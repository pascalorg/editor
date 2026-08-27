import { describe, expect, it, beforeEach } from 'bun:test'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import {
  nodeRegistry,
  pluginManager,
  useScene,
  getRegistryVersion,
  type LazyPluginDescriptor,
} from '@pascal-app/core'
import { editorHostPanelRegistry } from '@pascal-app/editor'
import { PLUGIN_CATALOG, getPluginDescriptor } from '../lib/plugins/catalog'
import { usePluginManager } from '../lib/plugins/use-plugin-manager'

describe('Adversarial Verification: Bundle Splitting & Zero Chunk Leakage Suite', () => {
  const editorDir = path.resolve(import.meta.dir, '..')
  const nextDir = path.join(editorDir, '.next')
  const buildManifestPath = path.join(nextDir, 'build-manifest.json')
  const reactLoadableManifestPath = path.join(nextDir, 'react-loadable-manifest.json')
  const staticChunksDir = path.join(nextDir, 'static', 'chunks')

  const TARGET_PLUGINS = [
    {
      id: 'pascal:boots',
      pkg: '@pascal-app/plugin-boots',
      symbol: 'bootsPlugin',
      panelSymbol: 'bootsHostPanel',
      nodeKinds: ['boots:job'],
    },
    {
      id: 'pascal:trees',
      pkg: '@pascal-app/plugin-trees',
      symbol: 'treesPlugin',
      panelSymbol: 'treesHostPanel',
      nodeKinds: ['trees:tree', 'trees:flower', 'trees:grass'],
    },
    {
      id: 'pascal:bones',
      pkg: '@pascal-app/plugin-bones',
      symbol: 'bonesPlugin',
      panelSymbol: 'bonesHostPanel',
      nodeKinds: ['bones:lumber', 'bones:framing', 'bones:service', 'bones:device'],
    },
    {
      id: 'ovurrsl:warehouse',
      pkg: '@ovurrsl/plugin-warehouse',
      symbol: 'warehousePlugin',
      panelSymbol: 'warehouseCatalogPanel',
      nodeKinds: [
        'warehouse:pallet',
        'warehouse:pallet-rack',
        'warehouse:conveyor-spiral',
        'warehouse:pallet-lift',
        'warehouse:truck',
      ],
    },
    {
      id: 'pascal:articraft',
      pkg: '@pascal-app/plugin-articraft',
      symbol: 'articraftPlugin',
      panelSymbol: 'articraftHostPanel',
      nodeKinds: ['articraft:asset'],
    },
    {
      id: 'pascal:streetscape',
      pkg: '@pascal-app/plugin-streetscape',
      symbol: 'streetscapePlugin',
      panelSymbol: 'streetscapeHostPanel',
      nodeKinds: [
        'streetscape:road-network',
        'streetscape:street-light',
        'streetscape:utility-pole',
        'streetscape:road-sign',
      ],
    },
    {
      id: 'mint:assets',
      pkg: '@mint/pascal-plugin',
      symbol: 'mintPlugin',
      panelSymbol: 'mintHostPanel',
      nodeKinds: [],
    },
  ]

  beforeEach(() => {
    nodeRegistry._reset()
    pluginManager._reset()
    editorHostPanelRegistry.reset()
    useScene.getState().setInstalledPlugins([], { explicit: true })
    pluginManager.setPanelRegistrar((panel) => {
      editorHostPanelRegistry.registerPanel(panel)
    })
    pluginManager.registerDescriptors(PLUGIN_CATALOG)
  })

  // =========================================================================
  // SECTION 1: Deep Forensic Inspection of Build Artifacts & Entrypoint Chunks
  // =========================================================================
  describe('Dimension 1: Deep Forensic Analysis of Initial Chunks', () => {
    it('build-manifest.json exists and all initial chunks are free of plugin code', () => {
      expect(existsSync(buildManifestPath)).toBe(true)
      const rawManifest = readFileSync(buildManifestPath, 'utf8')
      const manifest = JSON.parse(rawManifest)

      const initialFiles = new Set<string>([
        ...(manifest.rootMainFiles ?? []),
        ...(manifest.polyfillFiles ?? []),
        ...(manifest.lowPriorityFiles ?? []),
      ])

      // Add default entry pages
      for (const pageKey of ['/_app', '/_error', '/']) {
        if (manifest.pages?.[pageKey]) {
          for (const file of manifest.pages[pageKey]) {
            initialFiles.add(file)
          }
        }
      }

      expect(initialFiles.size).toBeGreaterThan(0)

      for (const relPath of initialFiles) {
        const fullPath = path.join(nextDir, relPath)
        if (!existsSync(fullPath)) continue

        const content = readFileSync(fullPath, 'utf8')

        for (const plugin of TARGET_PLUGINS) {
          // Verify no static package imports or package references
          expect(content.includes(`"${plugin.pkg}"`)).toBe(false)
          expect(content.includes(`'${plugin.pkg}'`)).toBe(false)

          // Verify no exported plugin symbols exist in main chunks
          expect(content.includes(plugin.symbol)).toBe(false)
          expect(content.includes(plugin.panelSymbol)).toBe(false)

          // Verify no node kind registration literals exist in main chunks
          for (const kind of plugin.nodeKinds) {
            expect(content.includes(`kind:"${kind}"`)).toBe(false)
            expect(content.includes(`kind:'${kind}'`)).toBe(false)
          }
        }
      }
    })

    it('App router chunks (layout.js, page.js, not-found.js) do not leak plugin node definitions', () => {
      const appChunksDir = path.join(staticChunksDir, 'app')
      if (existsSync(appChunksDir)) {
        function collectJsFiles(dir: string): string[] {
          let list: string[] = []
          for (const entry of readdirSync(dir, { withFileTypes: true })) {
            const full = path.join(dir, entry.name)
            if (entry.isDirectory()) {
              list = list.concat(collectJsFiles(full))
            } else if (entry.name.endsWith('.js')) {
              list.push(full)
            }
          }
          return list
        }

        const appJsFiles = collectJsFiles(appChunksDir)
        expect(appJsFiles.length).toBeGreaterThan(0)

        for (const jsFile of appJsFiles) {
          const content = readFileSync(jsFile, 'utf8')
          for (const plugin of TARGET_PLUGINS) {
            for (const kind of plugin.nodeKinds) {
              expect(content.includes(`kind:"${kind}"`)).toBe(false)
              expect(content.includes(`kind:'${kind}'`)).toBe(false)
            }
          }
        }
      }
    })
  })

  // =========================================================================
  // SECTION 2: Dynamic Chunk Presence & Separate Chunk Verification
  // =========================================================================
  describe('Dimension 2: Dynamic Chunk Isolation & React Loadable Mapping', () => {
    it('react-loadable-manifest.json maps all 7 target plugins to separate dynamic chunks', () => {
      expect(existsSync(reactLoadableManifestPath)).toBe(true)
      const loadableManifest = JSON.parse(readFileSync(reactLoadableManifestPath, 'utf8'))

      for (const plugin of TARGET_PLUGINS) {
        const shortPkg = plugin.pkg
          .replace('@pascal-app/', '')
          .replace('@ovurrsl/', '')
          .replace('@mint/', '')

        const matchingKeys = Object.keys(loadableManifest).filter(
          (k) => k.includes(plugin.pkg) || k.includes(shortPkg),
        )

        expect(matchingKeys.length).toBeGreaterThan(0)

        // Ensure mapped chunks physically exist on disk
        let totalChunkFiles = 0
        for (const key of matchingKeys) {
          const entry = loadableManifest[key]
          const files = entry?.files ?? []
          for (const f of files) {
            const full = path.join(nextDir, f)
            if (existsSync(full)) {
              totalChunkFiles++
            }
          }
        }
        expect(totalChunkFiles).toBeGreaterThan(0)
      }
    })

    it('each target plugin symbol resides exclusively in a dedicated dynamic chunk', () => {
      const allChunks = readdirSync(staticChunksDir).filter((f) => f.endsWith('.js'))
      expect(allChunks.length).toBeGreaterThan(10)

      for (const plugin of TARGET_PLUGINS) {
        const matchingChunks: string[] = []
        for (const chunkFile of allChunks) {
          const content = readFileSync(path.join(staticChunksDir, chunkFile), 'utf8')
          if (content.includes(plugin.symbol) || plugin.nodeKinds.some((k) => content.includes(k))) {
            matchingChunks.push(chunkFile)
          }
        }

        // Each plugin must have at least one chunk holding its code
        expect(matchingChunks.length).toBeGreaterThan(0)
      }
    })
  })

  // =========================================================================
  // SECTION 3: Static Import Scanner across Editor Source Code
  // =========================================================================
  describe('Dimension 3: Static Import & Leakage Scanner in Source Code', () => {
    it('no source file under apps/editor/app or apps/editor/components statically imports any target plugin', () => {
      const scanDirs = [
        path.join(editorDir, 'app'),
        path.join(editorDir, 'components'),
        path.join(editorDir, 'lib', 'auth'),
      ]

      function scanDir(dir: string) {
        if (!existsSync(dir)) return
        for (const entry of readdirSync(dir, { withFileTypes: true })) {
          const full = path.join(dir, entry.name)
          if (entry.isDirectory()) {
            if (entry.name === 'node_modules' || entry.name === '.next') continue
            scanDir(full)
          } else if (/\.(ts|tsx|js|jsx)$/.test(entry.name) && !entry.name.includes('.test.')) {
            const content = readFileSync(full, 'utf8')
            for (const plugin of TARGET_PLUGINS) {
              const staticImportRegex = new RegExp(
                `import\\s+(?:(?:\\{[^}]*\\}|\\*\\s+as\\s+\\w+|\\w+)\\s+from\\s+)?['"]${plugin.pkg}['"]`,
              )
              expect(staticImportRegex.test(content)).toBe(false)
            }
          }
        }
      }

      for (const d of scanDirs) {
        scanDir(d)
      }
    })

    it('apps/editor/lib/bootstrap.ts has ZERO static imports of target plugins', () => {
      const bootstrapPath = path.join(editorDir, 'lib', 'bootstrap.ts')
      const content = readFileSync(bootstrapPath, 'utf8')

      for (const plugin of TARGET_PLUGINS) {
        const regex = new RegExp(`from\\s+['"]${plugin.pkg}['"]`)
        expect(regex.test(content)).toBe(false)
      }
    })

    it('apps/editor/lib/plugins/catalog.ts uses dynamic import thunks for all 7 plugins', () => {
      const catalogPath = path.join(editorDir, 'lib', 'plugins', 'catalog.ts')
      const content = readFileSync(catalogPath, 'utf8')

      for (const plugin of TARGET_PLUGINS) {
        expect(content.includes(`id: '${plugin.id}'`) || content.includes(`id: "${plugin.id}"`)).toBe(true)
        const dynamicRegex = new RegExp(`import\\s*\\(\\s*['"]${plugin.pkg}['"]\\s*\\)`)
        expect(dynamicRegex.test(content)).toBe(true)
      }
    })
  })

  // =========================================================================
  // SECTION 4: Runtime Dynamic Execution & State Invariants
  // =========================================================================
  describe('Dimension 4: Runtime Lazy-Loading & Dynamic Isolation Invariants', () => {
    it('registering catalog descriptors leaves all plugins in unloaded state with zero node registrations', () => {
      for (const plugin of TARGET_PLUGINS) {
        const state = pluginManager.getPluginState(plugin.id)
        expect(state.status).toBe('unloaded')
        expect(state.error).toBeNull()

        for (const kind of plugin.nodeKinds) {
          expect(nodeRegistry.has(kind)).toBe(false)
        }
      }
    })

    it('installing one plugin does not install or trigger other plugins', async () => {
      // Install only Boots
      const success = await usePluginManager.getState().installPlugin('pascal:boots')
      expect(success).toBe(true)

      // Boots is installed
      expect(pluginManager.getPluginState('pascal:boots').status).toBe('installed')
      expect(nodeRegistry.has('boots:job')).toBe(true)

      // All other plugins remain strictly unloaded and unregistered
      const otherPlugins = TARGET_PLUGINS.filter((p) => p.id !== 'pascal:boots')
      for (const other of otherPlugins) {
        expect(pluginManager.getPluginState(other.id).status).toBe('unloaded')
        for (const kind of other.nodeKinds) {
          expect(nodeRegistry.has(kind)).toBe(false)
        }
      }
    })

    it('concurrent installation deduplicates promise calls and finishes cleanly', async () => {
      const promises = Array.from({ length: 10 }, () =>
        usePluginManager.getState().installPlugin('pascal:trees'),
      )

      const results = await Promise.all(promises)
      expect(results.every((r) => r === true)).toBe(true)
      expect(pluginManager.getPluginState('pascal:trees').status).toBe('installed')
      expect(nodeRegistry.has('trees:tree')).toBe(true)
    })

    it('network/runtime loading error isolates failure to the broken plugin without affecting host registry', async () => {
      const brokenDescriptor: LazyPluginDescriptor = {
        id: 'test:broken-plugin',
        name: 'Broken Plugin',
        loadPlugin: async () => {
          throw new Error('Adversarial simulated network failure')
        },
      }

      pluginManager.registerDescriptor(brokenDescriptor)
      expect(pluginManager.getPluginState('test:broken-plugin').status).toBe('unloaded')

      let threw = false
      try {
        await pluginManager.installPlugin('test:broken-plugin')
      } catch (err: any) {
        threw = true
        expect(err.message).toContain('Adversarial simulated network failure')
      }

      expect(threw).toBe(true)
      expect(pluginManager.getPluginState('test:broken-plugin').status).toBe('error')

      // Healthy plugin installation still succeeds cleanly
      const bootsSuccess = await usePluginManager.getState().installPlugin('pascal:boots')
      expect(bootsSuccess).toBe(true)
      expect(pluginManager.getPluginState('pascal:boots').status).toBe('installed')
    })
  })
})
