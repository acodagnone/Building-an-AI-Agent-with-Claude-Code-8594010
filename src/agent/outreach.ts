import { readFileSync } from 'node:fs';
import { generateObject } from 'ai';
import { anthropic } from '@ai-sdk/anthropic';
import { z } from 'zod';
import { getAirtableMcp, getProspectByDomain, createOutreach } from '../tools/airtable.ts';

const OUTREACH_PROMPT_PATH = 'src/agent/prompts/outreach.md';
const PREFERENCES_PATH = 'src/memory/preferences.md';

// §11.1
export const OutreachSchema = z.object({
  subjectLine: z.string().max(80),
  emailBody: z.string(),
  angleReasoning: z.string(),
});

export type Outreach = z.infer<typeof OutreachSchema>;

// §11.2 / §10 — read in code, not via the listPreferences tool (no loop means
// no tool calls here). A missing file is an empty string, not an error.
function readPreferences(): string {
  try {
    return readFileSync(PREFERENCES_PATH, 'utf8');
  } catch {
    return '';
  }
}

// §12.4 — one-shot generateObject call, no agent loop, no exploratory tools.
export async function draftOutreach(domain: string): Promise<Outreach> {
  // §11.2 — env validation runs first: before Airtable lookup, prompt load,
  // or model call, so a missing-env test never surfaces an Airtable error.
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error(
      'ANTHROPIC_API_KEY is not set. Add it to your .env file or GitHub Codespaces secrets.',
    );
  }

  const client = await getAirtableMcp();
  try {
    const prospect = await getProspectByDomain(client, domain);
    if (!prospect) {
      // §15 — no outreach without prior research.
      throw new Error(`Research ${domain} first. No prospect record found.`);
    }

    const preferences = readPreferences();
    const systemPrompt = readFileSync(OUTREACH_PROMPT_PATH, 'utf8');

    const { object } = await generateObject({
      model: anthropic('claude-haiku-4-5'),
      system: systemPrompt,
      schema: OutreachSchema,
      prompt: `Prospect record:\n${JSON.stringify(prospect, null, 2)}\n\nUser preferences:\n${preferences || '(none saved)'}`,
    });

    const outreach = OutreachSchema.parse(object);

    console.log(
      `\nSubject: ${outreach.subjectLine}\n\n${outreach.emailBody}\n\nAngle reasoning: ${outreach.angleReasoning}\n`,
    );

    await createOutreach(client, prospect.id, outreach);

    return outreach;
  } finally {
    await client.close();
  }
}
