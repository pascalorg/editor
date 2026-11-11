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
    import { loadPlugin, useScene } from '@pascal-app/core';
    import { Viewer } from '@pascal-app/viewer';
    import { renderPlugin } from '@pascal-app/nodes/render';
    export { Viewer, renderPlugin };
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
console.log(`Viewer/hydration consumer entry: ${consumerEntry.contents.byteLength} bytes`)
console.log(`Render bundle including all lazy chunks: ${bytes} bytes across ${files.length} chunks`)

// A declaration consumer gets no editor/Next resolution, even in this development workspace.
const consumer = resolve(root, 'packages/nodes/render-consumer.ts')
const consumerSource = `
  import type { Plugin } from '@pascal-app/core';
  import { renderPlugin } from '@pascal-app/nodes/render';
  import { playSound, initInteractionSounds, useAudioSettings, type SoundName } from '@pascal-app/viewer/sfx';
  const sound: SoundName = 'menuClick';
  export const play = () => playSound(sound);
  export { initInteractionSounds, useAudioSettings };
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
if (!program.getSourceFiles().some((file) => file.fileName.endsWith('/nodes/dist/render.d.ts')))
  throw new Error('Declaration consumer must resolve the built render export')
if (!program.getSourceFiles().some((file) => file.fileName.endsWith('/viewer/dist/sfx/index.d.ts')))
  throw new Error('Declaration consumer must resolve the built SFX export')
console.log('Render and SFX declaration consumer: passed with editor/Next resolution forbidden')
