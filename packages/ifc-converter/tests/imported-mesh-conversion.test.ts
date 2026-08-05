import { describe, expect, test } from 'bun:test'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import type { AnyNode, ImportedMeshNode, WallNode } from '@pascal-app/core'
import { convertIfcToPascal, type PascalSceneGraph } from '../src'

const fixturesDirectory = fileURLToPath(
  new URL('../../../apps/ifc-converter/public/test-ifc-files/', import.meta.url),
)
const wasmPath = fileURLToPath(new URL('../../../node_modules/web-ifc/', import.meta.url))

async function convertFixture(name: string, transform?: (source: string) => string) {
  const source = await readFile(`${fixturesDirectory}${name}`)
  const data = transform
    ? new TextEncoder().encode(transform(new TextDecoder().decode(source)))
    : source
  return convertIfcToPascal(data, undefined, { simplify: false, wasmPath })
}

function metadata(node: AnyNode): Record<string, unknown> {
  return (node.metadata ?? {}) as Record<string, unknown>
}

function importedMeshes(scene: PascalSceneGraph): ImportedMeshNode[] {
  return Object.values(scene.nodes).filter(
    (node): node is ImportedMeshNode => node.type === 'imported-mesh',
  )
}

type PlanBounds = { minX: number; maxX: number; minZ: number; maxZ: number }

function importedMeshPlanBounds(meshes: ImportedMeshNode[]): PlanBounds {
  const bounds: PlanBounds = {
    minX: Number.POSITIVE_INFINITY,
    maxX: Number.NEGATIVE_INFINITY,
    minZ: Number.POSITIVE_INFINITY,
    maxZ: Number.NEGATIVE_INFINITY,
  }
  for (const mesh of meshes) {
    for (const primitive of mesh.primitives) {
      for (let index = 0; index + 2 < primitive.positions.length; index += 3) {
        bounds.minX = Math.min(bounds.minX, primitive.positions[index]!)
        bounds.maxX = Math.max(bounds.maxX, primitive.positions[index]!)
        bounds.minZ = Math.min(bounds.minZ, primitive.positions[index + 2]!)
        bounds.maxZ = Math.max(bounds.maxZ, primitive.positions[index + 2]!)
      }
    }
  }
  return bounds
}

function wallPlanBounds(scene: PascalSceneGraph): PlanBounds {
  const walls = Object.values(scene.nodes).filter((node): node is WallNode => node.type === 'wall')
  return walls.reduce<PlanBounds>(
    (bounds, wall) => {
      const halfThickness = (wall.thickness ?? 0) / 2
      return {
        minX: Math.min(bounds.minX, wall.start[0] - halfThickness, wall.end[0] - halfThickness),
        maxX: Math.max(bounds.maxX, wall.start[0] + halfThickness, wall.end[0] + halfThickness),
        minZ: Math.min(bounds.minZ, wall.start[1] - halfThickness, wall.end[1] - halfThickness),
        maxZ: Math.max(bounds.maxZ, wall.start[1] + halfThickness, wall.end[1] + halfThickness),
      }
    },
    {
      minX: Number.POSITIVE_INFINITY,
      maxX: Number.NEGATIVE_INFINITY,
      minZ: Number.POSITIVE_INFINITY,
      maxZ: Number.NEGATIVE_INFINITY,
    },
  )
}

const openHouse = convertFixture('04-ifc-open-house.ifc')
const duplexWithMissingSpaceName = convertFixture('01-duplex.ifc', (source) =>
  source.replace(/(#157= IFCSPACE\('[^']+',#41,)'A102'/, (_match, prefix: string) => `${prefix}$`),
)

describe('IFC imported mesh conversion', () => {
  test('keeps millimetre mesh geometry aligned with native walls', async () => {
    const scene = await openHouse
    const meshBounds = importedMeshPlanBounds(importedMeshes(scene))
    const nativeBounds = wallPlanBounds(scene)

    expect(meshBounds.maxX - meshBounds.minX).toBeGreaterThan(9)
    expect(meshBounds.maxZ - meshBounds.minZ).toBeGreaterThan(5)
    expect(Math.abs(meshBounds.minX - nativeBounds.minX)).toBeLessThan(1)
    expect(Math.abs(meshBounds.maxX - nativeBounds.maxX)).toBeLessThan(1)
    expect(Math.abs(meshBounds.minZ - nativeBounds.minZ)).toBeLessThan(1)
    expect(Math.abs(meshBounds.maxZ - nativeBounds.maxZ)).toBeLessThan(1)
  }, 30_000)

  test('preserves roof slabs as imported geometry when a mesh is available', async () => {
    const scene = await openHouse
    const roofSlabs = importedMeshes(scene).filter(
      (node) =>
        metadata(node).ifcType === 'IFCSLAB' &&
        String(metadata(node).predefinedType).toUpperCase() === 'ROOF',
    )

    expect(roofSlabs).toHaveLength(2)
  }, 30_000)

  test('rounds serialized positions and normals to the storage precision', async () => {
    const scene = await openHouse
    for (const mesh of importedMeshes(scene)) {
      for (const primitive of mesh.primitives) {
        for (const value of primitive.positions) {
          expect(Math.abs(value * 10_000 - Math.round(value * 10_000))).toBeLessThan(1e-8)
        }
        for (const value of primitive.normals ?? []) {
          expect(Math.abs(value * 1000 - Math.round(value * 1000))).toBeLessThan(1e-8)
        }
      }
    }
  }, 30_000)

  test('claims stair flights and continues after a space with no Name', async () => {
    const scene = await duplexWithMissingSpaceName
    const nodes = Object.values(scene.nodes)

    expect(nodes.filter((node) => node.type === 'zone')).toHaveLength(21)
    expect(
      nodes.filter(
        (node) => node.type === 'imported-mesh' && metadata(node).ifcType === 'IFCSTAIRFLIGHT',
      ),
    ).toHaveLength(0)
  }, 30_000)
})
