# A5 — Review notes: existing PR_DESCRIPTION.md vs final a5-pr-description.md

## What was weak in the original

**Scope mismatch.** The original described `@pascal-app/mcp` as if it were only a headless query/mutation server. The branch actually also ships scene persistence (filesystem + Supabase adapters), scene lifecycle tools (save/load/list/rename/delete), templates, variants, a `photo_to_scene` workflow, editor API routes, two new Next.js pages, and an SQL migration. The original PR description didn't mention any of these, leaving reviewers to discover them in the diff.

**Stale numbers.** The original cited "142/142 tests, 27 files." The actual count after Phase 8 additions is 294 tests across 40 files, and 30 tools (not 21). Stale numbers undermine credibility with careful reviewers.

**No honest failure disclosure.** The original listed known limitations but said nothing about the concurrency race condition that the P8 audit found and documented. A security-minded reviewer who finds that themselves will trust the PR less. The final version names the bug, its root cause, and the test report that found it.

**Cross-cutting changes were buried.** The original had a short "Cross-cutting changes" section that linked to `CROSS_CUTTING.md` for three items and missed two (the `./storage` subpath export on `packages/mcp` itself, and the `AssetUrl` validator on core schemas). The final version expands each item with what changed, why, and impact, so reviewers don't have to open a separate file to decide whether to approve.

**Security gaps were not disclosed.** The `AssetUrl` work is mentioned as a benefit, but the P4 URL hardening audit found 36 FAILs at the `save_scene(includeCurrentScene: false)` and `POST /api/scenes` boundaries. Omitting this would leave the maintainer unaware of a real attack surface.

**No TL;DR or orientation aid.** A maintainer unfamiliar with MCP had to read several paragraphs before understanding what this PR does or whether it belongs in this repo.

## What the final version improves

- Opens with a 3-sentence TL;DR that answers "what" and "why here"
- Architecture diagram updated to show `SceneStore` and adapter selection
- All 30 tools listed with accurate groupings; stale 21-tool list removed
- Verification table covers all evidence with honest pass/fail ratios
- Known limitations expanded to 10 items with the concurrency race called out explicitly
- Security notes split into "in this PR" vs "tracked follow-up" — reviewers see what's done and what isn't
- Report index with direct file paths so reviewers can navigate without searching
- Checklist has three unchecked items reflecting real gaps, not a clean sweep
