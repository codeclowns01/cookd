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
});
