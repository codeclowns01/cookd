import { basename } from 'path';
import chokidar from 'chokidar';
import type { AgentAdapter, UsageEvent } from '../types.js';
import { claudeProjectsRoot, discoverProjectDirs, jsonlFilesIn, exists } from './paths.js';
import { parseJsonl, deduplicateEvents } from './transcript.js';
import { computeWeightedTokens } from './window.js';
import { loadCalibration } from './calibration-store.js';

export class ClaudeCodeAdapter implements AgentAdapter {
  readonly name = 'claude-code';
  readonly displayName = 'Claude Code';

  async detect(): Promise<boolean> {
    return exists(claudeProjectsRoot());
  }

  async events(): Promise<UsageEvent[]> {
    const dirs = await discoverProjectDirs();
    const allEvents: UsageEvent[] = [];

    for (const dir of dirs) {
      const projectName = basename(dir);
      const files = await jsonlFilesIn(dir);
      for (const file of files) {
        const sessionId = basename(file, '.jsonl');
        const events = await parseJsonl(file);
        for (const e of events) {
          e.sessionId ??= sessionId;
          e.projectName = projectName;
        }
        allEvents.push(...events);
      }
    }

    return deduplicateEvents(allEvents).sort((a, b) => a.ts.getTime() - b.ts.getTime());
  }

  watch(cb: () => void): () => void {
    const root = claudeProjectsRoot();
    const watcher = chokidar.watch(`${root}/**/*.jsonl`, {
      ignoreInitial: true,
      persistent: true,
      awaitWriteFinish: { stabilityThreshold: 500, pollInterval: 100 },
    });

    watcher.on('add', cb).on('change', cb);

    return () => { watcher.close(); };
  }

  weightEvent(e: UsageEvent): number {
    return computeWeightedTokens(e);
  }

  estimatedLimit(): number | null {
    return loadCalibration()?.cpLimit ?? null;
  }
}
