---
name: open-pr
description: Open a pull request on pascalorg/editor using the repo's PR template. Use when the user asks to open/create a PR, push and PR, or ship a branch in the editor repo.
allowed-tools: Bash(git *) Bash(gh *) Read
---

Open a pull request against `pascalorg/editor` from the current branch.

## 1. Pre-flight

```bash
git status                # confirm working tree state
git branch --show-current # confirm we're on a feature branch, not main
git log --oneline main..HEAD
```

Stop if:
- The current branch is `main`. Ask the user to create a feature branch first.
- The branch has no commits ahead of `main`. Nothing to open a PR for.
- There are uncommitted changes the user hasn't asked to commit.

Run a build sanity check if the change is non-trivial:

```bash
bun typecheck
bun build
```

Don't open the PR with a broken build.

## 2. Read the PR template

The template is at `.github/pull_request_template.md`. Read it before composing the body — the section headings and checklist items are the source of truth, not your memory of them.

```bash
cat .github/pull_request_template.md
```

Mirror the template exactly:

- `## What does this PR do?` — one paragraph or a short bullet list. Link related issues with `Fixes #123` when applicable.
- `## How to test` — numbered, concrete reviewer steps (commands to run, what to click, expected outcome).
- `## Screenshots / screen recording` — if the change is visual, paste a recording link or note that one will be added. If purely non-visual (refactor, internal API), say so explicitly so the reviewer knows nothing is missing.
- `## Checklist` — copy the boxes verbatim, ticking the ones already verified.

## 3. Push and open

```bash
git push -u origin HEAD
```

Check for an existing PR first:

```bash
gh pr view --json number,url,title,body 2>/dev/null
```

### 3a. No existing PR → create one

Pass the body via HEREDOC to preserve markdown formatting:

```bash
gh pr create --title "short, scope-prefixed title" --body "$(cat <<'EOF'
## What does this PR do?

<one-paragraph description; link issues>

## How to test

1. <step>
2. <step>
3. <step>

## Screenshots / screen recording

<link or "N/A — non-visual change">

## Checklist

- [x] I've tested this locally with `bun dev`
- [x] My code follows the existing code style (run `bun check` to verify)
- [ ] I've updated relevant documentation (if applicable)
- [x] This PR targets the `main` branch
EOF
)"
```

Keep the title under ~70 characters. Use a scope prefix when there's an obvious one (`viewer:`, `core:`, `editor:`, `mcp:`).

### 3b. PR already exists → update its description

Do **not** recreate the PR. Refresh the existing body so it reflects everything currently on the branch, while keeping the template structure and any reviewer-meaningful state the user already set.

1. Capture the existing body and the full branch history:

   ```bash
   gh pr view --json number,body -q '.number, .body' > /tmp/existing-pr.txt
   git log --oneline main..HEAD
   git diff --stat main..HEAD
   ```

2. Reconstruct the body section-by-section. Keep the four template headings in the same order (`## What does this PR do?`, `## How to test`, `## Screenshots / screen recording`, `## Checklist`). For each section:

   - **What does this PR do?** — rewrite from the *current* commits and diff on the branch, not from memory. Preserve any `Fixes #123` / `Refs #123` lines from the old body.
   - **How to test** — regenerate concrete steps for the *current* behaviour. If a previous step is still valid, keep its wording; drop steps that no longer apply; add steps for new commits.
   - **Screenshots / screen recording** — preserve the existing content verbatim (links, embedded images, "N/A — …"). Do not blank it out. Only change it if the user explicitly provided a new recording.
   - **Checklist** — preserve the user's tick state (`[x]` vs `[ ]`) for every item that still exists in the template. Add any new template items as unchecked.

   If the old body contains extra sections the template doesn't have (e.g. a manual "Notes" block), keep them at the end.

3. Apply the update:

   ```bash
   gh pr edit <number> --body "$(cat <<'EOF'
   ## What does this PR do?
   …
   EOF
   )"
   ```

   Use `gh pr edit --title` *only* if the branch's scope has clearly changed; otherwise leave the title alone.

4. Print the PR URL so the user can confirm the edit.

## 4. Report

Return:

- PR URL
- Title used
- Local typecheck/build status (if you ran them)
- A note for the reviewer if anything in the checklist is left unchecked
