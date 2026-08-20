import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../src/hooks/install.js', () => ({ installAutoSync: vi.fn() }));
vi.mock('../../src/hooks/binary.js', () => ({ binaryPath: () => '/home/u/.cookd/bin/cookd' }));
// offerAutoSync now short-circuits when the hooks are already installed (T6), so
// this must be pinned false — otherwise the test reads the developer's REAL
// ~/.claude/settings.json and the result depends on whose machine it runs on.
vi.mock('../../src/hooks/settings.js', () => ({
  hasCookdHook: vi.fn(() => false),
  claudeSettingsPath: () => '/home/u/.claude/settings.json',
}));

import { offerAutoSync } from '../../src/commands/init.js';
import { installAutoSync } from '../../src/hooks/install.js';
import { hasCookdHook } from '../../src/hooks/settings.js';

describe('offerAutoSync — non-interactive guard', () => {
  beforeEach(() => vi.clearAllMocks());

  it('does NOT install when stdin is not a TTY, and says so', async () => {
    const orig = process.stdin.isTTY;
    (process.stdin as any).isTTY = false;
    const lines: string[] = [];
    try {
      await offerAutoSync('1.0.0', (s) => lines.push(s));
    } finally {
      (process.stdin as any).isTTY = orig;
    }
    expect(installAutoSync).not.toHaveBeenCalled();
    expect(lines.join('\n')).toContain('auto-sync off');
  });
});

/**
 * ADR-012 T6. Re-asking for consent to an edit the user already approved reads
 * as if something failed — and after ADR-012 every re-run reaches this prompt,
 * so the re-ask became constant rather than occasional.
 */
describe('offerAutoSync — no re-prompt once the hooks exist', () => {
  beforeEach(() => vi.clearAllMocks());

  it('says nothing and installs nothing when the hook is already present', async () => {
    (hasCookdHook as any).mockReturnValue(true);
    const orig = process.stdin.isTTY;
    (process.stdin as any).isTTY = true;
    const lines: string[] = [];
    try {
      await offerAutoSync('1.0.0', (s) => lines.push(s));
    } finally {
      (process.stdin as any).isTTY = orig;
      (hasCookdHook as any).mockReturnValue(false);
    }
    expect(installAutoSync).not.toHaveBeenCalled();
    expect(lines.join('\n')).toBe('');
  });

  it('still offers when settings.json cannot be parsed — never crashes init', async () => {
    (hasCookdHook as any).mockImplementation(() => { throw new Error('not valid JSON'); });
    const orig = process.stdin.isTTY;
    (process.stdin as any).isTTY = false; // non-TTY: offer path, no install
    const lines: string[] = [];
    try {
      await offerAutoSync('1.0.0', (s) => lines.push(s));
    } finally {
      (process.stdin as any).isTTY = orig;
      (hasCookdHook as any).mockImplementation(() => false);
    }
    expect(lines.join('\n')).toContain('auto-sync off');
  });
});
