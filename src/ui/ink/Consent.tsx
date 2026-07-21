import { STAMP, MUT, FAINT } from '../theme.js';

/**
 * The exact-edit copy shown before we touch settings.json. Kept pure + tested.
 * Faithfully names BOTH hooks (SessionStart + SessionEnd), the exact command, and
 * discloses the one-time binary download — the transparency contract of this screen.
 */
export function consentLines(binaryPath: string): string[] {
  return [
    'keep your stats fresh automatically?',
    '',
    'cookd will add two hooks to  ~/.claude/settings.json :',
    `  · on Claude session START  ->  ${binaryPath} sync`,
    `  · on Claude session END    ->  ${binaryPath} sync`,
    '  (runs in the background, 30s cap; open the file for the exact JSON)',
    '',
    'what it does:  syncs your usage when a Claude session starts or ends.',
    'what it reads: only that session’s usage numbers.',
    'what it never: touches your prompts, code, or files.',
    '',
    'first run downloads a ~60MB helper to ~/.cookd/bin (one time).',
    'we back up your settings first and only add - never overwrite.',
    'remove anytime:  cookd uninstall',
  ];
}

/** Trust anchor: the "· on Claude session …" command lines render brightest (MUT),
 *  the headline in STAMP, supporting prose in FAINT. */
export function consentColorFor(line: string, index: number): string {
  if (index === 0) return STAMP;
  if (line.trimStart().startsWith('·')) return MUT;
  return FAINT;
}
