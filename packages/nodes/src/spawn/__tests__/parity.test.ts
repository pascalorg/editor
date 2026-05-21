import { describe, expect, test } from 'bun:test'
import { SpawnNode as SpawnSchemaFromCore } from '@pascal-app/core'
import { spawnDefinition } from '../definition'
import { SpawnNode } from '../schema'

/**
 * Structural parity for the spawn registry definition.
 *
 * The new renderer is a near-line-by-line port of the legacy
 * `@pascal-app/viewer/components/renderers/spawn/spawn-renderer.tsx` —
 * same mesh count, same primitives, same colors. The "parity" assertion
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
  })

  test('defaults() returns a value that the schema accepts', () => {
    const defaults = spawnDefinition.defaults()
    const parsed = SpawnNode.safeParse({ ...defaults, id: 'spawn_test1234567890ab' })
    expect(parsed.success).toBe(true)
  })

  test('presentation declares a url icon for the palette', () => {
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
