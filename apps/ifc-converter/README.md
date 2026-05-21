# IFC → Pascal Converter

A web app that converts IFC building models into Pascal scene-graph JSON and
previews the result in the real `@pascal-app/viewer`. Drop in an `.ifc` file
(or pick a bundled example), inspect what was extracted, and download the
JSON to load into the Pascal editor.

> ## ⚠️ Early alpha
>
> This converter is in **early alpha**. IFC is a sprawling, loosely-followed
> standard and real-world exports vary wildly — so expect rough edges:
> misplaced or missing elements, walls that default to a fixed height when
> their geometry can't be read, items skipped entirely, and element types
> that aren't mapped yet. The output is meant for previewing and iterating,
> not production.
>
> **Contributions very welcome** — if you hit a file that converts badly,
> a sample IFC + a note on what's wrong is hugely helpful, and PRs improving
> the conversion (better geometry extraction, more element types, edge-case
> handling) are exactly what this needs. Jump in. 🙏

## How it works

- **`@pascal-app/ifc-converter`** (`packages/ifc-converter`) — the pure
  conversion logic. Parses IFC via [web-ifc](https://github.com/ThatOpen/engine_web-ifc),
  maps elements onto Pascal node schemas from `@pascal-app/core`. No DOM, no
  React.
- **This app** — the UI: drop zone, example picker, element search/filters,
  the 3D preview, and JSON download.

## Develop

```bash
bun dev   # from this directory, or `turbo run dev` at the repo root
```

The `web-ifc.wasm` binary is copied into `public/` automatically on
install/dev/build (`scripts/copy-web-ifc-wasm.mjs`). Large example IFCs are
fetched from a public bucket at runtime; the small ones are committed under
`public/test-ifc-files/`. Override the bucket with
`NEXT_PUBLIC_IFC_EXAMPLES_BASE_URL`.

## Known limitations (help wanted)

- Plain `IFCWALL` (Brep/mapped geometry) falls back to a default height — exact
  per-wall heights need geometry-AABB extraction.
- Items (furniture, etc.) are skipped — Pascal items require a catalog asset.
- Beams have no Pascal node type yet and are skipped.
- Doors/windows are matched to walls by proximity when the IFC omits fill
  relationships; matching isn't perfect.
- Stairs/roofs are placeholders (bounding box / flat polygon in metadata).
