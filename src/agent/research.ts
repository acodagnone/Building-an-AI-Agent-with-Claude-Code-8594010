import { readFileSync } from 'node:fs';
import { generateText, generateObject, stepCountIs } from 'ai';
import { anthropic } from '@ai-sdk/anthropic';
import { z } from 'zod';
import { searchWeb } from '../tools/tavily.ts';
import { listPreferences, addPreference, removePreference } from '../memory/preferences.ts';
import { getAirtableMcp, upsertProspect } from '../tools/airtable.ts';

const BRAIN_PROMPT = readFileSync('src/agent/prompts/brain.md', 'utf8');

// §7.1 — colocated with the code that produces and validates prospects.
export const ProspectSchema = z.object({
  companyName: z.string(),
  domain: z.string(), // canonical key — set by caller, not the model. See §7.4.
  overview: z.string(), // 1–2 paragraphs
  signals: z
    .array(
      z.object({
        name: z.string(),
        description: z.string(),
        strength: z.enum(['strong', 'moderate', 'weak']),
      }),
    )
    .min(1),
  leadScore: z.number().int().min(1).max(100),
  scoreReasoning: z.string(), // why this number
  suggestedAngle: z.string(), // how to open the conversation
  lastResearched: z.string().datetime(), // ISO 8601, auto-set
});

export type Prospect = z.infer<typeof ProspectSchema>;

// §6 — canonical key: lowercase, no protocol/www, TLD stripped, alphanumerics only.
function normalizeToDomain(input: string): string {
  const withoutProtocol = input.trim().toLowerCase().replace(/^https?:\/\//, '');
  const withoutWww = withoutProtocol.replace(/^www\./, '');
  const dotIndex = withoutWww.indexOf('.');
  const withoutTld = dotIndex === -1 ? withoutWww : withoutWww.slice(0, dotIndex);
  return withoutTld.replace(/[^a-z0-9]/g, '');
}

// §12.3 — pinned verbatim. Paraphrasing causes silent extraction drift.
function structureProspectPrompt(companyName: string, analysisText: string): string {
  return `Extract a structured prospect for ${companyName} from the analysis below. Every field must come from the analysis text — do not invent values. Each signal's \`strength\` must be one of: strong, moderate, weak.

Analysis:
${analysisText}`;
}

// §12.3 / §7.4 — omits domain and lastResearched from the model's schema so
// the model has no slot to invent either. Exported for direct testing.
export async function structureProspect(text: string, companyName: string) {
  const { object } = await generateObject({
    model: anthropic('claude-haiku-4-5'),
    schema: ProspectSchema.omit({ domain: true, lastResearched: true }),
    prompt: structureProspectPrompt(companyName, text),
  });
  return object;
}

// §15 — "Schema validation fails on agent output: retry up to 2 times. If
// still failing, error with diagnostics." 3 total attempts.
const MAX_STRUCTURE_ATTEMPTS = 3;

async function structureAndValidate(analysisText: string, companyName: string): Promise<Prospect> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= MAX_STRUCTURE_ATTEMPTS; attempt++) {
    try {
      const partial = await structureProspect(analysisText, companyName);
      // §7.4 — deterministically attached by the caller, never derived by the
      // structurer and never invented by the model.
      return ProspectSchema.parse({
        ...partial,
        domain: normalizeToDomain(companyName),
        lastResearched: new Date().toISOString(),
      });
    } catch (err) {
      lastError = err;
    }
  }
  throw new Error(
    `structureProspect produced schema-invalid output for "${companyName}" after ${MAX_STRUCTURE_ATTEMPTS} attempts: ${lastError}`,
  );
}

export async function researchCompany(companyName: string) {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error(
      'ANTHROPIC_API_KEY is not set. Add it to your .env file or GitHub Codespaces secrets.',
    );
  }

  const client = await getAirtableMcp();
  try {
    const result = await generateText({
      model: anthropic('claude-haiku-4-5'),
      system: BRAIN_PROMPT,
      prompt: `Research the company "${companyName}" as a potential sales prospect.`,
      tools: { searchWeb, listPreferences, addPreference, removePreference },
      stopWhen: stepCountIs(8),
    });

    const prospect = await structureAndValidate(result.text, companyName);

    await upsertProspect(client, prospect);

    return { prospect, steps: result.steps };
  } finally {
    await client.close();
  }
}
