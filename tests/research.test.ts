import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { researchCompany } from '../src/agent/research.ts';

const PREFERENCES_PATH = 'src/memory/preferences.md';

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
    '[skip] ANTHROPIC_API_KEY unset — researchCompany (search wiring + preferences wiring) real-API suite skipped',
  );
}
if (!process.env.TAVILY_API_KEY) {
  console.warn(
    '[skip] TAVILY_API_KEY unset — researchCompany (search wiring + preferences wiring) real-API suite skipped',
  );
}

// (search wiring) + (preferences wiring) — asserts searchWeb is reachable and
// gets invoked during a researchCompany run, and that the preference tools
// are wired into the same loop: every run starts with a listPreferences call,
// and stateful user feedback triggers addPreference. Structured output
// ((structurer + persistence)) is a later-stage bullet and out of scope here.
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

    // (preferences wiring) — the acceptance test for this stage. Without it,
    // the wiring can silently regress when someone edits the tools map.
    it('begins with a listPreferences tool call', async () => {
      const result = await researchCompany('Stripe');

      const toolCallNames = result.steps.flatMap((step) =>
        step.toolCalls.map((call) => call.toolName),
      );
      expect(toolCallNames[0]).toBe('listPreferences');
    });

    // (preferences wiring) — stateful feedback in the user's message triggers
    // addPreference within the same run, and the new preference is observable
    // in preferences.md afterward. Restores the real file per §16.
    describe('stateful preference feedback', () => {
      let backup: string | null;

      beforeEach(() => {
        backup = existsSync(PREFERENCES_PATH) ? readFileSync(PREFERENCES_PATH, 'utf8') : null;
      });

      afterEach(() => {
        try {
          if (backup === null) {
            if (existsSync(PREFERENCES_PATH)) rmSync(PREFERENCES_PATH);
          } else {
            writeFileSync(PREFERENCES_PATH, backup);
          }
        } catch (err) {
          console.warn('[cleanup] failed to restore preferences.md', err);
        }
      });

      it('triggers an addPreference tool call and the preference is observable in preferences.md', async () => {
        const token = 'Cantonese and Bahasa Indonesia';
        const message = `For shipping and logistics companies, always lead with 24/7 multilingual deflection covering ${token}.`;

        const result = await researchCompany(message);

        const toolCallNames = result.steps.flatMap((step) =>
          step.toolCalls.map((call) => call.toolName),
        );
        expect(toolCallNames).toContain('addPreference');

        const preferences = readFileSync(PREFERENCES_PATH, 'utf8');
        expect(preferences).toContain(token);
      });
    });
  },
);
