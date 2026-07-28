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
    expect(typeof result.text).toBe('string');
    expect(result.text.length).toBeGreaterThan(0);
  });
});

if (!process.env.ANTHROPIC_API_KEY) {
  console.warn(
    '[skip] ANTHROPIC_API_KEY unset — researchCompany (search wiring) real-API suite skipped',
  );
}
if (!process.env.TAVILY_API_KEY) {
  console.warn(
    '[skip] TAVILY_API_KEY unset — researchCompany (search wiring) real-API suite skipped',
  );
}

// (search wiring) only — asserts searchWeb is reachable and gets invoked
// during a researchCompany run. Structured output ((structurer + persistence))
// is a later-stage bullet and out of scope here.
describe.skipIf(!process.env.ANTHROPIC_API_KEY || !process.env.TAVILY_API_KEY)(
  'researchCompany — search wiring (real API)',
  () => {
    it('invokes searchWeb at least once during a research run', async () => {
      const result = await researchCompany('Stripe');
      expect(result.steps.length).toBeGreaterThan(1);

      const toolCallNames = result.steps.flatMap((step) =>
        step.toolCalls.map((call) => call.toolName),
      );
      expect(toolCallNames).toContain('searchWeb');
    });
  },
);
