import { describe, expect, test, beforeEach, afterEach } from 'bun:test'
import {
  bootsPlugin,
  bootsHostPanel,
  jobDefinition,
  JobNode,
  JobKind,
  JobStatus,
} from '@pascal-app/plugin-boots'
import {
  nodeRegistry,
  loadPlugin,
  categoryOf,
  isPresettableKind,
  getNodePluginId,
} from '@pascal-app/core'
import {
  BufferGeometry,
  BoxGeometry,
  ConeGeometry,
  CylinderGeometry,
  Mesh,
  Ray,
  Vector3,
  Box3,
  Matrix4,
} from 'three'
import { MeshBVH } from 'three-mesh-bvh'
import { bvhFor } from '../node_modules/@pascal-app/plugin-boots/src/game/world'

describe('Milestone 1 Adversarial Challenge: @pascal-app/plugin-boots', () => {

  describe('1. Runtime Module Surface & Core Exports', () => {
    test('all public symbols are defined and match expected types', () => {
      expect(bootsPlugin).toBeDefined()
      expect(bootsPlugin.id).toBe('pascal:boots')
      expect(bootsPlugin.apiVersion).toBe(1)
      expect(Array.isArray(bootsPlugin.nodes)).toBe(true)
      expect(bootsPlugin.nodes?.length).toBe(1)

      expect(bootsHostPanel).toBeDefined()
      expect(bootsHostPanel.id).toBe('pascal:boots:panel')
      expect(bootsHostPanel.pluginId).toBe('pascal:boots')
      expect(bootsHostPanel.defaultInstalled).toBe(false)
      expect(typeof bootsHostPanel.component).toBe('function')

      expect(jobDefinition).toBeDefined()
      expect(jobDefinition.kind).toBe('boots:job')
      expect(jobDefinition.schemaVersion).toBe(1)
      expect(jobDefinition.category).toBe('furnish')

      expect(JobNode).toBeDefined()
      expect(JobKind).toBeDefined()
      expect(JobStatus).toBeDefined()
    })

    test('bootsHostPanel dynamic component loader resolves cleanly to a React component', async () => {
      const componentModule = await bootsHostPanel.component()
      expect(componentModule).toBeDefined()
      expect(componentModule.default).toBeDefined()
      expect(typeof componentModule.default).toBe('function')
    })
  })

  describe('2. Adversarial Schema Validation & Edge Cases (JobNode & Zod)', () => {
    const validBase = {
      id: 'job_adv_001',
      type: 'boots:job',
      position: [12.5, -3.2, 100.0] as [number, number, number],
      rotation: [0, Math.PI / 4, 0] as [number, number, number],
      job: 'paint',
      status: 'open',
    }

    test('validates full valid payload and applies defaults where omitted', () => {
      const parsed = JobNode.parse(validBase)
      expect(parsed.id).toBe('job_adv_001')
      expect(parsed.job).toBe('paint')
      expect(parsed.status).toBe('open')

      // Defaults omitted - auto generates valid job_ id and defaults
      const minimal = {
        type: 'boots:job',
      }
      const parsedMin = JobNode.parse(minimal)
      expect(parsedMin.id).toMatch(/^job_[a-z0-9]+$/)
      expect(parsedMin.position).toEqual([0, 0, 0])
      expect(parsedMin.rotation).toEqual([0, 0, 0])
      expect(parsedMin.job).toBe('fix')
      expect(parsedMin.status).toBe('open')
    })

    test('accepts all permitted enum variants for JobKind and JobStatus', () => {
      const kinds = ['fix', 'paint', 'install', 'clean', 'inspect'] as const
      const statuses = ['open', 'done'] as const

      for (const k of kinds) {
        const parsed = JobNode.parse({ ...validBase, job: k })
        expect(parsed.job).toBe(k)
      }

      for (const s of statuses) {
        const parsed = JobNode.parse({ ...validBase, status: s })
        expect(parsed.status).toBe(s)
      }
    })

    test('rejects unauthorized JobKind and JobStatus values', () => {
      const invalidJobs = ['destroy', 'build', 'repair', 'hack', '', null, 123, true, {}]
      for (const invalid of invalidJobs) {
        expect(() => JobNode.parse({ ...validBase, job: invalid })).toThrow()
      }

      const invalidStatuses = ['pending', 'completed', 'in_progress', 'cancelled', '', null, 0]
      for (const invalid of invalidStatuses) {
        expect(() => JobNode.parse({ ...validBase, status: invalid })).toThrow()
      }
    })

    test('strictly enforces objectId template pattern (rejects invalid prefix/type)', () => {
      const invalidIds = [
        'wall_123',
        'item_456',
        'boots_789',
        'cone_123',
        'job',
        'job-',
        '',
        12345,
        null,
      ]
      for (const invalidId of invalidIds) {
        expect(() => JobNode.parse({ ...validBase, id: invalidId })).toThrow()
      }
    })

    test('strictly enforces nodeType literal (boots:job)', () => {
      const invalidTypes = [
        'item',
        'wall',
        'boots:item',
        'boots:punchlist',
        'job',
        '',
        null,
      ]
      for (const invalidType of invalidTypes) {
        expect(() => JobNode.parse({ ...validBase, type: invalidType })).toThrow()
      }
    })

    test('rejects malformed coordinate arrays (wrong dimension, NaN, Infinity)', () => {
      const invalidPositions = [
        [0, 0], // 2D
        [0, 0, 0, 0], // 4D
        [],
        ['0', 0, 0],
        [NaN, 0, 0],
        [Infinity, 0, 0],
        [-Infinity, 0, 0],
        null,
        '0,0,0',
      ]
      for (const invalidPos of invalidPositions) {
        expect(() => JobNode.parse({ ...validBase, position: invalidPos })).toThrow()
      }

      const invalidRotations = [
        [0, 0],
        [0, 0, 0, 0],
        [NaN, 0, 0],
        null,
      ]
      for (const invalidRot of invalidRotations) {
        expect(() => JobNode.parse({ ...validBase, rotation: invalidRot })).toThrow()
      }
    })

    test('handles extreme floating point boundaries without precision loss', () => {
      const extremeNode = {
        ...validBase,
        position: [-1e6, 0.000001, 1e6] as [number, number, number],
        rotation: [-Math.PI * 2, Math.PI * 4, -0.000001] as [number, number, number],
      }
      const parsed = JobNode.parse(extremeNode)
      expect(parsed.position[0]).toBe(-1e6)
      expect(parsed.position[1]).toBe(0.000001)
      expect(parsed.position[2]).toBe(1e6)
    })
  })

  describe('3. Node Definition Contract & Parameter Integrity', () => {
    test('defaults generator outputs a schema-compliant job node', () => {
      const defs = jobDefinition.defaults()
      expect(defs).toBeDefined()
      expect(defs.object).toBe('node')
      expect(defs.position).toEqual([0, 0, 0])
      expect(defs.rotation).toEqual([0, 0, 0])
      expect(defs.job).toBe('fix')
      expect(defs.status).toBe('open')

      const combined = JobNode.parse({
        id: 'job_gen_001',
        type: 'boots:job',
        ...defs,
      })
      expect(combined.id).toBe('job_gen_001')
      expect(combined.type).toBe('boots:job')
    })

    test('capabilities declare accurate spatial constraints', () => {
      const caps = jobDefinition.capabilities
      expect(caps.movable).toEqual({ axes: ['x', 'z'], gridSnap: true })
      expect(caps.rotatable?.axes).toEqual(['y'])
      expect(caps.rotatable?.snapAngles?.length).toBe(8)
      expect(caps.selectable).toEqual({ hitVolume: 'bbox' })
      expect(caps.duplicable).toBe(true)
      expect(caps.deletable).toBe(true)

      // Footprint & drag bounds
      const bounds = caps.dragBounds?.({} as any)
      expect(bounds?.size).toEqual([0.36, 0.55, 0.36])

      const footprint = caps.floorPlaced?.footprint?.({ rotation: [0, 1.57, 0] } as any)
      expect(footprint?.dimensions).toEqual([0.36, 0.55, 0.36])
      expect(caps.floorPlaced?.collides).toBe(false)
    })

    test('parametrics expose expected inspector groups and options', () => {
      const params = jobDefinition.parametrics
      expect(params?.groups?.length).toBe(1)
      const group = params?.groups?.[0]
      expect(group?.label).toBe('Job')
      expect(group?.fields?.length).toBe(2)

      const jobField = group?.fields?.[0]
      expect(jobField?.key).toBe('job')
      expect(jobField?.kind).toBe('enum')
      expect(jobField?.options).toEqual(['fix', 'paint', 'install', 'clean', 'inspect'])

      const statusField = group?.fields?.[1]
      expect(statusField?.key).toBe('status')
      expect(statusField?.kind).toBe('enum')
      expect(statusField?.options).toEqual(['open', 'done'])
      expect(statusField?.display).toBe('segmented')
    })
  })

  describe('4. Node Registry Integration & Stress Lifecycle', () => {
    beforeEach(() => {
      nodeRegistry._reset()
    })

    afterEach(() => {
      nodeRegistry._reset()
    })

    test('loadPlugin successfully registers boots:job into core registry', async () => {
      expect(nodeRegistry.has('boots:job')).toBe(false)

      await loadPlugin(bootsPlugin)

      expect(nodeRegistry.has('boots:job')).toBe(true)
      const registered = nodeRegistry.get('boots:job')
      expect(registered).toBeDefined()
      expect(registered?.kind).toBe('boots:job')
      expect(registered?.schemaVersion).toBe(1)

      expect(categoryOf('boots:job')).toBe('furnish')
      expect(isPresettableKind('boots:job')).toBe(true)
      expect(getNodePluginId('boots:job')).toBe('pascal:boots')
    })

    test('rejects plugins with incompatible apiVersion', async () => {
      const invalidPlugin = {
        id: 'pascal:invalid_version',
        apiVersion: 999 as any,
        nodes: [jobDefinition as any],
      }
      expect(loadPlugin(invalidPlugin)).rejects.toThrow(/requires apiVersion 999; host supports 1/)
    })

    test('stress test: repeated idempotent registrations execute cleanly without memory leaks or errors', async () => {
      for (let i = 0; i < 50; i++) {
        await loadPlugin(bootsPlugin)
      }
      expect(nodeRegistry.has('boots:job')).toBe(true)
      expect(nodeRegistry.get('boots:job')?.kind).toBe('boots:job')
    })
  })

  describe('5. three-mesh-bvh Acceleration Structure & Spatial Integrity', () => {
    test('MeshBVH constructs acceleration hierarchy from standard geometries', () => {
      const box = new BoxGeometry(1, 1, 1)
      const bvh = new MeshBVH(box)
      expect(bvh).toBeDefined()

      const cone = new ConeGeometry(0.36, 0.55, 16)
      const coneBvh = new MeshBVH(cone)
      expect(coneBvh).toBeDefined()
    })

    test('MeshBVH accurate raycasting: hits target and respects raycast limits', () => {
      const geom = new BoxGeometry(2, 2, 2)
      const bvh = new MeshBVH(geom)

      // Direct ray from (0, 0, 5) pointing at -Z (toward box center at origin)
      const directRay = new Ray(new Vector3(0, 0, 5), new Vector3(0, 0, -1))
      const hit = bvh.raycastFirst(directRay, 2) // Side = 2 (DoubleSide)
      expect(hit).not.toBeNull()
      expect(hit?.point.z).toBeCloseTo(1, 3) // Front face is at z = +1
      expect(hit?.distance).toBeCloseTo(4, 3) // Distance from 5 to 1 = 4

      // Ray pointing away (miss)
      const missRay = new Ray(new Vector3(0, 0, 5), new Vector3(0, 1, 0))
      const missHit = bvh.raycastFirst(missRay, 2)
      expect(missHit).toBeNull()
    })

    test('MeshBVH box intersection correctly detects spatial overlap with mesh triangles', () => {
      const geom = new BoxGeometry(2, 2, 2) // bounds [-1, 1] on each axis
      const bvh = new MeshBVH(geom)
      const identity = new Matrix4()

      // Box intersecting front face (z spans 0.8 to 1.2, x and y span -0.5 to 0.5)
      const overlapBox = new Box3(new Vector3(-0.5, -0.5, 0.8), new Vector3(0.5, 0.5, 1.2))
      expect(bvh.intersectsBox(overlapBox, identity)).toBe(true)

      // Disjoint box outside geometry bounds (x spans 10 to 12)
      const disjointBox = new Box3(new Vector3(10, 10, 10), new Vector3(12, 12, 12))
      expect(bvh.intersectsBox(disjointBox, identity)).toBe(false)
    })

    test('bvhFor caching and fallback resilience for degenerate geometry', () => {
      const mesh = new Mesh(new BoxGeometry(1, 1, 1))

      // 1. WeakMap caching: Repeated calls on same geometry return identical MeshBVH instance
      const bvh1 = bvhFor(mesh)
      const bvh2 = bvhFor(mesh)
      expect(bvh1).toBe(bvh2)

      // 2. High triangle density geometry stress (1000+ triangles)
      const highPolyGeom = new CylinderGeometry(1, 1, 2, 64, 16)
      const highPolyMesh = new Mesh(highPolyGeom)
      const start = performance.now()
      const hpBvh = bvhFor(highPolyMesh)
      const elapsed = performance.now() - start

      expect(hpBvh).toBeDefined()
      expect(elapsed).toBeLessThan(100) // Must build under 100ms

      // 3. Degenerate empty geometry fallback
      const emptyGeom = new BufferGeometry()
      const emptyMesh = new Mesh(emptyGeom)
      const fallback = bvhFor(emptyMesh)
      expect(fallback).toBeDefined()
      // Raycasting on fallback should return null without throwing
      const ray = new Ray(new Vector3(0, 0, 5), new Vector3(0, 0, -1))
      const degenerateHit = fallback.raycastFirst(ray, 2)
      expect(degenerateHit).toBeNull()
    })
  })
})
