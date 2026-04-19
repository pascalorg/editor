# Phase 7 plan — A+B storage + edge cases + ideas

## Shared SceneStore contract (every agent reuses this)

```ts
// packages/mcp/src/storage/types.ts (Agent 1 owns)

import type { SceneGraph } from '@pascal-app/core/clone-scene-graph'

export type SceneId = string  // slug-safe (a-z0-9-), ≤ 64 chars

export interface SceneMeta {
  id: SceneId
  name: string
  projectId: string | null
  thumbnailUrl: string | null
  version: number            // monotonic, incremented on every save
  createdAt: string          // ISO 8601
  updatedAt: string
  ownerId: string | null
  sizeBytes: number
  nodeCount: number
}

export interface SceneWithGraph extends SceneMeta {
  graph: SceneGraph
}

export interface SceneStore {
  readonly backend: 'filesystem' | 'supabase'
  save(opts: {
    id?: SceneId
    name: string
    projectId?: string | null
    ownerId?: string | null
    graph: SceneGraph
    thumbnailUrl?: string | null
    expectedVersion?: number  // 409 on mismatch
  }): Promise<SceneMeta>
  load(id: SceneId): Promise<SceneWithGraph | null>
  list(opts?: { projectId?: string; ownerId?: string; limit?: number }): Promise<SceneMeta[]>
  delete(id: SceneId, opts?: { expectedVersion?: number }): Promise<boolean>
  rename(id: SceneId, newName: string, opts?: { expectedVersion?: number }): Promise<SceneMeta>
}

export class SceneNotFoundError extends Error { code = 'not_found' as const }
export class SceneVersionConflictError extends Error { code = 'version_conflict' as const }
export class SceneInvalidError extends Error { code = 'invalid' as const }
export class SceneTooLargeError extends Error { code = 'too_large' as const }

export function createSceneStore(env?: NodeJS.ProcessEnv): SceneStore { /* factory */ }
```

## Agent scope map

| Agent | Scope | File ownership |
|---|---|---|
| A1 | Storage interface + types + factory | `packages/mcp/src/storage/types.ts`, `packages/mcp/src/storage/index.ts`, `packages/mcp/src/storage/store.test.ts` |
| A2 | Filesystem impl | `packages/mcp/src/storage/filesystem-scene-store.ts` + tests |
| A3 | Supabase impl + migration SQL | `packages/mcp/src/storage/supabase-scene-store.ts`, `packages/mcp/sql/migrations/0001_scenes.sql` + tests |
| A4 | MCP scene-lifecycle tools | `packages/mcp/src/tools/scene-lifecycle/*.ts` + index wiring |
| A5 | Next.js API routes | `apps/editor/app/api/scenes/route.ts`, `apps/editor/app/api/scenes/[id]/route.ts`, `apps/editor/lib/scene-store-server.ts` |
| A6 | Editor routes + kill dev hook | `apps/editor/app/scene/[id]/page.tsx`, `apps/editor/app/scenes/page.tsx`, edit `apps/editor/app/page.tsx` |
| A7 | URL hardening in core schemas | `packages/core/src/schema/nodes/{scan,guide,item}.ts`, `packages/core/src/schema/material.ts` + migration |
| A8 | Auto-frame camera + scene templates | `packages/editor/src/hooks/use-auto-frame.ts`, `packages/mcp/src/templates/*`, `packages/mcp/src/tools/scene-lifecycle/list-templates.ts` |
| A9 | Multi-variant generation | `packages/mcp/src/tools/variants/*` + tests |
| A10 | Photo → scene + example | `packages/mcp/src/tools/photo-to-scene/*` (orchestrator), update `README.md`, new `examples/photo-to-scene.md` |

## Global coordination rules
- Agent A1 drops first (interface only). A2, A3, A4, A5 read from `packages/mcp/src/storage/types.ts`; if it doesn't exist when they start, they should **inline a copy of the types above** and the integrator fixes up the import later.
- All MCP tools use `StreamableHTTPClientTransport`-compatible input/output Zod schemas.
- Every tool uses the shared `SceneStore` via `createSceneStore()` — never instantiates concrete stores.
- Tests are `bun:test`, colocated.
- Biome 2-space, single quote, no semicolons, trailing commas all.
- Do NOT run `bun install` — already done.
- Do NOT modify files outside your ownership.

## Acceptance
- `bun test --cwd packages/mcp` green.
- `bunx biome check packages/mcp apps/editor/app` green.
- `bun run --cwd packages/mcp build` green.
- `MCP save_scene → list_scenes → editor opens /scene/<id>` works without `window.__pascalScene`.
