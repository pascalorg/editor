import { describe, expect, test } from 'bun:test'
import { assessPartBlueprint, assessPartVisualDetails, composePartPrimitives } from './part-compose'

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
    expect(shapes.filter((shape) => shape.name?.includes('blade root'))).toHaveLength(3)
    const frontRings = shapes.filter((shape) => shape.name?.includes('grill front ring'))
    expect(frontRings).toHaveLength(4)
    expect(
      new Set(frontRings.map((shape) => shape.position?.[2]?.toFixed(4))).size,
    ).toBeGreaterThan(1)
    expect(shapes.filter((shape) => shape.name?.includes('grill spoke'))).toHaveLength(18)
    expect(shapes.some((shape) => shape.name?.includes('grill side rib'))).toBe(true)
    expect(shapes.some((shape) => shape.name?.includes('rear outer ring'))).toBe(true)
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
    expect(shapes.filter((shape) => shape.name?.includes('impeller vane'))).toHaveLength(7)
    expect(shapes.some((shape) => shape.name?.includes('inlet port'))).toBe(true)
    expect(shapes.some((shape) => shape.name?.includes('outlet port'))).toBe(true)
    expect(shapes.some((shape) => shape.name?.includes('flange ring'))).toBe(true)
    expect(shapes.filter((shape) => shape.name?.includes('bolt'))).toHaveLength(12)
    expect(shapes.some((shape) => shape.name?.includes('control box'))).toBe(true)
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

    const duplicateWheelsetBicycle = composePartPrimitives({
      name: 'Duplicate wheelset bike',
      parts: [{ kind: 'bicycle_wheels' }, { kind: 'bike_wheelset' }, { kind: 'bicycle_frame' }],
    })
    expect(
      duplicateWheelsetBicycle.filter(
        (shape) => shape.name?.includes('bicycle') && shape.name?.includes('tire'),
      ),
    ).toHaveLength(2)

    const car = composePartPrimitives({
      name: 'Car',
      primaryColor: '#cc0000',
      parts: [{ kind: 'vehicle_body' }],
    })
    const bodyShell = car.find((shape) => shape.name?.includes('vehicle body shell'))
    expect(bodyShell?.material?.properties?.color).toBe('#cc0000')
    expect(bodyShell?.semanticRole).toBe('vehicle_body')
    expect(car.some((shape) => shape.name?.includes('vehicle front deck'))).toBe(true)
    expect(car.some((shape) => shape.name?.includes('vehicle rear deck'))).toBe(true)
    expect(car.filter((shape) => shape.name?.includes('vehicle tire'))).toHaveLength(4)
    expect(car.filter((shape) => shape.semanticRole === 'vehicle_tire')).toHaveLength(4)
    expect(car.some((shape) => shape.name?.includes('windshield'))).toBe(true)
    expect(car.some((shape) => shape.name?.includes('rear window'))).toBe(true)
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

    const sideWindow = car.find((shape) => shape.name?.includes('side window left'))
    expect(sideWindow?.length).toBeGreaterThan((cabin?.length ?? 0) * 0.6)
    expect(sideWindow?.width).toBeGreaterThan((windshield?.length ?? 0) * 0.7)

    expect(car.some((shape) => shape.name?.includes('wheel arch shadow'))).toBe(false)
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
})
