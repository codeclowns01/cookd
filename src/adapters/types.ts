export interface UsageEvent {
  ts: Date;
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens: number;
  cacheCreation1hTokens: number;
  cacheReadTokens: number;
  sessionId?: string;
  projectName?: string;
  isSidechain?: boolean;
  messageId?: string;
  limitResetAt?: Date;
}

export interface AgentAdapter {
  readonly name: string;
  readonly displayName: string;
  detect(): Promise<boolean>;
  events(): Promise<UsageEvent[]>;
  watch(cb: () => void): () => void;
  weightEvent(e: UsageEvent): number;
  estimatedLimit(): number | null;
}
