import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { ToolCallOptions } from '@ai-sdk/provider-utils';
import { listPreferences, addPreference, removePreference } from '../../src/memory/preferences.ts';

const PREFERENCES_PATH = 'src/memory/preferences.md';
const TOOL_CALL_OPTS = { toolCallId: 'test', messages: [] } satisfies ToolCallOptions;

// Snapshot whatever is on disk before each test and put it back after —
// per §16.1 "Tests restore the file (or delete the test-created one) after
// running", tests hit the real file (no mocks) so every test must leave the
// working tree exactly as it found it.
let backup: string | null;

beforeEach(() => {
  backup = existsSync(PREFERENCES_PATH) ? readFileSync(PREFERENCES_PATH, 'utf8') : null;
});

afterEach(() => {
  if (backup === null) {
    if (existsSync(PREFERENCES_PATH)) rmSync(PREFERENCES_PATH);
  } else {
    writeFileSync(PREFERENCES_PATH, backup);
  }
});

describe('listPreferences', () => {
  it('returns the file contents as a string', async () => {
    writeFileSync(
      PREFERENCES_PATH,
      '# Preferences\n\n- Prefer subject lines under 50 characters.\n',
    );

    const result = await listPreferences.execute!({}, TOOL_CALL_OPTS);

    expect(result).toBe('# Preferences\n\n- Prefer subject lines under 50 characters.\n');
  });

  it('returns "" when the file does not yet exist', async () => {
    if (existsSync(PREFERENCES_PATH)) rmSync(PREFERENCES_PATH);

    const result = await listPreferences.execute!({}, TOOL_CALL_OPTS);

    expect(result).toBe('');
  });
});

describe('addPreference', () => {
  it('creates the file with a "# Preferences" header on first write', async () => {
    if (existsSync(PREFERENCES_PATH)) rmSync(PREFERENCES_PATH);

    await addPreference.execute!(
      { text: 'Prefer subject lines under 50 characters.' },
      TOOL_CALL_OPTS,
    );

    const content = readFileSync(PREFERENCES_PATH, 'utf8');
    expect(content).toContain('# Preferences');
    expect(content).toContain('Prefer subject lines under 50 characters.');
  });

  it('appends a new bullet, round-tripping through listPreferences', async () => {
    writeFileSync(PREFERENCES_PATH, '# Preferences\n\n- Prefer subject lines under 50 characters.\n');

    await addPreference.execute!(
      { text: 'Always include the prospect’s recent hiring trajectory in the overview section.' },
      TOOL_CALL_OPTS,
    );

    const result = await listPreferences.execute!({}, TOOL_CALL_OPTS);
    expect(result).toContain('Prefer subject lines under 50 characters.');
    expect(result).toContain(
      'Always include the prospect’s recent hiring trajectory in the overview section.',
    );
  });

  it('is idempotent on exact-match — adding the same preference twice does not duplicate', async () => {
    if (existsSync(PREFERENCES_PATH)) rmSync(PREFERENCES_PATH);
    const text = 'For shipping companies, lead with 24/7 multilingual deflection.';

    await addPreference.execute!({ text }, TOOL_CALL_OPTS);
    await addPreference.execute!({ text }, TOOL_CALL_OPTS);

    const result = (await listPreferences.execute!({}, TOOL_CALL_OPTS)) as string;
    const occurrences = result.split(text).length - 1;
    expect(occurrences).toBe(1);
  });
});

describe('removePreference', () => {
  it('removes a matching bullet from the file', async () => {
    writeFileSync(
      PREFERENCES_PATH,
      '# Preferences\n\n- Prefer subject lines under 50 characters.\n- Always include hiring trajectory.\n',
    );

    await removePreference.execute!(
      { text: 'Prefer subject lines under 50 characters.' },
      TOOL_CALL_OPTS,
    );

    const result = await listPreferences.execute!({}, TOOL_CALL_OPTS);
    expect(result).not.toContain('Prefer subject lines under 50 characters.');
    expect(result).toContain('Always include hiring trajectory.');
  });

  it('matches case-insensitively, as a substring of the bullet', async () => {
    writeFileSync(
      PREFERENCES_PATH,
      '# Preferences\n\n- Prefer SUBJECT LINES under 50 characters.\n',
    );

    await removePreference.execute!({ text: 'subject lines' }, TOOL_CALL_OPTS);

    const result = await listPreferences.execute!({}, TOOL_CALL_OPTS);
    expect(result).not.toContain('Prefer SUBJECT LINES under 50 characters.');
  });

  it('removes only the first match when multiple bullets match', async () => {
    writeFileSync(
      PREFERENCES_PATH,
      '# Preferences\n\n- Multilingual support for shipping companies.\n- Multilingual support for logistics companies.\n',
    );

    await removePreference.execute!({ text: 'multilingual support' }, TOOL_CALL_OPTS);

    const result = await listPreferences.execute!({}, TOOL_CALL_OPTS);
    expect(result).toContain('Multilingual support for logistics companies.');
    expect(result).not.toContain('Multilingual support for shipping companies.');
  });
});
