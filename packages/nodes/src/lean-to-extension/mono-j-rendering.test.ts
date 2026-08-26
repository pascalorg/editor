import { describe, expect, test } from 'bun:test'
import { type AnyNode, LevelNode } from '@pascal-app/core'
import { generateRoofSegmentGeometry } from '@pascal-app/viewer'
import { Vector3 } from 'three'
import { createLeanToAssembly } from './assembly'
import { resolveLeanToFreestandingRunPlacement } from './placement'

describe('continuous mono J rendering', () => {
  test('closes internal roof-plane steps without exposing fascia', () => {
    const level = LevelNode.parse({ id: 'level_mono_render_j', level: 0 })
    const points = [
      [-6, 2.5],
      [0, -3.5],
      [4.5, 1.5],
      [2, 4],
    ] as const
    const runs = points
      .slice(0, -1)
      .map(
        (start, index) =>
          resolveLeanToFreestandingRunPlacement(
            level.id,
            start,
            points[index + 1]!,
            false,
            'mono',
          )!,
      )
    const sourceNodes = Object.fromEntries(
      [level, ...runs].map((node) => [node.id, node]),
    ) as Record<string, AnyNode>
    const assemblies = runs.map((run) => createLeanToAssembly(run, undefined, sourceNodes))
    const renderNodes = Object.fromEntries(
      [level, ...runs, ...assemblies.flatMap((assembly) => [assembly.roof, assembly.segment])].map(
        (node) => [node.id, node],
      ),
    ) as Record<string, AnyNode>

    let isolatedWhiteVerticalArea = 0
    let joinedWhiteVerticalArea = 0
    let joinedRoofFinishMaxSamePointVerticalSpan = 0
    for (const { segment } of assemblies) {
      const isolated = verticalAreas(generateRoofSegmentGeometry(segment))
      const joined = verticalAreas(generateRoofSegmentGeometry(segment, renderNodes))
      isolatedWhiteVerticalArea += isolated.white
      joinedWhiteVerticalArea += joined.white
      joinedRoofFinishMaxSamePointVerticalSpan = Math.max(
        joinedRoofFinishMaxSamePointVerticalSpan,
        joined.roofFinishMaxSamePointVerticalSpan,
      )
    }

    expect(joinedWhiteVerticalArea).toBeLessThan(isolatedWhiteVerticalArea - 0.01)
    expect(joinedRoofFinishMaxSamePointVerticalSpan).toBeGreaterThan(0.4)
  })
})

function verticalAreas(geometry: ReturnType<typeof generateRoofSegmentGeometry>) {
  const position = geometry.getAttribute('position')
  const index = geometry.getIndex()!
  const a = new Vector3()
  const b = new Vector3()
  const c = new Vector3()
  const ab = new Vector3()
  const ac = new Vector3()
  const normal = new Vector3()
  let white = 0
  let roofFinish = 0
  let roofFinishMaxSamePointVerticalSpan = 0
  for (const group of geometry.groups) {
    if (group.materialIndex !== 0 && group.materialIndex !== 3) continue
    for (let offset = group.start; offset < group.start + group.count; offset += 3) {
      a.fromBufferAttribute(position, index.getX(offset))
      b.fromBufferAttribute(position, index.getX(offset + 1))
      c.fromBufferAttribute(position, index.getX(offset + 2))
      normal.crossVectors(ab.subVectors(b, a), ac.subVectors(c, a))
      const area = normal.length() / 2
      normal.normalize()
      if (Math.abs(normal.y) > 0.05) continue
      if (group.materialIndex === 0) white += area
      else {
        roofFinish += area
        for (const [first, second] of [
          [a, b],
          [b, c],
          [c, a],
        ] as const) {
          if (Math.hypot(first.x - second.x, first.z - second.z) > 1e-5) continue
          roofFinishMaxSamePointVerticalSpan = Math.max(
            roofFinishMaxSamePointVerticalSpan,
            Math.abs(first.y - second.y),
          )
        }
      }
    }
  }
  geometry.dispose()
  return { roofFinish, roofFinishMaxSamePointVerticalSpan, white }
}
