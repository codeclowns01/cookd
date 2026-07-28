import { homedir } from 'os';
import { join } from 'path';
import { readdir, realpath, stat } from 'fs/promises';

export function claudeProjectsRoot(): string {
  return join(homedir(), '.claude', 'projects');
}

export async function discoverProjectDirs(): Promise<string[]> {
  const root = claudeProjectsRoot();
  try {
    const entries = await readdir(root, { withFileTypes: true });
    return entries
      .filter(e => e.isDirectory())
      .map(e => join(root, e.name));
  } catch {
    return [];
  }
}

/** A transcript file plus how deep below its project directory it was found.
 *  `depth: 0` is a top-level session transcript; anything deeper is a subagent
 *  transcript (ADR 0009 / journal D12). */
export interface TranscriptFile {
  path: string;
  depth: number;
}

/** Hard ceiling on recursion. Claude nests subagent transcripts one or two
 *  levels below the project directory; anything beyond this is not ours, and the
 *  cap keeps a pathological tree from turning a sync into a filesystem crawl. */
const MAX_DEPTH = 4;

/**
 * All `.jsonl` transcripts under `dir`, recursively.
 *
 * Previously this read exactly one directory level, so **subagent transcripts
 * were never discovered** — roughly 8% of real usage machine-wide, 21% in
 * agent-heavy sessions, and the reason `tonight.agentRuns` and `agentHeavyPct`
 * were structurally always 0 (journal defect B3).
 *
 * Symlinks are resolved and de-duplicated by real path, so a directory that
 * links back into its own ancestry cannot loop for ever.
 */
export async function jsonlFilesIn(dir: string): Promise<TranscriptFile[]> {
  const out: TranscriptFile[] = [];
  const seen = new Set<string>();

  async function walk(current: string, depth: number): Promise<void> {
    if (depth > MAX_DEPTH) return;

    let real: string;
    try {
      real = await realpath(current);
    } catch {
      return;
    }
    if (seen.has(real)) return;
    seen.add(real);

    let entries;
    try {
      entries = await readdir(current, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      const full = join(current, entry.name);
      if (entry.isFile()) {
        if (entry.name.endsWith('.jsonl')) out.push({ path: full, depth });
      } else if (entry.isDirectory() || entry.isSymbolicLink()) {
        // isSymbolicLink() covers a symlinked directory, which readdir reports
        // as a link rather than a directory. walk() resolves and guards it.
        await walk(full, depth + 1);
      }
    }
  }

  await walk(dir, 0);
  return out;
}

export async function exists(p: string): Promise<boolean> {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}
