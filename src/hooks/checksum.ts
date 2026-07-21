import { createHash } from 'crypto';

export function sha256Hex(data: Buffer): string {
  return createHash('sha256').update(data).digest('hex');
}

export function verifyChecksum(data: Buffer, expectedHex: string): boolean {
  return sha256Hex(data) === expectedHex.trim().toLowerCase();
}

/** Parse a `SHA256SUMS` file ("<hex>  <filename>" per line) → hash for `filename`, or null. */
export function parseSums(contents: string, filename: string): string | null {
  for (const line of contents.split('\n')) {
    const m = /^([0-9a-fA-F]{64})\s+\*?(.+)$/.exec(line.trim());
    if (m && m[2].trim() === filename) return m[1].toLowerCase();
  }
  return null;
}
