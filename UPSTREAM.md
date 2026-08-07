# Repository topology and upstream merges

Plain-language version of the same picture, for whoever operates this rather
than edits it: `OTOMASYON.md`.

## Two branches, and why

| Branch | What it is |
|---|---|
| `main` | A pure mirror of `pascalorg/editor`. No commit of ours ever lands here, which is what makes taking upstream free — the mirror can only fast-forward, so it never conflicts. |
| `integration` | **The default branch.** Everything this fork adds lives here, and it is what the deploy builds from. Every workflow that pushes, pushes here. |

Scheduled workflows run only from the default branch, which is why
`integration` is it. Point `vars.INTEGRATION_BRANCH` at another name to move
it; every workflow reads that variable and falls back to `integration`.

## Which change goes to which repository

| What changed | Repository | How it gets there |
|---|---|---|
| Editor (this codebase) | `ovurrsl/editor` — fork of `pascalorg/editor` | Commit on `integration` |
| Console / panel | `ovurrsl/panel` — the console's home | Automatic inbound: `pull-panel` vendors it into `apps/editor/panel` hourly, type-checks, pushes to `integration`, then dispatches the deploy. The outbound `sync-panel` is manual now — for seeding the console repository from here, not for routine work. |
| Warehouse plugin | `ovurrsl/plugin-warehouse` | Automatic: `bump-plugin` compares the pin in `apps/editor/package.json` against the plugin's `main` hourly, moves it, relocks, type-checks, pushes, and dispatches the deploy. Nothing to do by hand. |
| Upstream editor | `pascalorg/editor` | `mirror-upstream` fast-forwards `main` daily and opens one long-lived pull request into `integration`. **Merging it is the one manual step in the whole chain** — see below. |
| What the server runs | `ovurrsl/Digitaltwin` | Build artifacts only — published by the deploy workflow (or a manual publish). Never commit source here; the host redeploys from it. Step-by-step: `YAYINLAMA.md` |

Every automatic path above ends at `deploy-bundle`, which refuses to publish
unless the build succeeds and both boot smoke tests pass. That is the reason
none of them needs a human in the middle.

## Pulling updates from pascalorg/editor

`mirror-upstream` keeps `main` on upstream's tip and opens a pull request from
`main` into `integration` whenever `integration` is behind it — not only on the
run that moved the mirror, because `main` can also be advanced by hand and
gating on "did this job push?" loses those updates silently.

The `upstream-check` workflow (weekly, or run it manually from the Actions tab)
does a trial merge and reports which files would conflict — read its summary
before merging for real.

Resolving the pull request locally:

```
git remote add upstream https://github.com/pascalorg/editor.git   # once
git fetch upstream
git checkout integration
git merge upstream/main
```

Most of this repository's additions live in files upstream does not have, so
they merge silently: `apps/editor/panel/`, `apps/editor/lib/auth/`,
`apps/editor/app/(panel)/`, the deploy/relock/sync workflows, the deploy
scaffold under `.github/deploy/`.

## Upstream files that carry local changes — conflict rules

| File | Rule when it conflicts |
|---|---|
| `AGENTS.md` (and its `CLAUDE.md` / `GEMINI.md` / copilot symlinks) | Keep our fork block at the top, take upstream's body below it. The block is delimited by `FORK BLOCK` / `END FORK BLOCK` comments and says which branch to work on — without it an agent reads instructions written for `pascalorg/editor` and commits to `main`. |
| `apps/editor/app/page.tsx` | Keep ours. Upstream's root page is the editor composition; ours is the session router. Upstream's changes to the editor composition belong in `apps/editor/components/editor-app.tsx` — port them there by hand. |
| `apps/editor/components/editor-app.tsx` | Ours only (upstream has no such file), but it is a moved copy of upstream's old `app/page.tsx` — apply upstream's `app/page.tsx` improvements here. |
| `apps/editor/app/layout.tsx` | Merge both; keep the `export const dynamic = 'force-dynamic'` block (the host's CDN caches static HTML across deploys and serves dead assets without it). |
| `apps/editor/lib/graph-schema.ts` | Keep ours: API validation must consult each plugin's own node schemas, not a static union. Port upstream's non-plugin changes around that. |
| `apps/editor/app/api/scenes/**`, `lib/auth/guard.ts` | Merge both; keep the ownership/role checks (`authorizeSceneMutation`, `canEdit`). |
| `apps/editor/components/scene-loader.tsx` | Merge both; keep the `readOnly` prop and the console-session `useSession` wiring. |
| `apps/editor/app/scenes/`, `app/scene/[id]/` | Merge both; keep the console-session gating and the navigation that points Home at `/`. Scene administration lives in the console's 3D scenes tab, not in a standalone page. |
| `apps/editor/next.config.ts` | Merge both; keep `serverExternalPackages: ['@node-rs/argon2']` and the standalone/output settings. |
| `apps/editor/package.json`, `bun.lock`, `biome.jsonc` | Merge both, and keep the `@ovurrsl/plugin-warehouse` pin — upstream has no such dependency, so a wholesale "take theirs" silently removes the warehouse racks. After changing dependencies by hand, dispatch the Relock workflow from the Actions tab to regenerate `bun.lock` on a real runner. |
| `apps/editor/lib/bootstrap.ts`, `apps/ifc-converter/next-env.d.ts`, root `package.json`, `packages/mcp/src/storage/sqlite-scene-store.ts`, `packages/viewer/src/components/viewer/index.tsx` | No rule written yet — these conflicted in the beta.4 trial merge. Decide, then record the rule here so the next merge is cheaper. |
| `packages/core/src/services/storey.ts` | **Fork perf patch (2026-08-07):** `getLevelElevations` is memoised on the nodes record's identity (WeakMap). Measured: the wall systems re-derived it per wall per camera refresh — ~35% of frame CPU on a warehouse-scale scene. **Proposed upstream** (`plugin-warehouse/docs/upstream-storey-memo.md`); if upstream ships its own memoisation, take theirs and drop ours. Until then, keep the memo when merging. |
| `packages/viewer/src/systems/wall/wall-cutout.tsx` | **Fork perf patch (2026-08-07):** `wallAppearanceKey` is re-derived only when the nodes record's identity moves (it was a per-frame map+hash+stringify over every wall). Same disposition as `storey.ts`: proposed upstream, take upstream's version if they fix it themselves. |
| `packages/editor/src/components/tools/select/box-select-tool.tsx` | **Fork patch (2026-08-07):** marquee visibility walk tolerates `userData.hiddenForInstancing` — objects hidden because an instancing pool draws them (warehouse plugin) stay box-selectable. Keep the userData check when merging; drop only if upstream adds an equivalent contract. |
| `packages/editor/src/components/ui/sidebar/panels/items-panel/index.tsx` | **Fork feature (2026-08-07):** the Furnish palette also lists registry kinds with `presentation.paletteSection: 'furnish'` (plugin equipment), gated by `isNodeKindEnabled`. Keep the `collectFurnishKinds` block and its tiles when merging. |
| `apps/editor/components/build-tab.tsx` | **Fork fix (2026-08-07):** `collectBuildTypes` filters by `isNodeKindEnabled(kind, installedPlugins)` so uninstalled plugins' kinds don't render tiles. Keep the filter when merging. |

After any upstream merge: `bun run check && bun run check-types`, build, and
let CI plus the deploy workflow's boot smoke tests confirm nothing broke
before publishing to `ovurrsl/Digitaltwin`.
