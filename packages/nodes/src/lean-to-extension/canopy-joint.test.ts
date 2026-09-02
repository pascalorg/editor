import { describe, expect, test } from 'bun:test'
import { type AnyNode, LeanToExtensionNode, LevelNode } from '@pascal-app/core'
import {
  resolveCanopyGutterJointLayout,
  resolveCanopyRoofPlaneJointLayout,
  resolveFreestandingCanopyJoints,
} from './canopy-joint'
import { resolveLeanToFreestandingRunPlacement } from './placement'

function joinedRuns(canopyForm: 'gable' | 'butterfly', end: readonly [number, number] = [4, 4]) {
  const level = LevelNode.parse({ id: `level_${canopyForm}`, level: 0 })
  const first = resolveLeanToFreestandingRunPlacement(level.id, [0, 0], [4, 0], false, canopyForm)!
  const second = resolveLeanToFreestandingRunPlacement(level.id, [4, 0], end, false, canopyForm)!
  const nodes = Object.fromEntries([level, first, second].map((node) => [node.id, node])) as Record<
    string,
    AnyNode
  >
  return { first, second, nodes }
}

function jointCutPoint(
  node: LeanToExtensionNode,
  side: 'left' | 'right',
  localZ: number,
  localXOffset: number,
): [number, number] {
  const endpointX = side === 'left' ? -node.span / 2 : node.span / 2
  const cos = Math.cos(node.rotation[1])
  const sin = Math.sin(node.rotation[1])
  const localX = endpointX + localXOffset
  return [
    node.position[0] + localX * cos + localZ * sin,
    node.position[2] - localX * sin + localZ * cos,
  ]
}

describe('freestanding canopy corner joints', () => {
  test.each([
    'gable',
    'butterfly',
  ] as const)('resolves reciprocal 90-degree %s cuts on the inside canopy halves', (canopyForm) => {
    const { first, second, nodes } = joinedRuns(canopyForm)
    const firstJoint = resolveFreestandingCanopyJoints(first, nodes).right
    const secondJoint = resolveFreestandingCanopyJoints(second, nodes).left

    expect(firstJoint).toMatchObject({ neighborId: second.id, innerCanopySide: 'positive' })
    expect(secondJoint).toMatchObject({ neighborId: first.id, innerCanopySide: 'positive' })
    expect(firstJoint?.trimX).toBeCloseTo(first.projection + first.lowOverhang, 8)
    expect(firstJoint?.trimZ).toBeCloseTo(first.projection + first.lowOverhang, 8)
    expect(firstJoint?.gutterMitre).toBeCloseTo(-Math.PI / 4, 8)
    expect(firstJoint?.sharedPostOwner).not.toBe(secondJoint?.sharedPostOwner)
  })

  test('uses the angle bisector for non-square turns', () => {
    const { first, nodes } = joinedRuns('gable', [6, 2 * Math.sqrt(3)])
    const joint = resolveFreestandingCanopyJoints(first, nodes).right

    expect(joint?.interiorAngle).toBeCloseTo((2 * Math.PI) / 3, 8)
    expect(joint?.trimX).toBeCloseTo(joint!.trimZ / Math.tan(Math.PI / 3), 8)
  })

  test('produces reciprocal bisector cuts across shallow, square, and reflex turns', () => {
    for (const canopyForm of ['mono', 'gable', 'butterfly'] as const) {
      for (const turnDirection of [-1, 1] as const) {
        for (const turnDegrees of [5, 15, 30, 60, 90, 120, 150, 165, 175]) {
          const level = LevelNode.parse({
            id: `level_cut_${canopyForm}_${turnDirection}_${turnDegrees}`,
            level: 0,
          })
          const radians = (turnDirection * turnDegrees * Math.PI) / 180
          const corner: [number, number] = [100, 0]
          const end: [number, number] = [
            corner[0] + 100 * Math.cos(radians),
            corner[1] + 100 * Math.sin(radians),
          ]
          const first = resolveLeanToFreestandingRunPlacement(
            level.id,
            [0, 0],
            corner,
            false,
            canopyForm,
          )!
          const second = resolveLeanToFreestandingRunPlacement(
            level.id,
            corner,
            end,
            false,
            canopyForm,
          )!
          const nodes = Object.fromEntries(
            [level, first, second].map((node) => [node.id, node]),
          ) as Record<string, AnyNode>
          const firstJoint = resolveFreestandingCanopyJoints(first, nodes).right!
          const secondJoint = resolveFreestandingCanopyJoints(second, nodes).left!
          const firstZ =
            firstJoint.innerCanopySide === 'positive' ? firstJoint.trimZ : -firstJoint.trimZ
          const secondZ =
            secondJoint.innerCanopySide === 'positive' ? secondJoint.trimZ : -secondJoint.trimZ
          const firstPoint = jointCutPoint(first, 'right', firstZ, -firstJoint.trimX)
          const secondPoint = jointCutPoint(second, 'left', secondZ, secondJoint.trimX)

          expect(
            Math.hypot(firstPoint[0] - secondPoint[0], firstPoint[1] - secondPoint[1]),
          ).toBeLessThan(1e-8)
          expect(firstJoint.sharedPostOwner).not.toBe(secondJoint.sharedPostOwner)
        }
      }
    }
  })

  test('does not create a cosmetic miter between incompatible roof profiles', () => {
    const { first, second, nodes } = joinedRuns('gable')
    nodes[second.id] = LeanToExtensionNode.parse({ ...second, pitch: second.pitch + 2 })

    expect(resolveFreestandingCanopyJoints(first, nodes)).toEqual({})
  })

  test('does not join different canopy forms', () => {
    const { first, second, nodes } = joinedRuns('gable')
    nodes[second.id] = LeanToExtensionNode.parse({ ...second, canopyForm: 'butterfly' })

    expect(resolveFreestandingCanopyJoints(first, nodes)).toEqual({})
  })

  test.each([
    'gable',
    'butterfly',
  ] as const)('retreats the inner %s plane and extends the outer plane to the hip', (canopyForm) => {
    const { first, nodes } = joinedRuns(canopyForm)
    const run = first.projection + first.lowOverhang
    const inner = resolveCanopyRoofPlaneJointLayout(first, nodes, 'positive')
    const outer = resolveCanopyRoofPlaneJointLayout(first, nodes, 'negative')

    expect(inner.width).toBeCloseTo(first.span + first.leftOverhang + first.rightOverhang)
    expect(outer.width).toBeCloseTo(inner.width + run - first.rightOverhang)
    expect(outer.centerX).toBeCloseTo((run - first.rightOverhang) / 2)
    if (canopyForm === 'gable') {
      expect(inner.trim.frontRightX).toBeCloseTo(run)
      expect(outer.trim.backLeftX).toBeCloseTo(run)
    } else {
      expect(inner.trim.backLeftX).toBeCloseTo(run)
      expect(outer.trim.frontRightX).toBeCloseTo(run)
    }
  })

  test('extends the outside gable eave while retreating the inside eave', () => {
    const { first, nodes } = joinedRuns('gable')
    const run = first.projection + first.lowOverhang
    const inner = resolveCanopyGutterJointLayout(first, nodes, 'positive')
    const outer = resolveCanopyGutterJointLayout(first, nodes, 'negative')

    expect(inner.maxX).toBeCloseTo(first.span / 2 - run)
    expect(outer.maxX).toBeCloseTo(first.span / 2 + run)
    expect(inner.joints.right?.gutterMitre).toBeCloseTo(-Math.PI / 4)
    expect(outer.joints.right?.gutterMitre).toBeCloseTo(Math.PI / 4)
  })

  test('terminates a joined butterfly valley gutter at the structural corner', () => {
    const { first, nodes } = joinedRuns('butterfly')
    const gutter = resolveCanopyGutterJointLayout(first, nodes, 'positive')

    expect(gutter.maxX).toBeCloseTo(first.span / 2)
    expect(gutter.joints.right?.gutterMitre).toBeCloseTo(-Math.PI / 4)
  })
})
