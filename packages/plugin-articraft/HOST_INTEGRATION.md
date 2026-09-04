# Host integration

The package follows Pascal Plugin API v1: the core manifest and host panel are
separate exports.

```ts
import { extendPluginDiscovery } from '@pascal-app/core'
import { registerEditorHostPanel } from '@pascal-app/editor'
import {
  articraftHostPanel,
  articraftPlugin,
} from '@pascal-app/plugin-articraft'

extendPluginDiscovery(async () => [articraftPlugin])
registerEditorHostPanel(articraftHostPanel)
```

The raw TypeScript package must be transpiled by the host. Keep React, Three.js,
and all `@pascal-app/*` packages deduplicated through peer dependencies.

## Viewer appearance and performance

Articraft reads the host's `useViewer` appearance axes instead of persisting its
own quality settings. Colored + Rendered restores the source URDF/USDZ materials;
Colored + Solid reuses lightweight Lambert variants while retaining albedo maps
and transparency; Monochrome uses Pascal's active `furnishing` role colour and
scene theme. Variants are created once per authored material, reused across
preference changes, and disposed with the loaded hierarchy.

Committed assets stay on Pascal's scene layer, so the host's shadows, edge mode,
SSGI, and denoise pipeline apply globally. Placement previews use the editor
overlay layer and therefore remain outside the expensive scene depth/normal pass.
The plugin intentionally exposes no duplicate graphics-quality controls.

## Same-origin browser API

The panel calls these host routes:

```text
GET  /api/plugins/articraft/catalog?q=&page=1&pageSize=24
GET  /api/plugins/articraft/files?projectId=:projectId
GET  /api/plugins/articraft/configuration
POST /api/plugins/articraft/references
POST /api/plugins/articraft/generations
GET  /api/plugins/articraft/generations/:jobId
POST /api/plugins/articraft/generations/:jobId/cancel
```

Catalog responses use `ArticraftCatalogResponse`. Generation creation accepts
multipart form data (`prompt`, optional `image`, optional `provider`, optional
`model`) and returns `{ id, status }`. Configuration returns the worker-selected
default plus its allowlisted `models`; OpenAI/GPT-5.6 remains selected when those
fields are absent. Job status returns an item with the same `ArticraftCatalogItem`
shape when complete. Cancel marks queued work canceled immediately and propagates
the interruption into an active mini-articraft coroutine.

Reference creation accepts multipart form data (`projectId`, `prompt`, `provider`,
and optional `image`). Providers are `azure-openai` and `google`. The host generates
the image, saves it through its authenticated project-file boundary, and returns a
completed `ArticraftReferenceRender` containing the persisted project image. This is
curated host integration: Plugin API v1 does not grant arbitrary storage access to
browser plugins.

The host owns Pascal session checks, request limits, billing policy, the fixed
worker origin, and server-side worker authorization. Do not expose worker or
provider credentials as `NEXT_PUBLIC_*` values.

## Reference-image environment

Reference generation deliberately does not inherit Pascal's shared AI-provider
variables. Copy `.env.example` into an ignored host-local environment and set the
Articraft-prefixed variables required by each enabled provider:

```text
ARTICRAFT_REFERENCE_AZURE_OPENAI_ENDPOINT=
ARTICRAFT_REFERENCE_AZURE_OPENAI_API_KEY=
ARTICRAFT_REFERENCE_AZURE_OPENAI_DEPLOYMENT=gpt-image-2
ARTICRAFT_REFERENCE_AZURE_OPENAI_API_VERSION=preview
ARTICRAFT_REFERENCE_GOOGLE_API_KEY=
ARTICRAFT_REFERENCE_GOOGLE_MODEL=gemini-3.1-flash-image
```

Azure calls the configured GPT Image 2 deployment. Google uses Gemini 3.1 Flash
Image (Nano Banana 2) by default. Keys remain server-only; generated PNGs are
returned to the plugin only after the host has persisted them as project files.

## Reference worker

`server/` wraps mini-articraft's Python API behind a bearer-authenticated HTTP
contract. It is a reference deployment surface, not code that runs in the
browser or in a Vercel function. Generation requires CAD/OpenUSD dependencies
and should run in a persistent worker/container.

Required worker environment:

```text
ARTICRAFT_WORKER_API_KEY=
ARTICRAFT_ALLOWED_PROVIDERS=openai,anthropic,gemini,openrouter
ARTICRAFT_DEFAULT_PROVIDER=openai
ARTICRAFT_DEFAULT_MODEL=gpt-5.6
OPENAI_API_KEY=              # at least one provider credential
ANTHROPIC_API_KEY=
GEMINI_API_KEY=
OPENROUTER_API_KEY=
SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=
ARTICRAFT_STORAGE_BUCKET=articraft-catalog
```

Provider credits are spent by mini-articraft through the automatic default unless
the host intentionally overrides it. Keys stay in the worker environment and never
cross the HTTP response boundary.
