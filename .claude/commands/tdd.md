---
description: Run the test suite (tsc --noEmit && vitest) and summarize results
---

Run `npm test` (chains `tsc --noEmit` then vitest with `.env` loaded via `--env-file-if-exists`, per PRD §16.2). Then summarize:

- Type-check: pass or the first error.
- Tests: passed / failed / skipped counts.
- For every skipped suite, name the missing env var from its `console.warn` line — per §16.2, a skip must always be visible, never silent.
- For every failure, the assertion message and the file/line.

Follow the TDD report style in `Claude.md`: if the result matches what was expected (red before implementing, green after), say so in one sentence and stop. Only elaborate when the result is a surprise.
