import { describe, it, expect } from 'vitest';
import { releaseAssetName } from '../../src/hooks/platform.js';

describe('releaseAssetName', () => {
  it('maps linux x64', () => expect(releaseAssetName('linux', 'x64')).toBe('cookd-linux-x64'));
  it('maps linux arm64', () => expect(releaseAssetName('linux', 'arm64')).toBe('cookd-linux-arm64'));
  it('maps darwin arm64', () => expect(releaseAssetName('darwin', 'arm64')).toBe('cookd-darwin-arm64'));
  it('maps darwin x64', () => expect(releaseAssetName('darwin', 'x64')).toBe('cookd-darwin-x64'));
  it('maps windows x64 with .exe', () => expect(releaseAssetName('win32', 'x64')).toBe('cookd-windows-x64.exe'));
  it('returns null for unsupported (win arm64)', () => expect(releaseAssetName('win32', 'arm64')).toBeNull());
  it('returns null for unknown', () => expect(releaseAssetName('sunos' as NodeJS.Platform, 'x64')).toBeNull());
});
