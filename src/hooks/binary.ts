import { join } from 'path';
import { homedir } from 'os';
import { mkdirSync, writeFileSync, chmodSync, renameSync, existsSync } from 'fs';
import { releaseAssetName } from './platform.js';
import { parseSums, verifyChecksum } from './checksum.js';

const RELEASE_BASE =
  process.env.COOKD_RELEASE_BASE ?? 'https://github.com/codeclowns01/cookd/releases/download';

export class BinaryInstallError extends Error {}

export function binDir(): string { return join(homedir(), '.cookd', 'bin'); }
export function binaryPath(): string {
  return join(binDir(), process.platform === 'win32' ? 'cookd.exe' : 'cookd');
}
export function isBinaryInstalled(): boolean { return existsSync(binaryPath()); }

export function assetUrl(base: string, version: string, asset: string): string {
  return `${base}/v${version}/${asset}`;
}
export function sumsUrl(base: string, version: string): string {
  return `${base}/v${version}/SHA256SUMS`;
}

/** Verify the checksum, then atomically write the binary. Throws BinaryInstallError on mismatch. */
export function installFromBuffers(bin: Buffer, sums: string, asset: string, dest: string): void {
  const expected = parseSums(sums, asset);
  if (!expected) throw new BinaryInstallError(`no checksum for ${asset} in SHA256SUMS`);
  if (!verifyChecksum(bin, expected)) throw new BinaryInstallError(`checksum mismatch for ${asset}`);
  mkdirSync(join(dest, '..'), { recursive: true });
  const tmp = `${dest}.tmp`;
  writeFileSync(tmp, bin);
  if (process.platform !== 'win32') chmodSync(tmp, 0o755);
  renameSync(tmp, dest); // atomic
}

/** Download the matching binary + SHA256SUMS for `version` and install to ~/.cookd/bin. */
export async function downloadBinary(version: string): Promise<void> {
  const asset = releaseAssetName();
  if (!asset) {
    throw new BinaryInstallError(`no prebuilt cookd binary for ${process.platform}/${process.arch}`);
  }
  const [binRes, sumsRes] = await Promise.all([
    fetch(assetUrl(RELEASE_BASE, version, asset)),
    fetch(sumsUrl(RELEASE_BASE, version)),
  ]);
  if (!binRes.ok) throw new BinaryInstallError(`download failed: ${binRes.status}`);
  if (!sumsRes.ok) throw new BinaryInstallError(`checksums fetch failed: ${sumsRes.status}`);
  const bin = Buffer.from(await binRes.arrayBuffer());
  const sums = await sumsRes.text();
  installFromBuffers(bin, sums, asset, binaryPath());
}
