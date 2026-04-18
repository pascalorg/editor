# R4 — Routing & URLs

## TL;DR
**Zero dynamic routes today.** Every user lands on `/` which hardcodes `projectId="local-editor"`.

## Route tree
```
apps/editor/app/
├── page.tsx            (Home: <Editor projectId="local-editor">)
├── layout.tsx
├── privacy/page.tsx
├── terms/page.tsx
├── api/health/route.ts
└── fonts/
```

- No `[id]`, `[projectId]`, `[sceneId]`, or `[[...slug]]` segments.
- No middleware.
- No `rewrites()` / `redirects()` in `next.config.ts`.
- No query-param driven state.
- No hash routing.

## Latent expectation (dead code)
`packages/editor/src/components/ui/action-menu/view-toggles.tsx:79`:
```ts
const projectId = window.location.pathname.split('/editor/')[1]?.split('/')[0]
```
Code expects URLs of shape `/editor/<projectId>/…`. No such routes exist. Falls through to `undefined` gracefully today but signals a planned structure.

## Options to add
| Option | Route | Effort |
|---|---|---|
| A | `/?sceneId=<id>` — reuse `/` + `useSearchParams` | XS |
| B | `/editor/[projectId]` | S |
| C | `/editor/[projectId]/[sceneId]` | M |
| D | `/scene/[id]` — flat, project-agnostic | S |

Recommended: **B for projects, `/scene/[id]` short-link for sharing**. Matches the latent expectation in view-toggles.tsx.
