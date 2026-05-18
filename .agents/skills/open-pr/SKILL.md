---
name: open-pr
description: Open or update a pull request on pascalorg/editor using the repo's PR template. Use when the user asks to open/create a PR, push and PR, ship a branch, or refresh a PR description after new commits in the editor repo.
allowed-tools: Bash(git *) Bash(gh *) Read
---

Open a pull request against `pascalorg/editor` from the current branch, or — if a PR for the branch already exists — push new work and reconcile the PR description against the current `main..HEAD` delta.

## 1. Pre-flight

```bash
git status                # confirm working tree state
git branch --show-current # confirm we're on a feature branch, not main
git log --oneline main..HEAD
```

Stop if:
- The current branch is `main`. Ask the user to create a feature branch first.
- The branch has no commits ahead of `main` **and** no uncommitted changes. Nothing to ship.

If there are **uncommitted changes**, do not silently skip them:

1. Show the user `git status` and `git diff --stat`.
2. Ask for a commit message (do not auto-generate — this is an explicit "ship it" moment).
3. Stage the intended files and create the commit with the user-provided message.

Run a build sanity check if the change is non-trivial:

```bash
bun typecheck
bun build
```

Don't open or update the PR with a broken build.

## 2. Read the PR template

The template is at `.github/pull_request_template.md`. Read it before composing or reconciling the body — the section headings and checklist items are the source of truth, not your memory of them.

```bash
cat .github/pull_request_template.md
```

Template sections (mirror exactly):

- `## What does this PR do?` — one paragraph or short bullet list. Link related issues with `Fixes #123`.
- `## How to test` — numbered, concrete reviewer steps.
- `## Screenshots / screen recording` — link, or `N/A — non-visual change` if it doesn't apply.
- `## Checklist` — the boxes from the template, verbatim.

## 3. Push

```bash
git push -u origin HEAD
```

This updates an existing PR's commits/files automatically if one is already open. The description, however, does **not** auto-update — that's what step 5 handles.

## 4. Detect existing PR

```bash
gh pr view --json url,number,title,body 2>/dev/null
```

- If the command returns nothing → no PR exists → go to **step 5a (create)**.
- If it returns a PR → capture `url`, `number`, `title`, `body` → go to **step 5b (reconcile)**.

## 5a. Create (no existing PR)

Compose the body from the current `main..HEAD` delta:

```bash
git log --oneline main..HEAD
git diff --stat main...HEAD
```

Fill the template sections based on that delta. Then:

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

## 5b. Reconcile (existing PR)

**Goal:** keep what's still accurate in the existing description (including any manual edits the user made in the GitHub UI), update what's now wrong, and add what's missing. Do **not** blindly overwrite.

Steps:

1. Re-read the existing body captured in step 4.
2. Compute the current delta:
   ```bash
   git log --oneline main..HEAD
   git diff --stat main...HEAD
   git diff main...HEAD
   ```
3. Section by section, produce a reconciled body:
   - **What does this PR do?** — Keep existing sentences/bullets that still describe the branch. Rewrite or remove ones that no longer match the diff. Add bullets for new commits/features not yet mentioned.
   - **How to test** — Keep existing steps that still work. Update commands/paths that have changed. Add steps for new behavior. Remove steps for behavior that was reverted or removed.
   - **Screenshots / screen recording** — Preserve existing links verbatim. If the change is now visual and no link exists, note `<link to be added>` rather than removing the section.
   - **Checklist** — **Preserve the user's checkbox states exactly** (ticked or unticked). Do not re-tick based on this run's verification. If a box is unchecked but you verified its condition (e.g. `bun check` passed), surface a *note in the final report* — do not modify the box.
4. Preserve the template's section order and headings.
5. Write the reconciled body back:

   ```bash
   gh pr edit --body "$(cat <<'EOF'
   <reconciled body>
   EOF
   )"
   ```

   Update `--title` too **only if** the scope clearly changed (e.g. branch started as `editor:` work but now also touches `core:`). Otherwise leave the title alone.

If a reconcile would produce a body identical to the existing one, skip `gh pr edit` and note "description already up to date" in the report.

## 6. Report

Return:

- PR URL
- Whether the PR was **created** or **updated** (and if updated, whether the description was changed or already up to date)
- Title used (and whether it was changed)
- Commits pushed this run (from `git log`)
- Local typecheck/build status (if you ran them)
- Notes for the reviewer about any unchecked checklist items whose conditions you verified this run
