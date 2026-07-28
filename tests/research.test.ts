import { describe, it, expect, vi, afterEach } from 'vitest';
import { researchCompany } from '../src/agent/research.ts';

describe('researchCompany — missing env (always runs)', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('throws a clear, actionable error when ANTHROPIC_API_KEY is missing', async () => {
    vi.stubEnv('ANTHROPIC_API_KEY', '');
    await expect(researchCompany('Stripe')).rejects.toThrow(/ANTHROPIC_API_KEY/);
  });
});

if (!process.env.ANTHROPIC_API_KEY) {
  console.warn(
    '[skip] ANTHROPIC_API_KEY unset — researchCompany (seed) real-API suite skipped',
  );
}

// (researchCompany seed) only — this is the plain generateText smoke test.
// Tools, system prompt, and structured output are later-stage bullets
// ((search wiring) and (structurer + persistence)) and are out of scope here.
describe.skipIf(!process.env.ANTHROPIC_API_KEY)('researchCompany — seed (real API)', () => {
  it('is callable and returns a non-empty response when given a company name', async () => {
    const result = await researchCompany('Stripe');
    expect(typeof result).toBe('string');
    expect((result as string).length).toBeGreaterThan(0);
  });
});
