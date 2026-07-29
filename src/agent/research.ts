import { readFileSync } from 'node:fs';
import { generateText, stepCountIs } from 'ai';
import { anthropic } from '@ai-sdk/anthropic';
import { searchWeb } from '../tools/tavily.ts';
import { listPreferences, addPreference, removePreference } from '../memory/preferences.ts';

const BRAIN_PROMPT = readFileSync('src/agent/prompts/brain.md', 'utf8');

export async function researchCompany(companyName: string) {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error(
      'ANTHROPIC_API_KEY is not set. Add it to your .env file or GitHub Codespaces secrets.',
    );
  }

  return generateText({
    model: anthropic('claude-haiku-4-5'),
    system: BRAIN_PROMPT,
    prompt: `Research the company "${companyName}" as a potential sales prospect.`,
    tools: { searchWeb, listPreferences, addPreference, removePreference },
    stopWhen: stepCountIs(8),
  });
}
