# Listing viewer template

A standalone web page that shows one published Pascal project in 3D: the baked 3D file (GLB) under
studio light, a floors control, room names and areas on hover, and doors and windows that open on
click. It reads Pascal's public scene read API and nothing else. It does not use any `@pascal-app/*`
package, so it is also the reference for building your own viewer on Pascal.

It is a template: fork it, restyle it, add UI. This file tells you (or your agent) where things are
and which rules to keep.

## Layout

| Path | Owns |
| --- | --- |
| `src/pascal/` | The API client: the contract schema (`contract.ts`), `getScene` / `fetchGlb` with typed errors and signed-URL renewal (`client.ts`), and read helpers over the scene graph (`graph.ts`). No React and no three.js in here; keep it that way so it can move into an SDK unchanged. |
| `src/useListing.ts` | Loading flow: read the scene, then download the best 3D file, poll while it is being prepared. |
| `src/App.tsx`, `src/styles.css` | Screens (loading, errors, no 3D file, WebGL unavailable) and the overlay UI. |
| `src/viewer/Viewer.tsx` | The canvas: environment light, key light and shadow, camera framing, orbit controls. |
| `src/viewer/Model.tsx` | Parses the GLB, applies floor visibility, hover and click, plays door and window clips. |
| `src/viewer/semantics.ts` | Maps GLB nodes to Pascal identities: floors, rooms, openables. |
| `src/viewer/loaders.ts` | GLTFLoader with the meshopt decoder and KTX2 transcoder Pascal's files need. |
| `vite.config.ts` | Build, and the Content-Security-Policy written into `index.html`. |
| `tests/` | Playwright smoke against a mocked API, with fixtures from `scripts/make-fixture.mjs`. |

## The contract

The template is built on contract version 1 of Pascal's scene read API. The sections of that
contract are **Route**, **Response** and **Projection**; `src/pascal/contract.ts` mirrors the
response.

**Route.** `GET {baseUrl}/api/projects/{id}/scene`, optional `?revision=published` (the default and,
in version 1, the only value).

- Anonymous requests read public, published projects. The answer carries
  `Access-Control-Allow-Origin: *`, so any site can call it from the browser without a proxy.
- Every answer is `Cache-Control: private, no-store`, because it contains signed URLs.
- Errors are `{ "error": code }`: 404 `not_found` (missing or not public; Pascal does not tell them
  apart), 404 `not_published`, 401 when a credential was sent and rejected, 400
  `unsupported_revision`.
- The client sends `credentials: 'omit'`, so a visitor's own Pascal session never changes what
  your page sees.

**Response.** `contractVersion: 1`, then:

- `project`: `id`, `name` (may be null), `owner` (`displayName`, `avatarUrl`) or null, `coverUrl`.
- `revision`: `kind: 'published'`, `version`, `modelId`, `disclosurePolicyVersion`.
- `graph`: the published scene graph: `nodes` (by id, each with `id`, `type`, `name`, `parentId`,
  `children` and kind-specific fields) and `rootNodeIds`.
- `libraryMaterials`: the library materials the graph references.
- `bake`: `status` (`ready`, `baking`, `failed`, `none`), `bakeVersion`, `hash`, and `lods`: one
  entry per level of detail with `level` (0 is the most detailed), `url`, `bytes`, `triangles` and
  `expiresAt`.

Each LOD `url` is a signed URL that lives about 10 minutes and `expiresAt` is its real expiry. To
get a fresh one, read the scene again. `fetchGlb` does this when a URL is within a minute of expiry,
and once more if storage rejects it (400 or 403).

**Projection.** The graph is the published scene with what the owner did not publish removed
(disclosure policy 1): hidden subtrees, annotation-only node kinds, scans and guides unless shown
publicly, per-node `metadata` and `provenance`, and the site's address and parcel data. Do not rely
on fields outside the rendering data.

### What the 3D file contains

The GLB is self-describing, so a viewer needs no Pascal runtime:

- `node.name` is the Pascal node id, and `node.extras` (three's `userData`) carries `pascalId`,
  `kind` (`site`, `building`, `level`, `zone`, `slab`, `wall`, `door`, `window`, `item`, …) and
  `label`.
- A hit resolves to a Pascal node by walking up to the nearest ancestor with `extras.pascalId`.
  From there, `parentId` in the graph leads to its level and, for some kinds, its zone (room).
- Zones carry `polygon` (and `color`) in extras: the outline in the zone's own x/z plane, in
  metres. Their fill mesh is not in the file.
- Doors and windows that really open carry `openable: true` and `clips: ["<id>: open"]`: a
  one-second clip, closed at time 0. Play it once and clamp; reverse `timeScale` to close.
  Ambient clips end in `: loop` (a fan); this template does not play them.
- Geometry uses `EXT_meshopt_compression` (required) and textures are KTX2 (`KHR_texture_basisu`).
- There are no lights and no post-processing in the file. Lighting is the viewer's job.

## Run it

```bash
npm install            # or: bun install
cp .env.example .env   # optional
npm run dev            # http://localhost:5173/?project=<project id>
```

| Variable | Meaning |
| --- | --- |
| `VITE_PASCAL_BASE_URL` | Pascal instance, default `https://editor.pascal.app`. |
| `VITE_PASCAL_PROJECT_ID` | Project shown when the address has no `?project=`. |
| `VITE_PASCAL_ASSET_ORIGINS` | Storage hosts added to the CSP `connect-src`, default `https://*.supabase.co`. |

All of them are build-time and public: Vite inlines `VITE_*` values into the bundle.

Checks:

```bash
npm run typecheck
npm run build
npx playwright install chromium   # once
npm run test:e2e                  # builds, serves dist, mocks the API
```

The smoke test intercepts the scene read and the GLB download, so it needs no network and no
Pascal account. `npm run fixture` regenerates `tests/fixtures/` (needs KTX-Software's `toktx`, or
`TOKTX=/path/to/toktx`); the fixture is a small two-floor house with a KTX2 texture, a door clip and
meshopt compression, like a real bake.

## Deploy

`npm run build` writes a static site to `dist/`. There is one page and no client-side routing.

- **Vercel**: import the folder (framework preset Vite, build `npm run build`, output `dist`), set
  the variables above under Environment Variables, deploy. From the CLI: `vercel` then
  `vercel --prod`.
- **Cloudflare Pages**: build command `npm run build`, output directory `dist`, variables under
  Settings → Variables (they are read at build time). From the CLI:
  `npm run build && npx wrangler pages deploy dist`.

The CSP ships as a `<meta>` tag. A meta policy cannot set `frame-ancestors`; if you need to control
who embeds your page, send that as a header (`vercel.json` headers, or `public/_headers` on
Cloudflare Pages).

## Customise

- **Lighting and look**: `Viewer.tsx`. `StudioEnvironment` is the image-based light (three's
  `RoomEnvironment`, no download); `SUN` and `Stage` set the key light and its soft shadow, which
  falls on the site's own ground or on a shadow-only floor when the scene has none. To add
  post-processing, add `@react-three/postprocessing` inside the `Canvas`, and check the bundle
  size after.
- **UI**: `App.tsx` and `styles.css`. The floors control, hover label, header and hint are plain
  React over the canvas. Keep copy in sentence case and buttons fully rounded.
- **Semantics**: `semantics.ts`. `CUTAWAY_KINDS` are hidden while one floor is isolated so its rooms
  read from above; `roomAt` and `openableAt` decide what hover and click mean.
- **Large scenes**: hover raycasts every mesh. For very large files, add `three-mesh-bvh`.
- **WebGPU**: optional. The template uses WebGL 2 for reach; the loaders work with either renderer.
- **Another LOD**: `pickLod` in `src/pascal/client.ts` picks the most detailed level (lod0 when
  present). Pick a coarser level for phones if you need to.

## Rules

- Never put a Pascal API key, session or any other secret in the browser. `VITE_*` variables and
  everything in `src/` ship to every visitor. This template reads public, published projects
  anonymously; showing private projects needs a server you control that holds the credential.
- Do not import `@pascal-app/*`. The template must stay installable from this folder alone.
- Keep `src/pascal/` free of React and three.js.
- Keep the CSP in `vite.config.ts` in step with what the page loads. The decoders need
  `'wasm-unsafe-eval'`, `'unsafe-eval'` (the Basis transcoder's Emscripten bindings build functions
  at runtime inside its worker) and `worker-src blob:`; the reasons are in the file. KTX2 textures
  silently fail without them, and the model never finishes loading.
- The Basis transcoder is bundled from the installed `three` (no transcoder path is set), so it is
  served from your own origin and always matches the loader. Do not point it at a CDN.
- Watch the bundle: the app shell is about 82 KB gzipped and the 3D chunk about 295 KB, loaded in
  parallel with the API read. The KTX2 transcoder (about 15 KB of JavaScript and 245 KB of
  WebAssembly, gzipped) loads only when a file has KTX2 textures.
