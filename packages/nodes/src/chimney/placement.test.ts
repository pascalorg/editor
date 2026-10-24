import { expect, test } from 'bun:test'
import { RoofSegmentNode } from '@pascal-app/core'
import { getRoofOuterSurfaceFrameAtPoint } from '@pascal-app/viewer'
import { buildChimneyGeometry, ChimneyNode, resolveChimneyPlacement } from './index'

test('chimney placement uses selected grid step and protects the cap footprint', () => {
  const segment = RoofSegmentNode.parse({ width: 8, depth: 6 })
  const node = ChimneyNode.parse({ width: 1, depth: 1, capOverhang: 0.2 })
  expect(resolveChimneyPlacement(segment, node, 0.36, 0.64, 0.5).position).toEqual([0.5, 0, 0.5])
  expect(resolveChimneyPlacement(segment, node, 0.36, 0.64).position).toEqual([0.36, 0, 0.64])
  expect(resolveChimneyPlacement(segment, node, 0, 0).valid).toBe(true)
  expect(resolveChimneyPlacement(segment, node, 4.2, 0).valid).toBe(false)
})

test('cricket bottom follows the finished roof at a rotated chimney position', () => {
  const segment = RoofSegmentNode.parse({ width: 8, depth: 6, pitch: 30 })
  const node = ChimneyNode.parse({ position: [1, 0, 1], rotation: 0.4, cricketStyle: 'simple' })
  const geometry = buildChimneyGeometry(node, segment)
  const positions = geometry.cricket!.getAttribute('position')
  const c = Math.cos(node.rotation),
    s = Math.sin(node.rotation)
  for (let i = 0; i < 6; i++) {
    const x = positions.getX(i),
      z = positions.getZ(i)
    const y = getRoofOuterSurfaceFrameAtPoint(segment, 1 + x * c + z * s, 1 - x * s + z * c).point.y
    expect(positions.getY(i)).toBeCloseTo(y, 4)
  }
  for (const part of Object.values(geometry)) part?.dispose()
})
