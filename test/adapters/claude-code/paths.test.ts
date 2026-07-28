import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, mkdir, writeFile, symlink, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join, basename } from 'path';
import { jsonlFilesIn } from '../../../src/adapters/claude-code/paths.js';

/**
 * Journal defect B3: discovery read exactly one directory level, so subagent
 * transcripts — which Claude writes below the project directory — were never
 * counted. That is ~8% of real usage machine-wide (21% in agent-heavy sessions)
 * and the reason tonight.agentRuns / agentHeavyPct were structurally always 0.
 */
describe('jsonlFilesIn — recursive transcript discovery', () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'cookd-paths-'));
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('finds a top-level transcript at depth 0', async () => {
    await writeFile(join(root, 'session-a.jsonl'), '');
    const found = await jsonlFilesIn(root);
    expect(found).toHaveLength(1);
    expect(basename(found[0].path)).toBe('session-a.jsonl');
    expect(found[0].depth).toBe(0);
  });

  it('finds nested subagent transcripts and reports their depth', async () => {
    await writeFile(join(root, 'main.jsonl'), '');
    await mkdir(join(root, 'subagents'), { recursive: true });
    await writeFile(join(root, 'subagents', 'agent-1.jsonl'), '');
    await mkdir(join(root, 'subagents', 'nested'), { recursive: true });
    await writeFile(join(root, 'subagents', 'nested', 'agent-2.jsonl'), '');

    const found = await jsonlFilesIn(root);
    const byName = Object.fromEntries(found.map(f => [basename(f.path), f.depth]));

    expect(Object.keys(byName).sort()).toEqual(['agent-1.jsonl', 'agent-2.jsonl', 'main.jsonl']);
    expect(byName['main.jsonl']).toBe(0);
    expect(byName['agent-1.jsonl']).toBe(1);
    expect(byName['agent-2.jsonl']).toBe(2);
  });

  it('ignores non-jsonl files', async () => {
    await writeFile(join(root, 'keep.jsonl'), '');
    await writeFile(join(root, 'skip.json'), '');
    await writeFile(join(root, 'skip.txt'), '');
    const found = await jsonlFilesIn(root);
    expect(found.map(f => basename(f.path))).toEqual(['keep.jsonl']);
  });

  it('stops at the depth cap instead of crawling for ever', async () => {
    // MAX_DEPTH is 4; a transcript at depth 6 must not be returned.
    const deep = join(root, 'a', 'b', 'c', 'd', 'e', 'f');
    await mkdir(deep, { recursive: true });
    await writeFile(join(deep, 'too-deep.jsonl'), '');
    await writeFile(join(root, 'a', 'b', 'shallow.jsonl'), '');

    const found = await jsonlFilesIn(root);
    const names = found.map(f => basename(f.path));
    expect(names).toContain('shallow.jsonl');
    expect(names).not.toContain('too-deep.jsonl');
  });

  it('does not loop for ever on a symlink pointing back up the tree', async () => {
    await mkdir(join(root, 'child'), { recursive: true });
    await writeFile(join(root, 'child', 'agent.jsonl'), '');
    try {
      await symlink(root, join(root, 'child', 'loop'), 'dir');
    } catch {
      // Windows without developer mode refuses symlink creation; the realpath
      // de-duplication is still exercised by the other cases.
      return;
    }

    const found = await jsonlFilesIn(root);
    // Terminates, and reports the real file exactly once despite the cycle.
    expect(found.filter(f => basename(f.path) === 'agent.jsonl')).toHaveLength(1);
  });

  it('returns an empty list for a directory that does not exist', async () => {
    expect(await jsonlFilesIn(join(root, 'nope'))).toEqual([]);
  });

  // ——— confinement ———
  //
  // Making discovery recursive also made it possible to LEAVE the transcript
  // tree: readdir reports a symlinked directory as a link, not a directory, so
  // following those (which subagent discovery requires) means a link planted
  // under ~/.claude/projects/ would be walked into and any .jsonl beneath it
  // read and folded into the numbers we upload. The one-level version never had
  // to follow a link, so this class did not exist before.
  describe('stays inside the transcript tree', () => {
    let outside: string;

    beforeEach(async () => {
      outside = await mkdtemp(join(tmpdir(), 'cookd-outside-'));
    });

    afterEach(async () => {
      await rm(outside, { recursive: true, force: true });
    });

    it('does NOT follow a symlink that escapes the project directory', async () => {
      await writeFile(join(root, 'mine.jsonl'), '');
      await writeFile(join(outside, 'not-mine.jsonl'), '');
      try {
        await symlink(outside, join(root, 'escape'), 'dir');
      } catch {
        return; // Windows without developer mode refuses symlink creation
      }

      const found = await jsonlFilesIn(root);
      const names = found.map(f => basename(f.path));
      expect(names).toContain('mine.jsonl');
      expect(names).not.toContain('not-mine.jsonl');
    });

    it('does not escape via a deeply nested link either', async () => {
      await mkdir(join(root, 'a', 'b'), { recursive: true });
      await writeFile(join(outside, 'not-mine.jsonl'), '');
      try {
        await symlink(outside, join(root, 'a', 'b', 'escape'), 'dir');
      } catch {
        return;
      }

      const found = await jsonlFilesIn(root);
      expect(found.map(f => basename(f.path))).not.toContain('not-mine.jsonl');
    });

    it('still walks a link that stays inside the tree', async () => {
      // Confinement must not break the legitimate case: a link is only refused
      // for pointing OUT, not for being a link.
      await mkdir(join(root, 'real'), { recursive: true });
      await writeFile(join(root, 'real', 'agent.jsonl'), '');
      try {
        await symlink(join(root, 'real'), join(root, 'alias'), 'dir');
      } catch {
        return;
      }

      const found = await jsonlFilesIn(root);
      // Found via the real path; the alias resolves to the same directory and is
      // de-duplicated rather than counted twice.
      expect(found.filter(f => basename(f.path) === 'agent.jsonl')).toHaveLength(1);
    });

    it('is not fooled by a sibling directory sharing a name prefix', async () => {
      // `projects/foo-evil` must not read as a child of `projects/foo`. A
      // startsWith() check on the raw path would let this through.
      const sibling = join(root, '..', `${basename(root)}-evil`);
      await mkdir(sibling, { recursive: true });
      await writeFile(join(sibling, 'not-mine.jsonl'), '');
      try {
        await writeFile(join(root, 'mine.jsonl'), '');
        await symlink(sibling, join(root, 'link'), 'dir');
      } catch {
        await rm(sibling, { recursive: true, force: true });
        return;
      }

      const found = await jsonlFilesIn(root);
      expect(found.map(f => basename(f.path))).not.toContain('not-mine.jsonl');
      await rm(sibling, { recursive: true, force: true });
    });
  });
});
