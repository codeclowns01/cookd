// Must match the `target` values in .github/workflows/release.yml.
const TARGETS: Record<string, string> = {
  'linux-x64': 'cookd-linux-x64',
  'linux-arm64': 'cookd-linux-arm64',
  'darwin-x64': 'cookd-darwin-x64',
  'darwin-arm64': 'cookd-darwin-arm64',
  'win32-x64': 'cookd-windows-x64.exe',
};

/** Release asset filename for this platform, or null if no prebuilt binary exists. */
export function releaseAssetName(
  platform: NodeJS.Platform = process.platform,
  arch: string = process.arch,
): string | null {
  return TARGETS[`${platform}-${arch}`] ?? null;
}
