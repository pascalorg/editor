---
name: open-pr
description: Open or update a pull request on pascalorg/editor from the current branch, describing only what the branch actually did. Use when the user asks to open/create a PR, push and PR, or ship a branch in the editor repo.
metadata:
  internal: true
allowed-tools: Bash(git *) Bash(gh *) Read
---

Open (or refresh) a pull request against `pascalorg/editor` from the current branch.

## 1. What is actually on the branch

```bash
git branch --show-current                      # not main
git status --short                             # nothing uncommitted you weren't asked to commit
base=$(git merge-base HEAD origin/main)
git log --oneline --first-parent --no-merges "$base"..HEAD
git diff --stat "$base"..HEAD
```

The PR describes **only** these commits and this diff. Work that arrived by merging `main`, reverted commits, and patch-equivalent cherry-picks are not this PR's claims. If a file in the diff has no commit on the branch explaining it, stop and ask.

Run `bun run check-types` when the change is non-trivial; never claim a check you did not run.

## 2. Body = the repo template

`.github/pull_request_template.md` is the source of truth for headings and checklist. Fill it from §1, not from memory:

- **What does this PR do?** — the result, one paragraph or a short list; `Fixes #123` when applicable.
- **How to test** — numbered, concrete reviewer steps with the expected outcome. Automated commands only if you ran them.
- **Screenshots / screen recording** — link, `Not added yet.` for a visual change without media, or `N/A — non-visual change`.
- **Checklist** — copy verbatim; tick only what was verified (`bun dev` only after a real local run).

Title: under ~70 characters, a concrete result (not "update"/"improve"), scope-prefixed when one package owns it (`core:`, `viewer:`, `editor:`, `nodes:`, `mcp:`).

## 3. Push and open, or update

```bash
git push -u origin HEAD
gh pr view --json number,url,body 2>/dev/null     # existing PR?
```

- None → `gh pr create --title … --body "$(cat <<'EOF' … EOF)"`.
- Exists → `gh pr edit <n> --body …`: rebuild "What" and "How to test" from the current branch, keep the media section and the reviewer's checklist ticks verbatim, keep any extra sections at the end. Change the title only if the scope changed.

End the body with the attribution lines the session asks for, if any.

## 4. Report

PR URL, title, which checks you ran, and anything left unchecked for the reviewer.
