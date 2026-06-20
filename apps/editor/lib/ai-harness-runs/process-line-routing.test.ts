import { describe, expect, test } from 'bun:test'
import {
  routeProcessConnection,
  routeSegmentIntersectsClearanceBox,
  type ProcessRouteObstacle,
  type ProcessRoutePortOverrides,
} from './process-line-routing'
import type { ProcessLinePlan, StationPlacement } from './process-line-types'

function placement(stationId: string, x: number, z: number): StationPlacement {
  return {
    stationId,
    role: stationId,
    label: stationId,
    position: [x, 0, z],
    rotation: [0, 0, 0],
    footprint: { length: 2, width: 1 },
    clearance: { left: 0.4, right: 0.4, front: 0.4, back: 0.4 },
    clearanceBox: {
      minX: x - 1.4,
      maxX: x + 1.4,
      minZ: z - 0.9,
      maxZ: z + 0.9,
    },
  }
}

function cementPlan(): ProcessLinePlan {
  return {
    processId: 'cement_plant_full',
    processLabel: 'Cement plant',
    domain: 'generic',
    layoutStyle: 'linear',
    stations: [
      {
        id: 'preheater_tower',
        label: 'Preheater tower',
        role: 'preheater_tower',
        equipmentHint: 'cement.preheater_tower cyclone preheater tower',
      },
      {
        id: 'coal_mill',
        label: 'Coal mill',
        role: 'coal_mill',
        equipmentHint: 'cement.coal_mill fuel preparation coal mill',
      },
      {
        id: 'rotary_kiln',
        label: 'Rotary kiln',
        role: 'rotary_kiln',
        equipmentHint: 'cement.rotary_kiln with kiln drive unit',
      },
      {
        id: 'kiln_burner',
        label: 'Kiln burner',
        role: 'kiln_burner',
        equipmentHint: 'cement.kiln_burner',
      },
      {
        id: 'whr_boiler',
        label: 'WHR boiler',
        role: 'whr_boiler',
        equipmentHint: 'cement.whr_boiler waste heat recovery boiler',
      },
      {
        id: 'kiln_tail_esp',
        label: 'Kiln tail ESP',
        role: 'kiln_tail_esp',
        equipmentHint: 'cement.esp_dust_collector',
      },
      {
        id: 'process_stack',
        label: 'Process stack',
        role: 'process_stack',
        equipmentHint: 'cement.process_stack',
      },
      {
        id: 'mcc_control',
        label: 'MCC control',
        role: 'mcc_control',
        equipmentHint: 'motor control cabinet',
      },
      {
        id: 'tertiary_air_duct',
        label: 'Tertiary air duct',
        role: 'tertiary_air_duct',
        equipmentHint: 'cement.tertiary_air_duct',
      },
    ],
    connections: [],
  }
}

describe('routeProcessConnection', () => {
  test('keeps an explicit template port id ahead of scored artifact overrides', () => {
    const plan = cementPlan()
    const placements = new Map([
      ['preheater_tower', placement('preheater_tower', 0, 0)],
      ['whr_boiler', placement('whr_boiler', 6, 0)],
    ])
    const portOverrides: ProcessRoutePortOverrides = {
      preheater_tower: [
        {
          stationId: 'preheater_tower',
          portId: 'hot_meal_out',
          medium: 'material',
          point: [99, 0],
          height: 1.1,
          side: 'right',
          profileId: 'cement.preheater_tower',
          source: 'artifact',
        },
      ],
    }

    const route = routeProcessConnection({
      plan,
      connection: {
        fromStationId: 'preheater_tower',
        toStationId: 'whr_boiler',
        medium: 'material',
        visualKind: 'hot_gas_duct',
        fromPortId: 'exhaust_gas_out',
        toPortId: 'hot_gas_in',
      },
      connectionIndex: 0,
      placements,
      stationPlacements: [...placements.values()],
      boundary: { length: 16, width: 8 },
      portOverrides,
    })

    expect(route?.fromPort).toMatchObject({
      portId: 'exhaust_gas_out',
      source: 'profile',
      profileId: 'cement.preheater_tower',
    })
  })

  test('uses exact artifact port markers when they match the template port id', () => {
    const plan = cementPlan()
    const placements = new Map([
      ['preheater_tower', placement('preheater_tower', 0, 0)],
      ['whr_boiler', placement('whr_boiler', 6, 0)],
    ])
    const portOverrides: ProcessRoutePortOverrides = {
      preheater_tower: [
        {
          stationId: 'preheater_tower',
          portId: 'exhaust_gas_out',
          medium: 'material',
          point: [2.5, 1.25],
          height: 7.8,
          side: 'top',
          profileId: 'cement.preheater_tower',
          source: 'artifact',
        },
      ],
    }

    const route = routeProcessConnection({
      plan,
      connection: {
        fromStationId: 'preheater_tower',
        toStationId: 'whr_boiler',
        medium: 'material',
        visualKind: 'hot_gas_duct',
        fromPortId: 'exhaust_gas_out',
        toPortId: 'hot_gas_in',
      },
      connectionIndex: 0,
      placements,
      stationPlacements: [...placements.values()],
      boundary: { length: 16, width: 8 },
      portOverrides,
    })

    expect(route?.fromPort).toMatchObject({
      portId: 'exhaust_gas_out',
      point: [2.5, 1.25],
      source: 'artifact',
    })
  })

  test('exposes tertiary air inlet on the preheater contract', () => {
    const plan = cementPlan()
    const placements = new Map([
      ['tertiary_air_duct', placement('tertiary_air_duct', -5, 0)],
      ['preheater_tower', placement('preheater_tower', 0, 0)],
    ])

    const route = routeProcessConnection({
      plan,
      connection: {
        fromStationId: 'tertiary_air_duct',
        toStationId: 'preheater_tower',
        medium: 'material',
        visualKind: 'hot_gas_duct',
        fromPortId: 'tertiary_air_out',
        toPortId: 'tertiary_air_in',
      },
      connectionIndex: 0,
      placements,
      stationPlacements: [...placements.values()],
      boundary: { length: 16, width: 8 },
    })

    expect(route?.toPort).toMatchObject({
      portId: 'tertiary_air_in',
      source: 'profile',
      profileId: 'cement.preheater_tower',
    })
  })

  test('exposes power inlet on the rotary kiln drive contract', () => {
    const plan = cementPlan()
    const placements = new Map([
      ['mcc_control', placement('mcc_control', -5, 0)],
      ['rotary_kiln', placement('rotary_kiln', 0, 0)],
    ])

    const route = routeProcessConnection({
      plan,
      connection: {
        fromStationId: 'mcc_control',
        toStationId: 'rotary_kiln',
        medium: 'power',
        visualKind: 'cable_tray',
        fromPortId: 'power_out',
        toPortId: 'power_in',
      },
      connectionIndex: 0,
      placements,
      stationPlacements: [...placements.values()],
      boundary: { length: 16, width: 8 },
    })

    expect(route?.toPort).toMatchObject({
      portId: 'power_in',
      source: 'profile',
      profileId: 'cement.rotary_kiln',
    })
  })

  test('adds a terminal stub before entering a side port', () => {
    const plan = cementPlan()
    const placements = new Map([
      ['kiln_tail_esp', placement('kiln_tail_esp', 0, 0)],
      ['process_stack', placement('process_stack', 6, 0)],
    ])
    const portOverrides: ProcessRoutePortOverrides = {
      kiln_tail_esp: [
        {
          stationId: 'kiln_tail_esp',
          portId: 'clean_air_out',
          medium: 'material',
          point: [1, 0],
          height: 1.2,
          side: 'right',
          profileId: 'cement.esp_dust_collector',
          source: 'artifact',
        },
      ],
      process_stack: [
        {
          stationId: 'process_stack',
          portId: 'stack_gas_in',
          medium: 'material',
          point: [5, 0],
          height: 1.15,
          side: 'left',
          profileId: 'cement.process_stack',
          source: 'artifact',
        },
      ],
    }

    const route = routeProcessConnection({
      plan,
      connection: {
        fromStationId: 'kiln_tail_esp',
        toStationId: 'process_stack',
        medium: 'material',
        visualKind: 'air_duct',
        fromPortId: 'clean_air_out',
        toPortId: 'stack_gas_in',
      },
      connectionIndex: 0,
      placements,
      stationPlacements: [...placements.values()],
      boundary: { length: 16, width: 8 },
      portOverrides,
    })

    expect(route?.points[0]).toEqual([1, 0])
    expect(route?.points.at(1)).toEqual([1.55, 0])
    expect(route?.points.at(-2)).toEqual([4.45, 0])
    expect(route?.points.at(-1)).toEqual([5, 0])
  })

  test('uses primitive artifact obstacles when routing around generated equipment', () => {
    const plan = cementPlan()
    const placements = new Map([
      ['preheater_tower', placement('preheater_tower', -5, 0)],
      ['whr_boiler', placement('whr_boiler', 5, 0)],
      ['process_stack', placement('process_stack', 0, 3)],
    ])
    const routeObstacles: ProcessRouteObstacle[] = [
      {
        stationId: 'process_stack',
        source: 'artifact',
        minHeight: 0,
        maxHeight: 8,
        box: { minX: -0.8, maxX: 0.8, minZ: -0.8, maxZ: 0.8 },
      },
    ]

    const route = routeProcessConnection({
      plan,
      connection: {
        fromStationId: 'preheater_tower',
        toStationId: 'whr_boiler',
        medium: 'material',
        visualKind: 'hot_gas_duct',
        fromPortId: 'exhaust_gas_out',
        toPortId: 'hot_gas_in',
      },
      connectionIndex: 0,
      placements,
      stationPlacements: [...placements.values()],
      boundary: { length: 16, width: 8 },
      routeObstacles,
    })

    expect(route?.style).toBe('orthogonal')
    expect(route?.avoidedStationIds).toContain('process_stack')
    expect(route?.segments.some((segment) => segment.start[1] !== 0 || segment.end[1] !== 0)).toBe(
      true,
    )
  })

  test('reroutes a terminal stub when the preferred side exits into a generated obstacle', () => {
    const plan = cementPlan()
    const placements = new Map([
      ['kiln_tail_esp', placement('kiln_tail_esp', 0, 0)],
      ['process_stack', placement('process_stack', 6, 0)],
    ])
    const blockingBox = { minX: 1.2, maxX: 2.2, minZ: -0.5, maxZ: 0.5 }
    const portOverrides: ProcessRoutePortOverrides = {
      kiln_tail_esp: [
        {
          stationId: 'kiln_tail_esp',
          portId: 'clean_air_out',
          medium: 'material',
          point: [1, 0],
          height: 1.2,
          side: 'right',
          profileId: 'cement.esp_dust_collector',
          source: 'artifact',
        },
      ],
      process_stack: [
        {
          stationId: 'process_stack',
          portId: 'stack_gas_in',
          medium: 'material',
          point: [5, 0],
          height: 1.15,
          side: 'left',
          profileId: 'cement.process_stack',
          source: 'artifact',
        },
      ],
    }

    const route = routeProcessConnection({
      plan,
      connection: {
        fromStationId: 'kiln_tail_esp',
        toStationId: 'process_stack',
        medium: 'material',
        visualKind: 'air_duct',
        fromPortId: 'clean_air_out',
        toPortId: 'stack_gas_in',
      },
      connectionIndex: 0,
      placements,
      stationPlacements: [...placements.values()],
      boundary: { length: 16, width: 8 },
      portOverrides,
      routeObstacles: [
        {
          stationId: 'preheater_tower',
          source: 'artifact',
          minHeight: 0,
          maxHeight: 8,
          box: blockingBox,
        },
      ],
    })

    expect(route?.points.at(1)).not.toEqual([1.55, 0])
    expect(
      route?.segments.some((segment) =>
        routeSegmentIntersectsClearanceBox(segment.start, segment.end, blockingBox),
      ),
    ).toBe(false)
  })

  test('projects endpoint ports to the generated equipment surface before entering a stack', () => {
    const plan = cementPlan()
    const placements = new Map([
      ['kiln_tail_esp', placement('kiln_tail_esp', 0, 0)],
      ['process_stack', placement('process_stack', 6, 0)],
    ])
    const stackBox = { minX: 4.1, maxX: 6.4, minZ: -1.1, maxZ: 1.1 }
    const portOverrides: ProcessRoutePortOverrides = {
      kiln_tail_esp: [
        {
          stationId: 'kiln_tail_esp',
          portId: 'clean_air_out',
          medium: 'material',
          point: [1, 0],
          height: 1.2,
          side: 'right',
          profileId: 'cement.esp_dust_collector',
          source: 'artifact',
        },
      ],
      process_stack: [
        {
          stationId: 'process_stack',
          portId: 'stack_gas_in',
          medium: 'material',
          point: [5.2, 0],
          height: 1.15,
          side: 'left',
          profileId: 'cement.process_stack',
          source: 'artifact',
        },
      ],
    }

    const route = routeProcessConnection({
      plan,
      connection: {
        fromStationId: 'kiln_tail_esp',
        toStationId: 'process_stack',
        medium: 'material',
        visualKind: 'air_duct',
        fromPortId: 'clean_air_out',
        toPortId: 'stack_gas_in',
      },
      connectionIndex: 0,
      placements,
      stationPlacements: [...placements.values()],
      boundary: { length: 16, width: 8 },
      portOverrides,
      routeObstacles: [
        {
          stationId: 'process_stack',
          source: 'artifact',
          minHeight: 0,
          maxHeight: 8,
          box: stackBox,
        },
      ],
    })

    expect(route?.toPort?.point).toEqual([3.78, 0])
    expect(route?.points.at(-1)).toEqual([3.78, 0])
    expect(
      route?.segments.some((segment) =>
        routeSegmentIntersectsClearanceBox(segment.start, segment.end, stackBox),
      ),
    ).toBe(false)
  })

  test('does not push an endpoint standoff into a neighboring generated obstacle', () => {
    const plan = cementPlan()
    const placements = new Map([
      ['coal_mill', placement('coal_mill', -5, 0)],
      ['kiln_burner', placement('kiln_burner', 5, 0)],
      ['preheater_tower', placement('preheater_tower', -2, 0)],
    ])
    const portOverrides: ProcessRoutePortOverrides = {
      coal_mill: [
        {
          stationId: 'coal_mill',
          portId: 'pulverized_fuel_out',
          medium: 'material',
          point: [-2.49, 0],
          height: 1.8,
          side: 'right',
          profileId: 'cement.coal_mill',
          source: 'artifact',
        },
      ],
      kiln_burner: [
        {
          stationId: 'kiln_burner',
          portId: 'fuel_in',
          medium: 'material',
          point: [8.49, 0],
          height: 1.8,
          side: 'left',
          profileId: 'cement.kiln_burner',
          source: 'artifact',
        },
      ],
    }
    const preheaterBox = { minX: -2.44, maxX: 1.04, minZ: -1, maxZ: 1 }

    const route = routeProcessConnection({
      plan,
      connection: {
        fromStationId: 'coal_mill',
        toStationId: 'kiln_burner',
        medium: 'material',
        visualKind: 'pipe',
        fromPortId: 'pulverized_fuel_out',
        toPortId: 'fuel_in',
      },
      connectionIndex: 0,
      placements,
      stationPlacements: [...placements.values()],
      boundary: { length: 18, width: 8 },
      portOverrides,
      routeObstacles: [
        {
          stationId: 'coal_mill',
          source: 'artifact',
          minHeight: 0,
          maxHeight: 4,
          box: { minX: -6.6, maxX: -2.49, minZ: -1.2, maxZ: 1.2 },
        },
        {
          stationId: 'preheater_tower',
          source: 'artifact',
          minHeight: 0,
          maxHeight: 8,
          box: preheaterBox,
        },
      ],
    })

    expect(route?.fromPort?.point).toEqual([-2.49, 0])
    expect(
      route?.segments.some((segment) =>
        routeSegmentIntersectsClearanceBox(segment.start, segment.end, preheaterBox),
      ),
    ).toBe(false)
  })
})
