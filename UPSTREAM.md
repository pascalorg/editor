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
| `apps/editor/app/api/health/route.ts` | Keep ours — it exercises the scene store, and `deploy-bundle`'s second smoke test is only meaningful because of that. Upstream's version answers `ok` without touching the database, so taking it turns the release gate into a rubber stamp. Do take their `version` / `instanceId` fields: they are the only way to read which build is actually live. |
| `apps/editor/lib/bootstrap.ts` | Merge both — register upstream's `mintPlugin` **and** `warehousePlugin`. `extendPluginDiscovery` composes, so this is two calls rather than a choice; `setPluginDiscovery` would drop everything registered before it. Both plugins must also stay in `serverExternalPackages` (`next.config.ts`) and in `apps/editor/package.json`. |
| `apps/ifc-converter/next-env.d.ts` | Take upstream's deletion. Next regenerates it on every build and upstream has it in `.gitignore`; tracking it only buys a conflict at every Next upgrade. It has nothing to do with the IFC feature — that is `apps/ifc-converter/` plus the editor's own import button, and neither is affected. |
| root `package.json` | Keep ours: `build` (the Hostinger standalone chain the deploy copies `hostinger-server.js` into), `dev`, and `sync-panel`. Take everything else from upstream — `test`, `engines.node`, `packageManager`, `overrides.next`. `test` had gone missing on our side, so `bun test` at the root ran nothing at all. `release:cli` is deliberately not taken: we do not publish the CLI. |
| `apps/editor/next.config.ts` (output) | Keep `output: 'standalone'` **unconditional**. Upstream gates it behind `PASCAL_PORTABLE_BUILD=1`; taking that produces a green build with no standalone directory to serve, and the deploy fails at the copy step rather than at the build. Their `outputFileTracingRoot` is safe to take alongside it. |
| `packages/mcp/src/storage/sqlite-scene-store.ts` | Keep ours. The fork split the shared helpers into `scene-store-shared.ts` so `mysql-scene-store.ts` can use them; upstream still has everything inlined, so taking theirs re-inlines the helpers and breaks the MySQL store — which is the backend production actually runs. Port upstream's behavioural fixes into `scene-store-shared.ts` instead. |
| `packages/viewer/src/components/viewer/index.tsx` | Take upstream's. The GPU-capability check and the unsupported-GPU fallback were extracted into `lib/renderer-capability.ts` and `components/viewer/unsupported-gpu-fallback.tsx` upstream; our inline copies are simply the older version of the same code. Re-apply one thing after taking theirs: the fallback text says "Pascal", and ours says "DigitalTwin". |
| `apps/editor/lib/graph-schema.test.ts` | Merge both suites into one file. The two sides wrote independent tests at the same path — upstream covers the envelope (asset-URL allowlist, nesting, materials), ours covers plugin-kind validation. Neither subsumes the other. |
| `packages/viewer/src/systems/wall/wall-cutout.tsx` | **Fork perf fix (2026-08-07):** the slab-support / plane-top chain runs only for highlighted walls, behind `resolveSelectionHighlight`'s thunk. Measured at roughly half of frame CPU on a warehouse-scale scene, spent on walls whose answer was discarded. Keep the thunk when merging; it is being proposed upstream, so take upstream's version if they fix it themselves. |

After any upstream merge: `bun run check && bun run check-types`, build, and
let CI plus the deploy workflow's boot smoke tests confirm nothing broke
before publishing to `ovurrsl/Digitaltwin`.

---

## Before you publish: keep a way back

Tag or branch the commit the **currently live** deploy was built from, and push
it, before merging anything large. The live sha is the `head_sha` of the last
successful `Deploy bundle` run — not the head of `integration`, which usually
sits ahead of it.

```sh
LIVE=$(…head_sha of the last successful Deploy bundle run…)
git branch rollback/$(date +%F)-pre-upstream "$LIVE"
git push origin refs/heads/rollback/$(date +%F)-pre-upstream
```

Push it as `refs/heads/…` explicitly. A branch and a tag of the same name make
the short refspec ambiguous and the push is refused.

Rolling back is then:

```sh
git checkout integration
git reset --hard rollback/<the one you made>
git push --force-with-lease origin integration
# then run `Deploy bundle` by hand from the Actions tab
```

The database is **not** covered by this. Scenes live in MySQL, so a rollback
returns the code and leaves the data where it is — which is what you want for a
bad build, and no help at all for a bad migration.

---

## Log of upstream takes

One entry per merge. The point is not history for its own sake: it records what
was *decided* and what bit us, so the next take is cheaper than this one was.

### 2026-08-10 — beta.2 → beta.5, 56 commits

**Why it was 56 and not a handful.** `mirror-upstream` had been failing every
night since 7 August and nobody noticed, because nothing user-visible breaks
when the mirror stops — the editor keeps building from a frozen `main`. See the
`MIRROR_TOKEN` note in `OTOMASYON.md`. **Check that the mirror is green before
assuming you are up to date.**

**What we gained that we actually wanted:** the `materials` persistence fix
(below), the per-level base-elevation control, webp snapshot encoding, and the
GPU-capability refactor with its tests.

**The bug this merge uncovered, and the one worth remembering.** Upstream's
`#597` found that `materials` was never named in the persistence schemas.
`z.object()` strips what it does not name, so every custom surface was silently
deleted on save — no error, no log, and the scene reopens looking merely
"reset". Our fork had the same hole in two places, and one of them was missing
`installedPlugins` as well, so a warehouse scene forgot which pack it needed.

The general rule that falls out of it: **in `apps/editor/lib/graph-schema.ts`
and `packages/mcp/src/storage/scene-store-shared.ts`, the field list IS the set
of things that survive a save.** A field missing there is not a validation
error, it is deletion. Treat any upstream change to those two files as
load-bearing.

**Two traps in the tooling, both fixed here:**

- `Relock` pinned bun `1.3.0` while CI installed with `1.3.14`. A lockfile
  written by the older bun is rewritten by the newer one, and
  `--frozen-lockfile` turns that into a failed build — a relock producing a
  lockfile CI then rejects. Keep the two pinned to the same version as
  `packageManager`.
- The lockfile would not **converge**: two relocks in a row each rewrote it.
  `postcss` is a transitive dependency of both Next and Tailwind at different
  patch versions, and with nothing pinning it, bun broke the tie differently on
  every run. `--frozen-lockfile` can never pass against an oscillating
  lockfile, however many times you relock. Fixed by pinning `postcss` in the
  root `overrides`, next to `next` and `three`, which are there for the same
  reason. **If a frozen-lockfile failure survives a relock, suspect
  oscillation rather than staleness** — run the relock twice and diff.

**A mistake worth not repeating:** upstream's `graph-schema.test.ts` was merged
alongside ours, but upstream's suite tests upstream's implementation — including
an asset-URL allowlist our fork's version does not implement. Merging their
tests while keeping our implementation fails in CI. Either port the behaviour or
keep only the tests that match what the file actually does.
