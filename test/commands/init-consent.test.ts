import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../src/hooks/install.js', () => ({ installAutoSync: vi.fn() }));
vi.mock('../../src/hooks/binary.js', () => ({ binaryPath: () => '/home/u/.cookd/bin/cookd' }));

import { offerAutoSync } from '../../src/commands/init.js';
import { installAutoSync } from '../../src/hooks/install.js';

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
