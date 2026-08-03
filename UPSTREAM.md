# Repository topology and upstream merges

## Which change goes to which repository

| What changed | Repository | How it gets there |
|---|---|---|
| Editor (this codebase) | `ovurrsl/editor` — fork of `pascalorg/editor` | Commit here |
| Console / panel | `ovurrsl/panel` | Automatic: the `sync-panel` workflow opens a PR upstream whenever `apps/editor/panel/**` or the shared routes change |
| Warehouse plugin | `ovurrsl/plugin-warehouse` | Commit there, then pin the new sha in `apps/editor/package.json` and let the Relock workflow regenerate `bun.lock` |
| What the server runs | `ovurrsl/Digitaltwin` | Build artifacts only — published by the deploy workflow (or a manual publish). Never commit source here; the host redeploys from it. Step-by-step: `YAYINLAMA.md` |

## Pulling updates from pascalorg/editor

This repository stays a fork so upstream improvements can be merged. The
`upstream-check` workflow (weekly, or run it manually from the Actions tab)
does a trial merge and reports which files would conflict — read its summary
before merging for real.

```
git remote add upstream https://github.com/pascalorg/editor.git   # once
git fetch upstream
git merge upstream/main
```

Most of this repository's additions live in files upstream does not have, so
they merge silently: `apps/editor/panel/`, `apps/editor/lib/auth/`,
`apps/editor/app/(panel)/`, the deploy/relock/sync workflows, the deploy
scaffold under `.github/deploy/`.

## Upstream files that carry local changes — conflict rules

| File | Rule when it conflicts |
|---|---|
| `apps/editor/app/page.tsx` | Keep ours. Upstream's root page is the editor composition; ours is the session router. Upstream's changes to the editor composition belong in `apps/editor/components/editor-app.tsx` — port them there by hand. |
| `apps/editor/components/editor-app.tsx` | Ours only (upstream has no such file), but it is a moved copy of upstream's old `app/page.tsx` — apply upstream's `app/page.tsx` improvements here. |
| `apps/editor/app/layout.tsx` | Merge both; keep the `export const dynamic = 'force-dynamic'` block (the host's CDN caches static HTML across deploys and serves dead assets without it). |
| `apps/editor/lib/graph-schema.ts` | Keep ours: API validation must consult each plugin's own node schemas, not a static union. Port upstream's non-plugin changes around that. |
| `apps/editor/app/api/scenes/**`, `lib/auth/guard.ts` | Merge both; keep the ownership/role checks (`authorizeSceneMutation`, `canEdit`). |
| `apps/editor/components/scene-loader.tsx` | Merge both; keep the `readOnly` prop and the console-session `useSession` wiring. |
| `apps/editor/app/scenes/`, `app/scene/[id]/` | Merge both; keep the console-session gating and the navigation that points Home at `/`. Scene administration lives in the console's 3D scenes tab, not in a standalone page. |
| `apps/editor/next.config.ts` | Merge both; keep `serverExternalPackages: ['@node-rs/argon2']` and the standalone/output settings. |
| `apps/editor/package.json`, `bun.lock`, `biome.jsonc` | Merge both; after changing dependencies, fire the Relock workflow (edit the trailing comment in `.github/workflows/relock.yml`). |

After any upstream merge: `bun run check && bun run check-types`, build, and
let CI plus the deploy workflow's boot smoke tests confirm nothing broke
before publishing to `ovurrsl/Digitaltwin`.
