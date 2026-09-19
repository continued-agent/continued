import { createHash, timingSafeEqual } from "node:crypto";

function digest(value: string): Buffer {
  return createHash("sha256").update(value, "utf8").digest();
}

/**
 * Shared by the legacy `cn serve` transport and the remote/no-TUI transport.
 * Hashing first keeps timingSafeEqual's inputs a fixed length without ever
 * comparing bearer tokens with a regular equality operator.
 */
export function tokensEqual(provided: string, expected: string): boolean {
  return timingSafeEqual(digest(provided), digest(expected));
}
