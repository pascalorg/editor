import { describe, expect, test } from 'bun:test'
import { XMLParser } from 'fast-xml-parser'
import { strFromU8, unzipSync } from 'fflate'
import * as THREE from 'three'
import { exportSceneToPrint3mf } from './print-3mf'

function asArray<T>(value: T | T[]): T[] {
  return Array.isArray(value) ? value : [value]
}

describe('print 3MF export', () => {
  test('writes a deterministic standards package with explicit millimeter units', () => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(10, 4, 6))
    mesh.position.set(5, 2, -7)

    const first = exportSceneToPrint3mf(mesh, { scale: 100 })
    const second = exportSceneToPrint3mf(mesh, { scale: 100 })
    const files = unzipSync(first.buffer)
    const xml = strFromU8(files['3D/3dmodel.model']!)
    const model = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '' }).parse(
      xml,
    ).model
    const object = asArray<Record<string, unknown>>(model.resources.object)[0]!
    const item = asArray<Record<string, string>>(model.build.item)[0]!
    const metadata = asArray<Record<string, string>>(model.metadata)
    const partManifest = JSON.parse(
      metadata.find((entry) => entry.name === 'Pascal.PartManifest')!['#text']!,
    )
    const objectMesh = object.mesh as {
      vertices: { vertex: Record<string, string> | Record<string, string>[] }
      triangles: { triangle: Record<string, string> | Record<string, string>[] }
    }
    const vertices = asArray(objectMesh.vertices.vertex)
    const triangles = asArray(objectMesh.triangles.triangle)
    const bounds = new THREE.Box3()
    for (const vertex of vertices) {
      bounds.expandByPoint(new THREE.Vector3(Number(vertex.x), Number(vertex.y), Number(vertex.z)))
    }

    expect(Object.keys(files)).toEqual(['[Content_Types].xml', '_rels/.rels', '3D/3dmodel.model'])
    expect(strFromU8(files['_rels/.rels']!)).toContain('Target="/3D/3dmodel.model"')
    expect(model.unit).toBe('millimeter')
    expect(object.name).toBe('Pascal print model')
    expect(vertices).toHaveLength(8)
    expect(triangles).toHaveLength(12)
    expect(item.objectid).toBe('1')
    expect(item.transform).toBeUndefined()
    expect(partManifest).toEqual([
      {
        name: 'Pascal print model',
        vertexStart: 0,
        vertexCount: 8,
        triangleStart: 0,
        triangleCount: 12,
      },
    ])
    expect(bounds.min.toArray()).toEqual([0, 0, 0])
    expect(bounds.max.toArray()).toEqual([100, 60, 40])
    expect(first.report.format).toBe('3mf')
    expect(first.report.bounds?.width).toBeCloseTo(100, 6)
    expect(first.report.bounds?.depth).toBeCloseTo(60, 6)
    expect(first.report.bounds?.height).toBeCloseTo(40, 6)
    expect(first.buffer).toEqual(second.buffer)

    for (const triangle of triangles) {
      expect(Number(triangle.v1)).toBeLessThan(vertices.length)
      expect(Number(triangle.v2)).toBeLessThan(vertices.length)
      expect(Number(triangle.v3)).toBeLessThan(vertices.length)
    }
  })

  test('returns a blocking report instead of serializing non-finite coordinates', () => {
    const geometry = new THREE.BoxGeometry(1, 1, 1)
    geometry.getAttribute('position').setX(0, Number.NaN)

    const output = exportSceneToPrint3mf(new THREE.Mesh(geometry), { scale: 100 })
    const model = strFromU8(unzipSync(output.buffer)['3D/3dmodel.model']!)

    expect(output.report.status).toBe('blocked')
    expect(output.report.invalidTriangleCount).toBeGreaterThan(0)
    expect(output.report.diagnostics).toContainEqual(
      expect.objectContaining({ code: 'non_finite_geometry', severity: 'error' }),
    )
    expect(model).not.toContain('<object ')
  })
})
