export type SessionStatus = 'idle' | 'cooking' | 'cookd';

export interface Tonight {
  prompts?: number;
  agentRuns?: number;
  maxContext?: number;
  outputTokens?: number;
  cacheReadPct?: number;
  models?: Record<string, number>;
  tools?: [string, number][];
  topProject?: string;
  topProjectPct?: number;
  firstPromptAt?: string;
  timeToCookMins?: number;
  yoloPct?: number;
  toolErrors?: number;
  sessionsCount?: number;
}

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
  prompts?: number;
  toolCalls?: number;
  peakHour?: number;
}

export interface CookedEventPayload {
  cookedAt: string;
  usedTokens: number;
  limitTokens: number;
  timeToCookMins?: number;
  topModel?: string;
  resetsAt?: string;
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
  tonight?: Tonight;
  cookedEvent?: CookedEventPayload;
}
