---
name: open-pr2
description: Open or update a pascalorg/editor pull request from verified branch-authored commits while excluding changes imported by merges. Use only when the user explicitly asks for OpenPR2 or /open-pr2.
metadata:
  internal: true
disable-model-invocation: true
allowed-tools: Bash(git *) Bash(gh *) Bash(bun *) Read
---

# OpenPR2

Open or update a pull request against `pascalorg/editor`. Describe only work introduced by the feature branch's own non-merge, first-parent commits and still present in the PR. Treat merge commits as synchronization, never as evidence that the feature branch implemented the merged work.

The invariant is:

> Every title or body claim must map to an eligible branch commit, concrete changed lines from that commit, and the final PR diff.

If provenance cannot be established, stop before changing GitHub and explain why the branch must be cleaned or the intended commits identified.

## 1. Establish the canonical base

Inspect the repository, working tree, remotes, branch, and existing PR:

```bash
git status
git branch --show-current
git remote -v
gh pr view --json number,url,title,body,baseRefName,headRefName 2>/dev/null
```

For this repository, the canonical base is the remote whose fetch URL is `pascalorg/editor`, normally `upstream`. Use the existing PR's `baseRefName`; use `main` only when no PR exists. Fetch that exact base before comparing:

```bash
git fetch upstream <base-branch>
git rev-parse HEAD upstream/<base-branch>
git merge-base --all upstream/<base-branch> HEAD
```

Stop if:

- the current branch is the base branch;
- the working tree has changes the user did not ask to commit;
- the canonical remote or base cannot be resolved;
- the branch has no eligible commits after the provenance audit below;
- there is more than one merge base, unless the ambiguity is resolved before continuing.

Completion criterion: one fetched canonical base ref and one unambiguous merge base are recorded. A local branch named `main` is not a substitute for the canonical ref.

## 2. Build the provenance audit

Run the deterministic audit. Save its output as the provenance manifest for the rest of the workflow:

```bash
bun .agents/skills/open-pr2/scripts/provenance-audit.ts \
  --base upstream/<base-branch> \
  --head HEAD \
  --format markdown
```

The audit classifies:

- **Eligible:** non-merge commits on the first-parent feature-branch line.
- **Patch-equivalent:** branch commits whose patch already exists on the canonical base.
- **Imported:** merge commits and changes reachable only through their merged parents.
- **Branch-only files:** final-diff files touched only by eligible commits.
- **Merge-only files:** final-diff files touched only by excluded merges.
- **Patch-equivalent files:** final-diff files whose eligible-looking patch already exists on the base.
- **Overlapping files:** files touched by both an eligible commit and a merge; these require hunk review.
- **Unexplained files:** final-diff files not accounted for by either class.
- **Reverted eligible files:** files touched by eligible commits but absent from the final diff.

Treat merge-only files, patch-equivalent commits and files, and reverted eligible files as excluded. Stop for unexplained files. For every overlapping file, compare the eligible commit patch with the merge patch before deciding whether any behavior is describable:

```bash
git diff <merge>^1 <merge> -- <overlapping-path>
git diff <eligible-commit>^ <eligible-commit> -- <overlapping-path>
```

The merge patch is an exclusion inventory. Conflict resolution inside a merge is maintenance unless the user identifies it as intentional feature work.

For every eligible commit, inspect the actual patch relative to its first parent:

```bash
git show --format=fuller --stat --name-status <commit>
git diff <commit>^ <commit> -- <relevant-paths>
```

Commit subjects, branch names, prior chat, issue text, and the final aggregate diff are discovery hints only. They are not evidence of authorship.

The script uses `git cherry` to detect patch-equivalent commits. This cannot detect rewritten or partially copied patches. If a non-merge commit bundles unrelated feature families, has a subject that does not explain major parts of its patch, or appears copied from another branch, classify it as ambiguous. Stop and ask the user to identify the intended hunks or recommend rebuilding from `upstream/<base-branch>`.

Completion criterion: the manifest is generated, every overlap has a hunk decision, and there are no unexplained or unresolved ambiguous changes.

## 3. Intersect authored work with the final PR

Inspect what reviewers will actually receive:

```bash
git diff --stat upstream/<base-branch>...HEAD
git diff --name-status upstream/<base-branch>...HEAD
git diff upstream/<base-branch>...HEAD -- <relevant-paths>
```

For an existing PR, also inspect GitHub's diff:

```bash
gh pr diff <number> --name-only
gh pr diff <number>
```

A change is describable only when both are true:

1. an eligible commit's patch proves the branch introduced it; and
2. the behavior still appears in the final PR diff.

This intersection prevents two opposite errors:

- merged work appearing in the description merely because it is visible in the aggregate branch history;
- reverted or superseded branch work appearing merely because an old eligible commit mentions it.

Aggregate-diff changes with no eligible-commit evidence are inherited or unexplained. Exclude them from PR claims and report them to the user outside the proposed PR body. If those unexplained changes make the PR unsafe or misleading to review, stop and recommend branch cleanup.

Completion criterion: every surviving eligible behavior is identified, and every unexplained final-diff cluster is excluded and reported.

## 4. Build a claim ledger

Before writing prose, create a private evidence ledger with one row per behavior:

| Claim | Eligible commit | Patch evidence | Present in final PR | Test evidence |
|---|---|---|---|---|
| Concrete user-visible result | SHA | Files and relevant hunks | Yes | Command/manual check or not run |

Rules:

- Every proposed title and `What does this PR do?` item must have a ledger row.
- Every meaningful surviving eligible behavior must be represented.
- A filename alone is insufficient; inspect the relevant hunk.
- Tests added by a merge do not validate branch-authored claims.
- Never infer a claim from a branch name such as `improve-project-items`.
- Never turn an unexplained aggregate-diff cluster into an umbrella claim.

Completion criterion: the body can be reconstructed from the ledger without using conversation memory or merge-imported changes.

### Reconcile a user-provided example

When the user supplies an expected title, description, feature list, or teammate review, compare every supplied item with the ledger before drafting:

| Supplied item | Eligible commit | Final evidence | Decision |
|---|---|---|---|
| User's wording | SHA or none | Files and hunks | Include, rewrite, exclude, or clarify |

Preserve the supplied level of technical detail when its claims are supported. The repository template still controls section headings. Report every omitted or rewritten item and the evidence decision. User wording is a coverage target, not provenance evidence.

## 5. Run proportionate checks

Choose focused tests from the eligible changed behavior, then run package-level checks appropriate to that scope. For a non-trivial cross-package change, prefer focused tests plus:

```bash
bun run check-types
bun run build
```

Do not open or update the PR when a required check fails. Report the failure. Record only commands actually run and their real result; leave manual-runtime and checklist claims unchecked when they were not verified.

Completion criterion: each claimed check has command output from this run.

## 6. Read the current PR template

Read `.github/pull_request_template.md` every time. Keep its headings, order, and checklist wording exactly. The template is the source of truth.

Preserve from an existing PR:

- `Fixes #...` and `Refs #...` lines;
- screenshots, recordings, links, and embedded media;
- relevant reviewer notes;
- checklist state only where current evidence still supports it.

Remove stale claims and test steps that lack a claim-ledger row. Never preserve inaccurate prose merely because it already exists.

Treat generated blocks such as `<!-- CURSOR_SUMMARY --> ... <!-- /CURSOR_SUMMARY -->` as automation output, not author evidence. Preserve a generated block only when all of its claims pass the ledger audit and repository automation expects it to remain. Otherwise remove it from the authored body and report that decision. Never copy claims from a generated block into the human description without independent commit-and-hunk evidence.

## 7. Write from the ledger

### Title

- Describe the most important surviving eligible result.
- Keep it under 70 characters when practical.
- Use a package scope when one package clearly owns the change.
- Prefer a concrete result over `improve`, `enhance`, `update`, or `refactor`.
- When eligible work has unrelated feature groups, stop and recommend splitting the PR instead of inventing a narrow umbrella title.
- Update an existing title when its scope is unsupported by the ledger.

### What does this PR do?

Use one short item per problem and result:

```markdown
- **Short feature or problem name**
  - Issue: One short sentence describing what was wrong or missing.
  - Fixed: One short sentence describing the behavior introduced by an eligible commit.
```

Add one short constraint or design sentence only when a reviewer needs it. Cover all meaningful ledger rows and nothing else. Link issues only when an issue number is known.

### How to test

Write numbered, concrete reviewer steps for ledger-backed behavior. Put the expected result on an indented line. Include automated commands only when they were run during this workflow.

### Screenshots / screen recording

Preserve existing media verbatim. For visual changes without supplied media, write `Not added yet.` For non-visual changes, write `N/A, no visual change.`

### Checklist

Copy the current template verbatim. Tick only evidence-backed items. A prior checked box may be unchecked when the current audit cannot verify it.

### Human writing pass

Read the draft as a developer who has not seen the branch:

- use plain words, short sentences, and active voice;
- preserve necessary technical detail without turning the body into a file inventory;
- remove filler, hype, repeated claims, and implementation trivia that does not help review;
- keep unrelated ledger rows separate rather than compressing them into a vague umbrella item;
- make every test step concrete and verifiable;
- match a user-provided example's useful specificity while keeping only evidence-backed claims.

Completion criterion: the draft reads naturally and every sentence still maps to the ledger.

## 8. Pre-write audit

Read the proposed title and body against the claim ledger and exclusion inventory.

For every title phrase, feature bullet, test step, and checked box, answer:

1. Which eligible non-merge commit introduced it?
2. Which changed lines prove it?
3. Is it still present in the final PR diff?
4. Was the claimed validation actually run?

Then confirm:

- no merge-only feature is named;
- no meaningful surviving eligible behavior is omitted;
- no branch-name or conversation assumption became a claim;
- unexplained final-diff changes were reported to the user rather than described as authored work;
- the title matches the ledger rather than the aggregate diff;
- each user-supplied example item has an explicit include, rewrite, exclude, or clarify decision;
- generated summary blocks contain no unaudited claims.

Any unanswered question blocks the GitHub update.

## 9. Push, create or update, and verify

Push the current branch:

```bash
git push -u origin HEAD
```

Create a PR only when none exists. Otherwise update the existing PR; never create a duplicate. Pass Markdown through a quoted heredoc.

```bash
gh pr create --title "<ledger-backed title>" --body "$(cat <<'EOF'
<body using the current template>
EOF
)"
```

```bash
gh pr edit <number> --title "<ledger-backed title>" --body "$(cat <<'EOF'
<body using the current template>
EOF
)"
```

Read it back:

```bash
gh pr view <number> --json number,url,title,body,baseRefName,headRefName
```

Verify the saved title, template sections, base, head, media, checklist state, and every claim against the ledger. Correct a serialization mistake immediately; stop for any provenance or content discrepancy.

## 10. Report

Return:

- PR URL and final title;
- eligible commits used as evidence;
- merge commits excluded from the description;
- checks actually run and their outcomes;
- unexplained or inherited final-diff changes;
- unchecked checklist items or missing recordings;
- whether branch cleanup or PR splitting is still recommended.
