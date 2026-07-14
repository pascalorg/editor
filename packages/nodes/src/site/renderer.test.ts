import { describe, expect, test } from 'bun:test'
import { Path, Shape } from 'three'
import { createRenderableSiteGroundGeometry } from './renderer'

function squareShape(size = 1): Shape {
  const shape = new Shape()
  shape.moveTo(0, 0)
  shape.lineTo(size, 0)
  shape.lineTo(size, size)
  shape.lineTo(0, size)
  shape.closePath()
  return shape
}

function squarePath(size = 1): Path {
  const path = new Path()
  path.moveTo(0, 0)
  path.lineTo(size, 0)
  path.lineTo(size, size)
  path.lineTo(0, size)
  path.closePath()
  return path
}

describe('site renderer geometry', () => {
  test('skips ground fills with no drawable triangles', () => {
    const shape = squareShape()
    shape.holes.push(squarePath())

    expect(createRenderableSiteGroundGeometry(shape)).toBeNull()
  })

  test('keeps drawable ground fills renderable for lit WebGPU materials', () => {
    const geometry = createRenderableSiteGroundGeometry(squareShape())

    expect(geometry?.index?.count).toBeGreaterThan(0)
    expect(geometry?.getAttribute('position')?.count).toBeGreaterThan(0)
    expect(geometry?.getAttribute('normal')?.count).toBeGreaterThan(0)
    geometry?.dispose()
  })
})
