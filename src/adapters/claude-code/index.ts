import { basename } from 'path';
import chokidar from 'chokidar';
import type { AgentAdapter, UsageEvent } from '../types.js';
import { claudeProjectsRoot, discoverProjectDirs, jsonlFilesIn, exists } from './paths.js';
import { parseJsonl, deduplicateEvents, type SessionStats } from './transcript.js';
import { computeWeightedTokens } from './window.js';
import { loadCalibration } from './calibration-store.js';

export class ClaudeCodeAdapter implements AgentAdapter {
  readonly name = 'claude-code';
  readonly displayName = 'Claude Code';

  private _lastSessionStats: SessionStats = { prompts: 0, yoloPrompts: 0, toolCounts: {}, toolErrors: 0 };

  async detect(): Promise<boolean> {
    return exists(claudeProjectsRoot());
  }

  async events(): Promise<UsageEvent[]> {
    const today = new Date().toLocaleDateString('en-CA');
    const dirs = await discoverProjectDirs();
    const allEvents: UsageEvent[] = [];
    const agg: SessionStats = { prompts: 0, yoloPrompts: 0, toolCounts: {}, toolErrors: 0 };

    for (const dir of dirs) {
      const projectName = basename(dir);
      const files = await jsonlFilesIn(dir);
      for (const file of files) {
        const sessionId = basename(file, '.jsonl');
        const { events, sessionStats } = await parseJsonl(file, today);
        for (const e of events) {
          e.sessionId ??= sessionId;
          e.projectName = projectName;
        }
        allEvents.push(...events);
        agg.prompts += sessionStats.prompts;
        agg.yoloPrompts += sessionStats.yoloPrompts;
        agg.toolErrors += sessionStats.toolErrors;
        for (const [tool, count] of Object.entries(sessionStats.toolCounts)) {
          agg.toolCounts[tool] = (agg.toolCounts[tool] ?? 0) + count;
        }
      }
    }

    this._lastSessionStats = agg;
    return deduplicateEvents(allEvents).sort((a, b) => a.ts.getTime() - b.ts.getTime());
  }

  getSessionStats(): SessionStats {
    return this._lastSessionStats;
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
