import { homedir } from 'os';
import { isAbsolute, join, relative } from 'path';
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
 *
 * **The walk is confined to `dir`.** Making discovery recursive also made it
 * possible to leave the transcript tree: `readdir` reports a symlinked directory
 * as a link rather than a directory, so following those — which is required, and
 * which the one-level version never had to do — meant a link planted under
 * `~/.claude/projects/` would be walked into, and any `.jsonl` beneath it read
 * and folded into the numbers we upload. Every resolved path is now checked
 * against the resolved root and anything outside is skipped.
 *
 * The exposure was small (aggregate token counts, never file contents) and
 * needed local write access to the user's home directory to set up. It is closed
 * anyway, because the cost is a path comparison and the alternative is carrying
 * a filesystem escape in code that runs unattended after every Claude turn.
 *
 * Note the root is resolved FIRST and comparisons are made against the resolved
 * form. A user whose `~/.claude` is itself a symlink — dotfiles kept in a repo,
 * a synced folder — is unaffected: their whole tree resolves under one real
 * prefix and stays inside it.
 */
export async function jsonlFilesIn(dir: string): Promise<TranscriptFile[]> {
  const out: TranscriptFile[] = [];
  const seen = new Set<string>();

  let base: string;
  try {
    base = await realpath(dir);
  } catch {
    return out; // the project directory itself is gone
  }

  /** Is `target` the root, or genuinely beneath it? */
  function isInside(target: string): boolean {
    if (target === base) return true;
    const rel = relative(base, target);
    // `..` escapes upward; an absolute result means a different root entirely
    // (another drive on Windows). Segment-aware, so `projects/foo-evil` is not
    // mistaken for a child of `projects/foo`.
    return rel !== '' && !rel.startsWith('..') && !isAbsolute(rel);
  }

  async function walk(current: string, depth: number): Promise<void> {
    if (depth > MAX_DEPTH) return;

    let real: string;
    try {
      real = await realpath(current);
    } catch {
      return;
    }
    if (!isInside(real)) return;
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
