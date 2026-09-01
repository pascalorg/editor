---
name: open-pr2
description: Open or update a pull request on pascalorg/editor with a plain-language issue-and-fix description based on the full branch diff. Use only when the user explicitly asks for OpenPR2 or /open-pr2.
disable-model-invocation: true
allowed-tools: Bash(git *) Bash(gh *) Bash(bun *) Read
---

# OpenPR2

Open or update a pull request against `pascalorg/editor` from the current branch. Keep the repository's PR template, but write the body like one developer explaining the change to another.

## 1. Pre-flight

Inspect the working tree and the whole branch before writing anything:

```bash
git status
git branch --show-current
git log --oneline main..HEAD
git diff --stat main...HEAD
git diff --name-status main...HEAD
```

Read the relevant parts of `git diff main...HEAD`. Do not build the description from the latest commit alone or from conversation memory.

Stop if:

- The current branch is `main`. Ask the user to create a feature branch first.
- The branch has no commits ahead of `main`.
- There are uncommitted changes the user has not asked to commit.

For a non-trivial change, run checks that match the affected packages. Prefer focused tests plus:

```bash
bun run check-types
bun run build
```

Do not open a PR when a required check fails. Report the failure instead. Do not claim that a command or manual test passed unless it was run.

## 2. Read the current PR template

Read `.github/pull_request_template.md` every time. Its headings and checklist wording are the source of truth.

Keep the template headings in the same order:

1. `## What does this PR do?`
2. `## How to test`
3. `## Screenshots / screen recording`
4. `## Checklist`

Do not replace them with `Summary`, `Details`, `Validation`, or custom headings unless the template itself changes.

## 3. Write the title

- Keep it under 70 characters when practical.
- State the result, not the activity. Prefer `fix(editor): keep curved room slabs attached` over `update wall files`.
- Add a package scope when one package clearly owns the change, such as `core:`, `viewer:`, `editor:`, or `mcp:`.
- Avoid vague verbs such as `improve`, `enhance`, `update`, or `refactor` when a concrete verb fits.

## 4. Write the body in plain language

### What does this PR do?

The reviewer should understand every changed behavior without opening the diff. Do not compress unrelated fixes into a paragraph or a long bullet.

Give each problem its own short item. Use this exact shape:

```markdown
- **Short feature or problem name**
  - Issue: One short sentence describing what was wrong or missing.
  - Fixed: One short sentence describing the behavior after this PR.
```

Add one more indented sentence only when the reviewer needs an important constraint, risk, or design decision. Keep it short and do not add labels such as `Details`, `Technical`, or `Implementation`.

Example:

```markdown
- **Curved triangular rooms**
  - Issue: Slabs and ceilings kept a straight corner after curving a wall.
  - Fixed: Both surfaces now rebuild from the curved room boundary.

- **Wall and fence thickness**
  - Issue: Thickness could only be changed from the settings panel.
  - Fixed: Each face now has a circular thickness handle in 2D and 3D.
  - The centerline stays fixed, and the change uses one undo step.
```

Keep the item title concrete. Start with product behavior, not filenames or function names. Cover every meaningful user-visible fix on the branch. Combine items only when they describe the same problem and the same fix.

Avoid this compressed style:

```text
This PR fixes curved wall topology, adds thickness handles, improves floor-plan previews, updates roof paint slots, and cleans up roof controls.
```

Link issues with `Fixes #123` or `Refs #123` when applicable. Never invent an issue number.

### How to test

Write numbered reviewer steps. Put the action on the numbered line and the expected result on a short indented line.

Good:

```text
1. Create a triangular room and curve one wall.
   - The slab and ceiling should follow the curved corner with no gap.

2. Drag either wall thickness dot.
   - The wall should stay centered while its thickness changes.
```

List automated commands only when they were run. Include pass counts when they are known and useful. Do not turn the section into a dump of every command used during development.

### Screenshots / screen recording

- Preserve any existing media verbatim when updating a PR.
- For a visual or interactive change, add the supplied media. If none exists, write `Not added yet.`
- For a non-visual change, write `N/A, no visual change.`
- Do not claim that a recording exists when it does not.

### Checklist

Copy every checklist line from the current template verbatim.

- Tick an item only when it is true.
- `bun dev` is checked only after local runtime testing.
- The code-style item is checked only after the requested style command passes.
- Documentation is checked when docs were updated or when the item explicitly says it is not applicable. Otherwise leave it unchecked.
- Confirm the actual base branch before checking the target-branch item.

## 5. Human writing pass

Before submitting, read the title and body once as a reviewer who has not seen the branch.

Rewrite anything that fails these checks:

- Use plain words and short sentences.
- Say what the change does. Avoid phrases that could describe any PR.
- Remove filler, hype, sales language, and chatbot phrases.
- Remove repeated points and details that the diff explains on its own.
- Avoid jargon unless the repository uses the term and the reviewer needs it.
- Avoid forced lists, excessive bold text, em dashes, and long parenthetical asides.
- Prefer active voice.
- Keep a human rhythm. The body should not read like generated release notes.
- Make every test step concrete and verifiable.

If the summary sounds too small, add the missing problem or behavior. If it sounds dense, remove implementation trivia before shortening the explanation of the bug.

## 6. Push and find the PR

Push the current branch:

```bash
git push -u origin HEAD
```

Check whether it already has a PR:

```bash
gh pr view --json number,url,title,body 2>/dev/null
```

### No existing PR

Create one with `gh pr create`. Pass the body through a quoted heredoc so Markdown stays intact:

```bash
gh pr create --title "<title>" --body "$(cat <<'EOF'
<body using the current PR template>
EOF
)"
```

### Existing PR

Do not create another PR. Update the current one from the full branch diff.

Before rewriting it:

```bash
gh pr view --json number,title,body,url
git log --oneline main..HEAD
git diff --stat main...HEAD
```

When rebuilding the body:

- Preserve `Fixes #123` and `Refs #123` lines.
- Preserve screenshots, recordings, links, and embedded images verbatim unless the user supplied replacements.
- Preserve the user's checklist state for work that remains true. Never change an unchecked item to checked without evidence.
- Keep extra reviewer notes that are still relevant.
- Remove old claims and test steps that no longer match the branch.
- Leave the title unchanged unless the branch's purpose clearly changed.

Apply the update with `gh pr edit <number> --body ...`. Change the title only when needed.

## 7. Verify and report

Read the PR back after creation or editing:

```bash
gh pr view --json number,url,title,body,baseRefName,headRefName
```

Confirm that the title, template sections, base branch, and body were saved correctly.

Return:

- PR URL
- Title
- Checks and tests actually run
- Any unchecked checklist item or missing recording the reviewer should know about
