import { describe, expect, test } from 'bun:test'
import { Mesh, MeshBasicMaterial, Raycaster, Vector3 } from 'three'
import {
  buildFrameGeometry,
  buildLanternGlassGeometry,
  clamp01,
  paneSize,
  SkylightNode,
} from '../index'

describe('buildLanternGlassGeometry', () => {
  test('returns non-empty geometry across topScale variants', () => {
    const flatTop = buildLanternGlassGeometry(1, 1, 0.3, 0.5)
    const pointed = buildLanternGlassGeometry(1, 1, 0.3, 0)
    expect(flatTop.getAttribute('position').count).toBeGreaterThan(0)
    expect(pointed.getAttribute('position').count).toBeGreaterThan(0)
  })

  test('lantern height drives top vertex Y', () => {
    const geo = buildLanternGlassGeometry(1, 1, 0.4, 0)
    geo.computeBoundingBox()
    expect(geo.boundingBox!.max.y).toBeCloseTo(0.4)
  })
})

describe('paneSize / clamp01 helpers', () => {
  test('paneSize floors at 0.02', () => {
    expect(paneSize(0.001)).toBe(0.02)
    expect(paneSize(1)).toBe(1)
  })

  test('clamp01 clamps to [0,1]', () => {
    expect(clamp01(-0.5)).toBe(0)
    expect(clamp01(1.5)).toBe(1)
    expect(clamp01(0.4)).toBe(0.4)
  })
})

test('flat-top lantern has glass over the center of its top opening', () => {
  const geometry = buildLanternGlassGeometry(1, 1.2, 0.4, 0.5)
  const material = new MeshBasicMaterial()
  const mesh = new Mesh(geometry, material)
  const hits = new Raycaster(new Vector3(0.05, 1, 0.05), new Vector3(0, -1, 0)).intersectObject(
    mesh,
  )
  expect(hits.length).toBeGreaterThan(0)
  expect(hits[0]!.point.y).toBeCloseTo(0.4)
  geometry.dispose()
  material.dispose()
})

test('frame leaves the glass opening clear and covers the cut edge with flashing', () => {
  const node = SkylightNode.parse({ width: 1, height: 1.2, frameThickness: 0.05 })
  const geometry = buildFrameGeometry(node)!
  const material = new MeshBasicMaterial()
  const mesh = new Mesh(geometry, material)
  const ray = (x: number) =>
    new Raycaster(new Vector3(x, 1, 0), new Vector3(0, -1, 0)).intersectObject(mesh)
  expect(ray(0)).toHaveLength(0)
  expect(ray(0.58).length).toBeGreaterThan(0)
  expect(ray(0.62)).toHaveLength(0)
  geometry.dispose()
  material.dispose()
})
