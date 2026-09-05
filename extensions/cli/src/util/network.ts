import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

import type { FetchFunction } from "core/index.js";

const MAX_REDIRECTS = 5;

function isPrivateIpv4(address: string): boolean {
  const octets = address.split(".").map(Number);
  if (
    octets.length !== 4 ||
    octets.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255)
  ) {
    return false;
  }

  const [first, second, third] = octets;
  return (
    first === 0 ||
    first === 10 ||
    (first === 100 && second >= 64 && second <= 127) ||
    first === 127 ||
    (first === 169 && second === 254) ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && (second === 0 || second === 168)) ||
    (first === 198 && second >= 18 && second <= 19) ||
    (first === 203 && second === 0 && third === 113) ||
    first >= 224
  );
}

function ipv6ToBigInt(address: string): bigint | undefined {
  const normalized = address.toLowerCase().split("%", 1)[0];
  const ipv4Separator = normalized.lastIndexOf(":");
  if (normalized.includes(".") && ipv4Separator !== -1) {
    const ipv4 = normalized.slice(ipv4Separator + 1);
    if (!isPrivateIpv4(ipv4)) {
      const octets = ipv4.split(".").map(Number);
      const ipv4Hex = octets.map((octet) =>
        octet.toString(16).padStart(2, "0"),
      );
      const prefix = normalized.slice(0, ipv4Separator);
      return ipv6ToBigInt(
        `${prefix}:${ipv4Hex.slice(0, 2).join("")}:${ipv4Hex.slice(2).join("")}`,
      );
    }
  }

  const [left, right] = normalized.split("::");
  const leftParts = left ? left.split(":") : [];
  const rightParts = right ? right.split(":") : [];
  const parts = normalized.includes("::")
    ? [
        ...leftParts,
        ...Array(8 - leftParts.length - rightParts.length).fill("0"),
        ...rightParts,
      ]
    : leftParts;

  if (
    parts.length !== 8 ||
    parts.some((part) => !/^[0-9a-f]{1,4}$/.test(part))
  ) {
    return undefined;
  }

  return BigInt(`0x${parts.map((part) => part.padStart(4, "0")).join("")}`);
}

function isInIpv6Cidr(
  address: bigint,
  network: bigint,
  prefixLength: number,
): boolean {
  const mask =
    prefixLength === 0 ? 0n : ((1n << 128n) - 1n) << BigInt(128 - prefixLength);
  return (address & mask) === network;
}

export function isPrivateNetworkAddress(address: string): boolean {
  const normalized = address.toLowerCase().split("%", 1)[0];
  const mappedIpv4 = normalized.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mappedIpv4) {
    return isPrivateIpv4(mappedIpv4[1]);
  }

  const version = isIP(address);
  if (version === 4) {
    return isPrivateIpv4(address);
  }
  if (version !== 6) {
    return false;
  }

  const parsed = ipv6ToBigInt(address);
  if (parsed === undefined) {
    return false;
  }

  // URL parsers normalize IPv4-mapped IPv6 literals to hexadecimal form.
  if (parsed >> 32n === 0xffffn) {
    const ipv4Number = Number(parsed & 0xffffffffn);
    const ipv4 = [
      ipv4Number >>> 24,
      (ipv4Number >>> 16) & 0xff,
      (ipv4Number >>> 8) & 0xff,
      ipv4Number & 0xff,
    ].join(".");
    return isPrivateIpv4(ipv4);
  }

  return (
    parsed === 0n ||
    parsed === 1n ||
    isInIpv6Cidr(parsed, BigInt("0xfc000000000000000000000000000000"), 7) ||
    isInIpv6Cidr(parsed, BigInt("0xfe800000000000000000000000000000"), 10) ||
    isInIpv6Cidr(parsed, BigInt("0xff000000000000000000000000000000"), 8) ||
    isInIpv6Cidr(parsed, BigInt("0x20010db8000000000000000000000000"), 32) ||
    isInIpv6Cidr(parsed, BigInt("0x20010000000000000000000000000000"), 32)
  );
}

function isBlockedHostname(hostname: string): boolean {
  const normalized = hostname.toLowerCase().replace(/\.$/, "");
  return (
    normalized === "localhost" ||
    normalized.endsWith(".localhost") ||
    normalized.endsWith(".local") ||
    normalized.endsWith(".internal")
  );
}

/** Reject schemes and destinations that cross the local-network boundary. */
export async function assertSafeFetchUrl(input: string | URL): Promise<URL> {
  const url = new URL(input);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(`Unsupported URL scheme: ${url.protocol}`);
  }
  if (url.username || url.password) {
    throw new Error("URLs with embedded credentials are not allowed");
  }

  const hostname = url.hostname.replace(/^\[|\]$/g, "");
  if (isBlockedHostname(hostname) || isPrivateNetworkAddress(hostname)) {
    throw new Error(
      "Requests to private or local network addresses are not allowed",
    );
  }

  if (isIP(hostname) === 0) {
    const addresses = await lookup(hostname, { all: true, verbatim: true });
    if (addresses.some(({ address }) => isPrivateNetworkAddress(address))) {
      throw new Error("The URL resolves to a private or local network address");
    }
  }

  return url;
}

/**
 * Fetch a public URL while revalidating every redirect destination. The CLI
 * uses this instead of native fetch for the model-facing Fetch tool.
 */
export const safeFetch: FetchFunction = async (input, init = {}) => {
  let url = await assertSafeFetchUrl(input);

  for (let redirectCount = 0; ; redirectCount += 1) {
    const response = await fetch(url, {
      ...init,
      redirect: "manual",
    });

    if (![301, 302, 303, 307, 308].includes(response.status)) {
      return response;
    }

    const location = response.headers.get("location");
    if (!location) {
      return response;
    }
    if (redirectCount >= MAX_REDIRECTS) {
      throw new Error(`Too many redirects while fetching ${url}`);
    }

    url = await assertSafeFetchUrl(new URL(location, url));
  }
};
