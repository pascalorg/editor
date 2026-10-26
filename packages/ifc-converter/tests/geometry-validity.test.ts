import { describe, expect, test } from 'bun:test'
import { readFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { ImportedMeshNode } from '@pascal-app/core'
import { conversionReportHasIssues, convertIfcToPascalWithReport } from '../src'
import { emptyConversionReport, isFiniteMatrix, keepValidTriangles } from '../src/geometry-validity'

const fixture = fileURLToPath(
  new URL(
    '../../../apps/ifc-converter/public/test-ifc-files/04-ifc-open-house.ifc',
    import.meta.url,
  ),
)
const wasmPath = `${dirname(fileURLToPath(import.meta.resolve('web-ifc')))}/`

async function convertOpenHouse(edit: (source: string) => string) {
  const source = edit(new TextDecoder().decode(await readFile(fixture)))
  return convertIfcToPascalWithReport(new TextEncoder().encode(source), undefined, {
    simplify: false,
    wasmPath,
  })
}

describe('a file with one unreadable number', () => {
  // 1.E400 overflows to Infinity: one plate's placement, and its flat-mesh matrix, stop being
  // finite. This used to fail the whole file with "Could not build imported mesh node at
  // primitives.0.positions.0".
  test('converts, leaves that geometry out and reports it', async () => {
    const clean = await convertOpenHouse((source) => source)
    const { scene, report } = await convertOpenHouse((source) =>
      source.replace(
        '#2584=IFCCARTESIANPOINT((930.,45.,90.));',
        '#2584=IFCCARTESIANPOINT((1.E400,45.,90.));',
      ),
    )

    expect(conversionReportHasIssues(clean.report)).toBe(false)
    expect(report.skippedGeometry.transforms).toBeGreaterThan(0)
    expect(conversionReportHasIssues(report)).toBe(true)

    const meshes = Object.values(scene.nodes).filter(
      (node): node is ImportedMeshNode => node.type === 'imported-mesh',
    )
    expect(meshes.length).toBeGreaterThan(0)
    for (const mesh of meshes)
      for (const primitive of mesh.primitives)
        expect(primitive.positions.every(Number.isFinite)).toBe(true)
    expect(meshes.some((mesh) => mesh.metadata?.expressID === 2587)).toBe(false)
  }, 60_000)
})

describe('keepValidTriangles', () => {
  const normals = (count: number) =>
    Array.from({ length: count * 3 }, (_, i) => (i % 3 === 1 ? 1 : 0))

  test('drops non-finite vertices and their triangles, and compacts the rest', () => {
    const report = emptyConversionReport()
    const mesh = keepValidTriangles(
      {
        // vertex 2 is NaN; triangle (0,1,3) stays, (1,2,3) goes
        positions: [0, 0, 0, 1, 0, 0, Number.NaN, 0, 0, 0, 0, 1],
        normals: normals(4),
        indices: [0, 1, 3, 1, 2, 3],
      },
      report.skippedGeometry,
    )
    expect(mesh).toEqual({
      positions: [0, 0, 0, 1, 0, 0, 0, 0, 1],
      normals: normals(3),
      indices: [0, 1, 2],
    })
    expect(report.skippedGeometry).toEqual({
      transforms: 0,
      vertices: 1,
      triangles: 1,
      primitives: 0,
    })
  })

  test('drops a triangle with an index past the vertices or a non-finite normal', () => {
    const report = emptyConversionReport()
    const mesh = keepValidTriangles(
      {
        positions: [0, 0, 0, 1, 0, 0, 0, 0, 1],
        normals: [0, 1, 0, 0, 1, 0, 0, Number.POSITIVE_INFINITY, 0],
        indices: [0, 1, 7, 0, 1, 2],
      },
      report.skippedGeometry,
    )
    expect(mesh).toBeNull()
    expect(report.skippedGeometry).toEqual({
      transforms: 0,
      vertices: 1,
      triangles: 2,
      primitives: 1,
    })
  })

  test('an empty source is not a skipped primitive', () => {
    const report = emptyConversionReport()
    expect(
      keepValidTriangles({ positions: [], normals: [], indices: [] }, report.skippedGeometry),
    ).toBeNull()
    expect(report.skippedGeometry.primitives).toBe(0)
  })
})

describe('isFiniteMatrix', () => {
  const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]
  test('accepts a finite 4x4 and rejects NaN, Infinity or a short array', () => {
    expect(isFiniteMatrix(identity)).toBe(true)
    expect(isFiniteMatrix(identity.with(12, Number.NaN))).toBe(false)
    expect(isFiniteMatrix(identity.with(5, Number.NEGATIVE_INFINITY))).toBe(false)
    expect(isFiniteMatrix(identity.slice(0, 12))).toBe(false)
  })
})
