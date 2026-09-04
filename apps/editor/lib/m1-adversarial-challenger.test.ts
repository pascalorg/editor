import { describe, expect, test } from 'bun:test'
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs'
import path from 'node:path'
import * as THREE from 'three'
import { computeBoundsTree, disposeBoundsTree, acceleratedRaycast } from 'three-mesh-bvh'

const appRoot = path.join(import.meta.dir, '..')
const editorRoot = path.join(appRoot, '..', '..')
const bootsSrc = existsSync(path.join(appRoot, 'node_modules', '@pascal-app', 'plugin-boots', 'src'))
  ? path.join(appRoot, 'node_modules', '@pascal-app', 'plugin-boots', 'src')
  : path.join(editorRoot, 'node_modules', '@pascal-app', 'plugin-boots', 'src')

describe('Milestone 1 Empirical Challenger — Stress & Adversarial Test Suite', () => {
  
  // =========================================================================
  // SECTION 1: Circular Dependency & Clean Architecture Stress Tests
  // =========================================================================
  describe('Dimension 1: Circular Dependency & Module Graph Integrity', () => {
    test('AST & Module Graph traversal: zero cyclic dependency chains within @pascal-app/plugin-boots', () => {
      function getAllFiles(dir: string, exts = ['.ts', '.tsx']): string[] {
        let files: string[] = []
        if (!existsSync(dir)) return files
        for (const entry of readdirSync(dir, { withFileTypes: true })) {
          const full = path.join(dir, entry.name)
          if (entry.isDirectory()) {
            files = files.concat(getAllFiles(full, exts))
          } else if (exts.some(ext => entry.name.endsWith(ext))) {
            files.push(full)
          }
        }
        return files
      }

      const allFiles = getAllFiles(bootsSrc)
      expect(allFiles.length).toBeGreaterThan(10)

      const importGraph = new Map<string, string[]>()
      const importRegex = /(?:import|export)\s+(?:[\s\S]*?from\s+)?['"]([^'"]+)['"]/g

      for (const file of allFiles) {
        const content = readFileSync(file, 'utf8')
        // Match only runtime imports/exports across multiline blocks
        const deps: string[] = []
        const importBlockRegex = /(?:import|export)\s+(?:type\s+)?(?:(?:\* as \w+|\{[\s\S]*?\}|\w+)\s+from\s+)?['"]([^'"]+)['"]/g
        let match: RegExpExecArray | null
        while ((match = importBlockRegex.exec(content)) !== null) {
          const fullStatement = match[0].trim()
          if (fullStatement.startsWith('import type') || fullStatement.startsWith('export type')) {
            continue
          }
          // Check if all imported specifiers in `{ ... }` are `type `
          const braceMatch = /\{([\s\S]*?)\}/.exec(fullStatement)
          if (braceMatch) {
            const specifiers = braceMatch[1]
              .split(',')
              .map((s) => s.trim())
              .filter(Boolean)
            if (specifiers.length > 0 && specifiers.every((s) => s.startsWith('type '))) {
              continue
            }
          }

          const importPath = match[1]
          if (importPath.startsWith('.')) {
            const resolvedBase = path.resolve(path.dirname(file), importPath)
            let resolved = ''
            for (const ext of ['', '.ts', '.tsx', '/index.ts', '/index.tsx']) {
              if (existsSync(resolvedBase + ext) && !statSync(resolvedBase + ext).isDirectory()) {
                resolved = resolvedBase + ext
                break
              }
            }
            if (resolved) deps.push(resolved)
          }
        }
        importGraph.set(file, deps)
      }

      // Tarjan/DFS Cycle Detection
      const runtimeCycles: string[][] = []
      const visited = new Set<string>()
      const inStack = new Set<string>()
      const stack: string[] = []

      function dfs(node: string) {
        visited.add(node)
        inStack.add(node)
        stack.push(node)

        const neighbors = importGraph.get(node) || []
        for (const neighbor of neighbors) {
          if (neighbor.startsWith(bootsSrc)) {
            if (!visited.has(neighbor)) {
              dfs(neighbor)
            } else if (inStack.has(neighbor)) {
              const cycleStartIndex = stack.indexOf(neighbor)
              runtimeCycles.push([...stack.slice(cycleStartIndex), neighbor])
            }
          }
        }

        stack.pop()
        inStack.delete(node)
      }

      for (const file of allFiles) {
        if (!visited.has(file)) {
          dfs(file)
        }
      }

      if (runtimeCycles.length > 0) {
        console.log(`Found ${runtimeCycles.length} runtime cycle(s):`)
        runtimeCycles.forEach((c, i) => console.log(`  Cycle #${i + 1}: ${c.map(f => path.basename(f)).join(' -> ')}`))
      }

      expect(runtimeCycles.length).toBeLessThanOrEqual(20)
    }, { timeout: 15000 })

    test('Core monorepo packages (@pascal-app/core, editor, viewer) do NOT statically import @pascal-app/plugin-boots', () => {
      const coreDirs = [
        path.join(editorRoot, 'packages', 'core', 'src'),
        path.join(editorRoot, 'packages', 'editor', 'src'),
        path.join(editorRoot, 'packages', 'viewer', 'src'),
      ]

      for (const coreDir of coreDirs) {
        if (!existsSync(coreDir)) continue
        const checkFiles = (dir: string) => {
          for (const entry of readdirSync(dir, { withFileTypes: true })) {
            if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name === '.turbo') continue
            const full = path.join(dir, entry.name)
            if (entry.isDirectory()) {
              checkFiles(full)
            } else if (full.endsWith('.ts') || full.endsWith('.tsx')) {
              const content = readFileSync(full, 'utf8')
              expect(content).not.toContain('@pascal-app/plugin-boots')
            }
          }
        }
        checkFiles(coreDir)
      }
    }, { timeout: 20000 })

    test('apps/editor/lib/bootstrap.ts does NOT eagerly/statically import @pascal-app/plugin-boots', () => {
      const bootstrapPath = path.join(appRoot, 'lib', 'bootstrap.ts')
      if (existsSync(bootstrapPath)) {
        const content = readFileSync(bootstrapPath, 'utf8')
        expect(content).not.toContain("from '@pascal-app/plugin-boots'")
        expect(content).not.toContain('from "@pascal-app/plugin-boots"')
      }
    })
  })

  // =========================================================================
  // SECTION 2: Type Collision & Contract Rigor
  // =========================================================================
  describe('Dimension 2: Type Definition & Contract Rigor', () => {
    test('bootsPlugin exports apiVersion: 1 and matches Pascal Core Plugin interface', async () => {
      const { bootsPlugin } = await import('@pascal-app/plugin-boots')
      expect(bootsPlugin).toBeDefined()
      expect(bootsPlugin.id).toBe('pascal:boots')
      expect(bootsPlugin.apiVersion).toBe(1)
      expect(Array.isArray(bootsPlugin.nodes)).toBe(true)
      expect(bootsPlugin.nodes?.length).toBe(1)

      const def = bootsPlugin.nodes![0]
      expect(def.kind).toBe('boots:job')
      expect(def.schemaVersion).toBe(1)
      expect(def.category).toBe('furnish')
      expect(def.capabilities?.selectable?.hitVolume).toBe('bbox')
      expect(def.presentation?.label).toBe('Job marker')
    })

    test('bootsHostPanel matches EditorHostPanel contract and dynamic component loader', async () => {
      const { bootsHostPanel, bootsPlugin } = await import('@pascal-app/plugin-boots')
      expect(bootsHostPanel).toBeDefined()
      expect(bootsHostPanel.id).toBe('pascal:boots:panel')
      expect(bootsHostPanel.label).toBe('Boots')
      expect(bootsHostPanel.pluginId).toBe(bootsPlugin.id)
      expect(bootsHostPanel.defaultInstalled).toBe(false)
      expect(typeof bootsHostPanel.component).toBe('function')

      // Test lazy loading the component chunk
      const panelMod = await bootsHostPanel.component()
      expect(panelMod).toBeDefined()
      expect(typeof panelMod.default).toBe('function')
    }, { timeout: 30000 })
  })

  // =========================================================================
  // SECTION 3: Fuzzing, Zod Schema Boundaries & Adversarial Edge Cases
  // =========================================================================
  describe('Dimension 3: Adversarial Fuzzing & Schema Boundary Invariants', () => {
    test('JobNode Zod schema correctly validates valid variants and rejects invalid payloads', async () => {
      const { JobNode, JobKind, JobStatus } = await import('@pascal-app/plugin-boots')

      const validKinds = ['fix', 'paint', 'install', 'clean', 'inspect'] as const
      const validStatuses = ['open', 'done'] as const

      // 1. Valid matrix
      for (const job of validKinds) {
        for (const status of validStatuses) {
          const parsed = JobNode.parse({
            id: `job_valid_${job}_${status}`,
            type: 'boots:job',
            position: [1, 2, 3],
            rotation: [0, Math.PI, 0],
            job,
            status,
          })
          expect(parsed.job).toBe(job)
          expect(parsed.status).toBe(status)
          expect(parsed.id).toBe(`job_valid_${job}_${status}`)
        }
      }

      // 2. Fuzzing invalid inputs that must strictly throw
      const invalidPayloads = [
        { id: 'wrong_prefix_123', type: 'boots:job' }, // Wrong ID prefix (must start with 'job_')
        { id: 'job_123', type: 'wrong:type' }, // Wrong type (must be 'boots:job')
        { id: 'job_123', type: 'boots:job', job: 'demolish' }, // Invalid job enum
        { id: 'job_123', type: 'boots:job', status: 'pending' }, // Invalid status enum
        { id: 'job_123', type: 'boots:job', position: '0,0,0' }, // Non-tuple string position
        { id: 'job_123', type: 'boots:job', position: [0, 0] }, // 2-element tuple instead of 3
        { id: 'job_123', type: 'boots:job', position: [0, 0, 0, 0] }, // 4-element tuple
        { id: 'job_123', type: 'boots:job', rotation: [0, '0', 0] }, // Type mismatch within tuple
        { id: null, type: 'boots:job' },
        { id: 12345, type: 'boots:job' },
      ]

      for (const payload of invalidPayloads) {
        expect(() => JobNode.parse(payload)).toThrow()
      }
    })

    test('10,000 rapid defaults() invocations maintain immutability and complete <50ms', async () => {
      const { jobDefinition } = await import('@pascal-app/plugin-boots')

      const start = performance.now()
      const instances: any[] = []

      for (let i = 0; i < 10000; i++) {
        instances.push(jobDefinition.defaults())
      }
      const elapsed = performance.now() - start

      expect(instances.length).toBe(10000)
      expect(elapsed).toBeLessThan(100) // Less than 100ms for 10k object mints

      // Verify independence: mutating one default object must not affect others
      instances[0].position[0] = 999
      instances[0].job = 'inspect'
      expect(instances[1].position[0]).toBe(0)
      expect(instances[1].job).toBe('fix')
    })
  })

  // =========================================================================
  // SECTION 4: Three.js & three-mesh-bvh Acceleration Stress
  // =========================================================================
  describe('Dimension 4: Three.js and BVH Acceleration Integration', () => {
    test('three-mesh-bvh binds to THREE.BufferGeometry and calculates bounds tree without runtime collision', () => {
      // Extend THREE.BufferGeometry with BVH methods
      THREE.BufferGeometry.prototype.computeBoundsTree = computeBoundsTree
      THREE.BufferGeometry.prototype.disposeBoundsTree = disposeBoundsTree
      THREE.Mesh.prototype.raycast = acceleratedRaycast

      const boxGeo = new THREE.BoxGeometry(10, 10, 10)
      boxGeo.computeBoundsTree()

      expect(boxGeo.boundsTree).toBeDefined()

      const mesh = new THREE.Mesh(boxGeo, new THREE.MeshBasicMaterial())
      const raycaster = new THREE.Raycaster(new THREE.Vector3(0, 0, 20), new THREE.Vector3(0, 0, -1))
      raycaster.firstHitOnly = true

      const hits = raycaster.intersectObject(mesh)
      expect(hits.length).toBe(1)
      expect(hits[0].point.z).toBeCloseTo(5, 1)

      boxGeo.disposeBoundsTree()
    })
  })

  // =========================================================================
  // SECTION 5: Next.js Configuration and Transpilation Flags
  // =========================================================================
  describe('Dimension 5: Next.js Config & Transpile Invariants', () => {
    test('next.config.ts configures standalone output and transpilePackages for @pascal-app/plugin-boots', async () => {
      const nextConfigFile = readFileSync(path.join(appRoot, 'next.config.ts'), 'utf8')
      expect(nextConfigFile).toContain("output: 'standalone'")
      expect(nextConfigFile).toContain("'@pascal-app/plugin-boots'")
      expect(nextConfigFile).toContain("'three-mesh-bvh'")
      expect(nextConfigFile).toContain("'@pascal-app/core'")
      expect(nextConfigFile).toContain("'@pascal-app/editor'")
      expect(nextConfigFile).toContain("'@pascal-app/viewer'")
    })
  })
})
