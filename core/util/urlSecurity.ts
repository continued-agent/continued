const BLOCKED_IPV4_RANGES: ReadonlyArray<readonly [number, number]> = [
  [0x00000000, 0xff000000], // 0.0.0.0/8
  [0x0a000000, 0xff000000], // 10.0.0.0/8
  [0x64400000, 0xffc00000], // 100.64.0.0/10
  [0x7f000000, 0xff000000], // 127.0.0.0/8
  [0xa9fe0000, 0xffff0000], // 169.254.0.0/16
  [0xac100000, 0xfff00000], // 172.16.0.0/12
  [0xc0000000, 0xffff0000], // 192.0.0.0/16
  [0xc0a80000, 0xffff0000], // 192.168.0.0/16
  [0xc6120000, 0xfffe0000], // 198.18.0.0/15
  [0xcb007100, 0xffffff00], // 203.0.113.0/24
  [0xe0000000, 0xe0000000], // 224.0.0.0/3
];

const BLOCKED_IPV6_PREFIXES = ["fc", "fd", "::ffff", "fe80:", "ff"];
const BLOCKED_HOSTNAME_SUFFIXES = [".localhost", ".local", ".internal"];

function parseIpv4(hostname: string): number | undefined {
  const octets = hostname.split(".");
  if (
    octets.length !== 4 ||
    octets.some((octet) => !/^\d{1,3}$/.test(octet) || Number(octet) > 255)
  ) {
    return undefined;
  }

  return octets.reduce((address, octet) => address * 256 + Number(octet), 0);
}

function isPrivateIpv4(hostname: string): boolean {
  const address = parseIpv4(hostname);
  return (
    address !== undefined &&
    BLOCKED_IPV4_RANGES.some(
      ([network, mask]) => (address & mask) === (network & mask),
    )
  );
}

function isBlockedIpv6(hostname: string): boolean {
  return (
    hostname.includes(":") &&
    (hostname === "::" ||
      hostname === "::1" ||
      BLOCKED_IPV6_PREFIXES.some((prefix) => hostname.startsWith(prefix)))
  );
}

function isBlockedHostname(hostname: string): boolean {
  return (
    hostname === "localhost" ||
    BLOCKED_HOSTNAME_SUFFIXES.some((suffix) => hostname.endsWith(suffix)) ||
    isPrivateIpv4(hostname) ||
    isBlockedIpv6(hostname)
  );
}

/**
 * Portable URL checks shared by browser and Node callers. Node-only callers
 * should additionally validate DNS results before making a request.
 */
export function isBlockedUrl(url: URL): boolean {
  if (!/^https?:$/.test(url.protocol)) {
    return true;
  }
  if (url.username || url.password) {
    return true;
  }

  const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  return isBlockedHostname(hostname);
}
