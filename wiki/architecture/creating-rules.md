# Creating Architecture Pages

*How to add or update a page under `wiki/architecture/`.*

The pages in `wiki/architecture/` are the canonical source of architectural rules. AI agents (Claude, Codex, Cursor, Gemini) read them on demand via `AGENTS.md`.

## Workflow

1. Pick a focused topic (one concept per page — layers, events, registry, …).
2. Create `wiki/architecture/<slug>.md`. Slugs are short, kebab-case.
3. Add an entry to `wiki/architecture/README.md` so the new page is discoverable.
4. If the page should be read for PR reviews, link it from `.agents/skills/review-architecture/SKILL.md`.

## Page format

```markdown
# Page Title

*One-line italic description of what this page covers.*

Applies to: `path/glob/**`.

Short intro paragraph.

## Section

Concrete guidance with code examples and rules.
```

The italic description and `Applies to:` line replace the old Cursor frontmatter — they're plain markdown so every agent sees them.

## Good practice

- Keep a page focused on one concept. Split if it grows past ~500 lines.
- Lead with the rule, follow with the example. Show the correct shape before listing prohibitions.
- Reference real source files with a plain backtick path (e.g. `packages/core/src/schema/base.ts`).
- Add a new page when the same mistake has been made twice — not preemptively.
- Never duplicate content across pages. Link instead.

## Existing pages

See `wiki/architecture/README.md` for the current index.
