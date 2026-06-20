import { describe, expect, test } from 'bun:test'
import {
  assessPartBlueprint,
  assessPartVisualDetails,
  composePartPrimitives,
  resolveLayout,
} from './part-compose'

function expectBladeRotationMatchesRadialPlacement(shape: {
  position?: number[]
  rotation?: number[]
}) {
  const [x = 0, , z = 0] = shape.position ?? []
  const radialLength = Math.hypot(x, z)
  expect(radialLength).toBeGreaterThan(0.001)
  const expectedAngle = Math.atan2(z, x)
  const actualY = shape.rotation?.[1] ?? 0
  const actualZ = shape.rotation?.[2] ?? 0
  const wrappedDelta = Math.atan2(
    Math.sin(actualZ + expectedAngle),
    Math.cos(actualZ + expectedAngle),
  )
  expect(actualY).toBeCloseTo(0, 4)
  expect(wrappedDelta).toBeCloseTo(0, 4)
}

function expectLocalPlaneBladeRotationMatchesRadialPlacement(
  shape: {
    position?: number[]
    rotation?: number[]
  },
  center: [number, number] = [0, 0],
) {
  const [x = 0, y = 0] = shape.position ?? []
  const expectedAngle = Math.atan2(y - center[1], x - center[0])
  const actualY = shape.rotation?.[1] ?? 0
  const actualZ = shape.rotation?.[2] ?? 0
  const wrappedDelta = Math.atan2(
    Math.sin(actualZ - expectedAngle),
    Math.cos(actualZ - expectedAngle),
  )
  expect(actualY).toBeCloseTo(0, 4)
  expect(wrappedDelta).toBeCloseTo(0, 4)
}

describe('resolveLayout', () => {
  test('resolves explicit part relationship plans before primitive composition', () => {
    const [body, flange] = resolveLayout({
      parts: [
        { id: 'body', kind: 'valve_body', position: [0, 0.38, 0], axis: 'x', length: 0.7 },
        {
          id: 'flange',
          kind: 'flange_ring',
          connectTo: 'body',
          connectPoint: 'outlet',
          childPoint: 'back',
          axis: 'x',
          radius: 0.12,
        },
      ],
    })

    expect(body?.position).toEqual([0, 0.38, 0])
    expect(flange?.position?.[0]).toBeGreaterThan(0.35)
    expect(flange?.position?.[1]).toBeCloseTo(0.38, 5)
  })

  test('builds shared rotating machine layout plans for pumps and compressors', () => {
    const pump = resolveLayout(
      { family: 'pump', layoutFamily: 'rotating_machine_layout' },
      [
        { kind: 'skid_base', semanticRole: 'support_base' },
        { kind: 'ribbed_motor_body', semanticRole: 'drive_motor' },
        { kind: 'volute_casing', semanticRole: 'volute_casing' },
      ],
      { length: 2.2, width: 0.9, height: 1.1 },
    )
    const compressor = resolveLayout(
      { family: 'compressor', layoutFamily: 'rotating_machine_layout' },
      [
        { kind: 'skid_base', semanticRole: 'support_base' },
        { kind: 'ribbed_motor_body', semanticRole: 'drive_motor' },
        { kind: 'rounded_machine_body', semanticRole: 'compressor_casing' },
      ],
      { length: 2.2, width: 0.9, height: 1.1 },
    )

    expect(pump.layoutFamily).toBe('rotating_machine_layout')
    expect(compressor.layoutFamily).toBe('rotating_machine_layout')
    expect(pump.anchors.map((anchor) => anchor.id)).toContain('drive')
    expect(
      compressor.placements.find((part) => part.semanticRole === 'drive_motor')?.anchorId,
    ).toBe('drive')
  })

  test('builds shared vessel layout plans for tanks and reactors', () => {
    const tank = resolveLayout(
      { family: 'tank', layoutFamily: 'vessel_layout' },
      [
        { kind: 'cylindrical_tank', semanticRole: 'vessel_shell' },
        { kind: 'skid_base', semanticRole: 'support_base' },
      ],
      { height: 3, diameter: 1.2 },
    )
    const reactor = resolveLayout(
      { family: 'reactor', layoutFamily: 'vessel_layout' },
      [
        { kind: 'agitator_tank', semanticRole: 'vessel_shell' },
        { kind: 'platform_ladder', semanticRole: 'access_platform' },
      ],
      { height: 2.4, diameter: 1.1 },
    )

    expect(tank.layoutFamily).toBe('vessel_layout')
    expect(reactor.layoutFamily).toBe('vessel_layout')
    expect(tank.placements.find((part) => part.semanticRole === 'vessel_shell')?.anchorId).toBe(
      'shell',
    )
    expect(
      reactor.placements.find((part) => part.semanticRole === 'access_platform')?.anchorId,
    ).toBe('access')
  })

  test('builds shared enclosure layout plans for packaging, CNC, and electrical equipment', () => {
    const packaging = resolveLayout(
      { family: 'machine_tool', layoutFamily: 'box_enclosure_layout' },
      [
        { kind: 'generic_body', semanticRole: 'machine_enclosure' },
        { kind: 'control_box', semanticRole: 'control_panel' },
      ],
      { length: 2.6, width: 1, height: 1.6 },
    )
    const cnc = resolveLayout(
      { family: 'machine_tool', layoutFamily: 'box_enclosure_layout' },
      [
        { kind: 'generic_body', semanticRole: 'machine_enclosure' },
        { kind: 'generic_panel', semanticRole: 'viewing_window' },
      ],
      { length: 2.8, width: 1.1, height: 1.7 },
    )
    const electrical = resolveLayout(
      { family: 'electrical', layoutFamily: 'box_enclosure_layout' },
      [
        { kind: 'electrical_cabinet', semanticRole: 'electrical_cabinet' },
        { kind: 'vent_slats', semanticRole: 'vent_panel' },
      ],
      { length: 1.2, width: 0.5, height: 1.8 },
    )

    expect(packaging.layoutFamily).toBe('box_enclosure_layout')
    expect(cnc.layoutFamily).toBe('box_enclosure_layout')
    expect(electrical.layoutFamily).toBe('box_enclosure_layout')
    expect(
      packaging.placements.find((part) => part.semanticRole === 'control_panel')?.anchorId,
    ).toBe('controls')
    expect(cnc.placements.find((part) => part.semanticRole === 'viewing_window')?.anchorId).toBe(
      'front_panel',
    )
    expect(electrical.bounds.size[1]).toBeCloseTo(1.8, 5)
  })

  test('places vessel parts with internal anchors and attachToRole', () => {
    const plan = resolveLayout(
      { family: 'reactor', layoutFamily: 'vessel_layout' },
      [
        { kind: 'agitator_tank', semanticRole: 'reactor_vessel_shell', height: 2.4, radius: 0.55 },
        {
          kind: 'flanged_nozzle',
          semanticRole: 'feed_nozzle',
          attachToRole: 'reactor_vessel_shell',
          anchor: 'top',
          offset: [0.18, 0, 0],
        },
        {
          kind: 'platform_ladder',
          semanticRole: 'access_platform',
          attachToRole: 'reactor_vessel_shell',
          anchor: 'service_side',
        },
        {
          kind: 'skid_base',
          semanticRole: 'support_base',
          attachToRole: 'reactor_vessel_shell',
          anchor: 'bottom',
        },
      ],
      { height: 2.6, diameter: 1.2 },
    )

    const shell = plan.placements.find((part) => part.semanticRole === 'reactor_vessel_shell')
    const nozzle = plan.placements.find((part) => part.semanticRole === 'feed_nozzle')
    const platform = plan.placements.find((part) => part.semanticRole === 'access_platform')
    const support = plan.placements.find((part) => part.semanticRole === 'support_base')

    expect(plan.anchors.map((anchor) => anchor.id)).toEqual(
      expect.arrayContaining([
        'top',
        'bottom',
        'front',
        'back',
        'left',
        'right',
        'shell_center',
        'drive_side',
        'service_side',
      ]),
    )
    expect(nozzle?.position[1]).toBeGreaterThan(shell?.position[1] ?? 0)
    expect(nozzle?.position[0]).toBeCloseTo(0.18, 5)
    expect(platform?.position[2]).toBeGreaterThan(shell?.position[2] ?? 0)
    expect(support?.position[1]).toBeLessThan(shell?.position[1] ?? 0)
  })

  test('aligns rotating equipment rings, rollers, and drive units by role', () => {
    const plan = resolveLayout(
      { family: 'tank', layoutFamily: 'rotating_machine_layout' },
      [
        {
          kind: 'cylindrical_tank',
          semanticRole: 'vessel_shell',
          length: 4.8,
          radius: 0.55,
          axis: 'x',
        },
        {
          id: 'riding-ring',
          kind: 'flange_ring',
          semanticRole: 'riding_ring',
          attachToRole: 'vessel_shell',
          anchor: 'shell_center',
          arrayAlong: 'length',
          count: 2,
        },
        {
          id: 'support-roller',
          kind: 'bearing_block',
          semanticRole: 'support_roller',
          attachToRole: 'vessel_shell',
          anchor: 'bottom',
          arrayAlong: 'length',
          count: 2,
        },
        {
          kind: 'motor_gearbox_unit',
          semanticRole: 'kiln_drive_unit',
          attachToRole: 'vessel_shell',
          anchor: 'drive_side',
        },
      ],
      { length: 5, width: 1.4, height: 1.2, diameter: 1.1 },
    )

    const shell = plan.placements.find((part) => part.semanticRole === 'vessel_shell')
    const rings = plan.placements.filter((part) => part.semanticRole === 'riding_ring')
    const rollers = plan.placements.filter((part) => part.semanticRole === 'support_roller')
    const drive = plan.placements.find((part) => part.semanticRole === 'kiln_drive_unit')

    expect(rings).toHaveLength(2)
    expect(rollers).toHaveLength(2)
    expect(rings[0]?.position[0]).toBeLessThan(rings[1]?.position[0] ?? 0)
    expect(rollers[0]?.position[0]).toBeCloseTo(rings[0]?.position[0] ?? 0, 5)
    expect(drive?.position[0]).toBeLessThan(shell?.position[0] ?? 0)
  })
})

describe('industrial detail parts', () => {
  test('composes process-vessel details without falling back to generic pipe ports', () => {
    const shapes = composePartPrimitives({
      name: 'test process vessel',
      family: 'generic',
      length: 1.2,
      width: 1.2,
      height: 1.8,
      parts: [
        {
          kind: 'manway_lid',
          semanticRole: 'offset_manway_lid',
          position: [0.25, 1.72, 0],
          axis: 'y',
        },
        {
          kind: 'sanitary_nozzle',
          semanticRole: 'top_feed_nozzle',
          position: [-0.25, 1.76, 0],
          axis: 'y',
        },
        {
          kind: 'jacket_shell',
          semanticRole: 'thermal_jacket',
          radius: 0.58,
          height: 1.15,
          position: [0, 0.78, 0],
        },
        { kind: 'sight_glass', semanticRole: 'front_sight_glass', side: 'front' },
        { kind: 'sample_valve', semanticRole: 'sample_valve', side: 'right' },
        {
          kind: 'instrument_port',
          semanticRole: 'temperature_probe',
          position: [0, 1.95, 0.16],
          axis: 'y',
        },
        {
          kind: 'stainless_highlight_panel',
          semanticRole: 'polished_shell_highlight',
          side: 'front',
        },
      ],
    })

    const roles = new Set(shapes.map((shape) => shape.semanticRole))
    const sourceKinds = new Set(shapes.map((shape) => shape.sourcePartKind))

    expect([...sourceKinds]).toEqual(
      expect.arrayContaining([
        'manway_lid',
        'sanitary_nozzle',
        'jacket_shell',
        'sight_glass',
        'sample_valve',
        'instrument_port',
        'stainless_highlight_panel',
      ]),
    )
    expect([...roles]).toEqual(
      expect.arrayContaining([
        'offset_manway_lid',
        'top_feed_nozzle',
        'thermal_jacket',
        'front_sight_glass',
        'sample_valve',
        'temperature_probe',
        'polished_shell_highlight',
      ]),
    )
    expect(shapes.some((shape) => shape.semanticRole === 'inlet_port')).toBe(false)
  })

  test('composes reusable industrial utility details for profile packs', () => {
    const shapes = composePartPrimitives({
      name: 'industrial detail kit',
      family: 'generic',
      length: 1.4,
      width: 1.1,
      height: 1.6,
      parts: [
        {
          kind: 'flanged_nozzle',
          semanticRole: 'side_flanged_nozzle',
          side: 'front',
          radius: 0.08,
          length: 0.25,
        },
        {
          kind: 'inspection_hatch',
          semanticRole: 'front_inspection_hatch',
          side: 'front',
          radius: 0.16,
        },
        {
          kind: 'conical_hopper',
          semanticRole: 'bottom_conical_hopper',
          radiusTop: 0.42,
          radiusBottom: 0.08,
          height: 0.75,
          position: [0, 0.35, 0],
        },
        {
          kind: 'platform_with_ladder',
          semanticRole: 'service_platform',
          length: 1.1,
          width: 0.55,
          height: 0.9,
          rungCount: 5,
          position: [0.95, 0.9, 0],
        },
      ],
    })

    const roles = new Set(shapes.map((shape) => shape.semanticRole))
    const sourceKinds = new Set(shapes.map((shape) => shape.sourcePartKind))

    expect([...sourceKinds]).toEqual(
      expect.arrayContaining([
        'flanged_nozzle',
        'inspection_hatch',
        'conical_hopper',
        'platform_with_ladder',
      ]),
    )
    expect([...roles]).toEqual(
      expect.arrayContaining([
        'side_flanged_nozzle',
        'nozzle_flange',
        'front_inspection_hatch',
        'hatch_handle',
        'bottom_conical_hopper',
        'hopper_outlet_collar',
        'support_leg',
        'service_platform',
        'ladder_rung',
      ]),
    )
    expect(shapes.filter((shape) => shape.semanticRole === 'ladder_rung')).toHaveLength(5)
    expect(shapes.some((shape) => shape.sourcePartKind === 'pipe_port')).toBe(false)
  })
})

function cylinderEndpoints(shape: {
  position?: number[]
  rotation?: number[]
  height?: number
}): [[number, number, number], [number, number, number]] {
  const [x = 0, y = 0, z = 0] = shape.position ?? []
  const yaw = shape.rotation?.[2] ?? 0
  const half = (shape.height ?? 0) / 2
  const dx = Math.cos(yaw) * half
  const dy = Math.sin(yaw) * half
  return [
    [x - dx, y - dy, z],
    [x + dx, y + dy, z],
  ]
}

function cylinderEndpointByAxis(
  shape: {
    position?: number[]
    rotation?: number[]
    height?: number
  },
  axisIndex: 0 | 1 | 2,
  side: 'min' | 'max',
): [number, number, number] {
  const endpoints = cylinderEndpoints(shape)
  return (
    endpoints.sort((a, b) =>
      side === 'max' ? b[axisIndex] - a[axisIndex] : a[axisIndex] - b[axisIndex],
    )[0] ?? [0, 0, 0]
  )
}

describe('composePartPrimitives', () => {
  test('composes a standing fan from reusable mechanical parts', () => {
    const shapes = composePartPrimitives({
      name: 'Standing fan',
      detail: 'medium',
      parts: [
        { kind: 'circular_base', radius: 0.28, height: 0.08, position: [0, 0.04, 0] },
        { kind: 'vertical_pole', radius: 0.025, height: 1.05, position: [0, 0.6, 0] },
        { kind: 'support_bracket', position: [0, 1.08, 0], width: 0.24, height: 0.16 },
        { kind: 'motor_housing', position: [0, 1.18, -0.06], radius: 0.1, depth: 0.16 },
        { kind: 'radial_blades', position: [0, 1.18, 0.03], count: 3, bladeRadius: 0.28 },
        {
          kind: 'protective_grill',
          position: [0, 1.18, 0.03],
          radius: 0.36,
          ringCount: 4,
          spokeCount: 18,
        },
      ],
    })

    expect(shapes.some((shape) => shape.name?.includes('circular base'))).toBe(true)
    expect(shapes.some((shape) => shape.name?.includes('vertical pole'))).toBe(true)
    const blades = shapes.filter((shape) => Boolean(shape.name?.match(/ blade \d+$/)))
    expect(blades).toHaveLength(3)
    expect(blades.every((shape) => shape.kind === 'extrude')).toBe(true)
    expect(blades.every((shape) => (shape.profile?.length ?? 0) >= 8)).toBe(true)
    blades.forEach((shape) => {
      expectLocalPlaneBladeRotationMatchesRadialPlacement(shape, [0, 1.18])
    })
    expect(shapes.filter((shape) => shape.name?.includes('blade root'))).toHaveLength(3)
    const frontRings = shapes.filter((shape) => shape.name?.includes('grill front ring'))
    expect(frontRings).toHaveLength(4)
    expect(
      new Set(frontRings.map((shape) => shape.position?.[2]?.toFixed(4))).size,
    ).toBeGreaterThan(1)
    expect(shapes.filter((shape) => shape.name?.includes('grill spoke'))).toHaveLength(18)
    expect(shapes.some((shape) => shape.name?.includes('grill side rib'))).toBe(true)
    expect(shapes.some((shape) => shape.name?.includes('rear outer ring'))).toBe(true)
    expect(shapes.some((shape) => shape.name?.includes('rear inner support ring'))).toBe(true)
    expect(shapes.some((shape) => shape.name?.includes('grill center cap'))).toBe(true)
  })

  test('supports common aliases for part kinds', () => {
    const shapes = composePartPrimitives({
      parts: [
        { kind: 'grille', radius: 0.2, spokeCount: 6, ringCount: 2 },
        { kind: 'fan-blades', count: 4, radius: 0.15 },
      ],
    })

    expect(shapes.filter((shape) => shape.name?.includes('grill spoke'))).toHaveLength(6)
    const blades = shapes.filter((shape) => Boolean(shape.name?.match(/ blade \d+$/)))
    expect(blades).toHaveLength(4)
    expect(blades.every((shape) => shape.kind === 'extrude')).toBe(true)
  })

  test('composes independent editable fan blade arrays', () => {
    const shapes = composePartPrimitives({
      name: 'Industrial pedestal fan',
      detail: 'medium',
      parts: [
        {
          id: 'fan_blades',
          kind: 'fan_blade',
          count: 6,
          length: 0.32,
          width: 0.09,
          thickness: 0.018,
          primaryColor: '#ef4444',
        },
      ],
    })

    const blades = shapes.filter((shape) => shape.semanticRole === 'fan_blade')
    expect(blades).toHaveLength(6)
    expect(blades.every((shape) => shape.sourcePartKind === 'fan_blade')).toBe(true)
    expect(new Set(blades.map((shape) => shape.sourcePartId)).size).toBe(6)
    expect(blades.every((shape) => shape.editableHints?.primaryDimension === 'length')).toBe(true)
    expect(blades.every((shape) => shape.material?.properties?.color === '#ef4444')).toBe(true)
  })

  test('composes cylindrical tank parts as hollow vessels with heads, seams, and supports', () => {
    const shapes = composePartPrimitives({
      name: 'Horizontal process vessel',
      parts: [{ kind: 'cylindrical_tank', length: 1.8, radius: 0.32, axis: 'x' }],
    })

    expect(shapes.find((shape) => shape.semanticRole === 'vessel_shell')?.kind).toBe(
      'hollow-cylinder',
    )
    expect(shapes.filter((shape) => shape.semanticRole === 'vessel_head')).toHaveLength(2)
    expect(shapes.filter((shape) => shape.semanticRole === 'vessel_seam')).toHaveLength(2)
    expect(shapes.some((shape) => shape.semanticRole === 'top_nozzle')).toBe(true)
    expect(shapes.filter((shape) => shape.semanticRole === 'saddle_support')).toHaveLength(2)
  })

  test('composes agitator tank parts with vessel shell, heads, mixer, nozzles, and legs', () => {
    const shapes = composePartPrimitives({
      name: 'Stirred reactor',
      parts: [{ kind: 'agitator_tank', height: 1.1, radius: 0.34 }],
    })
    const roles = new Set(shapes.map((shape) => shape.semanticRole).filter(Boolean))

    expect(shapes.find((shape) => shape.semanticRole === 'reactor_vessel_shell')?.kind).toBe(
      'hollow-cylinder',
    )
    expect(shapes.filter((shape) => shape.semanticRole === 'vessel_head')).toHaveLength(2)
    expect(roles.has('agitator_motor')).toBe(true)
    expect(roles.has('feed_nozzle')).toBe(true)
    expect(roles.has('manway_flange')).toBe(true)
    expect(shapes.filter((shape) => shape.semanticRole === 'support_leg')).toHaveLength(4)
  })

  test('composes vehicle wheel sets with tire, rim, spokes, hubs, and axles', () => {
    const shapes = composePartPrimitives({
      name: 'Factory AGV vehicle',
      detail: 'high',
      parts: [{ kind: 'wheel_set', semanticRole: 'vehicle_tire', count: 4 }],
    })

    expect(shapes.filter((shape) => shape.semanticRole === 'vehicle_tire')).toHaveLength(4)
    expect(shapes.filter((shape) => shape.semanticRole === 'wheel_rim')).toHaveLength(4)
    expect(shapes.filter((shape) => shape.semanticRole === 'wheel_hub')).toHaveLength(4)
    expect(shapes.filter((shape) => shape.semanticRole === 'wheel_axle')).toHaveLength(2)
    expect(shapes.filter((shape) => shape.semanticRole === 'wheel_spoke')).toHaveLength(20)
  })

  test('composes mobile platform industrial details for AGV profiles', () => {
    const shapes = composePartPrimitives({
      name: 'Factory AGV',
      length: 1.45,
      width: 0.9,
      height: 0.48,
      parts: [
        { kind: 'mobile_platform_chassis', semanticRole: 'vehicle_body' },
        {
          kind: 'lidar_sensor',
          semanticRole: 'front_navigation_sensor',
          axis: 'x',
          position: [0.75, 0.21, 0],
        },
        {
          kind: 'status_light_strip',
          semanticRole: 'left_status_light_strip',
          side: 'left',
        },
        {
          kind: 'emergency_stop_button',
          semanticRole: 'emergency_stop_button',
          position: [0.42, 0.37, 0.22],
        },
      ],
    })
    const roles = new Set(shapes.map((shape) => shape.semanticRole))

    expect(roles.has('vehicle_body')).toBe(true)
    expect(roles.has('lower_bumper_skirt')).toBe(true)
    expect(roles.has('cargo_platform')).toBe(true)
    expect(roles.has('front_navigation_sensor')).toBe(true)
    expect(roles.has('sensor_lens')).toBe(true)
    expect(roles.has('left_status_light_strip')).toBe(true)
    expect(roles.has('emergency_stop_button')).toBe(true)
    expect(roles.has('emergency_stop_guard')).toBe(true)
    expect(shapes.every((shape) => shape.sourcePartKind !== 'generic_body')).toBe(true)
  })

  test('composes reusable industrial workcell accessory parts', () => {
    const shapes = composePartPrimitives({
      name: 'Robot workcell',
      length: 2,
      width: 1.2,
      height: 1.4,
      parts: [
        { kind: 'operator_panel', semanticRole: 'control_panel' },
        { kind: 'guard_fence', semanticRole: 'safety_barrier', count: 5 },
        { kind: 'pallet_table', semanticRole: 'pallet_table' },
        { kind: 'bearing_block', semanticRole: 'bearing_block' },
        { kind: 'coupling_guard', semanticRole: 'coupling_guard' },
        { kind: 'motor_gearbox_unit', semanticRole: 'drive_unit' },
        { kind: 'pipe_manifold', semanticRole: 'pipe_manifold', count: 3 },
        { kind: 'hopper_body', semanticRole: 'hopper_body' },
        { kind: 'service_platform', semanticRole: 'service_platform' },
      ],
    })
    const roles = new Set(shapes.map((shape) => shape.semanticRole))

    expect(roles.has('control_panel')).toBe(true)
    expect(roles.has('display_screen')).toBe(true)
    expect(roles.has('control_button')).toBe(true)
    expect(roles.has('safety_barrier')).toBe(true)
    expect(roles.has('guard_fence_post')).toBe(true)
    expect(roles.has('pallet_table')).toBe(true)
    expect(roles.has('support_leg')).toBe(true)
    expect(roles.has('bearing_block')).toBe(true)
    expect(roles.has('bearing_ring')).toBe(true)
    expect(roles.has('coupling_guard')).toBe(true)
    expect(roles.has('drive_motor')).toBe(true)
    expect(roles.has('drive_unit')).toBe(true)
    expect(roles.has('output_shaft')).toBe(true)
    expect(roles.has('pipe_manifold')).toBe(true)
    expect(roles.has('manifold_branch')).toBe(true)
    expect(roles.has('hopper_body')).toBe(true)
    expect(roles.has('hopper_outlet')).toBe(true)
    expect(roles.has('service_platform')).toBe(true)
    expect(roles.has('access_ladder')).toBe(true)
  })

  test('composes access platform ladder parts with guard rails and ladder side rails', () => {
    const shapes = composePartPrimitives({
      name: 'Inspection platform',
      parts: [{ kind: 'platform_ladder', height: 1.4, length: 1, width: 0.6, count: 6 }],
    })

    expect(shapes.some((shape) => shape.semanticRole === 'access_platform')).toBe(true)
    expect(shapes.filter((shape) => shape.semanticRole === 'platform_post')).toHaveLength(4)
    expect(shapes.filter((shape) => shape.semanticRole === 'guard_rail').length).toBeGreaterThan(3)
    expect(shapes.filter((shape) => shape.semanticRole === 'ladder_side_rail')).toHaveLength(2)
    expect(shapes.filter((shape) => shape.semanticRole === 'ladder_rung')).toHaveLength(6)
  })

  test('composes preheater tower frame and cyclone separator units', () => {
    const shapes = composePartPrimitives({
      name: 'Cement preheater',
      parts: [
        {
          kind: 'structural_tower_frame',
          semanticRole: 'preheater_tower_body',
          length: 2.4,
          width: 1.5,
          height: 6,
          levelCount: 5,
          stairFlights: 5,
        },
        {
          kind: 'cyclone_separator_unit',
          semanticRole: 'preheater_cyclone',
          height: 1.2,
          radius: 0.24,
          position: [-0.5, 5.1, 0],
        },
      ],
    })
    const roles = new Set(shapes.map((shape) => shape.semanticRole))

    expect(roles.has('preheater_tower_body')).toBe(true)
    expect(roles.has('multi_level_platform')).toBe(true)
    expect(roles.has('tower_column')).toBe(true)
    expect(roles.has('tower_beam')).toBe(true)
    expect(roles.has('tower_diagonal_brace')).toBe(true)
    expect(roles.has('external_stair_flight')).toBe(true)
    expect(roles.has('external_stair_landing')).toBe(true)
    expect(roles.has('preheater_cyclone')).toBe(true)
    expect(roles.has('cyclone_cone')).toBe(true)
    expect(roles.has('preheater_gas_duct')).toBe(true)
    expect(roles.has('meal_drop_pipe')).toBe(true)
  })

  test('composes pyramid parts as four-sided cones', () => {
    const shapes = composePartPrimitives({
      name: 'Pyramid marker',
      primaryColor: '#d97706',
      parts: [
        {
          kind: 'pyramid',
          length: 2,
          width: 1.2,
          height: 1.5,
          semanticRole: 'marker_pyramid',
        },
        {
          kind: 'square-pyramid',
          id: 'small_top',
          length: 0.5,
          height: 0.7,
          alignAbove: 0,
        },
      ],
    })

    expect(shapes).toHaveLength(2)
    expect(shapes[0]?.kind).toBe('cone')
    expect(shapes[0]?.name).toContain('pyramid')
    expect(shapes[0]?.semanticRole).toBe('marker_pyramid')
    expect(shapes[0]?.sourcePartKind).toBe('pyramid')
    expect(shapes[0]?.radialSegments).toBe(4)
    expect(shapes[0]?.height).toBe(1.5)
    expect(shapes[0]?.scale).toEqual([1, 1, 0.6])
    expect(shapes[0]?.material?.properties?.color).toBe('#d97706')
    expect(shapes[1]?.semanticRole).toBe('pyramid')
    expect(shapes[1]?.sourcePartKind).toBe('pyramid')
    expect(shapes[1]?.position?.[1]).toBeGreaterThan(shapes[0]?.position?.[1] ?? 0)
  })

  test('composes truncated pyramid parts as four-sided frustums', () => {
    const shapes = composePartPrimitives({
      name: 'Flat top pyramid marker',
      parts: [
        {
          kind: 'pyramid',
          truncated: true,
          length: 2,
          width: 1.2,
          height: 1.5,
        },
        {
          kind: 'pyramid',
          topScale: 0.5,
          length: 1,
          width: 1,
          height: 0.8,
        },
      ],
    })

    expect(shapes).toHaveLength(2)
    expect(shapes[0]?.kind).toBe('frustum')
    expect(shapes[0]?.radialSegments).toBe(4)
    expect(shapes[0]?.radiusBottom).toBe(1)
    expect(shapes[0]?.radiusTop).toBeCloseTo(0.35)
    expect(shapes[0]?.scale).toEqual([1, 1, 0.6])
    expect(shapes[1]?.kind).toBe('frustum')
    expect(shapes[1]?.radiusTop).toBeCloseTo(0.25)
  })

  test('normalizes mixer propeller part blueprints without duplicating or adding fan details', () => {
    const shapes = composePartPrimitives({
      geometryBrief: { category: 'mixer' },
      parts: [
        { kind: 'vertical_pole', id: 'shaft', height: 1.4, radius: 0.025 },
        { kind: 'circular_base', id: 'hub', radius: 0.07, height: 0.1, alignAbove: 'shaft' },
        {
          kind: 'propeller_blade_set',
          id: 'blades',
          count: 3,
          hubRadius: 0.07,
          bladeRadius: 0.38,
          bladeWidth: 0.15,
          bladeShape: 'taiji_half',
          bladePitch: 0.55,
          verticalCurve: 0.07,
          around: 'hub',
          aroundCount: 3,
        },
      ],
      enhanceVisualDetails: true,
    })

    expect(shapes.filter((shape) => shape.semanticRole === 'mixer_shaft')).toHaveLength(1)
    expect(shapes.filter((shape) => shape.semanticRole === 'mixer_hub')).toHaveLength(1)
    expect(shapes.filter((shape) => shape.semanticRole === 'mixer_blade')).toHaveLength(3)
    expect(shapes.some((shape) => shape.sourcePartKind === 'protective_grill')).toBe(false)
    expect(shapes.some((shape) => shape.sourcePartKind === 'motor_housing')).toBe(false)
  })

  test('does not infer a fan from a standalone chimney pole blueprint', () => {
    const shapes = composePartPrimitives({
      name: 'large chimney',
      geometryBrief: { category: 'industrial chimney', requiredRoles: ['chimney_body'] },
      parts: [
        {
          id: 'chimney_shaft',
          kind: 'vertical_pole',
          semanticRole: 'chimney_body',
          dimensions: { height: 10, radius: 0.5 },
        },
      ],
    })

    expect(shapes).toHaveLength(1)
    expect(shapes[0]?.semanticRole).toBe('chimney_body')
    expect(shapes[0]?.height).toBe(10)
    expect(shapes[0]?.radius).toBe(0.5)
    expect(shapes.some((shape) => shape.sourcePartKind === 'protective_grill')).toBe(false)
    expect(shapes.some((shape) => shape.sourcePartKind === 'radial_blades')).toBe(false)
    expect(shapes.some((shape) => shape.sourcePartKind === 'motor_housing')).toBe(false)
  })

  test('composes a tapered red-white industrial chimney stack', () => {
    const shapes = composePartPrimitives({
      name: 'red white factory chimney',
      detail: 'medium',
      parts: [
        {
          kind: 'smokestack',
          height: 10,
          radius: 0.55,
          warningStripes: true,
          stripeCount: 5,
        },
      ],
    })

    const shell = shapes.find((shape) => shape.semanticRole === 'chimney_body')
    const redBands = shapes.filter((shape) => shape.semanticRole === 'chimney_warning_red_band')
    const whiteBands = shapes.filter((shape) => shape.semanticRole === 'chimney_warning_white_band')

    expect(shell?.kind).toBe('frustum')
    expect(shell?.radiusBottom).toBeCloseTo(0.55)
    expect(shell?.radiusTop).toBeLessThan(shell?.radiusBottom ?? 0)
    expect(shapes.some((shape) => shape.semanticRole === 'chimney_base')).toBe(true)
    expect(shapes.some((shape) => shape.semanticRole === 'chimney_top_rim')).toBe(true)
    expect(shapes.some((shape) => shape.semanticRole === 'access_door')).toBe(true)
    expect(
      shapes.filter((shape) => shape.semanticRole === 'chimney_seam_ring').length,
    ).toBeGreaterThan(4)
    expect(redBands).toHaveLength(3)
    expect(whiteBands).toHaveLength(2)
    expect(redBands[0]?.material?.properties?.color).toBe('#b91c1c')
    expect(whiteBands[0]?.material?.properties?.color).toBe('#f8fafc')
  })

  test('composes common factory pump and blower structures', () => {
    const shapes = composePartPrimitives({
      name: 'Factory pump',
      detail: 'medium',
      parts: [
        { kind: 'skid_base', length: 1.2, width: 0.46, height: 0.08 },
        {
          kind: 'rounded_machine_body',
          position: [-0.26, 0.35, 0],
          length: 0.55,
          width: 0.32,
          height: 0.34,
        },
        { kind: 'volute_casing', position: [0.22, 0.42, 0.05], radius: 0.22, depth: 0.16 },
        { kind: 'impeller_blades', position: [0.22, 0.42, 0.16], count: 7, radius: 0.14 },
        { kind: 'inlet_port', position: [0.22, 0.42, 0.29], axis: 'z', radius: 0.07 },
        { kind: 'outlet_port', position: [0.48, 0.5, 0.05], axis: 'x', radius: 0.06 },
        {
          kind: 'flange_ring',
          position: [0.22, 0.42, 0.39],
          axis: 'z',
          radius: 0.11,
          boltCount: 6,
        },
        { kind: 'bolt_pattern', position: [0.22, 0.42, 0.43], axis: 'z', radius: 0.09, count: 6 },
        { kind: 'control_box', position: [-0.26, 0.58, 0.2] },
      ],
    })

    expect(shapes.some((shape) => shape.name?.includes('skid left rail'))).toBe(true)
    expect(shapes.some((shape) => shape.name?.includes('rounded machine body'))).toBe(true)
    expect(shapes.some((shape) => shape.name?.includes('volute scroll casing'))).toBe(true)
    expect(shapes.some((shape) => shape.name?.includes('volute discharge neck'))).toBe(true)
    const impellerVanes = shapes.filter((shape) => shape.name?.includes('impeller vane'))
    expect(impellerVanes).toHaveLength(7)
    impellerVanes.forEach((shape) => {
      expectLocalPlaneBladeRotationMatchesRadialPlacement(shape, [0.22, 0.42])
    })
    expect(shapes.some((shape) => shape.name?.includes('inlet port'))).toBe(true)
    expect(shapes.some((shape) => shape.name?.includes('outlet port'))).toBe(true)
    expect(shapes.some((shape) => shape.name?.includes('flange ring'))).toBe(true)
    expect(shapes.filter((shape) => shape.name?.includes('bolt'))).toHaveLength(12)
    expect(shapes.some((shape) => shape.name?.includes('control box'))).toBe(true)
  })

  test('composes stronger vent grilles and rounded industrial machine bodies', () => {
    const shapes = composePartPrimitives({
      name: 'Industrial body detail',
      autoComplete: false,
      detail: 'high',
      parts: [
        { kind: 'rounded_machine_body', length: 1, width: 0.5, height: 0.45 },
        {
          kind: 'vent_grill',
          position: [0, 0.5, 0.28],
          width: 0.42,
          count: 7,
          depth: 0.04,
        },
      ],
    })

    expect(shapes.some((shape) => shape.name?.includes('raised top service hatch'))).toBe(true)
    expect(shapes.some((shape) => shape.name?.includes('lower shadow plinth'))).toBe(true)
    expect(shapes.some((shape) => shape.name?.includes('front horizontal seam'))).toBe(true)
    expect(shapes.some((shape) => shape.name?.includes('vent recess panel'))).toBe(true)
    expect(shapes.some((shape) => shape.name?.includes('vent top frame'))).toBe(true)
    expect(shapes.filter((shape) => shape.name?.includes('vent vertical mullion'))).toHaveLength(2)
    expect(shapes.filter((shape) => shape.name?.includes('vent slat'))).toHaveLength(7)
  })

  test('places pipe rims on the open end and supports flange bolt control', () => {
    const shapes = composePartPrimitives({
      name: 'Pipe detail',
      autoComplete: false,
      parts: [
        {
          kind: 'pipe_port',
          position: [0, 0, 0],
          axis: 'x',
          side: 'right',
          length: 0.4,
          radius: 0.08,
        },
        {
          kind: 'flange_ring',
          position: [0.2, 0, 0],
          axis: 'x',
          radius: 0.12,
          includeBolts: false,
        },
      ],
    })

    const rim = shapes.find((shape) => shape.name?.includes('pipe port rim'))
    expect(rim?.position?.[0]).toBeCloseTo(0.2)
    expect(rim?.axis).toBe('x')
    expect(shapes.find((shape) => shape.name?.includes('flange ring'))?.axis).toBe('x')
    expect(shapes.some((shape) => shape.name?.includes('flange gasket'))).toBe(true)
    expect(shapes.some((shape) => shape.name?.includes('flange bolt'))).toBe(false)
  })

  test('supports volute outlet angles and factory blueprint auto-completion', () => {
    const shapes = composePartPrimitives({
      name: 'Auto pump',
      parts: [
        {
          kind: 'volute_casing',
          position: [0.2, 0.4, 0.05],
          radius: 0.2,
          outletAngle: Math.PI / 2,
        },
      ],
    })

    const discharge = shapes.find((shape) => shape.name?.includes('volute discharge neck'))
    expect(discharge?.position?.[0]).toBeCloseTo(0.2)
    expect(discharge?.position?.[1]).toBeGreaterThan(0.5)
    expect(discharge?.rotation?.[2]).toBeCloseTo(Math.PI / 2)
    expect(shapes.some((shape) => shape.name?.includes('skid left rail'))).toBe(true)
    expect(shapes.some((shape) => shape.name?.includes('ribbed motor body'))).toBe(true)
    expect(shapes.some((shape) => shape.name?.includes('inlet port'))).toBe(true)
    expect(shapes.some((shape) => shape.name?.includes('outlet port'))).toBe(true)
    expect(shapes.some((shape) => shape.name?.includes('flange ring'))).toBe(true)
  })

  test('composes common conveyor, tank, and valve equipment parts', () => {
    const shapes = composePartPrimitives({
      name: 'Factory line',
      detail: 'low',
      parts: [
        { kind: 'conveyor_frame', length: 1.1, width: 0.36 },
        { kind: 'roller_array', count: 5, length: 1.0, width: 0.36 },
        { kind: 'belt_surface', length: 1.1, width: 0.36 },
        { kind: 'cylindrical_tank', position: [1, 0.55, 0], length: 0.8, radius: 0.18 },
        { kind: 'valve_body', position: [1.8, 0.32, 0], radius: 0.09 },
        { kind: 'handwheel', position: [1.8, 0.52, 0], radius: 0.1 },
      ],
    })

    expect(shapes.some((shape) => shape.name?.includes('conveyor left rail'))).toBe(true)
    expect(shapes.filter((shape) => shape.name?.includes('conveyor roller'))).toHaveLength(5)
    expect(shapes.some((shape) => shape.name?.includes('conveyor belt surface'))).toBe(true)
    expect(shapes.some((shape) => shape.name?.includes('cylindrical tank shell'))).toBe(true)
    expect(shapes.some((shape) => shape.name?.includes('tank top nozzle'))).toBe(true)
    expect(shapes.some((shape) => shape.name?.includes('valve body barrel'))).toBe(true)
    expect(shapes.some((shape) => shape.name?.includes('handwheel rim'))).toBe(true)
  })

  test('auto-completes valve validation roles for gate valve blueprints', () => {
    const shapes = composePartPrimitives({
      name: 'Gate valve',
      parts: [{ kind: 'valve_body' }],
    })

    expect(shapes.some((shape) => shape.semanticRole === 'flange_inlet')).toBe(true)
    expect(shapes.some((shape) => shape.semanticRole === 'flange_outlet')).toBe(true)
    expect(shapes.some((shape) => shape.semanticRole === 'bonnet')).toBe(true)
    expect(shapes.some((shape) => shape.semanticRole === 'stem')).toBe(true)
    expect(shapes.some((shape) => shape.semanticRole === 'gate_wedge')).toBe(true)
    expect(shapes.some((shape) => shape.semanticRole === 'bonnet_bolts')).toBe(true)
    expect(shapes.some((shape) => shape.semanticRole === 'yoke')).toBe(true)
    expect(shapes.some((shape) => shape.semanticRole === 'handwheel')).toBe(true)
  })

  test('parameterizes ball valves without requiring users to list internal parts', () => {
    const shapes = composePartPrimitives({
      name: 'Ball Valve',
      parts: [{ kind: 'valve_body' }],
    })

    expect(shapes.some((shape) => shape.semanticRole === 'valve_ball')).toBe(true)
    expect(shapes.some((shape) => shape.semanticRole === 'valve_bore')).toBe(true)
    expect(shapes.filter((shape) => shape.semanticRole === 'seat_ring')).toHaveLength(2)
    expect(shapes.some((shape) => shape.semanticRole === 'gate_wedge')).toBe(false)
    expect(shapes.some((shape) => shape.name?.includes('lever handle'))).toBe(true)

    const inletFlange = shapes.find((shape) => shape.semanticRole === 'flange_inlet')
    const outletFlange = shapes.find((shape) => shape.semanticRole === 'flange_outlet')
    expect(inletFlange?.position?.[1]).toBeCloseTo(0.38)
    expect(outletFlange?.position?.[1]).toBeCloseTo(0.38)
    expect(inletFlange?.position?.[0]).toBeLessThan(0)
    expect(outletFlange?.position?.[0]).toBeGreaterThan(0)
  })

  test('composes bicycle and vehicle equipment families', () => {
    const bicycle = composePartPrimitives({
      name: 'Bike',
      parts: [{ kind: 'bicycle_frame' }],
    })
    expect(
      bicycle.filter((shape) => shape.name?.includes('bicycle') && shape.name?.includes('tire')),
    ).toHaveLength(2)
    expect(bicycle.filter((shape) => shape.semanticRole === 'bicycle_tire')).toHaveLength(2)
    expect(bicycle.some((shape) => shape.name?.includes('bicycle top tube'))).toBe(true)
    expect(bicycle.some((shape) => shape.name?.includes('bicycle left fork blade'))).toBe(true)
    expect(bicycle.some((shape) => shape.name?.includes('handlebar crossbar'))).toBe(true)
    expect(bicycle.some((shape) => shape.name?.includes('saddle cushion'))).toBe(true)
    expect(bicycle.some((shape) => shape.name?.includes('chain elongated loop'))).toBe(true)
    const chain = bicycle.find((shape) => shape.name?.includes('chain elongated loop'))
    expect(chain?.kind).toBe('sweep')
    expect(chain?.closed).toBe(true)
    expect(chain?.path?.length).toBeGreaterThan(6)
    expect(bicycle.some((shape) => shape.name?.includes('front chainring'))).toBe(true)
    expect(bicycle.some((shape) => shape.name?.includes('rear sprocket'))).toBe(true)
    expect(bicycle.some((shape) => shape.semanticRole === 'crank')).toBe(true)
    expect(bicycle.some((shape) => shape.semanticRole === 'chainring')).toBe(true)
    expect(bicycle.filter((shape) => shape.semanticRole === 'pedal')).toHaveLength(2)

    const duplicateWheelsetBicycle = composePartPrimitives({
      name: 'Duplicate wheelset bike',
      parts: [{ kind: 'bicycle_wheels' }, { kind: 'bike_wheelset' }, { kind: 'bicycle_frame' }],
    })
    expect(
      duplicateWheelsetBicycle.filter(
        (shape) => shape.name?.includes('bicycle') && shape.name?.includes('tire'),
      ),
    ).toHaveLength(2)

    const singleBicycleWheel = composePartPrimitives({
      name: 'single bicycle wheel',
      parts: [
        {
          id: 'bicycle_wheel',
          kind: 'wheel_set',
          semanticRole: 'bicycle_wheel',
          radius: 0.35,
        },
      ],
    })
    expect(
      singleBicycleWheel.filter((shape) => shape.semanticRole === 'bicycle_tire'),
    ).toHaveLength(1)
    expect(singleBicycleWheel.filter((shape) => shape.semanticRole === 'bicycle_rim')).toHaveLength(
      1,
    )
    expect(singleBicycleWheel.filter((shape) => shape.semanticRole === 'bicycle_hub')).toHaveLength(
      1,
    )
    expect(
      singleBicycleWheel.filter((shape) => shape.semanticRole === 'bicycle_spoke'),
    ).toHaveLength(8)

    const twoExplicitBicycleWheels = composePartPrimitives({
      name: 'two bicycle wheels',
      parts: [
        {
          id: 'bicycle_wheels',
          kind: 'wheel_set',
          semanticRole: 'bicycle_wheel',
          count: 2,
          radius: 0.35,
        },
      ],
    })
    expect(
      twoExplicitBicycleWheels.filter((shape) => shape.semanticRole === 'bicycle_tire'),
    ).toHaveLength(2)
    expect(
      twoExplicitBicycleWheels.filter((shape) => shape.semanticRole === 'bicycle_rim'),
    ).toHaveLength(2)
    expect(
      twoExplicitBicycleWheels.filter((shape) => shape.semanticRole === 'bicycle_hub'),
    ).toHaveLength(2)
    expect(
      twoExplicitBicycleWheels.filter((shape) => shape.semanticRole === 'bicycle_spoke'),
    ).toHaveLength(16)

    const llmAliasBicycle = composePartPrimitives({
      name: 'red bicycle',
      primaryColor: '#CC0000',
      length: 2,
      parts: [
        { id: 'frame', kind: 'bicycle_frame', semanticRole: 'frame' },
        { id: 'fork', kind: 'bicycle_fork', semanticRole: 'fork' },
        { id: 'wheel_front', kind: 'bicycle_wheel', semanticRole: 'wheel', axis: 'x' },
        { id: 'wheel_rear', kind: 'bicycle_wheel', semanticRole: 'wheel', axis: 'x' },
        { id: 'handlebar', kind: 'bicycle_handlebar', semanticRole: 'handlebar' },
        { id: 'seat', kind: 'bicycle_seat', semanticRole: 'seat' },
        { id: 'crank', kind: 'bicycle_crank', semanticRole: 'crank' },
        { id: 'chainring', kind: 'bicycle_chainring', semanticRole: 'chainring' },
        { id: 'pedals', kind: 'bicycle_pedals', semanticRole: 'pedal' },
        { id: 'chain', kind: 'bicycle_chain', semanticRole: 'chain' },
      ],
    })
    expect(llmAliasBicycle.filter((shape) => shape.semanticRole === 'bicycle_tire')).toHaveLength(2)
    const llmAliasBicycleTires = llmAliasBicycle.filter(
      (shape) => shape.semanticRole === 'bicycle_tire',
    )
    expect(llmAliasBicycleTires.every((shape) => shape.axis === 'z')).toBe(true)
    expect(
      llmAliasBicycleTires.every(
        (shape) => (shape.tubeRadius ?? 1) < (shape.majorRadius ?? 0) * 0.1,
      ),
    ).toBe(true)
    expect(llmAliasBicycle.filter((shape) => shape.semanticRole === 'bicycle_spoke')).toHaveLength(
      16,
    )
    expect(llmAliasBicycle.some((shape) => shape.semanticRole === 'bicycle_frame')).toBe(true)
    expect(llmAliasBicycle.some((shape) => shape.semanticRole === 'bicycle_fork')).toBe(true)
    expect(llmAliasBicycle.some((shape) => shape.semanticRole === 'saddle')).toBe(true)
    expect(llmAliasBicycle.some((shape) => shape.semanticRole === 'chain_loop')).toBe(true)

    const relationshipHeavyBicycle = composePartPrimitives({
      name: 'blue bicycle',
      primaryColor: '#2563EB',
      length: 1.8,
      width: 0.5,
      height: 1,
      geometryBrief: {
        category: 'complete_bicycle',
        requiredRoles: [
          'bicycle_tire',
          'bicycle_frame',
          'bicycle_fork',
          'handlebar',
          'saddle',
          'chain_loop',
        ],
      },
      parts: [
        { id: 'rear_wheel', kind: 'wheel_set', semanticRole: 'bicycle_tire', radius: 0.35 },
        {
          id: 'front_wheel',
          kind: 'wheel_set',
          semanticRole: 'bicycle_tire',
          alignBeside: 'rear_wheel',
          side: 'front',
          radius: 0.35,
        },
        {
          id: 'frame',
          kind: 'tube_frame',
          semanticRole: 'bicycle_frame',
          alignAbove: 'rear_wheel',
        },
        {
          id: 'fork',
          kind: 'fork',
          semanticRole: 'bicycle_fork',
          connectTo: 'frame',
          connectPoint: 'head_tube',
        },
        {
          id: 'handlebar',
          kind: 'handlebar',
          semanticRole: 'handlebar',
          connectTo: 'fork',
          connectPoint: 'steerer_top',
        },
        {
          id: 'saddle',
          kind: 'saddle',
          semanticRole: 'saddle',
          connectTo: 'frame',
          connectPoint: 'seat_tube_top',
        },
        { id: 'chain', kind: 'chain_loop', semanticRole: 'chain_loop' },
      ],
    })
    const tires = relationshipHeavyBicycle.filter((shape) => shape.semanticRole === 'bicycle_tire')
    expect(tires).toHaveLength(2)
    expect(tires.every((shape) => shape.axis === 'z')).toBe(true)
    expect(tires.every((shape) => (shape.tubeRadius ?? 1) < (shape.majorRadius ?? 0) * 0.1)).toBe(
      true,
    )
    expect(
      relationshipHeavyBicycle.filter((shape) => shape.semanticRole === 'bicycle_spoke'),
    ).toHaveLength(16)
    expect(tires[0]?.majorRadius).toBeCloseTo(0.32)
    expect(tires.map((shape) => shape.position?.[0]).sort()).toEqual([
      -0.5800000000000001, 0.5800000000000001,
    ])
    expect(tires.every((shape) => shape.position?.[1] === 0.32)).toBe(true)
    const tireTop = (tires[0]?.position?.[1] ?? 0) + (tires[0]?.majorRadius ?? 0)
    const topTube = relationshipHeavyBicycle.find((shape) => shape.name?.includes('top tube'))
    const handlebar = relationshipHeavyBicycle.find((shape) =>
      shape.name?.includes('handlebar crossbar'),
    )
    const handlebarStem = relationshipHeavyBicycle.find((shape) =>
      shape.name?.includes('handlebar stem'),
    )
    const frontForkBlade = relationshipHeavyBicycle.find((shape) =>
      shape.name?.includes('bicycle left fork blade'),
    )
    const steererTube = relationshipHeavyBicycle.find((shape) =>
      shape.name?.includes('bicycle steerer tube'),
    )
    const saddle = relationshipHeavyBicycle.find((shape) => shape.name?.includes('saddle cushion'))
    expect(topTube?.position?.[1]).toBeGreaterThan(tireTop + 0.2)
    expect(handlebar?.position?.[1]).toBeGreaterThan(tireTop + 0.3)
    expect(saddle?.position?.[1]).toBeGreaterThan(tireTop + 0.38)
    expect(handlebar?.position?.[2]).toBe(0)
    expect(saddle?.position?.[2]).toBe(0)
    const frontTire = [...tires].sort(
      (a, b) => (b.position?.[0] ?? Number.NEGATIVE_INFINITY) - (a.position?.[0] ?? 0),
    )[0]
    const forkAxle = cylinderEndpointByAxis(frontForkBlade ?? {}, 0, 'max')
    expect(forkAxle[0]).toBeCloseTo(frontTire?.position?.[0] ?? 0, 4)
    expect(forkAxle[1]).toBeCloseTo(frontTire?.position?.[1] ?? 0, 4)
    const steererTop = cylinderEndpointByAxis(steererTube ?? {}, 1, 'max')
    const stemBase = cylinderEndpointByAxis(handlebarStem ?? {}, 1, 'min')
    expect(stemBase[0]).toBeCloseTo(steererTop[0], 4)
    expect(stemBase[1]).toBeCloseTo(steererTop[1], 4)
    expect(handlebar?.position?.[0]).toBeLessThan(frontTire?.position?.[0] ?? 0)

    const car = composePartPrimitives({
      name: 'Car',
      primaryColor: '#cc0000',
      parts: [{ kind: 'vehicle_body' }],
    })
    const bodyShell = car.find((shape) => shape.name?.includes('vehicle body shell'))
    expect(bodyShell?.kind).toBe('trapezoid-prism')
    expect(bodyShell?.material?.properties?.color).toBe('#cc0000')
    expect(bodyShell?.semanticRole).toBe('vehicle_body')
    expect(car.some((shape) => shape.name?.includes('vehicle rounded front nose'))).toBe(true)
    expect(car.some((shape) => shape.name?.includes('vehicle tapered rear quarter'))).toBe(true)
    expect(car.some((shape) => shape.name?.includes('vehicle front deck'))).toBe(true)
    expect(car.some((shape) => shape.name?.includes('vehicle rear deck'))).toBe(true)
    expect(car.filter((shape) => shape.name?.includes('vehicle tire'))).toHaveLength(4)
    const vehicleTires = car.filter((shape) => shape.semanticRole === 'vehicle_tire')
    expect(vehicleTires).toHaveLength(4)
    expect(
      vehicleTires.every((shape) => (shape.tubeRadius ?? 0) > (shape.majorRadius ?? 1) * 0.18),
    ).toBe(true)
    expect(car.some((shape) => shape.name?.includes('windshield'))).toBe(true)
    expect(car.some((shape) => shape.name?.includes('rear window'))).toBe(true)
    expect(car.some((shape) => shape.name?.includes('rear quarter window'))).toBe(true)
    expect(car.some((shape) => shape.name?.includes('headlight'))).toBe(true)
    expect(car.some((shape) => shape.name?.includes('front bumper bar'))).toBe(true)
    expect(car.some((shape) => shape.name?.includes('rear bumper bar'))).toBe(true)
  })

  test('normalizes vehicle part aliases and derives a coherent car layout from the body', () => {
    const car = composePartPrimitives({
      partName: 'purple-sedan',
      primaryColor: '#8B5CF6',
      enhanceVisualDetails: true,
      parts: [
        {
          partType: 'vehicle_body',
          id: 'body',
          length: 4.6,
          width: 1.8,
          height: 1.4,
          position: [0, 0.85, 0],
          cornerRadius: 0.15,
        },
        {
          partType: 'vehicle_wheels',
          id: 'wheels',
          wheelRadius: 0.35,
          wheelWidth: 0.22,
          frontZ: 1.5,
          rearZ: -1.5,
          position: [0, 0.35, 0],
        },
        { partType: 'vehicle_windows', id: 'windows', position: [0, 1.55, 0.3] },
        {
          partType: 'headlights',
          id: 'front-lights',
          position: [2.1, 0.75, 0],
          rotation: [0, Math.PI / 2, 0],
        },
        {
          partType: 'bumper',
          id: 'front-bumper',
          length: 1.7,
          height: 0.3,
          position: [2.3, 0.45, 0],
          rotation: [0, Math.PI / 2, 0],
        },
        {
          partType: 'bumper',
          id: 'rear-bumper',
          length: 1.7,
          height: 0.3,
          position: [-2.3, 0.45, 0],
          rotation: [0, Math.PI / 2, 0],
        },
      ],
    })

    const bodyShell = car.find((shape) => shape.name?.includes('vehicle body shell'))
    expect(bodyShell?.material?.properties?.color).toBe('#8B5CF6')
    expect(bodyShell?.height).toBeLessThan(0.8)

    const tires = car.filter((shape) => shape.name?.includes('vehicle tire'))
    expect(tires).toHaveLength(4)
    expect(Math.min(...tires.map((shape) => shape.position?.[0] ?? 0))).toBeLessThan(-1.4)
    expect(Math.max(...tires.map((shape) => shape.position?.[0] ?? 0))).toBeGreaterThan(1.4)
    expect(Math.max(...tires.map((shape) => Math.abs(shape.position?.[2] ?? 0)))).toBeGreaterThan(
      0.7,
    )

    const windshield = car.find((shape) => shape.name?.includes('windshield'))
    expect(windshield?.rotation?.[2]).toBeLessThan(Math.PI / 2)
    expect(windshield?.position?.[2]).toBeCloseTo(0)

    const rearWindow = car.find((shape) => shape.name?.includes('rear window'))
    expect(rearWindow?.rotation?.[2]).toBeGreaterThan(Math.PI / 2)

    const sideWindow = car.find((shape) => shape.name?.includes('side window left'))
    expect(sideWindow?.rotation?.[0]).toBeCloseTo(Math.PI / 2)
    expect(
      car.filter(
        (shape) => shape.name?.includes('vehicle wheel arch lip') && shape.kind === 'torus',
      ),
    ).toHaveLength(4)
    expect(car.filter((shape) => shape.name?.includes('vehicle wheel well shadow'))).toHaveLength(4)

    const frontBumper = car.find((shape) => shape.name?.includes('front bumper bar'))
    expect(frontBumper?.rotation).toBeUndefined()
    expect(frontBumper?.position?.[0]).toBeGreaterThan(2.2)
  })

  test('honors compact vehicle size and body-local color aliases', () => {
    const car = composePartPrimitives({
      name: 'small red car',
      parts: [
        {
          kind: 'vehicle_body',
          primaryColor: '#cc0000',
          vehicleStyle: 'sedan',
          sizeScale: 0.8,
        },
        { kind: 'vehicle_wheels' },
        { kind: 'vehicle_windows' },
        { kind: 'headlights' },
        { kind: 'bumper' },
      ],
    })

    const bodyShell = car.find((shape) => shape.name?.includes('vehicle body shell'))
    expect(bodyShell?.length).toBeCloseTo(3.52)
    expect(bodyShell?.width).toBeCloseTo(1.44)
    expect(bodyShell?.material?.properties?.color).toBe('#cc0000')

    const cabin = car.find((shape) => shape.name?.includes('vehicle cabin frame'))
    expect(cabin?.kind).toBe('trapezoid-prism')
    expect(cabin?.length).toBeLessThan((bodyShell?.length ?? 0) * 0.45)
    expect(cabin?.length).toBeGreaterThan((bodyShell?.length ?? 0) * 0.4)
    expect(cabin?.height).toBeLessThan(0.1)

    const roof = car.find((shape) => shape.name?.includes('vehicle roof cap'))
    expect(roof?.semanticRole).toBe('vehicle_roof')
    expect(roof?.kind).toBe('rounded-panel')
    expect(roof?.thickness).toBeGreaterThan(0.02)
    expect(roof?.thickness).toBeLessThan(0.05)
    expect(roof?.width).toBeLessThan(cabin?.width ?? Number.POSITIVE_INFINITY)
    expect(roof?.position?.[1]).toBeGreaterThan(cabin?.position?.[1] ?? 0)

    const hood = car.find((shape) => shape.name?.includes('front deck hood surface'))
    expect(hood?.kind).toBe('wedge')
    expect(hood?.height).toBeLessThan((bodyShell?.height ?? 1) * 0.12)

    const glasshouse = car.find((shape) => shape.name?.includes('integrated vehicle glasshouse'))
    expect(glasshouse?.kind).toBe('trapezoid-prism')
    expect(glasshouse?.semanticRole).toBe('vehicle_window')
    expect(glasshouse?.material?.properties?.transparent).toBe(true)
    expect(glasshouse?.topLengthScale).toBeLessThan(1)

    const pillars = car.filter((shape) => shape.semanticRole === 'vehicle_pillar')
    expect(pillars).toHaveLength(6)
    expect(pillars.every((shape) => shape.material?.properties?.color === '#cc0000')).toBe(true)

    const roofRails = car.filter((shape) => shape.name?.includes('vehicle roof rail'))
    expect(roofRails).toHaveLength(2)

    const windshield = car.find((shape) => shape.name?.includes('windshield'))
    expect(windshield?.material?.properties?.transparent).toBe(true)
    expect(windshield?.material?.properties?.color).toBe('#1e3a8a')
    expect(windshield?.rotation?.[2]).toBeLessThan(Math.PI / 2)

    const rearWindow = car.find((shape) => shape.name?.includes('rear window'))
    expect(rearWindow?.rotation?.[2]).toBeGreaterThan(Math.PI / 2)

    const sideWindows = car.filter(
      (shape) => shape.name?.includes('side window left') && shape.kind === 'rounded-panel',
    )
    expect(sideWindows).toHaveLength(2)
    expect(sideWindows.every((shape) => (shape.width ?? 0) > (windshield?.length ?? 0) * 0.7)).toBe(
      true,
    )

    expect(car.some((shape) => shape.name?.includes('vehicle wheel arch lip'))).toBe(false)
    expect(car.some((shape) => shape.name?.includes('vehicle wheel well shadow'))).toBe(false)
  })

  test('uses a tapered trapezoid cabin when vehicle roof corners are requested below 90 degrees', () => {
    const car = composePartPrimitives({
      name: 'Red streamlined car',
      primaryColor: '#cc0000',
      autoComplete: false,
      parts: [
        {
          kind: 'vehicle_body',
          length: 4,
          width: 1.6,
          height: 1.25,
          roofCornerAngle: 85,
          cornerRadius: 0.14,
          cornerSegments: 10,
        },
      ],
    })

    const cabin = car.find((shape) => shape.name?.includes('vehicle cabin frame'))
    expect(cabin?.kind).toBe('trapezoid-prism')
    expect(cabin?.topLengthScale).toBeCloseTo(0.9)
    expect(cabin?.topWidthScale).toBeCloseTo(0.9)
    expect(cabin?.semanticRole).toBe('vehicle_cabin')
  })

  test('derives distinct vehicle style proportions from intent', () => {
    const sedan = composePartPrimitives({
      name: 'family sedan',
      parts: [{ kind: 'vehicle_body' }],
    })
    const suv = composePartPrimitives({
      name: 'offroad SUV',
      parts: [{ kind: 'vehicle_body' }],
    })
    const sports = composePartPrimitives({
      name: 'red sports car',
      parts: [{ kind: 'vehicle_body' }],
    })
    const truck = composePartPrimitives({
      name: 'pickup truck',
      parts: [{ kind: 'vehicle_body' }],
    })

    const body = (shapes: ReturnType<typeof composePartPrimitives>) =>
      shapes.find((shape) => shape.name?.includes('vehicle body shell'))
    const cabin = (shapes: ReturnType<typeof composePartPrimitives>) =>
      shapes.find((shape) => shape.name?.includes('vehicle cabin frame'))
    const tireRadius = (shapes: ReturnType<typeof composePartPrimitives>) =>
      shapes.find((shape) => shape.name?.includes('vehicle tire'))?.majorRadius ?? 0

    expect(body(suv)?.position?.[1]).toBeGreaterThan(body(sedan)?.position?.[1] ?? 0)
    expect(body(sports)?.position?.[1]).toBeLessThan(body(sedan)?.position?.[1] ?? 0)
    expect(tireRadius(sports)).toBeGreaterThan(tireRadius(sedan))
    expect(cabin(sports)?.topLengthScale).toBeLessThan(cabin(sedan)?.topLengthScale ?? 1)
    expect(cabin(suv)?.length).toBeGreaterThan(cabin(sedan)?.length ?? 0)
    expect(truck.some((shape) => shape.name?.includes('truck cargo bed'))).toBe(true)
  })

  test('composes expanded factory equipment families and visual details', () => {
    const shapes = composePartPrimitives({
      name: 'Plant equipment',
      autoComplete: false,
      parts: [
        { kind: 'gearbox_body' },
        { kind: 'filter_vessel', position: [0.8, 0.62, 0] },
        { kind: 'heat_exchanger', position: [1.6, 0.52, 0] },
        { kind: 'agitator_tank', position: [2.6, 0.58, 0] },
        { kind: 'pipe_rack', position: [3.7, 0.45, 0], count: 2 },
        { kind: 'platform_ladder', position: [4.8, 0.75, 0] },
        { kind: 'nameplate', position: [0, 0.45, 0.2] },
        { kind: 'warning_label', position: [0.1, 0.52, 0.21] },
        { kind: 'seam_ring', position: [0.8, 0.98, 0], axis: 'y', radius: 0.18 },
      ],
    })

    expect(shapes.some((shape) => shape.name?.includes('gearbox housing'))).toBe(true)
    expect(shapes.some((shape) => shape.name?.includes('filter vessel shell'))).toBe(true)
    expect(shapes.some((shape) => shape.name?.includes('heat exchanger shell'))).toBe(true)
    expect(shapes.some((shape) => shape.name?.includes('agitator tank shell'))).toBe(true)
    expect(shapes.filter((shape) => shape.name?.includes('rack pipe'))).toHaveLength(2)
    expect(shapes.some((shape) => shape.name?.includes('access platform deck'))).toBe(true)
    expect(shapes.some((shape) => shape.name?.includes('nameplate'))).toBe(true)
    expect(shapes.some((shape) => shape.name?.includes('warning label'))).toBe(true)
    expect(shapes.some((shape) => shape.name?.includes('seam ring'))).toBe(true)
  })

  test('supports part connections and blueprint assessment', () => {
    const shapes = composePartPrimitives({
      name: 'Connected pump port',
      autoComplete: false,
      parts: [
        {
          id: 'port',
          kind: 'pipe_port',
          position: [0, 0, 0],
          axis: 'z',
          length: 0.4,
          radius: 0.08,
        },
        {
          kind: 'flange_ring',
          connectTo: 'port',
          anchor: 'front',
          childAnchor: 'back',
          axis: 'z',
          radius: 0.12,
        },
      ],
    })
    const flange = shapes.find((shape) => shape.name?.includes('flange ring'))
    expect(flange?.position?.[2]).toBeCloseTo(0.2175)

    const assessment = assessPartBlueprint({
      parts: [{ kind: 'volute_casing' }, { kind: 'inlet_port' }],
    })
    expect(assessment.family).toBe('pump')
    expect(assessment.score).toBeLessThan(1)
    expect(assessment.missing).toContain('outlet_port')
    expect(assessment.recommendations.length).toBeGreaterThan(0)
  })

  test('supports semantic part connection points', () => {
    const shapes = composePartPrimitives({
      name: 'Semantic pump connections',
      autoComplete: false,
      parts: [
        {
          id: 'casing',
          kind: 'volute_casing',
          position: [0.2, 0.4, 0.05],
          radius: 0.2,
          depth: 0.1,
          outletAngle: 0,
        },
        {
          id: 'suction-flange',
          name: 'suction-flange',
          kind: 'flange_ring',
          connectTo: 'casing',
          connectPoint: 'inlet',
          childPoint: 'back',
          axis: 'z',
          radius: 0.1,
          includeBolts: false,
        },
        {
          id: 'outlet-pipe',
          name: 'outlet-pipe',
          kind: 'outlet_port',
          connectTo: 'casing',
          connectPoint: 'outlet',
          childPoint: 'base',
          axis: 'x',
          radius: 0.05,
          length: 0.24,
        },
      ],
    })

    const suctionFlange = shapes.find((shape) => shape.name?.includes('suction-flange flange ring'))
    const outletPipe = shapes.find((shape) => shape.name?.includes('outlet-pipe outlet port'))
    expect(suctionFlange?.position?.[2]).toBeCloseTo(0.1215)
    expect(outletPipe?.position?.[0]).toBeCloseTo(0.532)
  })

  test('resolves compose_parts spatial relationship fields before manual coordinates', () => {
    const shapes = composePartPrimitives({
      name: 'Relation layout',
      autoComplete: false,
      parts: [
        {
          id: 'base',
          name: 'base',
          kind: 'skid_base',
          length: 1,
          width: 0.4,
          height: 0.08,
          position: [0, 0.04, 0],
        },
        {
          id: 'motor',
          name: 'motor',
          kind: 'ribbed_motor_body',
          centeredOn: 'base',
          axis: 'x',
          length: 0.4,
          radius: 0.1,
        },
        {
          id: 'controls',
          name: 'controls',
          kind: 'control_box',
          alignAbove: 'base',
          relationGap: 0.02,
          width: 0.2,
          depth: 0.08,
          height: 0.16,
        },
        {
          id: 'side-module',
          name: 'side-module',
          kind: 'control_box',
          alignBeside: 'base',
          side: 'right',
          relationGap: 0.03,
          width: 0.2,
          depth: 0.08,
          height: 0.16,
        },
      ],
    })

    const motor = shapes.find((shape) => shape.name?.includes('motor ribbed motor body'))
    expect(motor?.position).toEqual([0, 0.42, 0])

    const controls = shapes.find((shape) => shape.name?.includes('controls control box'))
    expect(controls?.position?.[0]).toBeCloseTo(0)
    expect(controls?.position?.[1]).toBeCloseTo(0.18)
    expect(controls?.position?.[2]).toBeCloseTo(0)

    const sideModule = shapes.find((shape) => shape.name?.includes('side-module control box'))
    expect(sideModule?.position?.[0]).toBeCloseTo(0.63)
    expect(sideModule?.position?.[1]).toBeCloseTo(0.04)
    expect(sideModule?.position?.[2]).toBeCloseTo(0)
  })

  test('expands around relationship into evenly distributed circular parts', () => {
    const shapes = composePartPrimitives({
      name: 'Around layout',
      autoComplete: false,
      parts: [
        {
          id: 'tank',
          name: 'tank',
          kind: 'cylindrical_tank',
          axis: 'y',
          radius: 0.4,
          length: 1,
          position: [0, 0.5, 0],
        },
        {
          id: 'foot',
          name: 'support foot',
          kind: 'control_box',
          around: 'tank',
          aroundCount: 4,
          aroundRadius: 0.55,
          width: 0.12,
          depth: 0.08,
          height: 0.16,
        },
      ],
    })

    const feet = shapes.filter((shape) => shape.name?.match(/support foot \d control box$/))
    expect(feet).toHaveLength(4)
    expect(feet[0]?.position?.[0]).toBeCloseTo(0.55)
    expect(feet[0]?.position?.[2]).toBeCloseTo(0)
    expect(feet[1]?.position?.[0]).toBeCloseTo(0)
    expect(feet[1]?.position?.[2]).toBeCloseTo(0.55)
    expect(feet[2]?.position?.[0]).toBeCloseTo(-0.55)
    expect(feet[2]?.position?.[2]).toBeCloseTo(0)
    expect(feet[3]?.position?.[0]).toBeCloseTo(0)
    expect(feet[3]?.position?.[2]).toBeCloseTo(-0.55)
  })

  test('expands linear part arrays after relationship placement', () => {
    const shapes = composePartPrimitives({
      name: 'Array layout',
      autoComplete: false,
      parts: [
        {
          id: 'block',
          name: 'block',
          kind: 'rounded_machine_body',
          length: 1,
          width: 0.4,
          height: 0.24,
          position: [0, 0.12, 0],
        },
        {
          id: 'cylinder',
          name: 'cylinder head',
          kind: 'control_box',
          alignAbove: 'block',
          width: 0.08,
          depth: 0.08,
          height: 0.1,
          array: { count: 3, axis: 'x', spacing: 0.2 },
        },
      ],
    })

    const heads = shapes.filter((shape) => shape.name?.match(/cylinder head \d control box$/))
    expect(heads).toHaveLength(3)
    expect(heads[0]?.position?.[0]).toBeCloseTo(-0.2)
    expect(heads[1]?.position?.[0]).toBeCloseTo(0)
    expect(heads[2]?.position?.[0]).toBeCloseTo(0.2)
    for (const head of heads) {
      expect(head.position?.[1]).toBeCloseTo(0.29)
      expect(head.position?.[2]).toBeCloseTo(0)
    }
  })

  test('places around corner patterns on rectangular parent corners', () => {
    const shapes = composePartPrimitives({
      name: 'Corner layout',
      autoComplete: false,
      parts: [
        {
          id: 'base',
          name: 'base',
          kind: 'skid_base',
          length: 1,
          width: 0.6,
          height: 0.08,
          position: [0, 0.04, 0],
        },
        {
          id: 'foot',
          name: 'corner foot',
          kind: 'control_box',
          around: 'base',
          cornerPattern: true,
          width: 0.1,
          depth: 0.1,
          height: 0.12,
        },
      ],
    })

    const feet = shapes.filter((shape) => shape.name?.match(/corner foot \d control box$/))
    expect(feet).toHaveLength(4)
    expect(feet[0]?.position?.[0]).toBeCloseTo(-0.45)
    expect(feet[0]?.position?.[2]).toBeCloseTo(-0.25)
    expect(feet[1]?.position?.[0]).toBeCloseTo(0.45)
    expect(feet[1]?.position?.[2]).toBeCloseTo(-0.25)
    expect(feet[2]?.position?.[0]).toBeCloseTo(0.45)
    expect(feet[2]?.position?.[2]).toBeCloseTo(0.25)
    expect(feet[3]?.position?.[0]).toBeCloseTo(-0.45)
    expect(feet[3]?.position?.[2]).toBeCloseTo(0.25)
  })

  test('links common mechanical parts with contextual defaults', () => {
    const fan = composePartPrimitives({
      name: 'Context fan',
      autoComplete: false,
      parts: [
        {
          id: 'blades',
          name: 'blades',
          kind: 'radial_blades',
          radius: 0.3,
          position: [0, 1.2, 0.04],
        },
        {
          id: 'grill',
          name: 'grill',
          kind: 'protective_grill',
        },
      ],
    })
    const grillRing = fan.find((shape) => shape.name?.includes('grill front ring 4'))
    expect(grillRing?.position?.[0]).toBeCloseTo(0)
    expect(grillRing?.position?.[1]).toBeCloseTo(1.18)
    expect(grillRing?.position?.[2]).toBeCloseTo(0.04)
    expect(grillRing?.majorRadius).toBeCloseTo(0.354)

    const pump = composePartPrimitives({
      name: 'Context pump',
      autoComplete: false,
      parts: [
        {
          id: 'casing',
          name: 'casing',
          kind: 'volute_casing',
          radius: 0.32,
          depth: 0.16,
          position: [0, 0.55, 0.2],
        },
        { id: 'suction', name: 'suction', kind: 'inlet_port', radius: 0.06, length: 0.2 },
        { id: 'discharge', name: 'discharge', kind: 'outlet_port', radius: 0.05, length: 0.24 },
      ],
    })
    const suction = pump.find((shape) => shape.name?.includes('suction inlet port'))
    const discharge = pump.find((shape) => shape.name?.includes('discharge outlet port'))
    expect(suction?.position?.[2]).toBeCloseTo(0.3864)
    expect(discharge?.position?.[0]).toBeCloseTo(0.4267)
  })

  test('composes propeller blade sets as reusable taiji-half paddles', () => {
    const shapes = composePartPrimitives({
      name: 'Generic agitator',
      autoComplete: false,
      parts: [
        {
          kind: 'propeller_blade_set',
          count: 3,
          bladeRadius: 0.42,
          bladeWidth: 0.16,
          depth: 0.032,
          bladePitch: 0.52,
          bladeShape: 'taiji_half',
          verticalCurve: 0.07,
          wireRadius: 0.055,
        },
      ],
    })

    const blades = shapes.filter((shape) => shape.semanticRole === 'propeller_blade')
    expect(blades).toHaveLength(3)
    expect(blades.every((shape) => shape.sourcePartKind === 'propeller_blade_set')).toBe(true)
    expect(blades.every((shape) => shape.name?.includes('taiji half propeller blade'))).toBe(true)
    const profile = blades[0]?.profile ?? []
    expect(profile.length).toBeGreaterThanOrEqual(26)
    const maxY = Math.max(...profile.map(([, y]) => y))
    const minY = Math.min(...profile.map(([, y]) => y))
    expect(maxY).toBeGreaterThan(Math.abs(minY) * 0.8)
    expect(blades.every((shape) => Math.abs((shape.rotation?.[0] ?? 0) + Math.PI / 2) > 0.18)).toBe(
      true,
    )
    blades.forEach(expectBladeRotationMatchesRadialPlacement)
  })

  test('composes mixer blades through the reusable taiji-half blade set kernel', () => {
    const shapes = composePartPrimitives({
      name: 'Mud mixer',
      autoComplete: false,
      parts: [
        {
          kind: 'mixer_blades',
          count: 3,
          bladeRadius: 0.42,
          bladeWidth: 0.16,
          depth: 0.032,
          bladePitch: 0.52,
          wireRadius: 0.055,
        },
      ],
    })

    const blades = shapes.filter((shape) => shape.semanticRole === 'mixer_blade')
    expect(blades).toHaveLength(3)
    expect(blades.every((shape) => shape.kind === 'extrude')).toBe(true)
    expect(blades.every((shape) => shape.name?.includes('taiji half mixer propeller blade'))).toBe(
      true,
    )
    expect(blades.every((shape) => (shape.profile?.length ?? 0) >= 20)).toBe(true)
    expect(blades.every((shape) => Math.abs((shape.rotation?.[0] ?? 0) + Math.PI / 2) > 0.25)).toBe(
      true,
    )
    blades.forEach(expectBladeRotationMatchesRadialPlacement)
    const profile = blades[0]?.profile ?? []
    const minX = Math.min(...profile.map(([x]) => x))
    const maxX = Math.max(...profile.map(([x]) => x))
    const widestX = profile.reduce((best, [x]) => {
      const widthAtBest = profile.filter(([px]) => px === best).map(([, y]) => y)
      const widthAtX = profile.filter(([px]) => px === x).map(([, y]) => y)
      return Math.max(...widthAtX) - Math.min(...widthAtX) >
        Math.max(...widthAtBest) - Math.min(...widthAtBest)
        ? x
        : best
    }, minX)
    const widthAt = (xValue: number) => {
      const ys = profile.filter(([x]) => x === xValue).map(([, y]) => y)
      return Math.max(...ys) - Math.min(...ys)
    }
    expect(widthAt(widestX)).toBeGreaterThan(widthAt(minX) * 1.8)
    expect(widthAt(widestX)).toBeGreaterThan(widthAt(maxX) * 1.8)
  })

  test('composes curved organic and aerodynamic reusable parts', () => {
    const propeller = composePartPrimitives({
      name: 'Curved propeller',
      autoComplete: false,
      parts: [
        {
          kind: 'airfoil_blade',
          name: 'propeller',
          count: 3,
          length: 0.6,
          rootWidth: 0.18,
          tipWidth: 0.06,
          thickness: 0.025,
          pitch: 0.42,
          camber: 0.04,
        },
      ],
    })
    const blades = propeller.filter((shape) => shape.semanticRole === 'airfoil_blade')
    expect(blades).toHaveLength(3)
    expect(blades.every((shape) => shape.kind === 'extrude')).toBe(true)
    expect(blades.every((shape) => (shape.profile?.length ?? 0) >= 20)).toBe(true)
    blades.forEach(expectBladeRotationMatchesRadialPlacement)
    expect(propeller.some((shape) => shape.semanticRole === 'airfoil_hub')).toBe(true)

    const lens = composePartPrimitives({
      name: 'Frog sunglasses',
      autoComplete: false,
      parts: [
        {
          kind: 'curved_lens_panel',
          name: 'frog lens',
          lensShape: 'frog',
          width: 0.34,
          height: 0.2,
          curvature: 0.12,
          color: '#111827',
        },
      ],
    })
    const lensPanel = lens.find((shape) => shape.semanticRole === 'curved_lens')
    expect(lensPanel?.kind).toBe('extrude')
    expect(lensPanel?.material?.properties?.transparent).toBe(true)
    expect(lens.some((shape) => shape.semanticRole === 'lens_rim')).toBe(true)

    const mouse = composePartPrimitives({
      name: 'Mouse',
      autoComplete: false,
      parts: [{ kind: 'ergonomic_shell', name: 'mouse shell', style: 'mouse' }],
    })
    expect(mouse.some((shape) => shape.semanticRole === 'ergonomic_shell')).toBe(true)
    expect(mouse.filter((shape) => shape.semanticRole === 'mouse_button')).toHaveLength(2)
    expect(mouse.some((shape) => shape.semanticRole === 'scroll_wheel')).toBe(true)

    const helmet = composePartPrimitives({
      name: 'Helmet shell',
      autoComplete: false,
      parts: [
        {
          kind: 'ellipsoid_shell',
          name: 'helmet',
          length: 0.34,
          width: 0.24,
          height: 0.18,
          shellThickness: 0.012,
        },
      ],
    })
    expect(helmet.some((shape) => shape.semanticRole === 'ellipsoid_shell')).toBe(true)
    expect(helmet.some((shape) => shape.semanticRole === 'ellipsoid_shell_rim')).toBe(true)
    expect(helmet.some((shape) => shape.semanticRole === 'ellipsoid_shell_opening')).toBe(true)

    const curvedPanel = composePartPrimitives({
      name: 'Curved machine panel',
      autoComplete: false,
      parts: [{ kind: 'curved_panel', width: 0.4, height: 0.22, curvature: 0.16 }],
    })
    expect(curvedPanel.some((shape) => shape.sourcePartKind === 'curved_lens_panel')).toBe(true)
  })

  test('composes streamlined bodies and lofted panels from reusable curved parts', () => {
    const aircraft = composePartPrimitives({
      name: 'Aircraft body',
      autoComplete: false,
      parts: [
        {
          kind: 'streamlined_body',
          name: 'fuselage',
          length: 1.6,
          width: 0.32,
          height: 0.22,
          noseRoundness: 0.75,
          tailTaper: 0.45,
          roofArc: 0.18,
        },
      ],
    })
    expect(aircraft.some((shape) => shape.semanticRole === 'streamlined_body')).toBe(true)
    expect(aircraft.some((shape) => shape.semanticRole === 'streamlined_nose')).toBe(true)
    expect(aircraft.some((shape) => shape.semanticRole === 'streamlined_tail')).toBe(true)
    expect(aircraft.some((shape) => shape.semanticRole === 'streamlined_roof_arc')).toBe(true)

    const loft = composePartPrimitives({
      name: 'Transition fairing',
      autoComplete: false,
      parts: [
        {
          kind: 'lofted_shell',
          name: 'fairing',
          length: 0.9,
          width: 0.34,
          height: 0.16,
          thickness: 0.018,
          sections: [
            { x: -0.45, width: 0.4, height: 0.12 },
            { x: 0, width: 0.3, height: 0.18, y: 0.02 },
            { x: 0.45, width: 0.12, height: 0.08 },
          ],
        },
      ],
    })
    expect(loft.filter((shape) => shape.semanticRole === 'lofted_panel_segment')).toHaveLength(2)
    expect(loft.some((shape) => shape.semanticRole === 'lofted_panel_root')).toBe(true)
    expect(loft.some((shape) => shape.semanticRole === 'lofted_panel_tip')).toBe(true)
  })

  test('auto-completes a Boeing 717 style airliner from aircraft intent', () => {
    const shapes = composePartPrimitives({
      name: '生成一架波音717客机',
      detail: 'medium',
      parts: [],
    })

    const fuselage = shapes.find((shape) => shape.semanticRole === 'aircraft_fuselage')
    expect(fuselage).toBeDefined()
    const wings = shapes.filter((shape) => shape.semanticRole === 'aircraft_wing')
    expect(wings).toHaveLength(2)
    expect(wings.every((shape) => shape.kind === 'extrude')).toBe(true)
    expect(wings.every((shape) => (shape.profile?.length ?? 0) >= 4)).toBe(true)
    expect(wings.map((shape) => Math.sign(shape.position?.[2] ?? 0)).sort()).toEqual([-1, 1])
    expect(shapes.filter((shape) => shape.semanticRole === 'aircraft_winglet')).toHaveLength(2)
    expect(shapes.filter((shape) => shape.semanticRole === 'engine_nacelle_left')).toHaveLength(1)
    expect(shapes.filter((shape) => shape.semanticRole === 'engine_nacelle_right')).toHaveLength(1)
    expect(shapes.some((shape) => shape.semanticRole === 'vertical_stabilizer')).toBe(true)
    expect(shapes.filter((shape) => shape.semanticRole === 'horizontal_stabilizer')).toHaveLength(2)
    expect(
      shapes.filter((shape) => shape.semanticRole === 'aircraft_landing_gear_nose'),
    ).toHaveLength(2)
    expect(
      shapes.filter((shape) => shape.semanticRole === 'aircraft_landing_gear_main'),
    ).toHaveLength(4)
    const inferredAircraftLength = ((fuselage?.scale?.[0] as number | undefined) ?? 1) / 0.78
    const cabinWindows = shapes.filter((shape) => shape.semanticRole === 'cabin_window')
    expect(cabinWindows.length).toBeGreaterThan(20)
    expect(
      cabinWindows.every(
        (shape) =>
          shape.kind === 'conformal-strip' &&
          shape.xStart != null &&
          shape.xEnd != null &&
          shape.xEnd - shape.xStart < inferredAircraftLength * 0.03 &&
          shape.xEnd / inferredAircraftLength < 0.22 &&
          (shape.width ?? 0) < inferredAircraftLength * 0.035 &&
          (shape.material?.properties?.opacity ?? 0) >= 0.85,
      ),
    ).toBe(true)
    expect(shapes.some((shape) => shape.semanticRole === 'cockpit_window')).toBe(true)
    const cockpitWindows = shapes.filter((shape) => shape.semanticRole === 'cockpit_window')
    expect(cockpitWindows).toHaveLength(4)
    expect(
      cockpitWindows.every(
        (shape) =>
          shape.kind === 'conformal-strip' &&
          shape.surface === 'ellipsoid-cylinder' &&
          shape.xStart != null &&
          shape.xEnd != null &&
          shape.xStart / inferredAircraftLength > 0.26 &&
          shape.xEnd / inferredAircraftLength < 0.35 &&
          shape.verticalOffset != null &&
          shape.verticalOffset > 0 &&
          shape.surfaceRadiusY != null &&
          shape.surfaceRadiusZ != null &&
          shape.rotation == null,
      ),
    ).toBe(true)
    expect(
      cockpitWindows.every((shape) => (shape.material?.properties?.opacity ?? 0) >= 0.85),
    ).toBe(true)
    expect(shapes.some((shape) => shape.semanticRole === 'aircraft_nose')).toBe(false)
    expect(shapes.some((shape) => shape.semanticRole === 'streamlined_roof_arc')).toBe(false)
    const stripes = shapes.filter((shape) => shape.semanticRole === 'aircraft_livery_stripe')
    expect(stripes).toHaveLength(2)
    expect(stripes.every((shape) => shape.kind === 'conformal-strip')).toBe(true)
    expect(stripes.map((shape) => shape.side).sort()).toEqual(['left', 'right'])
    expect(stripes.every((shape) => shape.surfaceRadiusY && shape.surfaceRadiusZ)).toBe(true)
    expect(stripes.every((shape) => shape.surfaceLength)).toBe(true)
    expect(stripes.every((shape) => shape.endTaper === 0.42 && shape.widthSegments === 4)).toBe(
      true,
    )

    const assessment = assessPartBlueprint({
      name: 'Boeing 717 airliner',
      parts: [{ kind: 'fuselage_tube' }, { kind: 'low_mounted_wings' }],
    })
    expect(assessment.family).toBe('aircraft')
    expect(assessment.missing).toContain('aircraft_engine')
  })

  test('scales aircraft default blueprint from top-level length', () => {
    const shapes = composePartPrimitives({
      name: 'Boeing 717 airliner',
      length: 5,
      geometryBrief: { category: 'aircraft', expectedDimensions: { length: 5 } },
      parts: [],
    })

    const fuselage = shapes.find((shape) => shape.semanticRole === 'aircraft_fuselage')
    const wing = shapes.find((shape) => shape.semanticRole === 'aircraft_wing')

    expect(fuselage?.scale?.[0]).toBeCloseTo(3.9)
    expect(wing?.kind).toBe('extrude')
    expect(wing?.profile?.length).toBeGreaterThanOrEqual(4)
    expect(Math.max(...(wing?.profile ?? []).map(([, y]) => Math.abs(y)))).toBeGreaterThan(1)
  })

  test('preserves 10 meter aircraft length in default blueprint', () => {
    const shapes = composePartPrimitives({
      name: '10 meter aircraft',
      length: 10,
      geometryBrief: { category: 'aircraft', expectedDimensions: { length: 10 } },
      parts: [{ kind: 'aircraft_fuselage' }],
    })

    const fuselage = shapes.find((shape) => shape.semanticRole === 'aircraft_fuselage')
    const wing = shapes.find((shape) => shape.semanticRole === 'aircraft_wing')
    const engine = shapes.find((shape) => shape.semanticRole === 'engine_nacelle_left')

    expect(fuselage?.scale?.[0]).toBeCloseTo(7.8)
    expect(shapes.some((shape) => shape.semanticRole === 'aircraft_nose')).toBe(false)
    expect(wing?.kind).toBe('extrude')
    expect(wing?.depth).toBeLessThanOrEqual(0.08)
    expect(Math.max(...(wing?.profile ?? []).map(([, y]) => Math.abs(y)))).toBeGreaterThan(2)
    expect(shapes.some((shape) => shape.semanticRole === 'aircraft_winglet')).toBe(true)
    expect(engine?.radius).toBeLessThan(0.36)
  })

  test('applies compose_parts dimensions to the primary explicit part', () => {
    const shapes = composePartPrimitives({
      name: 'Boeing 717 airliner',
      geometryBrief: { category: 'aircraft', expectedDimensions: { length: 5 } },
      parts: [{ kind: 'aircraft_fuselage' }],
    })

    const fuselage = shapes.find((shape) => shape.semanticRole === 'aircraft_fuselage')

    expect(fuselage?.scale?.[0]).toBeCloseTo(3.9)
  })

  test('keeps aircraft default parts aligned when the LLM supplies only a fuselage part', () => {
    const shapes = composePartPrimitives({
      name: 'Boeing 717 airliner',
      length: 8,
      geometryBrief: { category: 'aircraft', expectedDimensions: { length: 8 } },
      parts: [{ kind: 'aircraft_fuselage' }],
    })

    const fuselage = shapes.find((shape) => shape.semanticRole === 'aircraft_fuselage')
    const wing = shapes.find((shape) => shape.semanticRole === 'aircraft_wing')
    const engine = shapes.find((shape) => shape.semanticRole === 'engine_nacelle_left')
    const verticalTail = shapes.find((shape) => shape.semanticRole === 'vertical_stabilizer')
    const horizontalTail = shapes.find((shape) => shape.semanticRole === 'horizontal_stabilizer')
    const horizontalTails = shapes.filter((shape) => shape.semanticRole === 'horizontal_stabilizer')
    const noseGear = shapes.find((shape) => shape.semanticRole === 'aircraft_landing_gear_nose')

    expect(fuselage?.scale?.[0]).toBeCloseTo(6.24)
    expect(wing?.position?.[1]).toBeLessThan(fuselage?.position?.[1] ?? 0)
    expect(wing?.position?.[1]).toBeGreaterThan((fuselage?.position?.[1] ?? 0) - 0.35)
    expect(engine?.position?.[1]).toBeLessThan(wing?.position?.[1] ?? 0)
    expect(Math.abs(engine?.position?.[2] ?? 0)).toBeGreaterThan(
      ((fuselage?.scale?.[2] as number | undefined) ?? 0) * 0.7,
    )
    expect(verticalTail?.position?.[1]).toBeGreaterThan(fuselage?.position?.[1] ?? 0)
    expect(horizontalTail?.position?.[1]).toBeGreaterThan(verticalTail?.position?.[1] ?? 0)
    expect(horizontalTails.map((shape) => Math.sign(shape.position?.[2] ?? 0)).sort()).toEqual([
      -1, 1,
    ])
    expect(noseGear?.position?.[1]).toBeLessThan((fuselage?.position?.[1] ?? 0) - 0.8)
    expect(noseGear?.position?.[1]).toBeGreaterThan(0)
  })

  test('assesses alternative required parts and auto-completes stronger family structures', () => {
    const pumpAssessment = assessPartBlueprint({
      parts: [
        { kind: 'skid_base' },
        { kind: 'rounded_machine_body' },
        { kind: 'volute_casing' },
        { kind: 'inlet_port' },
        { kind: 'outlet_port' },
        { kind: 'flange_ring' },
      ],
    })
    expect(pumpAssessment.family).toBe('pump')
    expect(pumpAssessment.missing).not.toContain('ribbed_motor_body')
    expect(pumpAssessment.missingDetails).toContain('impeller_blades')

    const fan = composePartPrimitives({
      name: 'Auto fan',
      parts: [{ kind: 'protective_grill' }],
    })
    expect(fan.some((shape) => shape.name?.includes('circular base'))).toBe(true)
    expect(fan.some((shape) => shape.name?.includes('vertical pole'))).toBe(true)
    expect(fan.some((shape) => shape.name?.includes('bracket crossbar'))).toBe(true)
    expect(fan.some((shape) => shape.name?.includes('motor housing'))).toBe(true)
    expect(fan.filter((shape) => Boolean(shape.name?.match(/ blade \d+$/)))).toHaveLength(3)
  })

  test('controls protective grill complexity with detail levels', () => {
    const low = composePartPrimitives({
      name: 'Low detail grill',
      autoComplete: false,
      parts: [{ kind: 'protective_grill', detailLevel: 'low' }],
    })
    const medium = composePartPrimitives({
      name: 'Medium detail grill',
      autoComplete: false,
      parts: [{ kind: 'protective_grill', detailLevel: 'medium' }],
    })
    const high = composePartPrimitives({
      name: 'High detail grill',
      autoComplete: false,
      parts: [{ kind: 'protective_grill', detailLevel: 'high' }],
    })

    expect(low.length).toBeLessThan(medium.length)
    expect(medium.length).toBeLessThan(high.length)
    expect(low.filter((shape) => shape.name?.includes('grill front ring'))).toHaveLength(3)
    expect(low.filter((shape) => shape.name?.includes('grill spoke'))).toHaveLength(12)
    expect(low.filter((shape) => shape.name?.includes('grill side rib'))).toHaveLength(6)
    expect(high.filter((shape) => shape.name?.includes('grill spoke'))).toHaveLength(24)
  })

  test('applies detail levels to reusable industrial detail parts', () => {
    const lowVent = composePartPrimitives({
      name: 'Low detail vent',
      autoComplete: false,
      parts: [{ kind: 'vent_slats', detailLevel: 'low' }],
    })
    const highVent = composePartPrimitives({
      name: 'High detail vent',
      autoComplete: false,
      parts: [{ kind: 'vent_slats', detailLevel: 'high' }],
    })
    const lowFlange = composePartPrimitives({
      name: 'Low detail flange',
      autoComplete: false,
      parts: [{ kind: 'flange_ring', detailLevel: 'low' }],
    })
    const highFlange = composePartPrimitives({
      name: 'High detail flange',
      autoComplete: false,
      parts: [{ kind: 'flange_ring', detailLevel: 'high' }],
    })
    const lowLadder = composePartPrimitives({
      name: 'Low detail ladder',
      autoComplete: false,
      parts: [{ kind: 'platform_ladder', detailLevel: 'low', height: 1.4 }],
    })
    const highLadder = composePartPrimitives({
      name: 'High detail ladder',
      autoComplete: false,
      parts: [{ kind: 'platform_ladder', detailLevel: 'high', height: 1.4 }],
    })

    expect(lowVent.filter((shape) => shape.name?.includes('vent slat'))).toHaveLength(4)
    expect(highVent.filter((shape) => shape.name?.includes('vent slat'))).toHaveLength(10)
    expect(lowFlange.filter((shape) => shape.name?.includes('flange bolt'))).toHaveLength(4)
    expect(highFlange.filter((shape) => shape.name?.includes('flange bolt'))).toHaveLength(10)
    expect(lowLadder.filter((shape) => shape.name?.includes('ladder rung'))).toHaveLength(5)
    expect(highLadder.filter((shape) => shape.name?.includes('ladder rung'))).toHaveLength(10)
  })

  test('scores visual details and can enhance detailed blueprints', () => {
    const plainAssessment = assessPartVisualDetails({
      parts: [
        { kind: 'skid_base' },
        { kind: 'ribbed_motor_body' },
        { kind: 'volute_casing' },
        { kind: 'inlet_port' },
        { kind: 'outlet_port' },
        { kind: 'flange_ring' },
      ],
    })
    expect(plainAssessment.family).toBe('pump')
    expect(plainAssessment.score).toBeLessThan(1)
    expect(plainAssessment.missingDetails).toContain('nameplate')

    const detailedPump = composePartPrimitives({
      name: 'Detailed realistic pump',
      parts: [{ kind: 'volute_casing' }],
    })
    expect(detailedPump.some((shape) => shape.name?.includes('impeller vane'))).toBe(true)
    expect(detailedPump.some((shape) => shape.name?.includes('nameplate'))).toBe(true)
    expect(detailedPump.some((shape) => shape.name?.includes('warning label'))).toBe(true)

    const explicitlyPlain = composePartPrimitives({
      name: 'Detailed pump but no auto visual details',
      enhanceVisualDetails: false,
      parts: [{ kind: 'volute_casing' }],
    })
    expect(explicitlyPlain.some((shape) => shape.name?.includes('nameplate'))).toBe(false)
  })

  test('composes stage 5 desk, electrical cabinet, process pipe, and cable tray parts', () => {
    const shapes = composePartPrimitives({
      name: 'Factory office and utilities',
      autoComplete: false,
      parts: [
        { kind: 'desk_top', length: 1.2, width: 0.6, height: 0.05 },
        { kind: 'leg_set', length: 1.2, width: 0.6, height: 0.7 },
        { kind: 'drawer_stack', count: 3 },
        { kind: 'electrical_cabinet', position: [1.1, 0.5, 0], slatCount: 4 },
        { kind: 'pipe_run', position: [2, 0.55, 0], axis: 'x', length: 1, radius: 0.05 },
        { kind: 'pipe_elbow', position: [2.6, 0.55, 0], radius: 0.05 },
        { kind: 'cable_tray', position: [3.4, 0.8, 0], length: 1, slatCount: 5 },
      ],
    })

    expect(shapes.some((shape) => shape.name?.includes('desk top'))).toBe(true)
    expect(shapes.filter((shape) => shape.name?.includes('desk leg'))).toHaveLength(4)
    expect(shapes.filter((shape) => shape.name?.includes('drawer front'))).toHaveLength(3)
    expect(shapes.some((shape) => shape.name?.includes('electrical cabinet body'))).toBe(true)
    expect(
      shapes.filter((shape) => shape.name?.includes('electrical cabinet vent slat')),
    ).toHaveLength(4)
    expect(
      shapes.some((shape) => shape.kind === 'hollow-cylinder' && shape.name?.includes('pipe run')),
    ).toBe(true)
    expect(
      shapes.some((shape) => shape.kind === 'sweep' && shape.name?.includes('pipe elbow')),
    ).toBe(true)
    expect(shapes.filter((shape) => shape.name?.includes('cable tray rung'))).toHaveLength(5)
  })

  test('auto-completes and scores stage 5 part families', () => {
    const desk = composePartPrimitives({
      name: 'Writing desk',
      parts: [{ kind: 'desk_top' }],
    })
    expect(desk.some((shape) => shape.name?.includes('desk top'))).toBe(true)
    expect(desk.filter((shape) => shape.name?.includes('desk leg'))).toHaveLength(4)

    const electricalAssessment = assessPartVisualDetails({
      parts: [{ kind: 'electrical_cabinet' }],
    })
    expect(electricalAssessment.family).toBe('electrical')
    expect(electricalAssessment.missingDetails).toContain('cable_tray')

    const detailedPipe = composePartPrimitives({
      name: 'Detailed process pipe',
      parts: [{ kind: 'pipe_run' }],
    })
    expect(detailedPipe.some((shape) => shape.name?.includes('pipe elbow'))).toBe(true)
    expect(detailedPipe.some((shape) => shape.name?.includes('flange ring'))).toBe(true)
  })

  test('keeps registry family plans isolated from legacy cross-family auto completion', () => {
    const tank = composePartPrimitives({
      name: 'Detailed storage tank with inlet outlet and access platform',
      family: 'tank',
      registryPartPlan: true,
      autoComplete: true,
      enhanceVisualDetails: true,
      parts: [
        { kind: 'cylindrical_tank', semanticRole: 'vessel_shell', height: 3, radius: 0.6 },
        { kind: 'inlet_port', semanticRole: 'inlet_port' },
        { kind: 'outlet_port', semanticRole: 'outlet_port' },
        { kind: 'platform_ladder', semanticRole: 'access_platform' },
      ],
    })

    expect(tank.some((shape) => shape.sourcePartKind === 'cylindrical_tank')).toBe(true)
    expect(tank.some((shape) => shape.sourcePartKind === 'platform_ladder')).toBe(true)
    expect(tank.some((shape) => shape.sourcePartKind === 'volute_casing')).toBe(false)
    expect(tank.some((shape) => shape.sourcePartKind === 'impeller_blades')).toBe(false)
    expect(tank.some((shape) => shape.sourcePartKind === 'ribbed_motor_body')).toBe(false)

    const machineTool = composePartPrimitives({
      name: 'Boeing style CNC machining center enclosure',
      family: 'machine_tool',
      registryPartPlan: true,
      autoComplete: true,
      enhanceVisualDetails: true,
      parts: [
        { kind: 'generic_base', semanticRole: 'machine_base', length: 2.8, width: 1.1 },
        { kind: 'generic_body', semanticRole: 'machine_enclosure', length: 2.8, width: 1.1 },
        { kind: 'generic_panel', semanticRole: 'spindle_head' },
        { kind: 'control_box', semanticRole: 'control_panel' },
      ],
    })

    const sourceKinds = new Set(machineTool.map((shape) => shape.sourcePartKind))
    expect(sourceKinds.has('generic_base')).toBe(true)
    expect(sourceKinds.has('generic_body')).toBe(true)
    expect(sourceKinds.has('aircraft_fuselage')).toBe(false)
    expect(sourceKinds.has('aircraft_wing')).toBe(false)
    expect(sourceKinds.has('aircraft_engine')).toBe(false)
    expect(sourceKinds.has('aircraft_landing_gear')).toBe(false)
  })
})
