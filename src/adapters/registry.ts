import type { AgentAdapter } from './types.js';
import { ClaudeCodeAdapter } from './claude-code/index.js';
import { CursorAdapter } from './cursor/index.js';

const ADAPTERS: AgentAdapter[] = [
  new ClaudeCodeAdapter(),
  new CursorAdapter(),
];

export async function detectAdapter(): Promise<AgentAdapter | null> {
  for (const adapter of ADAPTERS) {
    if (await adapter.detect()) return adapter;
  }
  return null;
}

export { ADAPTERS };
