import { readFileSync, realpathSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { build, type Plugin } from 'esbuild'
import ts from 'typescript'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const forbiddenSpecifier = /^(?:@pascal-app\/editor|next)(?:\/|$)/
const forbiddenPath =
  /(?:^|\/)(?:packages\/editor|node_modules\/(?:@pascal-app\/editor|next))(?:\/|$)/

function rejectForbidden(path: string) {
  if (forbiddenSpecifier.test(path) || forbiddenPath.test(path.replaceAll('\\', '/')))
    throw new Error(`Forbidden render dependency: ${path}`)
}

const boundary: Plugin = {
  name: 'render-package-boundary',
  setup(context) {
    context.onResolve({ filter: /.*/ }, async (args) => {
      if (args.pluginData?.boundaryChecked) return
      rejectForbidden(args.path)
      const result = await context.resolve(args.path, {
        kind: args.kind,
        resolveDir: args.resolveDir,
        importer: args.importer,
        pluginData: { boundaryChecked: true },
      })
      if (result.errors.length) return result
      rejectForbidden(result.path)
      if (result.path && !result.external && result.namespace === 'file')
        rejectForbidden(realpathSync(result.path))
      if (result.external) throw new Error(`Uninspected external render dependency: ${args.path}`)
      return { ...result, pluginData: undefined }
    })
  },
}

// Loads the resolver hook cannot see: a computed import()/require(), import.meta.glob, and
// workers (their entry is a URL, not an import). Pascal-owned code must not use them, so
// every module reaches the render graph through an inspected literal import.
const pascalSource = /(?:^|\/)packages\/(?:core|viewer|nodes|geometry-script)\//
function rejectUninspectedLoads(path: string, contents: string) {
  const file = ts.createSourceFile(path, contents, ts.ScriptTarget.Latest, true)
  const literal = (node: ts.Node | undefined) =>
    !!node && (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node))
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) {
      const callee = node.expression
      const isImport = callee.kind === ts.SyntaxKind.ImportKeyword
      const isRequire = ts.isIdentifier(callee) && callee.text === 'require'
      if ((isImport || isRequire) && !literal(node.arguments[0]))
        throw new Error(
          `Uninspected render load: computed ${isImport ? 'import()' : 'require()'} in ${path}`,
        )
    }
    if (
      ts.isPropertyAccessExpression(node) &&
      node.name.text === 'glob' &&
      ts.isMetaProperty(node.expression)
    )
      throw new Error(`Uninspected render load: import.meta.glob in ${path}`)
    if (
      ts.isNewExpression(node) &&
      ts.isIdentifier(node.expression) &&
      (node.expression.text === 'Worker' || node.expression.text === 'SharedWorker')
    )
      throw new Error(`Uninspected render load: ${node.expression.text} in ${path}`)
    ts.forEachChild(node, visit)
  }
  visit(file)
}

for (const source of [
  "const dep = globalThis.dep ?? '@pascal-app/editor'; export const lazy = () => import(dep)",
  // biome-ignore lint/suspicious/noTemplateCurlyInString: source text for the computed-import boundary probe
  'export const lazy = (name) => import(`@pascal-app/${name}`)',
  "const dep = '@pascal-app/editor'; export const load = () => require(dep)",
  "export const modules = import.meta.glob('../editor/src/**/*.ts')",
  "export const worker = new Worker(new URL('../editor/src/worker.ts', import.meta.url))",
]) {
  let rejected = false
  try {
    rejectUninspectedLoads('probe.js', source)
  } catch (error) {
    if (!String(error).includes('Uninspected render load:')) throw error
    rejected = true
  }
  if (!rejected) throw new Error(`Boundary self-test accepted ${source}`)
}

function virtualModule(name: string, contents: string): Plugin {
  return {
    name,
    setup(context) {
      context.onResolve({ filter: new RegExp(`^${name}$`) }, () => ({
        path: name,
        namespace: name,
      }))
      context.onLoad({ filter: /.*/, namespace: name }, () => ({ contents, resolveDir: root }))
    },
  }
}

// Reach a forbidden import transitively through a virtual module, including lazy imports
// and a direct package path that bypasses the package-name check.
for (const dependency of [
  '@pascal-app/editor',
  'next/navigation',
  resolve(root, 'packages/editor/src/index.tsx'),
]) {
  for (const source of [
    `import '${dependency}'`,
    `export const lazy = () => import('${dependency}')`,
  ]) {
    let rejected = false
    try {
      await build({
        stdin: { contents: "export * from 'render-boundary-probe'", resolveDir: root },
        bundle: true,
        platform: 'browser',
        format: 'esm',
        write: false,
        logLevel: 'silent',
        plugins: [boundary, virtualModule('render-boundary-probe', source)],
      })
    } catch (error) {
      if (!String(error).includes('Forbidden render dependency:')) throw error
      rejected = true
    }
    if (!rejected) throw new Error(`Boundary self-test accepted ${source}`)
  }
}

const result = await build({
  absWorkingDir: root,
  entryPoints: {
    render: '@pascal-app/nodes/render',
    sfx: '@pascal-app/viewer/sfx',
    ui: '@pascal-app/viewer/ui',
    consumer: 'render-consumer',
  },
  bundle: true,
  platform: 'browser',
  format: 'esm',
  splitting: true,
  metafile: true,
  minify: true,
  write: false,
  outdir: resolve(root, '.render-bundle-check'),
  logLevel: 'silent',
  plugins: [
    boundary,
    virtualModule(
      'render-consumer',
      `
    import { loadPlugin, roomCounts, useScene } from '@pascal-app/core';
    import { timeTargetMinutes, transitionTimeOfDay, filterSectionHits, filterXrayHits, isSectionObject, heldReasons, GlbScene, InteractiveSystem, createWalkthroughInput, WALKTHROUGH_DEFAULT_SPEEDS, WALKTHROUGH_SEE_DISTANCE, GlbWalkthroughController, LiveWalkthroughController, familyForNode, sceneFamilies, VIEWER_FAMILIES, xrayActive, SectionGroup, sectionBounds, presetInstant, useFirstPersonHud, useViewer, Viewer } from '@pascal-app/viewer';
    import { renderPlugin } from '@pascal-app/nodes/render';
    import { WalkthroughTouchControls } from '@pascal-app/viewer/ui';
    export { timeTargetMinutes, transitionTimeOfDay, filterSectionHits, filterXrayHits, isSectionObject, heldReasons, GlbScene, InteractiveSystem, createWalkthroughInput, WALKTHROUGH_DEFAULT_SPEEDS, WALKTHROUGH_SEE_DISTANCE, GlbWalkthroughController, WalkthroughTouchControls, LiveWalkthroughController, familyForNode, sceneFamilies, VIEWER_FAMILIES, xrayActive, SectionGroup, sectionBounds, presetInstant, roomCounts, useFirstPersonHud, useViewer, Viewer, renderPlugin };
    export async function hydrate(scene) {
      await loadPlugin(renderPlugin);
      useScene.getState().setScene(scene);
    }
  `,
    ),
  ],
})

const inputs = Object.keys(result.metafile.inputs)
if (!inputs.some((path) => path.endsWith('packages/viewer/dist/sfx/index.js')))
  throw new Error('SFX entry must resolve through the built package export to dist/sfx/index.js')
if (!inputs.some((path) => path.endsWith('packages/viewer/dist/ui/index.js')))
  throw new Error('UI entry must resolve through the built package export to dist/ui/index.js')
for (const cameraModule of [
  'components/viewer-camera-controls',
  'components/viewer-opening-camera',
  'lib/opening-camera',
]) {
  if (!inputs.some((path) => path.endsWith(`packages/viewer/dist/ui/${cameraModule}.js`)))
    throw new Error(`UI boundary must inspect the camera module: ${cameraModule}`)
}
if (!inputs.some((path) => path.endsWith('packages/nodes/dist/render.js')))
  throw new Error('Render entry must resolve through the built package export to dist/render.js')
let scannedPascalModules = 0
for (const path of inputs) {
  rejectForbidden(path)
  if (pascalSource.test(path.replaceAll('\\', '/'))) {
    rejectUninspectedLoads(path, readFileSync(resolve(root, path), 'utf8'))
    scannedPascalModules++
  }
}
if (scannedPascalModules === 0) throw new Error('No Pascal-owned render modules were scanned')
for (const [path, output] of Object.entries(result.metafile.outputs)) {
  rejectForbidden(path)
  for (const dependency of output.imports) {
    rejectForbidden(dependency.path)
    if (dependency.external) throw new Error(`External dependency in ${path}: ${dependency.path}`)
  }
}
const files = result.outputFiles
const entry = files.find((file) => file.path.endsWith('/render.js'))
const sfxEntry = files.find((file) => file.path.endsWith('/sfx.js'))
if (!sfxEntry) throw new Error('Missing SFX entry output')
const uiEntry = files.find((file) => file.path.endsWith('/ui.js'))
if (!uiEntry) throw new Error('Missing UI entry output')
const consumerEntry = files.find((file) => file.path.endsWith('/consumer.js'))
if (!entry || !consumerEntry) throw new Error('Missing render or consumer entry output')
const bytes = files.reduce((sum, file) => sum + file.contents.byteLength, 0)
const outputsByPath = new Map(
  Object.entries(result.metafile.outputs).map(([path, output]) => [resolve(root, path), output]),
)
const reachable = new Set<string>()
function visitOutput(path: string) {
  if (reachable.has(path)) return
  const output = outputsByPath.get(path)
  if (!output) throw new Error(`Missing output chunk: ${path}`)
  reachable.add(path)
  for (const dependency of output.imports) visitOutput(resolve(root, dependency.path))
}
visitOutput(entry.path)
const renderBytes = [...reachable].reduce((sum, path) => sum + outputsByPath.get(path)!.bytes, 0)
console.log(
  'Render bundle boundary self-test: passed (static, lazy, computed, glob and worker loads)',
)
console.log(`Pascal-owned render modules scanned for uninspected loads: ${scannedPascalModules}`)
console.log(`Render entry: ${entry.contents.byteLength} bytes (shared chunks emitted separately)`)
console.log(
  `Render graph including shared/lazy chunks: ${renderBytes} bytes across ${reachable.size} chunks`,
)
console.log(`Viewer SFX entry: ${sfxEntry.contents.byteLength} bytes`)
console.log(
  `Viewer UI entry: ${uiEntry.contents.byteLength} bytes (shared chunks emitted separately)`,
)
console.log(`Viewer/hydration consumer entry: ${consumerEntry.contents.byteLength} bytes`)
console.log(`Render bundle including all lazy chunks: ${bytes} bytes across ${files.length} chunks`)

// A declaration consumer gets no editor/Next resolution, even in this development workspace.
const consumer = resolve(root, 'packages/nodes/render-consumer.ts')
const consumerSource = `
  import { roomCounts, type Plugin, type RoomCounts, type SceneGraph } from '@pascal-app/core';
  import { familyForNode, sceneFamilies, VIEWER_FAMILIES, xrayActive, SectionGroup, sectionBounds, presetInstant, useViewer, type SectionAxis, type SectionShadows, type DaylightSite, type TimeOfDay } from '@pascal-app/viewer';
  import { timeTargetMinutes, transitionTimeOfDay, filterSectionHits, filterXrayHits, isSectionObject, heldReasons, GlbScene, InteractiveSystem, type TimeTarget, type TimeTransitionOptions, type GlbPickEvent, type SelectionCalloutProps, type CalloutAction } from '@pascal-app/viewer';
  import type { ComponentProps } from 'react';
  const renderCallout = (props: SelectionCalloutProps) => { const actions: CalloutAction[] = props.actions; return null; };
  export const bakedProps: ComponentProps<typeof GlbScene> = { url: 'scene.glb', outlineSync: false, renderCallout, onPick: (event: GlbPickEvent) => { if (event.hitObject) heldReasons(event.hitObject); } };
  export const liveProps: ComponentProps<typeof InteractiveSystem> = { renderCallout };
  export const interactionApi = { transitionTimeOfDay, filterSectionHits, filterXrayHits, isSectionObject, heldReasons };
  export const transition = () => transitionTimeOfDay('dawn', { durationMs: (delta) => Math.abs(delta) * 2, easing: (t) => t });
  const elevationTarget: TimeTarget = { elevation: -2.5, side: 'setting' };
  const transitionOptions: TimeTransitionOptions = { durationMs: 0 };
  export const elevationTransition = (): (() => void) => transitionTimeOfDay(elevationTarget, transitionOptions);
  export const risingTransition = () => transitionTimeOfDay({ elevation: 6, side: 'rising' });
  export const targetMinutes: number = timeTargetMinutes(elevationTarget);
  export const presetMinutes: number = timeTargetMinutes('dawn');
  const site: DaylightSite = { northRotation: 1, lat: 48.86, lng: 2.35 };
  const dawn: TimeOfDay = 'dawn';
  export const families = (graph: SceneGraph): string[] => sceneFamilies(graph);
  export const familyApi = { familyForNode, VIEWER_FAMILIES, xrayActive };
  useViewer.getState().setXrayFamily('items');
  export const xray: string | null = useViewer.getState().xrayFamily;
  const axis: SectionAxis = 'y';
  useViewer.getState().setSectionEnabled(true);
  useViewer.getState().setSectionAxis(axis);
  useViewer.getState().setSectionPosition(2);
  useViewer.getState().setSectionFlipped(false);
  const shadows: SectionShadows = 'full';
  useViewer.getState().setSectionShadows(shadows);
  export const section = { SectionGroup, sectionBounds, extent: sectionBounds() }; 
  export const daylight = { instant: presetInstant(new Date(), site.lat!, site.lng!, dawn), site };
  useViewer.getState().setDaylightSite(site);
  export const counts = (graph: SceneGraph): RoomCounts => roomCounts(graph);
  import { LiveWalkthroughController, useFirstPersonHud, type LiveWalkthroughControllerProps } from '@pascal-app/viewer';
  import { createWalkthroughInput, GlbWalkthroughController, type GlbWalkthroughControllerProps, type WalkthroughInput, type WalkthroughSpeeds, type WalkthroughSeenInteract, WALKTHROUGH_DEFAULT_SPEEDS, WALKTHROUGH_SEE_DISTANCE } from '@pascal-app/viewer';
  const input: WalkthroughInput = createWalkthroughInput();
  input.setMove(1, 0); input.addLook(12, 4); input.requestJump(); input.requestInteract(); input.clear();
  useViewer.getState().setWalkthroughInputMode('touch');
  export const touchMode: 'desktop' | 'touch' = useViewer.getState().walkthroughInputMode;
  export { GlbWalkthroughController };
  const speeds: WalkthroughSpeeds = { walk: 1.8, run: 2.8 };
  const walkProps: LiveWalkthroughControllerProps = { paused: false, speeds, seeDistance: 16 };
  export const bakedWalkProps: GlbWalkthroughControllerProps = { url: 'scene.glb', speeds, seeDistance: 6 };
  export const seenInteract: WalkthroughSeenInteract = useFirstPersonHud.getState().seenInteract;
  export const walkthroughDefaults = { WALKTHROUGH_DEFAULT_SPEEDS, WALKTHROUGH_SEE_DISTANCE };
  export const walkthrough = { LiveWalkthroughController, useFirstPersonHud, walkProps };
  import { renderPlugin } from '@pascal-app/nodes/render';
  import { playSound, initInteractionSounds, useAudioSettings, type SoundName } from '@pascal-app/viewer/sfx';
  const sound: SoundName = 'menuClick';
  export const play = () => playSound(sound);
  export { initInteractionSounds, useAudioSettings };
  import { ParametricViewerRooms, RoomPillsLayer2D, RoomPillsLayer3D, SceneLoader, ViewerControlsBar, ViewerRooms, ViewerSceneHeader, WalkthroughHud, WalkthroughTouchControls, type WalkthroughHudProps, type WalkthroughTouchControlsProps, type WalkthroughSeenInteract as UiSeenInteract, type ViewerLinkProps } from '@pascal-app/viewer/ui';
  const uiSeen: UiSeenInteract = seenInteract;
  export const hudProps: WalkthroughHudProps = { seenInteract: uiSeen, comeCloserLabel: 'Come a little closer' };
  export const touchProps: WalkthroughTouchControlsProps = { className: 'host-skin' };
  export { WalkthroughTouchControls };
  const link = (props: ViewerLinkProps) => props.href;
  export const ui = { SceneLoader, ViewerControlsBar, ViewerSceneHeader, WalkthroughHud, link };
  export const rooms = { ParametricViewerRooms, RoomPillsLayer2D, RoomPillsLayer3D, ViewerRooms };
  import { FloorplanPreview, ViewerStage, ViewerStageSwitcher, type ViewerStageMode } from '@pascal-app/viewer/ui';
  import { ViewerCameraControls, ViewerOpeningCamera, parseOpeningCamera, savedSceneCamera, type ViewerCameraControlsProps, type ViewerOpeningCameraProps, type OpeningCameraPose } from '@pascal-app/viewer/ui';
  const controlsProps: ViewerCameraControlsProps = {
    mouseButtons: { left: 'rotate', middle: 'dolly', right: 'pan' },
    touches: { one: 'rotate', two: 'dolly-pan', three: 'none' },
    limits: { minDistance: 1, maxDistance: 300, minPolarAngle: 0, maxPolarAngle: Math.PI },
    smoothTime: 0.25, tap: { maxTravelPx: 7, maxDurationMs: 500 },
  };
  const pose: OpeningCameraPose = { position: [30, 30, 30], target: [0, 0, 0] };
  const openingProps: ViewerOpeningCameraProps = { pose, ready: true, onApplied: () => {} };
  export const camera = { ViewerCameraControls, ViewerOpeningCamera, parseOpeningCamera, savedSceneCamera, controlsProps, openingProps };
  const mode: ViewerStageMode = 'split';
  export const stage = { FloorplanPreview, ViewerStage, ViewerStageSwitcher, mode };
  const plugin: Plugin = renderPlugin;
  export const version: 1 = plugin.apiVersion;
`
const options: ts.CompilerOptions = {
  noEmit: true,
  strict: true,
  skipLibCheck: true,
  module: ts.ModuleKind.ESNext,
  moduleResolution: ts.ModuleResolutionKind.Bundler,
  target: ts.ScriptTarget.ES2022,
  types: [],
}
const host = ts.createCompilerHost(options)
const getSourceFile = host.getSourceFile.bind(host)
host.getSourceFile = (path, languageVersion, onError, shouldCreateNewSourceFile) => {
  rejectForbidden(path)
  return path === consumer
    ? ts.createSourceFile(path, consumerSource, languageVersion, true)
    : getSourceFile(path, languageVersion, onError, shouldCreateNewSourceFile)
}
host.resolveModuleNames = (names, containingFile) =>
  names.map((name) => {
    rejectForbidden(name)
    const resolved = ts.resolveModuleName(name, containingFile, options, host).resolvedModule
    if (resolved) rejectForbidden(realpathSync(resolved.resolvedFileName))
    return resolved
  })
const program = ts.createProgram([consumer], options, host)
const diagnostics = ts.getPreEmitDiagnostics(program)
if (diagnostics.length) {
  throw new Error(
    ts.formatDiagnosticsWithColorAndContext(diagnostics, {
      getCanonicalFileName: (path) => path,
      getCurrentDirectory: () => root,
      getNewLine: () => '\n',
    }),
  )
}
if (
  !program
    .getSourceFiles()
    .some((file) =>
      file.fileName.endsWith('/viewer/dist/components/viewer/live-walkthrough-controller.d.ts'),
    )
)
  throw new Error('Declaration consumer must resolve the built live walkthrough controller')
if (!program.getSourceFiles().some((file) => file.fileName.endsWith('/nodes/dist/render.d.ts')))
  throw new Error('Declaration consumer must resolve the built render export')
if (!program.getSourceFiles().some((file) => file.fileName.endsWith('/viewer/dist/sfx/index.d.ts')))
  throw new Error('Declaration consumer must resolve the built SFX export')
if (!program.getSourceFiles().some((file) => file.fileName.endsWith('/viewer/dist/ui/index.d.ts')))
  throw new Error('Declaration consumer must resolve the built UI export')
console.log(
  'Render, live walkthrough, SFX and UI declaration consumer: passed with editor/Next resolution forbidden',
)
