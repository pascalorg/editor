import { useScene } from '@pascal-app/core'
import { mintHostPanel, mintPlugin } from '@mint/pascal-plugin'
import {
  type AnyNodeDefinition,
  discoverPlugins,
  extendPluginDiscovery,
  loadPlugin,
  nodeRegistry,
  registerNode,
} from '@pascal-app/core'
import { registerEditorHostPanel, registerSitePlanContributor } from '@pascal-app/editor'
import { builtinPlugin } from '@pascal-app/nodes'
import { activateBones, bonesHostPanel, bonesPlugin } from '@pascal-app/plugin-bones'
import { constructionHostPanel, constructionPlugin } from '@pascal-app/plugin-construction'
import {
  environmentHostPanel,
  environmentPlugin,
  environmentPresentation,
} from '@pascal-app/plugin-environment'
import { poolHostPanel, poolPlugin } from '@pascal-app/plugin-pool'
import { generateHostPanel, generatePlugin, registerGenerateCommands, useGenerate } from '@pascal-app/plugin-generate'
import { lotHostPanel, lotPlugin } from '@pascal-app/plugin-lot'
import { registerRoofCommands, roofHostPanel, roofPlugin } from '@pascal-app/plugin-roof'
import {
  registerBuiltinSheetProviders,
  registerSheetDrawingProvider,
  registerSheetsCommands,
  sheetsHostPanel,
  sheetsPlugin,
  bonesExteriorItems,
  bonesSectionPrisms,
} from '@pascal-app/plugin-sheets'
import {
  buildBuildingModel,
  buildElevationDrawing,
  buildSectionDrawing,
  sectionsHostPanel,
  sectionsPlugin,
} from '@pascal-app/plugin-sections'
import { buildUtilitiesDrawing, utilitiesHostPanel, utilitiesPlugin } from '@pascal-app/plugin-utilities'
import { streetscapeHostPanel, streetscapePlugin } from '@pascal-app/plugin-streetscape'
import { treesHostPanel, treesPlugin } from '@pascal-app/plugin-trees'
import { registerViewerPresentation } from '@pascal-app/viewer'

// Idempotency guards: HMR can reload this module, but `registerNode`
// throws on duplicate kinds. Flags live in the module closure so they
// reset on a hard reload but survive within a session.
let builtinsLoaded = false
let externalsKickedOff = false

function isDev(): boolean {
  const env = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process
    ?.env
  return env?.NODE_ENV !== 'production'
}

/**
 * Synchronously register every built-in node kind. Runs as a side
 * effect at module import time so the registry is populated *before*
 * any downstream React tree renders — the previous async kick-off
 * (`void loadBuiltinNodes()`) only registered in a microtask, letting
 * the first SSR / hydration pass see an empty registry. The mismatch
 * surfaced as a hydration error at the `<html>` element and every
 * `NodeRenderer` resolving to `null` until later renders.
 *
 * `discoverPlugins()` (which may hit the network for external packs)
 * stays async and runs separately via `loadExternalPlugins()`.
 */
function loadBuiltinsSync(): void {
  if (builtinsLoaded) return
  builtinsLoaded = true
  for (const def of builtinPlugin.nodes ?? []) {
    // Skip kinds the registry already has. The module-closure flag
    // above resets on HMR, but the registry singleton (in @pascal-app/core)
    // persists — without this guard we'd throw on the first duplicate.
    if (nodeRegistry.has((def as AnyNodeDefinition).kind)) continue
    registerNode(def as AnyNodeDefinition)
  }

  if (isDev()) {
    const kinds = Array.from(nodeRegistry.entries(), ([k]) => k)
    if (typeof console !== 'undefined') {
      console.info(
        `[pascal:registry] loaded ${builtinPlugin.id} v${builtinPlugin.apiVersion} (${kinds.length} kinds: ${kinds.join(', ') || '∅'})`,
      )
    }
    // Expose the registry on globalThis for ad-hoc dev inspection. In
    // prod the registry is reachable through @pascal-app/core's
    // exports only.
    if (typeof globalThis !== 'undefined') {
      ;(globalThis as { __pascalNodeRegistry?: typeof nodeRegistry }).__pascalNodeRegistry =
        nodeRegistry
    }
  }
}

/**
 * Phase 6 plugin discovery hook — runs once, asynchronously, after the
 * synchronous builtins are already registered. Apps that ship external
 * node packs override the discovery via `setPluginDiscovery(...)`
 * before this module loads. See `wiki/architecture/plugin-authoring.md`.
 */
export async function loadExternalPlugins(): Promise<void> {
  if (externalsKickedOff) return
  externalsKickedOff = true
  const externals = await discoverPlugins()
  for (const plugin of externals) {
    await loadPlugin(plugin)
  }
  if (isDev() && externals.length > 0 && typeof console !== 'undefined') {
    console.info(`[pascal:registry] + ${externals.length} discovered plugin(s)`)
  }
}

// Register the first-party example node plugin alongside any host-provided
// discovery source instead of replacing it. Its Nature rail panel is host UI,
// so it is registered separately from the core plugin manifest.
extendPluginDiscovery(async () => [treesPlugin])
registerEditorHostPanel(treesHostPanel)
extendPluginDiscovery(async () => [constructionPlugin])
registerEditorHostPanel(constructionHostPanel)
extendPluginDiscovery(async () => [environmentPlugin])
registerEditorHostPanel(environmentHostPanel)
registerViewerPresentation(environmentPresentation)
extendPluginDiscovery(async () => [bonesPlugin])
// Bones ships INSTALLED: the engineering X-ray, the framing view and the
// blueprints are how a generated house gets checked, and a scene made on a
// fresh browser had no Bones rail item at all (Steve, 2026-09-06: "bones is
// missing on this scene"). The Plugins panel still uninstalls it per scene.
registerEditorHostPanel({ ...bonesHostPanel, defaultInstalled: true })
// Auto roof: the roof derived from the walls (Ctrl+K → Auto roof). Generate builds through the same engine.
extendPluginDiscovery(async () => [roofPlugin])
registerEditorHostPanel(roofHostPanel)
registerRoofCommands()
// Generate: complete houses from a seed or a template (Ctrl+K → Generate house).
extendPluginDiscovery(async () => [lotPlugin])
registerEditorHostPanel(lotHostPanel)
extendPluginDiscovery(async () => [generatePlugin])
registerEditorHostPanel(generateHostPanel)
registerGenerateCommands()
// A generated house carries Bones in the finished view: the tank in its
// enclosure, the condenser, the meter, the mast and pole, the cover plates
// (plugin-bones framing/physical.ts) — derived on the level the run wrote,
// once, in the 'off' view (the walls untouched). Steve, 2026-09-09: "bring
// bones into the auto generation to control it better".
useGenerate.subscribe((state, prev) => {
  const last = state.last
  if (!last || last === prev.last || !last.ok || !last.levelId) return
  const nodes = useScene.getState().nodes as Record<string, { type?: string; parentId?: string | null } | undefined>
  if (Object.values(nodes).some((n) => n?.type === 'bones:framing' && n.parentId === last.levelId)) return
  activateBones(useScene as never, last.levelId, null, 'off')
})
// Plans (PlanCrafters remote engine) is parked — see docs/construction-documents.md.
// Sheets: paper space, drawn by Pascal's own renderer (Ctrl+K → Open sheets).
extendPluginDiscovery(async () => [sheetsPlugin])
registerEditorHostPanel(sheetsHostPanel)
registerSheetsCommands()
// Sections: true vector sections + elevations from Pascal's own geometry.
extendPluginDiscovery(async () => [sectionsPlugin])
registerEditorHostPanel(sectionsHostPanel)
// Sheet viewports of kind 'section' / 'elevation' draw through the sections builders.
// They take `{ nodes }` and draw with y = -elevation (plugin-sections/src/geometry/types.ts).
registerSheetDrawingProvider('section', (nodes, args) => {
  // the model the section cuts, with Bones' ducts, boots, plenum, air
  // handler and the physical equipment as prisms — cut and shown beyond
  const model = buildBuildingModel(nodes as never)
  model.prisms.push(...(bonesSectionPrisms(nodes as never, model.levels) as never[]))
  // a viewport that carries a capture of the live viewer clipped at the
  // plane asks for the cut alone — the picture IS the beyond (plugin-sheets capture.ts)
  return buildSectionDrawing({ nodes: nodes as never }, args as never, model, {
    beyondFromImage: (args as { imageBacked?: boolean }).imageBacked === true,
  })
})
registerSheetDrawingProvider('elevation', (nodes, args) => {
  // the model the elevation draws, with Bones' exterior equipment (the water
  // heater's enclosure, the meter, the mast and pole, the condenser) as items
  const model = buildBuildingModel(nodes as never)
  model.items.push(...(bonesExteriorItems(nodes as never, model.levels) as never[]))
  // a viewport that carries a capture of the live viewer asks for the
  // overlays only — the picture IS the body (plugin-sheets capture.ts)
  return buildElevationDrawing({ nodes: nodes as never }, ((args as { direction?: string }).direction ?? 'south') as never, model, {
    overlaysOnly: (args as { imageBacked?: boolean }).imageBacked === true,
    // the viewer's own lines on the viewport replace the model's outlines
    outlines: (args as { edgesBacked?: boolean }).edgesBacked !== true,
  })
})
// Site utilities (WS4): overhead / underground runs, poles, service points.
extendPluginDiscovery(async () => [utilitiesPlugin])
registerEditorHostPanel(utilitiesHostPanel)
// …and on the site plan (the site layer draws only what the builder returns).
registerSitePlanContributor('utilities', (scene) => buildUtilitiesDrawing(scene as never))
// Built-in sheet providers: structural (Bones), electrical, plumbing, energy, general notes.
registerBuiltinSheetProviders()
extendPluginDiscovery(async () => [mintPlugin])
registerEditorHostPanel(mintHostPanel)
extendPluginDiscovery(async () => [poolPlugin])
registerEditorHostPanel(poolHostPanel)
extendPluginDiscovery(async () => [streetscapePlugin])
// The upstream manifest still names 'Pascal' as creator; credit the author.
registerEditorHostPanel({
  ...streetscapeHostPanel,
  creator: { name: 'Sudhir Yadav', url: 'https://github.com/sudhir9297' },
})

loadBuiltinsSync()
void loadExternalPlugins()
