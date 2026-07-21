import { describe, it, expect } from 'vitest';
import { consentLines } from '../../src/ui/ink/Consent.js';

describe('consent copy contract', () => {
  const binaryPath = '/home/u/.cookd/bin/cookd';
  const text = consentLines(binaryPath).join('\n');

  it('names the file being edited', () => expect(text).toContain('~/.claude/settings.json'));

  it('faithfully names BOTH hooks (session start AND end)', () => {
    expect(text).toContain('START');
    expect(text).toContain('END');
  });

  it('shows the exact command run', () => {
    expect(text).toContain(`${binaryPath} sync`);
  });

  it('discloses the one-time binary download', () => {
    expect(text.toLowerCase()).toContain('download');
    expect(text).toContain('~60MB');
  });

  it('states the read/never boundary and uninstall path', () => {
    expect(text).toContain('only that session');
    expect(text.toLowerCase()).toContain('never');
    expect(text).toContain('cookd uninstall');
  });
});
