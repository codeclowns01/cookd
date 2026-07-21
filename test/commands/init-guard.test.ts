import { describe, it, expect } from 'vitest';
import { shouldSkipPressCode } from '../../src/commands/init-guard.js';

describe('shouldSkipPressCode', () => {
  it('true when valid credentials exist', () => {
    expect(shouldSkipPressCode({ deviceToken: 't', handle: 'you', deviceId: 'd', linkedAt: 'now' })).toBe(true);
  });
  it('false when no credentials', () => {
    expect(shouldSkipPressCode(null)).toBe(false);
  });
  it('false when credentials are missing a device token', () => {
    expect(shouldSkipPressCode({ handle: 'you', deviceId: 'd', linkedAt: 'now' } as any)).toBe(false);
  });
});
