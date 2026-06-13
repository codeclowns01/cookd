export type SessionStatus = 'idle' | 'cooking' | 'cookd';

export interface ModelSegment {
  model: string;
  cpTokens: number;
  pctOfWindow: number;
}

export interface DailyStats {
  localDate: string;
  totalCp: number;
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
  sessionCount: number;
  limitHitCount: number;
  peakPctUsed: number;
  modelBreakdown: Record<string, number>;
  firstSessionAt: number | null;
  lastActivityAt: number | null;
}

export interface LifetimeStats {
  totalTokens: number;
  tenureDays: number;
  prompts: number;
  topModel: string;
  models: Record<string, number>;
  topProject: string;
  peakHour: number;
  busiestDay: string;
  busiestDayTokens: number;
  maxContext: number;
  agentHeavyPct: number;
}

export interface WindowSummary {
  status: SessionStatus;
  usedTokens: number;
  limitTokens: number | null;
  pctUsed: number | null;
  windowStart: string | null;
  resetsAt: string | null;
  plan: string | null;
  calibrationConfidence: string;
  modelBreakdown: Record<string, number>;
  dailyStats: DailyStats;
}
