import { describe, expect, test } from 'bun:test'
import {
  type FloorplanGeometry,
  type GeometryContext,
  SpawnNode as SpawnSchemaFromCore,
} from '@pascal-app/core'
import { spawnDefinition } from '../definition'
import { buildSpawnFloorplan } from '../floorplan'
import { SpawnNode } from '../schema'

/**
 * Structural parity for the spawn registry definition.
 *
 * The new renderer is a near-line-by-line port of the legacy
 * `@pascal-app/viewer/components/renderers/spawn/spawn-renderer.tsx` —
 * same mesh count and primitives. The "parity" assertion
 * for the spike is structural (definition is well-formed, both lazy
 * modules resolve to React components) plus a manual visual eyeball check
 * documented in the plan. Pixel-level Playwright parity lands in Phase 4
 * when more nodes are migrated.
 */
describe('spawn definition', () => {
  test('schema matches the core schema export', () => {
    // Both imports must point to the same Zod schema — the registry
    // definition re-exports from core.
    expect(SpawnNode).toBe(SpawnSchemaFromCore)
  })

  test('definition has the expected shape', () => {
    expect(spawnDefinition.kind).toBe('spawn')
    expect(spawnDefinition.schemaVersion).toBe(1)
    expect(spawnDefinition.category).toBe('site')
    expect(spawnDefinition.schema).toBe(SpawnNode)
    expect(typeof spawnDefinition.floorplanMoveTarget).toBe('function')
  })

  test('defaults() returns a value that the schema accepts', () => {
    const defaults = spawnDefinition.defaults()
    const parsed = SpawnNode.safeParse({ ...defaults, id: 'spawn_test1234567890ab' })
    expect(parsed.success).toBe(true)
  })

  test('presentation declares a url palette icon', () => {
    expect(spawnDefinition.presentation?.label).toBe('Spawn Point')
    expect(spawnDefinition.presentation?.icon.kind).toBe('url')
    expect(spawnDefinition.presentation?.paletteSection).toBe('structure')
  })

  test("movable capability restricts to X/Z (matches today's placement behavior)", () => {
    expect(spawnDefinition.capabilities.movable?.axes).toEqual(['x', 'z'])
    expect(spawnDefinition.capabilities.movable?.gridSnap).toBe(true)
  })

  test('rotatable capability declares yaw-only with diagonal-friendly snap angles', () => {
    expect(spawnDefinition.capabilities.rotatable?.axes).toEqual(['y'])
    const angles = spawnDefinition.capabilities.rotatable?.snapAngles ?? []
    expect(angles.length).toBeGreaterThanOrEqual(3)
    expect(angles).toContain(0)
  })

  test('handles expose rotation and move controls', () => {
    expect(Array.isArray(spawnDefinition.handles)).toBe(true)
    if (!Array.isArray(spawnDefinition.handles)) return
    expect(spawnDefinition.handles.map((handle) => handle.kind)).toEqual([
      'arc-resize',
      'translate',
    ])
  })

  test('floorplan uses footprint marker oriented to the spawn view and selected rotation affordance', () => {
    const spawn = SpawnNode.parse({
      id: 'spawn_test1234567890ab',
      position: [1, 0, 2],
      rotation: Math.PI / 4,
    })
    const geometry = buildSpawnFloorplan(spawn, {
      resolve: () => undefined,
      children: [],
      siblings: [],
      parent: null,
      viewState: {
        selected: true,
        highlighted: false,
        hovered: false,
        moving: false,
        palette: {
          selectedStroke: '#60a5fa',
          selectedFill: '#dbeafe',
          selectedHatch: '#60a5fa',
          wallHoverStroke: '#60a5fa',
          endpointHandleFill: '#fed7aa',
          endpointHandleStroke: '#f97316',
          endpointHandleHoverStroke: '#fb923c',
          endpointHandleActiveFill: '#fdba74',
          endpointHandleActiveStroke: '#ea580c',
          curveHandleFill: '#99f6e4',
          curveHandleStroke: '#14b8a6',
          curveHandleHoverStroke: '#2dd4bf',
          measurementStroke: '#6366f1',
          measurementLabelBackground: '#ffffff',
          measurementLabelText: '#111827',
        },
      },
    } satisfies GeometryContext)

    expect(geometry.kind).toBe('group')
    const marker = geometry.kind === 'group' ? geometry.children[0] : null
    expect(marker?.kind).toBe('group')
    if (marker?.kind === 'group') {
      expect(marker.transform?.rotate).toBe(-spawn.rotation)
    }

    const flat = flattenFloorplan(geometry)
    expect(flat.some((entry) => entry.kind === 'path' && entry.stroke === '#818cf8')).toBe(true)
    expect(flat.some((entry) => entry.kind === 'move-handle')).toBe(true)
    expect(flat.some((entry) => entry.kind === 'rotate-arrow')).toBe(true)
  })

  test('renderer is a parametric lazy module reference', () => {
    expect(spawnDefinition.renderer.kind).toBe('parametric')
    if (spawnDefinition.renderer.kind !== 'parametric') return
    expect(typeof spawnDefinition.renderer.module).toBe('function')
  })

  test('tool is a lazy module reference', () => {
    expect(typeof spawnDefinition.tool).toBe('function')
  })

  test('mcp description is set so AI surfaces describe the kind', () => {
    expect(spawnDefinition.mcp?.description).toBeDefined()
    expect(spawnDefinition.mcp?.description?.length).toBeGreaterThan(0)
  })
})

function flattenFloorplan(geometry: FloorplanGeometry): FloorplanGeometry[] {
  if (geometry.kind !== 'group') return [geometry]
  return geometry.children.flatMap((child) => flattenFloorplan(child))
}
