import { describe, expect, test } from 'bun:test'
import {
  normalizeAircraftPartPlan,
  normalizeCompressorPartPlan,
  normalizeConveyorPartPlan,
  normalizeDeskPartPlan,
  normalizeElectricalPartPlan,
  normalizeGenericPartPlan,
  normalizeHeatExchangerPartPlan,
  normalizeKioskPartPlan,
  normalizeMachineToolPartPlan,
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
          semanticRole: 'viewing_panel',
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
