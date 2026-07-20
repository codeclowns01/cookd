import { describe, it, expect } from 'vitest';
import { sha256Hex, verifyChecksum, parseSums } from '../../src/hooks/checksum.js';

describe('checksum', () => {
  const data = Buffer.from('hello cookd');

  it('sha256Hex is stable and lowercase hex', () => {
    const h = sha256Hex(data);
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    expect(sha256Hex(data)).toBe(h);
  });

  it('verifyChecksum passes for matching hash', () => {
    expect(verifyChecksum(data, sha256Hex(data))).toBe(true);
  });

  it('verifyChecksum fails on mismatch and is case-insensitive on match', () => {
    expect(verifyChecksum(data, '0'.repeat(64))).toBe(false);
    expect(verifyChecksum(data, sha256Hex(data).toUpperCase())).toBe(true);
  });

  it('parseSums finds the hash for a given filename', () => {
    const sums = `${sha256Hex(data)}  cookd-linux-x64\n${'a'.repeat(64)}  cookd-darwin-arm64\n`;
    expect(parseSums(sums, 'cookd-linux-x64')).toBe(sha256Hex(data));
    expect(parseSums(sums, 'cookd-missing')).toBeNull();
  });
});
