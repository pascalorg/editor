---
name: repo-check
description: Run Pascal's full repository quality gate, diagnose failures, fix actionable issues, rerun the gate, and report blockers and suggestions. Use when the user asks to run the project checks, tests, type checks, skill validation, build, or fix CI-style failures locally.
metadata:
  internal: true
---

# Repo Check

## Run

From the repository root, read `AGENTS.md`, record `git status --short`, then run every command in order. Capture each exit code and relevant diagnostics, even if an earlier command fails.

   ```bash
   bun run check
   bun run skills:validate
   bun run check-types
   bun run test
   bun run build
   ```

## Fix and rerun

Trace each failure to its cause. Read files fully before editing; make focused fixes and preserve unrelated work. Report environmental or unrelated failures as blockers with evidence and a next step. After fixes, rerun all five commands from the start until they pass or only external blockers remain. Review the final status and diff; every change must map to a fix.

## Report

Report the overall result and each command's status; note reruns. List fixes by file with cause and change. For blockers, give command, diagnostic, reason, and next step. Keep optional suggestions separate. Write “None” for empty sections.
