import { describe, expect, test } from 'bun:test'
import { Euler, Group, Quaternion, Vector3 } from 'three'
import { bakeArticraftAnimation, markArticraftJointTarget } from './animation'
import { ArticraftAssetNode } from './schema'

describe('Articraft GLB animation export', () => {
  test('bakes movable joints into one looping clip and restores the saved pose', () => {
    const root = new Group()
    const hingeTarget = new Group()
    const sliderTarget = new Group()
    const fixedTarget = new Group()
    hingeTarget.position.set(1, 2, 3)
    hingeTarget.quaternion.setFromEuler(new Euler(0, 0.2, 0))
    sliderTarget.position.set(-1, 0.5, 2)
    sliderTarget.quaternion.setFromEuler(new Euler(0, Math.PI / 2, 0))
    markArticraftJointTarget(hingeTarget, 'lid hinge')
    markArticraftJointTarget(sliderTarget, 'drawer_slide')
    markArticraftJointTarget(fixedTarget, 'fixed_mount')
    root.add(hingeTarget, sliderTarget, fixedTarget)

    const node = ArticraftAssetNode.parse({
      id: 'articraft_export_test',
      catalogId: 'export-test',
      title: 'Export test',
      source: 'generated',
      artifact: { format: 'usdz', url: 'https://assets.example/model.usdz' },
      joints: [
        {
          name: 'lid hinge',
          type: 'revolute',
          parent: 'base',
          child: 'lid',
          axis: [0, 0, 1],
          origin: { xyz: [0, 0, 0], rpy: [0, 0, 0] },
          limits: { lower: -0.5, upper: 1.5 },
        },
        {
          name: 'drawer_slide',
          type: 'prismatic',
          parent: 'base',
          child: 'drawer',
          axis: [1, 0, 0],
          origin: { xyz: [0, 0, 0], rpy: [0, 0, 0] },
          limits: { lower: 0, upper: 0.6 },
        },
        {
          name: 'fixed_mount',
          type: 'fixed',
          parent: 'base',
          child: 'mount',
          axis: [0, 0, 1],
          origin: { xyz: [0, 0, 0], rpy: [0, 0, 0] },
          limits: null,
        },
      ],
      jointValues: { 'lid hinge': 0.25, drawer_slide: 0.3 },
      attribution: {
        creator: 'Articraft authors',
        license: 'CC-BY-4.0',
        sourceUrl: 'https://example.com/source',
      },
    })

    const clip = bakeArticraftAnimation(node, root)

    expect(clip?.name).toBe('articraft_export_test: loop')
    expect(clip?.userData).toEqual({ loop: true })
    expect(clip?.tracks).toHaveLength(2)
    expect(clip?.tracks.map((track) => track.ValueTypeName).sort()).toEqual([
      'quaternion',
      'vector',
    ])
    expect(hingeTarget.name).toBe('articraft_export_test__articraft_joint_0_lid_hinge')
    expect(sliderTarget.name).toBe('articraft_export_test__articraft_joint_1_drawer_slide')

    for (const track of clip?.tracks ?? []) {
      expect(track.times.length).toBe(33)
      const stride = track.ValueTypeName === 'quaternion' ? 4 : 3
      expect(Array.from(track.values.slice(0, stride))).toEqual(
        Array.from(track.values.slice(-stride)),
      )
    }

    const expectedHinge = new Quaternion()
      .setFromEuler(new Euler(0, 0.2, 0))
      .multiply(new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), 0.25))
    expect(hingeTarget.quaternion.angleTo(expectedHinge)).toBeLessThan(1e-8)
    expect(sliderTarget.position.distanceTo(new Vector3(-1, 0.5, 1.7))).toBeLessThan(1e-8)
    expect(fixedTarget.position.toArray()).toEqual([0, 0, 0])
  })

  test('does not emit an animation without a resolved movable joint target', () => {
    const node = ArticraftAssetNode.parse({
      id: 'articraft_static_test',
      catalogId: 'static-test',
      title: 'Static test',
      source: 'generated',
      artifact: { format: 'usdz', url: 'https://assets.example/model.usdz' },
      joints: [],
      attribution: {
        creator: 'Articraft authors',
        license: 'CC-BY-4.0',
        sourceUrl: 'https://example.com/source',
      },
    })

    expect(bakeArticraftAnimation(node, new Group())).toBeNull()
  })
})
