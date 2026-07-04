import { describe, expect, test } from 'bun:test'
import {
  getPartCapabilityMetadata,
  normalizeAircraftPartPlan,
  normalizeCompressorPartPlan,
  normalizeConveyorPartPlan,
  normalizeDeskPartPlan,
  normalizeElectricalPartPlan,
  normalizeFanPartPlan,
  normalizeGenericPartPlan,
  normalizeHeatExchangerPartPlan,
  normalizeKioskPartPlan,
  normalizeMachineToolPartPlan,
  normalizePartPlanForFamily,
  normalizePipeSystemPartPlan,
  normalizePumpPartPlan,
  normalizeReactorPartPlan,
  normalizeTankPartPlan,
  normalizeVehiclePartPlan,
  partCapabilitySummary,
} from './part-registry'

describe('part registry', () => {
  test('exposes LLM-safe part parameters', () => {
    const summary = partCapabilitySummary('vehicle')

    expect(summary).toContain('vehicle.body_shell')
    expect(summary).toContain('wheel_set')
    expect(summary).toContain('radius:number[0.15,0.8]')
    expect(summary).toContain('editable(dimensions=length|width|height')
    expect(summary).toContain('materials=primaryColor')
  })

  test('classifies reusable part parameters for profile packs and LLM edits', () => {
    const metadata = getPartCapabilityMetadata('pump')
    const motor = metadata.find((part) => part.kind === 'ribbed_motor_body')
    const flange = metadata.find((part) => part.kind === 'flange_ring')

    expect(motor).toEqual(
      expect.objectContaining({
        id: 'pump.ribbed_motor_body',
        family: 'pump',
        semanticRole: 'drive_motor',
        dimensionProperties: expect.arrayContaining(['length', 'radius']),
        quantityProperties: expect.arrayContaining(['slatCount']),
        materialProperties: expect.arrayContaining(['primaryColor']),
      }),
    )
    expect(flange).toEqual(
      expect.objectContaining({
        kind: 'flange_ring',
        quantityProperties: expect.arrayContaining(['boltCount']),
        dimensionProperties: expect.arrayContaining(['radius']),
        detailProperties: expect.arrayContaining(['detailLevel']),
      }),
    )
  })

  test('exposes independent fan blade arrays for editable fan profiles', () => {
    const metadata = getPartCapabilityMetadata('fan')
    const blade = metadata.find((part) => part.kind === 'fan_blade')
    const grill = metadata.find((part) => part.kind === 'protective_grill')

    expect(blade).toEqual(
      expect.objectContaining({
        id: 'fan.fan_blade',
        semanticRole: 'fan_blade',
        quantityProperties: expect.arrayContaining(['count']),
        dimensionProperties: expect.arrayContaining(['length', 'width', 'thickness']),
        materialProperties: expect.arrayContaining(['primaryColor']),
      }),
    )
    expect(grill).toEqual(
      expect.objectContaining({
        id: 'fan.protective_grill',
        semanticRole: 'protective_grill',
        detailProperties: expect.arrayContaining(['detailLevel']),
      }),
    )

    const plan = normalizeFanPartPlan({
      parts: [
        { id: 'blades', kind: 'fan_blade', count: 6, primaryColor: '#ef4444' },
        { id: 'grill', kind: 'protective_grill', detailLevel: 'low' },
      ],
    })
    expect(plan.parts.some((part) => part.kind === 'fan_blade' && part.count === 6)).toBe(true)
    expect(plan.parts.find((part) => part.kind === 'protective_grill')).toEqual(
      expect.objectContaining({ detailLevel: 'low', ringCount: 3, spokeCount: 12 }),
    )
    expect(
      normalizePartPlanForFamily('fan', {
        parts: [{ id: 'grill', kind: 'protective_grill', detailLevel: 'low' }],
      })?.parts.find((part) => part.kind === 'protective_grill'),
    ).toEqual(expect.objectContaining({ ringCount: 3, spokeCount: 12 }))
  })

  test('preserves repeated industrial parts when explicit ids distinguish instances', () => {
    const plan = normalizeTankPartPlan({
      parts: [
        { id: 'riding-ring-tail', kind: 'flange_ring', semanticRole: 'riding_ring' },
        { id: 'riding-ring-head', kind: 'flange_ring', semanticRole: 'riding_ring' },
        { id: 'girth-gear', kind: 'flange_ring', semanticRole: 'girth_gear' },
        { id: 'support-roller-tail', kind: 'bearing_block', semanticRole: 'support_roller' },
        { id: 'support-roller-head', kind: 'bearing_block', semanticRole: 'support_roller' },
      ],
    })

    expect(plan.parts.filter((part) => part.kind === 'flange_ring')).toHaveLength(3)
    expect(plan.parts.filter((part) => part.kind === 'bearing_block')).toHaveLength(2)
    expect(plan.parts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'girth-gear', semanticRole: 'girth_gear' }),
        expect.objectContaining({ id: 'support-roller-head', semanticRole: 'support_roller' }),
      ]),
    )
  })

  test('exposes reusable mobile platform parts for industrial profile packs', () => {
    const metadata = getPartCapabilityMetadata('generic')
    const chassis = metadata.find((part) => part.kind === 'mobile_platform_chassis')
    const lidar = metadata.find((part) => part.kind === 'lidar_sensor')
    const eStop = metadata.find((part) => part.kind === 'emergency_stop_button')
    const lightStrip = metadata.find((part) => part.kind === 'status_light_strip')
    const operatorPanel = metadata.find((part) => part.kind === 'operator_panel')
    const guardFence = metadata.find((part) => part.kind === 'guard_fence')
    const palletTable = metadata.find((part) => part.kind === 'pallet_table')
    const bearingBlock = metadata.find((part) => part.kind === 'bearing_block')
    const couplingGuard = metadata.find((part) => part.kind === 'coupling_guard')
    const motorGearbox = metadata.find((part) => part.kind === 'motor_gearbox_unit')
    const pipeManifold = metadata.find((part) => part.kind === 'pipe_manifold')
    const hopperBody = metadata.find((part) => part.kind === 'hopper_body')
    const servicePlatform = metadata.find((part) => part.kind === 'service_platform')
    const hemisphere = metadata.find((part) => part.kind === 'hemisphere')

    expect(chassis).toEqual(
      expect.objectContaining({
        id: 'generic.mobile_platform_chassis',
        semanticRole: 'vehicle_body',
        dimensionProperties: expect.arrayContaining(['length', 'width', 'height']),
        materialProperties: expect.arrayContaining(['primaryColor', 'secondaryColor']),
      }),
    )
    expect(lidar).toEqual(
      expect.objectContaining({
        semanticRole: 'navigation_sensor',
        dimensionProperties: expect.arrayContaining(['radius', 'height']),
        placementProperties: expect.arrayContaining(['axis']),
      }),
    )
    expect(eStop).toEqual(
      expect.objectContaining({
        semanticRole: 'emergency_stop_button',
        materialProperties: expect.arrayContaining(['color']),
      }),
    )
    expect(lightStrip).toEqual(
      expect.objectContaining({
        semanticRole: 'status_light_strip',
        placementProperties: expect.arrayContaining(['side']),
      }),
    )
    expect(operatorPanel).toEqual(
      expect.objectContaining({
        semanticRole: 'control_panel',
        materialProperties: expect.arrayContaining(['primaryColor', 'accentColor']),
      }),
    )
    expect(guardFence).toEqual(
      expect.objectContaining({
        semanticRole: 'safety_barrier',
        quantityProperties: expect.arrayContaining(['count']),
      }),
    )
    expect(palletTable).toEqual(
      expect.objectContaining({
        semanticRole: 'pallet_table',
        dimensionProperties: expect.arrayContaining(['length', 'width', 'height']),
      }),
    )
    expect(bearingBlock).toEqual(
      expect.objectContaining({
        semanticRole: 'bearing_block',
        dimensionProperties: expect.arrayContaining(['length', 'width', 'height', 'radius']),
      }),
    )
    expect(couplingGuard).toEqual(
      expect.objectContaining({
        semanticRole: 'coupling_guard',
        dimensionProperties: expect.arrayContaining(['length', 'radius', 'thickness']),
      }),
    )
    expect(motorGearbox).toEqual(
      expect.objectContaining({
        semanticRole: 'drive_unit',
        materialProperties: expect.arrayContaining(['primaryColor', 'secondaryColor']),
      }),
    )
    expect(pipeManifold).toEqual(
      expect.objectContaining({
        semanticRole: 'pipe_manifold',
        quantityProperties: expect.arrayContaining(['count']),
      }),
    )
    expect(hopperBody).toEqual(
      expect.objectContaining({
        semanticRole: 'hopper_body',
        dimensionProperties: expect.arrayContaining(['length', 'width', 'height']),
      }),
    )
    expect(servicePlatform).toEqual(
      expect.objectContaining({
        semanticRole: 'service_platform',
        dimensionProperties: expect.arrayContaining(['length', 'width', 'height']),
        shapeProperties: expect.arrayContaining(['overallHeight']),
        detailProperties: expect.arrayContaining(['detailLevel']),
      }),
    )
    expect(hemisphere).toEqual(
      expect.objectContaining({
        id: 'generic.hemisphere',
        semanticRole: 'hemisphere',
        dimensionProperties: expect.arrayContaining(['radius', 'diameter', 'height']),
        quantityProperties: expect.arrayContaining(['widthSegments', 'heightSegments']),
      }),
    )
  })

  test('exposes reusable process-vessel detail parts for industry packs', () => {
    const metadata = getPartCapabilityMetadata('generic')
    const details = new Map(metadata.map((part) => [part.kind, part]))

    expect(details.get('manway_lid')).toEqual(
      expect.objectContaining({
        semanticRole: 'manway_lid',
        dimensionProperties: expect.arrayContaining(['radius', 'thickness']),
        quantityProperties: expect.arrayContaining(['boltCount']),
      }),
    )
    expect(details.get('sanitary_nozzle')).toEqual(
      expect.objectContaining({
        semanticRole: 'sanitary_nozzle',
        placementProperties: expect.arrayContaining(['axis']),
      }),
    )
    expect(details.get('flanged_nozzle')).toEqual(
      expect.objectContaining({
        semanticRole: 'flanged_nozzle',
        dimensionProperties: expect.arrayContaining(['radius', 'length']),
        shapeProperties: expect.arrayContaining(['flangeRadius', 'flangeThickness']),
        quantityProperties: expect.arrayContaining(['boltCount']),
        placementProperties: expect.arrayContaining(['axis', 'side']),
      }),
    )
    expect(details.get('inspection_hatch')).toEqual(
      expect.objectContaining({
        semanticRole: 'inspection_hatch',
        dimensionProperties: expect.arrayContaining(['radius', 'thickness']),
        placementProperties: expect.arrayContaining(['axis', 'side']),
      }),
    )
    expect(details.get('jacket_shell')).toEqual(
      expect.objectContaining({
        semanticRole: 'jacket_shell',
        dimensionProperties: expect.arrayContaining(['radius', 'height', 'thickness']),
      }),
    )
    expect(details.get('sight_glass')).toEqual(
      expect.objectContaining({
        semanticRole: 'sight_glass',
        placementProperties: expect.arrayContaining(['side']),
        materialProperties: expect.arrayContaining(['color']),
      }),
    )
    expect(details.get('sample_valve')).toEqual(
      expect.objectContaining({
        semanticRole: 'sample_valve',
        placementProperties: expect.arrayContaining(['side']),
      }),
    )
    expect(details.get('instrument_port')).toEqual(
      expect.objectContaining({
        semanticRole: 'instrument_port',
        placementProperties: expect.arrayContaining(['axis']),
      }),
    )
    expect(details.get('stainless_highlight_panel')).toEqual(
      expect.objectContaining({
        semanticRole: 'stainless_highlight_panel',
        materialProperties: expect.arrayContaining(['color']),
      }),
    )
    expect(details.get('conical_hopper')).toEqual(
      expect.objectContaining({
        semanticRole: 'conical_hopper',
        dimensionProperties: expect.arrayContaining(['radiusTop', 'radiusBottom', 'height']),
        shapeProperties: expect.arrayContaining(['outletRadius']),
        quantityProperties: expect.arrayContaining(['radialSegments']),
      }),
    )
    expect(details.get('platform_with_ladder')).toEqual(
      expect.objectContaining({
        semanticRole: 'service_platform',
        dimensionProperties: expect.arrayContaining(['length', 'width', 'height']),
        quantityProperties: expect.arrayContaining(['rungCount']),
      }),
    )
    expect(details.get('helical_stair')).toEqual(
      expect.objectContaining({
        semanticRole: 'external_spiral_stair',
        dimensionProperties: expect.arrayContaining(['height', 'innerRadius', 'outerRadius']),
        quantityProperties: expect.arrayContaining(['stepCount', 'ringCount']),
        placementProperties: expect.arrayContaining(['startAngle']),
      }),
    )
    expect(details.get('helical_ladder')).toEqual(
      expect.objectContaining({
        semanticRole: 'external_spiral_ladder',
        dimensionProperties: expect.arrayContaining(['height', 'innerRadius', 'outerRadius']),
        quantityProperties: expect.arrayContaining(['stepCount', 'ringCount']),
        placementProperties: expect.arrayContaining(['startAngle']),
      }),
    )
  })

  test('normalizes vehicle part aliases and clamps unsafe parameters', () => {
    const plan = normalizeVehiclePartPlan({
      primaryColor: '#cc0000',
      parts: [
        { kind: 'car body', params: { length: 4.8, width: 1.9, height: 1.4 } },
        { kind: 'huge tire', params: { count: 5, radius: 2.4 } },
      ],
    })

    expect(plan.parts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'body_shell',
          semanticRole: 'vehicle_body',
          length: 4.8,
          primaryColor: '#cc0000',
        }),
        expect.objectContaining({
          kind: 'wheel_set',
          semanticRole: 'vehicle_tire',
          count: 4,
          radius: 0.8,
        }),
        expect.objectContaining({ kind: 'window_strip' }),
        expect.objectContaining({ kind: 'light_pair' }),
      ]),
    )
    expect(plan.warnings).toEqual(
      expect.arrayContaining([
        'wheel_set.count normalized from 5 to 4.',
        'wheel_set.radius clamped from 2.4 to 0.8.',
      ]),
    )
  })

  test('normalizes desk parts and exposes drawer parameters', () => {
    const summary = partCapabilitySummary('desk')
    const plan = normalizeDeskPartPlan({
      name: 'office desk with drawers',
      length: 1.5,
      width: 0.7,
      height: 0.75,
      parts: [{ kind: 'drawer', params: { count: 9 } }],
    })

    expect(summary).toContain('desk.drawer_stack')
    expect(summary).toContain('count:integer[1,6]')
    expect(plan.parts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'desk_top', length: 1.5, width: 0.7 }),
        expect.objectContaining({ kind: 'leg_set', length: 1.35, width: 0.574 }),
        expect.objectContaining({ kind: 'drawer_stack', count: 6 }),
      ]),
    )
    expect(plan.warnings).toEqual(
      expect.arrayContaining(['drawer_stack.count clamped from 9 to 6.']),
    )
  })

  test('normalizes aircraft aliases into a complete adjustable part plan', () => {
    const summary = partCapabilitySummary('aircraft')
    const plan = normalizeAircraftPartPlan({
      name: 'Boeing airliner',
      length: 10,
      primaryColor: '#ffffff',
      parts: [
        { kind: 'fuselage', params: { count: 80, noseRoundness: 2 } },
        { kind: 'jet engine', params: { count: 5, radius: 1 } },
        { kind: 'wheel_set', semanticRole: 'aircraft_landing_gear_nose', params: { radius: 0.5 } },
      ],
    })

    expect(summary).toContain('aircraft.aircraft_fuselage')
    expect(summary).toContain('aircraft.aircraft_engine')
    expect(plan.parts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'aircraft_fuselage',
          semanticRole: 'aircraft_fuselage',
          length: 10,
          primaryColor: '#ffffff',
          count: 40,
          noseRoundness: 1,
        }),
        expect.objectContaining({
          kind: 'aircraft_engine',
          semanticRole: 'engine_nacelle',
          count: 4,
          radius: 0.36,
        }),
        expect.objectContaining({
          kind: 'aircraft_landing_gear',
          semanticRole: 'landing_gear_wheel',
          radius: 0.2,
        }),
        expect.objectContaining({ kind: 'aircraft_wing' }),
        expect.objectContaining({ kind: 'aircraft_vertical_stabilizer' }),
        expect.objectContaining({ kind: 'aircraft_horizontal_stabilizer' }),
      ]),
    )
    expect(plan.warnings).toEqual(
      expect.arrayContaining([
        'aircraft_fuselage.count clamped from 80 to 40.',
        'aircraft_fuselage.noseRoundness clamped from 2 to 1.',
        'aircraft_engine.count clamped from 5 to 4.',
        'aircraft_engine.radius clamped from 1 to 0.36.',
        'aircraft_landing_gear.radius clamped from 0.5 to 0.2.',
      ]),
    )
  })

  test('builds generic fallback plans for unknown equipment', () => {
    const summary = partCapabilitySummary('generic')
    const plan = normalizeGenericPartPlan({
      name: 'futuristic coffee machine',
      length: 1.2,
      width: 0.6,
      height: 1,
      parts: [{ kind: 'control panel', params: { length: 8 } }],
    })

    expect(summary).toContain('generic.generic_body')
    expect(summary).toContain('generic.generic_spout')
    expect(plan.parts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'generic_body', semanticRole: 'main_body', length: 1.2 }),
        expect.objectContaining({
          kind: 'generic_base',
          semanticRole: 'support_base',
          length: 1.296,
        }),
        expect.objectContaining({
          kind: 'generic_control_panel',
          semanticRole: 'control_detail',
          length: 4,
        }),
        expect.objectContaining({ kind: 'generic_spout', semanticRole: 'spout' }),
        expect.objectContaining({ kind: 'generic_base', semanticRole: 'cup_platform' }),
      ]),
    )
    expect(plan.warnings).toEqual(
      expect.arrayContaining(['generic_control_panel.length clamped from 8 to 4.']),
    )
  })

  test('normalizes kiosk aliases and preserves explicit part params', () => {
    const summary = partCapabilitySummary('kiosk')
    const plan = normalizeKioskPartPlan({
      name: 'ticket booth',
      length: 2,
      width: 1.4,
      height: 2.4,
      primaryColor: '#e5e7eb',
      parts: [
        { kind: 'service window', params: { length: 0.9 } },
        { kind: 'sign', params: { length: 0.7, height: 0.2 } },
      ],
    })

    expect(summary).toContain('kiosk.kiosk_body')
    expect(summary).toContain('kiosk.kiosk_opening')
    expect(plan.parts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'kiosk_body',
          semanticRole: 'kiosk_body',
          length: 2,
          width: 1.4,
          height: 1.8719999999999999,
          primaryColor: '#e5e7eb',
        }),
        expect.objectContaining({ kind: 'kiosk_roof', semanticRole: 'roof' }),
        expect.objectContaining({ kind: 'kiosk_opening', semanticRole: 'opening', length: 0.9 }),
        expect.objectContaining({
          kind: 'kiosk_sign',
          semanticRole: 'sign_panel',
          length: 0.7,
          height: 0.2,
        }),
        expect.objectContaining({ kind: 'kiosk_awning', semanticRole: 'awning' }),
      ]),
    )
  })

  test('normalizes industrial pump parts with adjustable dimensions', () => {
    const summary = partCapabilitySummary('pump')
    const plan = normalizePumpPartPlan({
      name: 'centrifugal pump',
      length: 1.4,
      width: 0.6,
      height: 0.7,
      primaryColor: '#64748b',
      motorLength: 0.62,
      inletDiameter: 0.18,
      outletDiameter: 0.14,
      flangeBoltCount: 10,
      ribCount: 12,
      parts: [{ kind: 'pump casing', params: { radius: 5 } }, { kind: 'flange' }],
    })

    expect(summary).toContain('pump.volute_casing')
    expect(summary).toContain('pump.inlet_port')
    expect(plan.parts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'skid_base', length: 1.4, width: 0.6 }),
        expect.objectContaining({
          kind: 'ribbed_motor_body',
          semanticRole: 'drive_motor',
          length: 0.62,
          radius: 0.168,
          slatCount: 12,
        }),
        expect.objectContaining({
          kind: 'volute_casing',
          semanticRole: 'volute_casing',
          radius: 1.5,
          primaryColor: '#64748b',
        }),
        expect.objectContaining({ kind: 'inlet_port', semanticRole: 'inlet_port', radius: 0.09 }),
        expect.objectContaining({
          kind: 'outlet_port',
          semanticRole: 'outlet_port',
          radius: 0.07,
        }),
        expect.objectContaining({ kind: 'flange_ring', boltCount: 10 }),
      ]),
    )
    expect(plan.warnings).toEqual(
      expect.arrayContaining(['volute_casing.radius clamped from 5 to 1.5.']),
    )
  })

  test('normalizes conveyor, electrical, and pipe industrial families', () => {
    const conveyor = normalizeConveyorPartPlan({
      name: 'belt conveyor',
      length: 4,
      width: 0.8,
      height: 0.9,
      beltWidth: 0.64,
      rollerCount: 14,
      rollerRadius: 0.045,
      legCount: 6,
    })
    const electrical = normalizeElectricalPartPlan({
      name: 'control cabinet',
      length: 0.9,
      width: 0.35,
      height: 1.8,
      primaryColor: '#e5e7eb',
      doorCount: 2,
      ventRows: 8,
      cableTrayRungCount: 11,
      parts: [{ kind: 'cable tray', params: { length: 2 } }],
    })
    const pipe = normalizePipeSystemPartPlan({
      name: 'process piping',
      length: 3,
      pipeDiameter: 0.16,
      bendRadius: 0.42,
      flangeBoltCount: 12,
      valveStyle: 'ball',
      parts: [{ kind: 'pipe elbow' }, { kind: 'flange' }, { kind: 'valve' }],
    })
    const flange = pipe.parts.find((part) => part.kind === 'flange_ring')

    expect(conveyor.parts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'conveyor_frame', length: 4, width: 0.8, height: 0.9 }),
        expect.objectContaining({ kind: 'conveyor_frame', legCount: 6 }),
        expect.objectContaining({ kind: 'roller_array', length: 3.76, width: 0.64, count: 14 }),
        expect.objectContaining({ kind: 'roller_array', radius: 0.045 }),
        expect.objectContaining({ kind: 'belt_surface', length: 3.92, width: 0.64 }),
      ]),
    )
    expect(electrical.parts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'electrical_cabinet',
          length: 0.9,
          width: 0.35,
          height: 1.8,
          doorCount: 2,
          slatCount: 8,
          primaryColor: '#e5e7eb',
        }),
        expect.objectContaining({ kind: 'cable_tray', length: 2, slatCount: 11 }),
      ]),
    )
    expect(pipe.parts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'pipe_run', length: 3, radius: 0.08 }),
        expect.objectContaining({ kind: 'pipe_elbow', radius: 0.08, bendRadius: 0.42 }),
        expect.objectContaining({ kind: 'flange_ring', boltCount: 12 }),
        expect.objectContaining({ kind: 'valve_body', radius: 0.08, valveStyle: 'ball' }),
      ]),
    )
    expect(flange?.radius).toBeCloseTo(0.124)
  })

  test('normalizes process equipment and machine tool families with editable part attributes', () => {
    const summary = partCapabilitySummary()
    const tank = normalizeTankPartPlan({
      name: 'vertical storage tank with access platform',
      height: 3,
      diameter: 1.2,
      portDiameter: 0.16,
      parts: [{ kind: 'platform' }, { kind: 'outlet' }],
    })
    const reactor = normalizeReactorPartPlan({
      name: 'stirred reactor',
      vesselHeight: 2,
      diameter: 1.1,
      nozzleDiameter: 0.16,
    })
    const compressor = normalizeCompressorPartPlan({
      name: 'skid air compressor',
      length: 2,
      width: 0.8,
      height: 0.8,
      motorLength: 0.7,
      portDiameter: 0.18,
      parts: [{ kind: 'control panel' }],
    })
    const exchanger = normalizeHeatExchangerPartPlan({
      name: 'shell and tube heat exchanger with support',
      length: 2.4,
      diameter: 0.5,
      parts: [{ kind: 'support' }],
    })
    const machine = normalizeMachineToolPartPlan({
      name: 'cnc machining center',
      length: 2.8,
      width: 1.1,
      height: 1.7,
      parts: [
        {
          id: 'viewing_panel',
          kind: 'generic_panel',
          semanticRole: 'viewing_window',
          centeredOn: 'enclosure',
          side: 'front',
          params: { length: 0.9, height: 0.7, thickness: 0.01, color: '#88CCEE' },
        },
        {
          id: 'work_table',
          kind: 'generic_panel',
          semanticRole: 'work_table',
          centeredOn: 'enclosure',
          params: { length: 1, width: 0.7, thickness: 0.06 },
        },
        {
          id: 'display',
          kind: 'generic_display',
          semanticRole: 'display_screen',
          centeredOn: 'control_box',
          side: 'front',
          params: { length: 0.35, height: 0.28 },
        },
        { id: 'vents_left', kind: 'vent_slats', semanticRole: 'vent_panel', side: 'left' },
        { id: 'warning_front', kind: 'warning_label', semanticRole: 'warning_label' },
        { id: 'nameplate_front', kind: 'nameplate', semanticRole: 'nameplate' },
      ],
    })

    expect(summary).toContain('tank.cylindrical_tank')
    expect(summary).toContain('reactor.agitator_tank')
    expect(summary).toContain('compressor.rounded_machine_body')
    expect(summary).toContain('heat_exchanger.heat_exchanger')
    expect(summary).toContain('machine_tool.generic_body')
    expect(tank.parts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'cylindrical_tank', length: 3, radius: 0.6, axis: 'y' }),
        expect.objectContaining({ kind: 'outlet_port', radius: 0.08 }),
        expect.objectContaining({ kind: 'platform_ladder' }),
      ]),
    )
    expect(reactor.parts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'agitator_tank', height: 2, radius: 0.55 }),
        expect.objectContaining({ kind: 'inlet_port', radius: 0.08 }),
        expect.objectContaining({ kind: 'outlet_port', radius: 0.08 }),
      ]),
    )
    expect(
      normalizeReactorPartPlan({
        name: 'stirred reactor',
        parts: [{ id: 'impeller', kind: 'mixer_blades', count: 3 }],
      }),
    ).toMatchObject({
      warnings: [],
      parts: expect.arrayContaining([
        expect.objectContaining({
          id: 'impeller',
          kind: 'mixer_blades',
          semanticRole: 'reactor_impeller',
          count: 3,
        }),
      ]),
    })
    expect(compressor.parts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'skid_base', semanticRole: 'machine_base' }),
        expect.objectContaining({ kind: 'ribbed_motor_body', length: 0.7 }),
        expect.objectContaining({
          kind: 'rounded_machine_body',
          semanticRole: 'compressor_casing',
        }),
        expect.objectContaining({ kind: 'inlet_port', radius: 0.09 }),
        expect.objectContaining({ kind: 'outlet_port', radius: 0.09 }),
        expect.objectContaining({ kind: 'control_box', semanticRole: 'control_box' }),
      ]),
    )
    expect(exchanger.parts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'heat_exchanger', length: 2.4, radius: 0.25 }),
        expect.objectContaining({ kind: 'skid_base', semanticRole: 'support_base' }),
      ]),
    )
    expect(machine.parts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'generic_base', semanticRole: 'machine_base' }),
        expect.objectContaining({ kind: 'generic_body', semanticRole: 'machine_enclosure' }),
        expect.objectContaining({ kind: 'generic_panel', semanticRole: 'spindle_head' }),
        expect.objectContaining({
          id: 'viewing_panel',
          kind: 'generic_panel',
          semanticRole: 'viewing_window',
          centeredOn: 'enclosure',
          side: 'front',
          length: 0.9,
          height: 0.7,
          thickness: 0.01,
        }),
        expect.objectContaining({
          id: 'work_table',
          kind: 'generic_panel',
          semanticRole: 'work_table',
          centeredOn: 'enclosure',
          length: 1,
          width: 0.7,
          thickness: 0.06,
        }),
        expect.objectContaining({ kind: 'control_box', semanticRole: 'control_panel' }),
        expect.objectContaining({
          id: 'display',
          kind: 'generic_display',
          semanticRole: 'display_screen',
          centeredOn: 'control_box',
          side: 'front',
          length: 0.35,
          height: 0.28,
        }),
        expect.objectContaining({
          id: 'vents_left',
          kind: 'vent_slats',
          semanticRole: 'vent_panel',
        }),
        expect.objectContaining({ id: 'warning_front', kind: 'warning_label' }),
        expect.objectContaining({ id: 'nameplate_front', kind: 'nameplate' }),
      ]),
    )
  })
})
