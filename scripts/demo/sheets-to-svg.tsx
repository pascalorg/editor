/**
 * Headless sheet rendering to SVG — one file per sheet, drawn by the same
 * React SVG renderer the Sheets workspace uses (`FloorplanGeometryRenderer`),
 * so the SVGs are what the screen shows, and they can be inspected in a
 * browser at any zoom.
 *
 *   bun scripts/demo/sheets-to-svg.tsx <scene.json> [outDir]
 *
 * `scene.json` is the graph `generate-and-print.ts` writes beside its PDF
 * (nodes / rootNodeIds / collections / materials / installedPlugins). The
 * default outDir is apps/editor/public/tmp-sheets, which the dev server
 * serves at /tmp-sheets/ — an index.html viewer is written beside the SVGs:
 * `index.html?f=A2.0.svg` fits the sheet, `&z=3&sx=0.4&sy=0.2` zooms 3× on
 * the point 40 % across, 20 % down.
 */
import { nodeRegistry, registerNode, useScene } from '@pascal-app/core'
import { FloorplanGeometryRenderer, registerSitePlanContributor } from '@pascal-app/editor'
import * as nodeDefs from '@pascal-app/nodes'
import { bonesPlugin } from '@pascal-app/plugin-bones'
import { buildElevationDrawing, buildSectionDrawing, sectionsPlugin } from '@pascal-app/plugin-sections'
import {
  type ComposedSheet,
  composeAll,
  registerBuiltinSheetProviders,
  registerSheetDrawingProvider,
  sheetsPlugin,
} from '@pascal-app/plugin-sheets'
import { buildUtilitiesDrawing, utilitiesPlugin } from '@pascal-app/plugin-utilities'
import { renderToStaticMarkup } from 'react-dom/server'

const SCENE = process.argv[2]
const OUT_DIR = process.argv[3] ?? 'apps/editor/public/tmp-sheets'
if (!SCENE) throw new Error('usage: bun scripts/demo/sheets-to-svg.tsx <scene.json> [outDir]')

for (const value of Object.values(nodeDefs)) {
  const def = value as { kind?: string; schema?: unknown }
  if (def && typeof def.kind === 'string' && def.schema && !nodeRegistry.get(def.kind)) {
    registerNode(def as never)
  }
}
for (const plugin of [sheetsPlugin, sectionsPlugin, utilitiesPlugin, bonesPlugin]) {
  for (const def of (plugin as { nodes?: { kind: string }[] }).nodes ?? []) {
    if (!nodeRegistry.get(def.kind)) registerNode(def as never)
  }
}
registerSheetDrawingProvider('section', (nodes, args) =>
  buildSectionDrawing({ nodes: nodes as never }, args as never),
)
registerSheetDrawingProvider('elevation', (nodes, args) =>
  buildElevationDrawing(
    { nodes: nodes as never },
    ((args as { direction?: string }).direction ?? 'south') as never,
  ),
)
registerSitePlanContributor('utilities', (scene) => buildUtilitiesDrawing(scene as never))
registerBuiltinSheetProviders()

/** Paper.tsx's sheet, without its interaction layer. */
function Sheet({ composed }: { composed: ComposedSheet }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="100%"
      height="100%"
      viewBox={`0 0 ${composed.widthIn} ${composed.heightIn}`}
      style={{ background: '#ffffff' }}
    >
      <title>{`${composed.sheet.number} ${composed.sheet.title}`}</title>
      {composed.plate.map((geometry, i) => (
        <FloorplanGeometryRenderer
          key={`p${i}`}
          geometry={geometry}
          sceneRotationDeg={0}
          pointerEventsOverride="none"
        />
      ))}
      {composed.windows.map((win, i) => {
        const unitsPerPoint = win.viewport.width / Math.max(1e-6, win.rect.w * 72)
        return (
          <svg
            key={`win-${i}`}
            x={win.rect.x}
            y={win.rect.y}
            width={win.rect.w}
            height={win.rect.h}
            viewBox={`${win.viewport.x} ${win.viewport.y} ${win.viewport.width} ${win.viewport.height}`}
            preserveAspectRatio="xMidYMid meet"
            style={{ overflow: 'hidden' }}
          >
            <g transform={`rotate(${win.rotationDeg})`}>
              {win.model && (
                <FloorplanGeometryRenderer
                  geometry={win.model}
                  sceneRotationDeg={win.rotationDeg}
                  pointerEventsOverride="none"
                />
              )}
              {win.annotations && (
                <FloorplanGeometryRenderer
                  geometry={win.annotations}
                  renderMode="pdf"
                  sceneRotationDeg={win.rotationDeg}
                  annotationUnitsPerPoint={unitsPerPoint}
                  screenUnitsPerPixel={unitsPerPoint}
                  pointerEventsOverride="none"
                />
              )}
            </g>
          </svg>
        )
      })}
      {composed.overlay.map((geometry, i) => (
        <FloorplanGeometryRenderer
          key={`o${i}`}
          geometry={geometry}
          sceneRotationDeg={0}
          pointerEventsOverride="none"
        />
      ))}
    </svg>
  )
}

const VIEWER = `<!doctype html><meta charset="utf-8"><title>sheets</title>
<style>html,body{margin:0;background:#666;height:100%;overflow:hidden}img{display:block;background:#fff}</style>
<img id="s">
<script>
const q=new URLSearchParams(location.search);const f=q.get('f')||'A0.0.svg';const z=+(q.get('z')||0);
const sx=+(q.get('sx')||0.5),sy=+(q.get('sy')||0.5);const img=document.getElementById('s');img.src=f;
img.onload=()=>{const W=img.naturalWidth,H=img.naturalHeight;const vw=innerWidth,vh=innerHeight;
const fit=Math.min(vw/W,vh/H);const k=z?fit*z:fit;img.style.width=(W*k)+'px';img.style.height=(H*k)+'px';
img.style.marginLeft=(z?(vw/2-W*k*sx):((vw-W*k)/2))+'px';img.style.marginTop=(z?(vh/2-H*k*sy):((vh-H*k)/2))+'px';};
</script>`

async function main() {
  const graph = JSON.parse(await Bun.file(SCENE).text()) as Record<string, unknown>
  useScene.setState({
    nodes: graph.nodes as never,
    rootNodeIds: graph.rootNodeIds as never,
    collections: (graph.collections ?? {}) as never,
    materials: (graph.materials ?? {}) as never,
    installedPlugins: (graph.installedPlugins ?? []) as never,
  } as never)
  const nodes = useScene.getState().nodes
  const composed = composeAll({ nodes: nodes as never })
  const { mkdirSync } = await import('node:fs')
  mkdirSync(OUT_DIR, { recursive: true })
  const names: string[] = []
  for (const sheet of composed) {
    const svg = renderToStaticMarkup(<Sheet composed={sheet} />)
    const name = `${sheet.sheet.number}.svg`
    await Bun.write(`${OUT_DIR}/${name}`, svg)
    names.push(name)
  }
  await Bun.write(`${OUT_DIR}/index.html`, VIEWER)
  console.log(`wrote ${names.length} sheets to ${OUT_DIR}: ${names.join(' ')}`)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
