import { describe, it, expect } from 'vitest';
import { assetUrl, sumsUrl, installFromBuffers, BinaryInstallError } from '../../src/hooks/binary.js';
import { sha256Hex } from '../../src/hooks/checksum.js';
import { tmpdir } from 'os';
import { join } from 'path';
import { mkdtempSync, readFileSync, existsSync } from 'fs';

describe('binary provisioning', () => {
  it('builds asset + sums URLs from version', () => {
    const base = 'https://example.com/releases/download';
    expect(assetUrl(base, '1.2.3', 'cookd-linux-x64')).toBe(`${base}/v1.2.3/cookd-linux-x64`);
    expect(sumsUrl(base, '1.2.3')).toBe(`${base}/v1.2.3/SHA256SUMS`);
  });

  it('writes the binary when the checksum matches', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cookd-bin-'));
    const dest = join(dir, 'cookd');
    const bin = Buffer.from('#!/binary\x00payload');
    const sums = `${sha256Hex(bin)}  cookd-linux-x64\n`;
    installFromBuffers(bin, sums, 'cookd-linux-x64', dest);
    expect(existsSync(dest)).toBe(true);
    expect(readFileSync(dest).equals(bin)).toBe(true);
  });

  it('refuses to write on checksum mismatch', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cookd-bin-'));
    const dest = join(dir, 'cookd');
    const bin = Buffer.from('payload');
    const sums = `${'0'.repeat(64)}  cookd-linux-x64\n`;
    expect(() => installFromBuffers(bin, sums, 'cookd-linux-x64', dest)).toThrow(BinaryInstallError);
    expect(existsSync(dest)).toBe(false);
  });

  it('refuses to write when the asset is absent from SHA256SUMS', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cookd-bin-'));
    const dest = join(dir, 'cookd');
    const bin = Buffer.from('payload');
    expect(() => installFromBuffers(bin, `${'a'.repeat(64)}  other\n`, 'cookd-linux-x64', dest))
      .toThrow(BinaryInstallError);
    expect(existsSync(dest)).toBe(false);
  });
});

describe('binary version marker — the upgrade path (ADR 0009)', () => {
  it('records the version beside the binary when one is given', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cookd-bin-'));
    const dest = join(dir, 'cookd');
    const bin = Buffer.from('payload');
    const sums = `${sha256Hex(bin)}  cookd-linux-x64\n`;
    installFromBuffers(bin, sums, 'cookd-linux-x64', dest, '0.2.0');
    expect(readFileSync(join(dir, '.version'), 'utf8').trim()).toBe('0.2.0');
  });

  it('writes NO marker when the checksum fails', () => {
    // A marker claiming a version that was never installed is worse than none:
    // the next run would skip the download and keep firing the old binary.
    const dir = mkdtempSync(join(tmpdir(), 'cookd-bin-'));
    const dest = join(dir, 'cookd');
    expect(() => installFromBuffers(Buffer.from('x'), `${'0'.repeat(64)}  cookd-linux-x64\n`, 'cookd-linux-x64', dest, '0.2.0'))
      .toThrow(BinaryInstallError);
    expect(existsSync(join(dir, '.version'))).toBe(false);
  });
});
