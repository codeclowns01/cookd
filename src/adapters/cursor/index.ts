import type { AgentAdapter, UsageEvent } from '../types.js';

export class CursorAdapter implements AgentAdapter {
  readonly name = 'cursor';
  readonly displayName = 'Cursor';

  async detect(): Promise<boolean> {
    return false;
  }

  async events(): Promise<UsageEvent[]> {
    return [];
  }

  watch(_cb: () => void): () => void {
    return () => {};
  }

  weightEvent(_e: UsageEvent): number {
    return 0;
  }

  estimatedLimit(): number | null {
    return null;
  }
}
