import { join } from 'path';
import { homedir } from 'os';
import { mkdirSync, writeFileSync, chmodSync, renameSync, existsSync, readFileSync, rmSync } from 'fs';
import { releaseAssetName } from './platform.js';
import { parseSums, verifyChecksum } from './checksum.js';
import { safeFetch } from '../sync/client.js';

const RELEASE_BASE =
  process.env.COOKD_RELEASE_BASE ?? 'https://github.com/codeclowns01/cookd/releases/download';

export class BinaryInstallError extends Error {}

export function binDir(): string { return join(homedir(), '.cookd', 'bin'); }
export function binaryPath(): string {
  return join(binDir(), process.platform === 'win32' ? 'cookd.exe' : 'cookd');
}
export function isBinaryInstalled(): boolean { return existsSync(binaryPath()); }

/**
 * Which release is sitting in `~/.cookd/bin` right now.
 *
 * Recorded in a marker file beside the binary rather than asked of the binary
 * itself. Spawning it to read `--version` would mean executing a downloaded
 * artifact just to decide whether to replace it, on every `npx` run — a worse
 * trade than one four-byte file.
 *
 * Returns null when the marker is missing, which is the correct answer for
 * every binary installed before this existed: unknown counts as stale.
 */
export function versionMarkerPath(): string { return join(binDir(), '.version'); }

export function installedBinaryVersion(): string | null {
  try {
    const v = readFileSync(versionMarkerPath(), 'utf8').trim();
    return v.length > 0 ? v : null;
  } catch {
    return null;
  }
}

export function clearVersionMarker(): void {
  rmSync(versionMarkerPath(), { force: true });
}

export function assetUrl(base: string, version: string, asset: string): string {
  return `${base}/v${version}/${asset}`;
}
export function sumsUrl(base: string, version: string): string {
  return `${base}/v${version}/SHA256SUMS`;
}

/** Verify the checksum, then atomically write the binary. Throws BinaryInstallError on mismatch.
 *  `version`, when given, is recorded beside the binary so a later run can tell
 *  whether what is installed is current. Written only AFTER the rename, so a
 *  failed or interrupted install can never leave a marker claiming a version
 *  that is not on disk. */
export function installFromBuffers(bin: Buffer, sums: string, asset: string, dest: string, version?: string): void {
  const expected = parseSums(sums, asset);
  if (!expected) throw new BinaryInstallError(`no checksum for ${asset} in SHA256SUMS`);
  if (!verifyChecksum(bin, expected)) throw new BinaryInstallError(`checksum mismatch for ${asset}`);
  mkdirSync(join(dest, '..'), { recursive: true });
  const tmp = `${dest}.tmp`;
  writeFileSync(tmp, bin);
  if (process.platform !== 'win32') chmodSync(tmp, 0o755);
  renameSync(tmp, dest); // atomic
  if (version) writeFileSync(join(dest, '..', '.version'), `${version}\n`, 'utf8');
}

/** Download the matching binary + SHA256SUMS for `version` and install to ~/.cookd/bin. */
export async function downloadBinary(version: string): Promise<void> {
  const asset = releaseAssetName();
  if (!asset) {
    throw new BinaryInstallError(`no prebuilt cookd binary for ${process.platform}/${process.arch}`);
  }
  // safeFetch reuses the proxy/TLS-inspection error handling from the sync client,
  // so corporate-network users get an actionable message on the ~60MB download too.
  const [binRes, sumsRes] = await Promise.all([
    safeFetch(assetUrl(RELEASE_BASE, version, asset)),
    safeFetch(sumsUrl(RELEASE_BASE, version)),
  ]);
  if (!binRes.ok) throw new BinaryInstallError(`download failed: ${binRes.status}`);
  if (!sumsRes.ok) throw new BinaryInstallError(`checksums fetch failed: ${sumsRes.status}`);
  const bin = Buffer.from(await binRes.arrayBuffer());
  const sums = await sumsRes.text();
  installFromBuffers(bin, sums, asset, binaryPath(), version);
}
