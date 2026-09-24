---
name: open-pr2
description: Open or update a pascalorg/editor pull request using provenance-audited claims and the repository template.
metadata:
  internal: true
disable-model-invocation: true
allowed-tools: Bash(git *) Bash(gh *) Bash(bun *) Read
---

# OpenPR2

Open or update a pull request against `pascalorg/editor`. Describe only behavior introduced by eligible branch commits and still present in the final PR diff. A title or body claim must be supported by the commit patch, changed lines, and final diff. If authorship or scope cannot be established, stop before changing GitHub and explain what must be resolved.

## 1. Preflight and base

Inspect the repository, working tree, branch, remotes, and existing PR:

```bash
git status
git branch --show-current
git remote -v
gh pr view --json number,url,title,body,baseRefName,headRefName 2>/dev/null
```

Use the remote whose fetch URL is `pascalorg/editor` (normally `upstream`). Use the existing PR's `baseRefName`, or `main` when no PR exists. Fetch that exact base and confirm a single merge base:

```bash
git fetch <canonical-remote> <base-branch>
git rev-parse HEAD <canonical-remote>/<base-branch>
git merge-base --all <canonical-remote>/<base-branch> HEAD
```

Stop if the branch is the base branch, there are unrequested working-tree changes, the canonical remote/base cannot be resolved, there are no eligible commits, or multiple merge bases remain unresolved. A local `main` is not a substitute for the canonical remote ref.

## 2. Audit provenance and final changes

Run the audit and retain its output as the evidence manifest for the rest of the workflow:

```bash
bun .agents/skills/open-pr2/scripts/provenance-audit.ts \
  --base <canonical-remote>/<base-branch> \
  --head HEAD \
  --format markdown
```

The audit classifies first-parent non-merge commits as eligible unless `git cherry` finds an equivalent patch on the base. It also reports excluded merges, patch-equivalent commits/files, branch-only files, merge-only files, overlaps, unexplained final files, and eligible files absent from the final diff.

- Exclude merge-only, patch-equivalent, and reverted work from PR claims.
- Stop for unexplained files. For overlapping files, compare both the merge patch and eligible commit patch before deciding what is attributable:

  ```bash
  git diff <merge>^1 <merge> -- <overlapping-path>
  git diff <eligible-commit>^ <eligible-commit> -- <overlapping-path>
  ```

- Inspect each eligible commit relative to its first parent:

  ```bash
  git show --format=fuller --stat --name-status <commit>
  git diff <commit>^ <commit> -- <relevant-paths>
  ```

Commit subjects, branch names, issue text, conversation, and the aggregate diff are discovery hints, not authorship evidence. Conflict resolution in a merge is maintenance unless the user identifies it as feature work. `git cherry` cannot detect rewritten or partial patches; treat bundled unrelated work or suspicious copied commits as ambiguous and ask which changes belong. Recommend rebuilding from the canonical base when needed.

Inspect the actual PR result too:

```bash
git diff --stat <canonical-remote>/<base-branch>...HEAD
git diff --name-status <canonical-remote>/<base-branch>...HEAD
git diff <canonical-remote>/<base-branch>...HEAD -- <relevant-paths>
gh pr diff <number> --name-only  # existing PR only
gh pr diff <number>              # existing PR only
```

A change is describable only when an eligible commit proves the branch introduced it and the behavior remains in the final PR diff. Report inherited or unexplained changes to the user outside the PR body. Stop for branch cleanup if they make the PR unsafe or misleading to review.

Before drafting, keep a private claim ledger with one row per behavior:

| Claim | Eligible commit | Patch evidence | In final PR | Test evidence |
|---|---|---|---|---|
| User-visible result | SHA | Files and relevant hunks | Yes | Command/manual check or not run |

Every title and body claim needs a row; include every meaningful surviving eligible behavior. A filename alone is insufficient. Tests introduced by a merge do not validate branch-authored claims. Do not infer claims from a branch name or use unexplained changes as an umbrella item.

When the user supplies a title, feature list, description, or teammate review, reconcile every item against the ledger. Preserve supported detail, mark each item include/rewrite/exclude/clarify, and report omissions or rewrites with the evidence decision. User wording is a coverage target, not provenance evidence.

## 3. Checks and template

Choose focused tests for eligible changed behavior and package checks appropriate to its scope. For a non-trivial cross-package change, prefer focused tests plus:

```bash
bun run check-types
bun run build
```

Do not create or update a PR if a required check fails. Report the failure. Record only commands actually run and their real outcomes; leave unverified manual-runtime and checklist claims unchecked.

Read `.github/pull_request_template.md` every time. Keep its headings, order, and checklist wording exactly. For an existing PR, preserve `Fixes #...`/`Refs #...` lines, media, relevant reviewer notes, and only evidence-backed checklist state. Remove stale claims or test steps without ledger evidence.

Treat generated blocks such as `<!-- CURSOR_SUMMARY --> ... <!-- /CURSOR_SUMMARY -->` as automation output, not authorship evidence. Preserve them only if every claim passes the ledger audit and repository automation expects them; otherwise remove them from the authored body and report that decision. Never copy an unaudited generated claim into the human description.

## 4. Draft and audit the PR

### Title

- Lead with the most important surviving eligible result; stay under 70 characters when practical.
- Use a package scope when one package clearly owns the change.
- Prefer a concrete result to `improve`, `enhance`, `update`, or `refactor`.
- If eligible work has unrelated feature groups, recommend splitting instead of inventing an umbrella title.
- Update an existing title when its scope is unsupported by the ledger.

### Body

Use one short item per problem and result:

```markdown
- **Short feature or problem name**
  - Issue: One short sentence describing what was wrong or missing.
  - Fixed: One short sentence describing the behavior introduced by an eligible commit.
```

Add a short constraint only when reviewers need it. Cover all meaningful ledger rows, and link issues only when the number is known.

- **How to test:** Give numbered, concrete reviewer steps with expected results. Include automated commands only when run during this workflow.
- **Screenshots / screen recording:** Preserve existing media verbatim. For a visual change without supplied media, write `Not added yet.` For a non-visual change, write `N/A, no visual change.`
- **Checklist:** Copy the current template verbatim. Check `bun dev` only after local runtime testing, code style only after its command passes, documentation when updated or explicitly N/A, and target branch only after confirming the actual base. Uncheck unsupported old items.

Read the draft as a developer who has not seen the branch. Use plain words, short active sentences; remove filler, hype, repeated claims, and unhelpful implementation detail. Keep unrelated claims separate and make every test step verifiable.

Before any GitHub update, confirm every title phrase, feature, test step, and checked box has eligible commit evidence, changed-line evidence, presence in the final diff, and real validation evidence where claimed. Confirm there are no merge-only claims, no omitted surviving eligible behavior, no unaudited generated claims, and every user-supplied example has an explicit decision. Any unresolved item blocks the update.

## 5. Publish, verify, and report

Push the current branch:

```bash
git push -u origin HEAD
```

Create a PR only if none exists; otherwise update the existing PR. Never create a duplicate. Pass Markdown through a quoted heredoc:

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

Read the result back:

```bash
gh pr view <number> --json number,url,title,body,baseRefName,headRefName
```

Verify the saved title, template, base/head, media, checklist, and claims. Correct serialization mistakes; stop for any provenance or content discrepancy.

Report the PR URL and title, eligible commits used, merges excluded, checks actually run and outcomes, unexplained/inherited changes, unchecked checklist items or missing recordings, and whether cleanup or splitting is recommended.
