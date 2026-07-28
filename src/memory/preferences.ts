import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { tool } from 'ai';
import { z } from 'zod';

const PREFERENCES_PATH = 'src/memory/preferences.md';
const HEADER = '# Preferences';

export const listPreferences = tool({
  description:
    'List all saved user preferences that shape how prospects are researched, scored, and pitched. Call this at the start of every research run, before analysis, to see which preferences apply.',
  inputSchema: z.object({}),
  execute: async (): Promise<string> => {
    if (!existsSync(PREFERENCES_PATH)) return '';
    return readFileSync(PREFERENCES_PATH, 'utf8');
  },
});

export const addPreference = tool({
  description:
    'Save a new user preference as a bullet in the preferences file. Only call this when the user explicitly states a preference to remember — never invent one from inference.',
  inputSchema: z.object({ text: z.string() }),
  execute: async ({ text }): Promise<string> => {
    const content = existsSync(PREFERENCES_PATH)
      ? readFileSync(PREFERENCES_PATH, 'utf8')
      : `${HEADER}\n\n`;

    const bullet = `- ${text}`;
    const alreadyExists = content.split('\n').some((line) => line.trim() === bullet);
    if (alreadyExists) return content;

    const separator = content.endsWith('\n') ? '' : '\n';
    const updated = `${content}${separator}${bullet}\n`;
    writeFileSync(PREFERENCES_PATH, updated);
    return updated;
  },
});

export const removePreference = tool({
  description:
    'Remove a saved user preference matching the given text (case-insensitive substring match). Call this when the user asks to forget or remove a previously saved preference.',
  inputSchema: z.object({ text: z.string() }),
  execute: async ({ text }): Promise<string> => {
    if (!existsSync(PREFERENCES_PATH)) return '';

    const content = readFileSync(PREFERENCES_PATH, 'utf8');
    const needle = text.toLowerCase();
    let removed = false;

    const lines = content.split('\n').filter((line) => {
      if (!removed && line.trim().startsWith('-') && line.toLowerCase().includes(needle)) {
        removed = true;
        return false;
      }
      return true;
    });

    const updated = lines.join('\n');
    writeFileSync(PREFERENCES_PATH, updated);
    return updated;
  },
});
