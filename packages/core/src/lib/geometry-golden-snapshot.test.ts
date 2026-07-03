import { describe, expect, test } from 'bun:test'
import { composeAssemblyPrimitives } from './assembly-compose'
import {
  createGeometryGoldenSnapshot,
  stringifyGeometryGoldenSnapshot,
} from './geometry-golden-snapshot'
import { composePartPrimitives } from './part-compose'

describe('geometry golden snapshots', () => {
  test('captures a stable structural snapshot for the strengthened standing fan', () => {
    const snapshot = createGeometryGoldenSnapshot(
      composePartPrimitives({
        name: 'Standing fan',
        parts: [{ kind: 'protective_grill' }],
      }),
      {
        id: 'standing-fan',
        prompt: 'standing electric fan',
        geometryBrief: { category: 'fan' },
        maxShapes: 12,
      },
    )

    expect(snapshot).toMatchObject({
      id: 'standing-fan',
      family: 'fan',
      shapeCount: 46,
      dimensions: [0.733, 1.5465, 0.56],
      roles: {
        circular_base: 1,
        fan_blade: 3,
        fan_hub: 1,
        motor_housing: 2,
        protective_grill: 34,
        support_bracket: 4,
        vertical_pole: 1,
      },
      visualQuality: {
        family: 'fan',
        score: 1,
        issueCount: 0,
        warningCount: 0,
      },
    })
    expect(snapshot.shapes[0]).toMatchObject({
      kind: 'torus',
      name: 'Standing fan grill front ring 1',
      role: 'protective_grill',
    })
    expect(snapshot.shapes.some((shape) => shape.name?.includes('rear inner support ring'))).toBe(
      true,
    )
    expect(snapshot.shapes.some((shape) => shape.name?.includes('grill center cap'))).toBe(true)
    expect(stringifyGeometryGoldenSnapshot(snapshot)).toContain('"id": "standing-fan"')
  })

  test('captures a stable structural snapshot for an industrial assembly family', () => {
    const snapshot = createGeometryGoldenSnapshot(
      composeAssemblyPrimitives({ family: 'machine_tool', object: 'machining center' }),
      {
        id: 'machining-center',
        prompt: 'cnc machining center',
        geometryBrief: { category: 'industrial_equipment' },
        maxShapes: 12,
      },
    )

    expect(snapshot).toMatchObject({
      id: 'machining-center',
      family: 'industrial_equipment',
      shapeCount: 7,
      dimensions: [2.244, 1.3622, 1.4439],
      roles: {
        control_panel: 1,
        glass_panel: 1,
        linear_rail: 1,
        machine_base: 1,
        machine_bed: 1,
        machine_enclosure: 1,
        spindle_head: 1,
      },
      visualQuality: {
        family: 'industrial_equipment',
        score: 0.96,
        issueCount: 0,
        warningCount: 1,
      },
    })
    expect(snapshot.shapes.map((shape) => shape.role)).toEqual([
      'machine_base',
      'machine_enclosure',
      'machine_bed',
      'linear_rail',
      'spindle_head',
      'glass_panel',
      'control_panel',
    ])
  })

  test('captures stable curved surface kernel snapshots', () => {
    const snapshot = createGeometryGoldenSnapshot(
      composePartPrimitives({
        name: 'Curved shell kit',
        autoComplete: false,
        parts: [
          {
            kind: 'ellipsoid_shell',
            name: 'helmet shell',
            length: 0.34,
            width: 0.24,
            height: 0.18,
            shellThickness: 0.012,
          },
          {
            kind: 'lofted_shell',
            name: 'transition fairing',
            position: [0.55, 0.08, 0],
            length: 0.5,
            width: 0.18,
            height: 0.1,
          },
        ],
      }),
      {
        id: 'curved-surface-kernels',
        prompt: 'ellipsoid helmet shell and lofted transition shell',
        geometryBrief: { category: 'curved_surface_kernel' },
        maxShapes: 12,
      },
    )

    expect(snapshot).toMatchObject({
      id: 'curved-surface-kernels',
      family: 'curved_surface_kernel',
      shapeCount: 8,
      roles: {
        ellipsoid_shell: 1,
        ellipsoid_shell_opening: 1,
        ellipsoid_shell_rim: 1,
        lofted_panel_root: 1,
        lofted_panel_section: 1,
        lofted_panel_segment: 2,
        lofted_panel_tip: 1,
      },
    })
    expect(snapshot.sources).toMatchObject({
      ellipsoid_shell: 3,
      lofted_panel: 5,
    })
  })
})
