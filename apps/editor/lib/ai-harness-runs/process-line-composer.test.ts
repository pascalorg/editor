import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { fallbackFactoryPlan } from './factory-planner'
import { composeProcessLine } from './process-line-composer'
import { routeSegmentIntersectsClearanceBox } from './process-line-routing'
import { installIndustryPacksForTests } from './test-industry-pack-setup'

function waterElectrolysisPlan() {
  const plan = fallbackFactoryPlan('create a hydrogen electrolysis workshop')
  if (plan.kind !== 'process_line') throw new Error('expected process line plan')
  return plan.process
}

function cementClinkerPlan() {
  const plan = fallbackFactoryPlan('\u751f\u6210\u4e00\u4e2a\u6c34\u6ce5\u719f\u6599\u4ea7\u7ebf')
  if (plan.kind !== 'process_line') throw new Error('expected cement clinker process line plan')
  return plan.process
}

function cementPlantPlan() {
  const plan = fallbackFactoryPlan('\u751f\u6210\u4e00\u4e2a\u6c34\u6ce5\u5de5\u5382')
  if (plan.kind !== 'process_line') throw new Error('expected cement plant process line plan')
  return plan.process
}

function refineryPlan() {
  const plan = fallbackFactoryPlan('\u751f\u6210\u4e00\u4e2a\u70bc\u6cb9\u5382')
  if (plan.kind !== 'process_line') throw new Error('expected refinery process line plan')
  return plan.process
}

function isOrthogonalSegment(start: [number, number], end: [number, number]) {
  return start[0] === end[0] || start[1] === end[1]
}

function stationCenter(result: ReturnType<typeof composeProcessLine>, stationId: string) {
  const placement = result.stationPlacements.find((item) => item.stationId === stationId)
  if (!placement) throw new Error(`missing station placement ${stationId}`)
  return [placement.position[0], placement.position[2]]
}

function polygonBounds(polygon: Array<[number, number]>) {
  const xs = polygon.map((point) => point[0])
  const zs = polygon.map((point) => point[1])
  return {
    minX: Math.min(...xs),
    maxX: Math.max(...xs),
    minZ: Math.min(...zs),
    maxZ: Math.max(...zs),
  }
}

describe('process line composer', () => {
  let restoreIndustryPacks: (() => Promise<void>) | undefined

  beforeAll(async () => {
    restoreIndustryPacks = await installIndustryPacksForTests([
      { id: 'industry.cement.basic', version: '0.1.0' },
      { id: 'industry.refinery.basic', version: '0.1.0' },
    ])
  }, 30000)

  afterAll(async () => {
    await restoreIndustryPacks?.()
  }, 30000)

  test('composes water electrolysis workshop with semantic tank assemblies and connections', () => {
    const result = composeProcessLine({
      prompt: 'create a hydrogen electrolysis workshop',
      plan: waterElectrolysisPlan(),
      placement: { parentId: 'level_factory', generatedBy: 'factory-agent' },
    })

    expect(result.summary).toContain('Water electrolysis hydrogen workshop')
    expect(result.stationPlacements).toHaveLength(8)
    expect(result.layoutDiagnostics).toEqual({
      fits: true,
      boundary: { length: 24, width: 9 },
      diagnostics: [],
    })
    expect(result.layoutStrategy).toMatchObject({ style: 'parallel_bays', repaired: true })
    expect(result.stationPlacements.every((placement) => placement.clearanceBox)).toBe(true)
    expect(result.primitiveRequests.map((request) => request.station.role)).toContain(
      'electrolyzer',
    )
    expect(
      result.patches.some(
        (patch) =>
          patch.node.type === 'assembly' &&
          patch.node.metadata?.equipmentAssembly &&
          patch.node.metadata?.stationId === 'hydrogen_separator',
      ),
    ).toBe(true)
    expect(result.patches.some((patch) => patch.node.type === 'pipe')).toBe(true)
    expect(result.patches.some((patch) => patch.node.type === 'pipe-fitting')).toBe(true)
    expect(result.patches.some((patch) => patch.node.type === 'cable-tray')).toBe(true)
    expect(result.patches.some((patch) => patch.node.type === 'box')).toBe(true)
    expect(result.patches.some((patch) => patch.node.type === 'item')).toBe(true)
    expect(
      result.patches.some(
        (patch) =>
          patch.node.type === 'item' &&
          patch.node.metadata?.catalogItemId === 'factory-electric-box' &&
          patch.node.metadata?.processCatalogQualified === true,
      ),
    ).toBe(true)
    expect(
      result.patches.every(
        (patch) =>
          (patch.node.metadata?.generatedBy === 'factory-agent' ||
            patch.node.metadata?.generatedBy === 'ai-geometry') &&
          patch.node.metadata?.processId === 'water_electrolysis_hydrogen',
      ),
    ).toBe(true)
  })

  test('normalizes invalid connection media before writing node metadata', () => {
    const plan = structuredClone(waterElectrolysisPlan())
    plan.connections[0] = {
      ...plan.connections[0]!,
      medium: { kind: 'gas' } as never,
    }

    const result = composeProcessLine({
      prompt: 'create a hydrogen electrolysis workshop',
      plan,
      placement: { parentId: 'level_factory', generatedBy: 'factory-agent' },
      sections: { shell: false, stations: false, connections: true },
    })

    expect(result.patches.length).toBeGreaterThan(0)
    expect(
      result.patches.every((patch) => typeof patch.node.metadata?.connectionRole !== 'object'),
    ).toBe(true)
  })

  test('uses localized display labels for Chinese process line prompts', () => {
    const result = composeProcessLine({
      prompt: '\u521b\u5efa\u4e00\u6761\u5316\u5de5\u5382\u6c34\u88c2\u89e3\u8f66\u95f4',
      plan: waterElectrolysisPlan(),
      placement: { parentId: 'level_factory', generatedBy: 'factory-agent' },
    })

    const shellZone = result.patches.find(
      (patch) => patch.node.type === 'zone' && patch.node.metadata?.role === 'layout-zone',
    )
    const waterZone = result.patches.find(
      (patch) => patch.node.type === 'zone' && patch.node.metadata?.stationId === 'water_treatment',
    )
    const hydrogenTank = result.patches.find(
      (patch) =>
        patch.node.type === 'assembly' && patch.node.metadata?.stationId === 'hydrogen_separator',
    )

    expect(shellZone?.node.name).toBe('\u7535\u89e3\u6c34\u5236\u6c22\u8f66\u95f4')
    expect(shellZone?.node.metadata).toMatchObject({
      processLabel: 'Water electrolysis hydrogen workshop',
      processDisplayLabel: '\u7535\u89e3\u6c34\u5236\u6c22\u8f66\u95f4',
    })
    expect(waterZone?.node.name).toBe('\u7eaf\u6c34\u5904\u7406')
    expect(waterZone?.node.metadata).toMatchObject({
      stationLabel: 'Pure water treatment',
      stationDisplayLabel: '\u7eaf\u6c34\u5904\u7406',
    })
    expect(hydrogenTank?.node.name).toBe('\u6c22\u6c14\u6c14\u6db2\u5206\u79bb\u5668')
    expect(
      result.stationPlacements.find((item) => item.stationId === 'electrolyzer'),
    ).toMatchObject({
      label: 'Electrolyzer stack array',
      displayLabel: '\u7535\u89e3\u69fd\u7ec4',
    })
  })

  test('names occupied building zones distinctly from their process station zone', () => {
    const result = composeProcessLine({
      prompt: '\u751f\u6210\u4e00\u4e2a\u70bc\u6cb9\u5382',
      plan: refineryPlan(),
      placement: { parentId: 'level_factory', generatedBy: 'factory-agent' },
    })

    const stationZone = result.patches.find(
      (patch) =>
        patch.node.type === 'zone' &&
        patch.node.metadata?.stationId === 'control_room' &&
        patch.node.metadata?.role === 'process-line-station',
    )
    const buildingZone = result.patches.find(
      (patch) =>
        patch.node.type === 'zone' &&
        patch.node.metadata?.stationId === 'control_room' &&
        patch.node.metadata?.role === 'layout-zone' &&
        patch.node.metadata?.resolver === 'native-occupied-building',
    )

    expect(stationZone?.node.name).toBe('\u4e2d\u63a7\u5ba4')
    expect(buildingZone?.node.name).toBe('\u4e2d\u63a7\u697c')
    expect(buildingZone?.node.metadata).toMatchObject({
      stationDisplayLabel: '\u4e2d\u63a7\u5ba4',
      processDisplayLabel: '\u4e2d\u63a7\u697c',
      parentProcessDisplayLabel: '\u57fa\u7840\u70bc\u6cb9\u5382',
    })
  })

  test('routes process connections from equipment contract ports instead of station centers', () => {
    const result = composeProcessLine({
      prompt: 'create a hydrogen electrolysis workshop',
      plan: waterElectrolysisPlan(),
      placement: { parentId: 'level_factory', generatedBy: 'factory-agent' },
    })

    const waterPipe = result.patches.find(
      (patch) =>
        patch.node.type === 'pipe' &&
        patch.node.metadata?.fromStationId === 'water_treatment' &&
        patch.node.metadata?.toStationId === 'electrolyzer',
    )
    const powerTray = result.patches.find(
      (patch) =>
        patch.node.type === 'cable-tray' &&
        patch.node.metadata?.fromStationId === 'dc_power_supply' &&
        patch.node.metadata?.toStationId === 'electrolyzer',
    )
    const hydrogenPipe = result.patches.find(
      (patch) =>
        patch.node.type === 'pipe' &&
        patch.node.metadata?.fromStationId === 'electrolyzer' &&
        patch.node.metadata?.toStationId === 'hydrogen_separator',
    )
    const coolingPipe = result.patches.find(
      (patch) =>
        patch.node.type === 'pipe' &&
        patch.node.metadata?.fromStationId === 'electrolyzer' &&
        patch.node.metadata?.toStationId === 'cooling_loop',
    )

    expect(waterPipe?.node.metadata).toMatchObject({
      fromPortId: 'pure_water_out',
      toPortId: 'water_in',
      fromPortProfileId: 'hydrogen_electrolysis.water_treatment.compact',
      toPortProfileId: 'hydrogen_electrolysis.electrolyzer_skid.compact',
    })
    expect(powerTray?.node.metadata).toMatchObject({
      fromPortId: 'dc_power_out',
      toPortId: 'dc_power',
    })
    expect(hydrogenPipe?.node.metadata).toMatchObject({
      fromPortId: 'hydrogen_out',
      toPortId: 'gas_in',
    })
    expect(coolingPipe?.node.metadata).toMatchObject({
      fromPortId: 'cooling_out',
      toPortId: 'cooling_return',
    })

    if (!waterPipe || waterPipe.node.type !== 'pipe') throw new Error('expected water pipe')
    expect(waterPipe.node.start).not.toEqual(stationCenter(result, 'water_treatment'))
    expect(waterPipe.node.end).not.toEqual(stationCenter(result, 'electrolyzer'))
    expect(waterPipe.node.elevation).toBe(0.875)

    if (!powerTray || powerTray.node.type !== 'cable-tray') throw new Error('expected power tray')
    expect(powerTray.node.elevation).toBe(2.4)
  })

  test('routes process connections around non-endpoint station clearance boxes', () => {
    const result = composeProcessLine({
      prompt: 'create a hydrogen electrolysis workshop',
      plan: {
        ...waterElectrolysisPlan(),
        dimensions: { length: 18, width: 9 },
      },
      placement: { parentId: 'level_factory', generatedBy: 'factory-agent' },
    })

    const routedPipePatches = result.patches.filter(
      (patch) =>
        patch.node.type === 'pipe' &&
        patch.node.metadata?.fromStationId === 'electrolyzer' &&
        patch.node.metadata?.toStationId === 'hydrogen_separator',
    )

    expect(routedPipePatches.length).toBeGreaterThan(1)
    expect(
      result.patches.some(
        (patch) =>
          patch.node.type === 'pipe-fitting' &&
          patch.node.metadata?.role === 'process-line-route-elbow' &&
          patch.node.metadata?.fromStationId === 'electrolyzer' &&
          patch.node.metadata?.toStationId === 'hydrogen_separator',
      ),
    ).toBe(true)

    for (const [segmentIndex, patch] of routedPipePatches.entries()) {
      if (patch.node.type !== 'pipe') throw new Error('expected pipe patch')
      expect(patch.node.metadata).toMatchObject({
        routeStyle: 'orthogonal',
        routeSegmentIndex: segmentIndex,
        routeSegmentCount: routedPipePatches.length,
      })
      expect(isOrthogonalSegment(patch.node.start, patch.node.end)).toBe(true)

      for (const stationPlacement of result.stationPlacements) {
        if (
          stationPlacement.stationId === 'electrolyzer' ||
          stationPlacement.stationId === 'hydrogen_separator'
        ) {
          continue
        }
        expect(
          routeSegmentIntersectsClearanceBox(
            patch.node.start,
            patch.node.end,
            stationPlacement.clearanceBox,
          ),
        ).toBe(false)
      }
    }

    const connectionSegments = result.patches.filter(
      (patch) => patch.node.type === 'pipe' || patch.node.type === 'cable-tray',
    )
    for (const patch of connectionSegments) {
      if (patch.node.type !== 'pipe' && patch.node.type !== 'cable-tray') {
        throw new Error('expected routed connection segment')
      }
      const fromStationId = patch.node.metadata?.fromStationId
      const toStationId = patch.node.metadata?.toStationId
      for (const stationPlacement of result.stationPlacements) {
        if (
          stationPlacement.stationId === fromStationId ||
          stationPlacement.stationId === toStationId
        ) {
          continue
        }
        expect(
          routeSegmentIntersectsClearanceBox(
            patch.node.start,
            patch.node.end,
            stationPlacement.clearanceBox,
          ),
        ).toBe(false)
      }
    }
  })

  test('composes cement clinker line with industry-pack profile contracts and port hints', () => {
    const plan = cementClinkerPlan()
    const result = composeProcessLine({
      prompt: '\u751f\u6210\u4e00\u4e2a\u6c34\u6ce5\u719f\u6599\u4ea7\u7ebf',
      plan,
      placement: { parentId: 'level_factory', generatedBy: 'factory-agent' },
    })

    expect(plan.architecture?.omitPerimeterWalls).toBe(true)
    expect(result.summary).toContain('Cement clinker production line')
    expect(result.stationPlacements).toHaveLength(7)
    expect(result.layoutDiagnostics.fits).toBe(true)
    expect(result.patches.some((patch) => patch.node.type === 'wall')).toBe(false)
    expect(result.patches.some((patch) => patch.node.type === 'door')).toBe(false)
    expect(result.patches.some((patch) => patch.node.type === 'window')).toBe(false)
    expect(result.primitiveRequests.map((request) => request.equipmentContract?.profileId)).toEqual(
      expect.arrayContaining([
        'cement.preheater_tower',
        'cement.rotary_kiln',
        'cement.grate_cooler',
        'cement.clinker_silo',
        'cement.bag_filter',
      ]),
    )
    expect(
      result.patches.some(
        (patch) =>
          patch.node.type === 'zone' &&
          patch.node.name === '\u56de\u8f6c\u7a91' &&
          patch.node.metadata?.stationId === 'rotary_kiln',
      ),
    ).toBe(true)

    const dedustingPipe = result.patches.find(
      (patch) =>
        patch.node.type === 'pipe' &&
        patch.node.metadata?.fromStationId === 'preheater_tower' &&
        patch.node.metadata?.toStationId === 'bag_filter',
    )
    expect(dedustingPipe?.node.metadata).toMatchObject({
      connectionRole: 'gas',
      fromPortIdHint: 'exhaust_gas_out',
      toPortIdHint: 'dust_gas_in',
      fromPortId: 'exhaust_gas_out',
      toPortId: 'dust_gas_in',
      fromPortMedium: 'gas',
      toPortMedium: 'gas',
      fromPortProfileId: 'cement.preheater_tower',
      toPortProfileId: 'cement.bag_filter',
      visualKind: 'hot_gas_duct',
      resolver: 'native-hot-gas-duct',
    })
    if (!dedustingPipe || dedustingPipe.node.type !== 'pipe') throw new Error('expected duct pipe')
    expect(dedustingPipe.node.diameter).toBe(0.16)
    expect(dedustingPipe.node.temperatureC).toBe(360)
    expect(
      result.patches.some(
        (patch) =>
          patch.node.type === 'box' &&
          patch.node.metadata?.role === 'process-line-connection-support' &&
          patch.node.metadata?.fromStationId === 'preheater_tower' &&
          patch.node.metadata?.toStationId === 'bag_filter' &&
          patch.node.metadata?.resolver === 'native-route-support',
      ),
    ).toBe(true)

    const clinkerConveyor = result.patches.find(
      (patch) =>
        patch.node.type === 'cable-tray' &&
        patch.node.metadata?.fromStationId === 'grate_cooler' &&
        patch.node.metadata?.toStationId === 'clinker_conveying',
    )
    expect(clinkerConveyor?.node.metadata).toMatchObject({
      visualKind: 'material_conveyor',
      resolver: 'native-material-conveyor',
    })
    if (!clinkerConveyor || clinkerConveyor.node.type !== 'cable-tray') {
      throw new Error('expected clinker material conveyor')
    }
    expect(clinkerConveyor.node.width).toBe(0.72)
    expect(clinkerConveyor.node.elevation).toBe(1.05)
  })

  test('composes full cement plant from the modular industry template', () => {
    const result = composeProcessLine({
      prompt: '\u751f\u6210\u4e00\u4e2a\u6c34\u6ce5\u5de5\u5382',
      plan: cementPlantPlan(),
      placement: { parentId: 'level_factory', generatedBy: 'factory-agent' },
    })

    expect(result.summary).toContain('Full cement plant')
    expect(result.stationPlacements).toHaveLength(28)
    expect(result.layoutDiagnostics.fits).toBe(true)
    expect(result.layoutStrategy).toMatchObject({ style: 'parallel_bays' })
    const focusStationIds = result.focusBounds?.stationIds
    expect(Array.isArray(focusStationIds)).toBe(true)
    expect(result.focusBounds).toMatchObject({
      reason: 'factory-key-process',
    })
    expect(focusStationIds as string[]).toEqual(
      expect.arrayContaining([
        'preheater_tower',
        'rotary_kiln',
        'kiln_hood',
        'grate_cooler',
        'clinker_crusher',
        'process_stack',
      ]),
    )
    expect(focusStationIds as string[]).not.toContain('limestone_crusher')
    expect(focusStationIds as string[]).not.toContain('coal_mill')
    expect(focusStationIds as string[]).not.toContain('whr_boiler')
    expect(focusStationIds as string[]).not.toContain('control_room')
    expect(focusStationIds as string[]).not.toContain('cement_mill')
    expect(focusStationIds as string[]).not.toContain('cement_packer')
    expect(
      result.patches.some(
        (patch) =>
          patch.node.type === 'slab' &&
          Array.isArray(patch.node.metadata?.factoryCameraFocus?.bounds?.center),
      ),
    ).toBe(true)
    const controlRoomNativeTypes = result.patches
      .filter((patch) => patch.node.metadata?.stationId === 'control_room')
      .map((patch) => patch.node.type)
    expect(controlRoomNativeTypes).toEqual(
      expect.arrayContaining(['slab', 'wall', 'door', 'window', 'roof', 'roof-segment']),
    )
    expect(
      result.patches
        .filter((patch) => patch.node.type === 'wall')
        .every((patch) => patch.node.metadata?.stationId === 'control_room'),
    ).toBe(true)
    expect(result.primitiveRequests.map((request) => request.equipmentContract?.profileId)).toEqual(
      expect.arrayContaining([
        'cement.limestone_crusher',
        'cement.stack_reclaimer',
        'cement.vertical_raw_mill',
        'cement.raw_meal_homogenization_silo',
        'cement.coal_mill',
        'cement.esp_dust_collector',
        'cement.cement_mill',
        'cement.whr_boiler',
      ]),
    )
    expect(
      result.primitiveRequests.map((request) => request.equipmentContract?.profileId),
    ).not.toContain('cement.tertiary_air_duct')
    expect(result.primitiveRequests.map((request) => request.station.id)).not.toContain(
      'control_room',
    )
    expect(
      result.patches.some(
        (patch) => patch.node.type === 'item' && patch.node.metadata?.stationId === 'control_room',
      ),
    ).toBe(false)
    expect(
      result.patches.some(
        (patch) =>
          patch.node.type === 'zone' &&
          patch.node.name === '\u77f3\u7070\u77f3\u7834\u788e\u673a' &&
          patch.node.metadata?.stationId === 'limestone_crusher',
      ),
    ).toBe(true)
    expect(
      result.patches.some(
        (patch) =>
          patch.node.type === 'zone' &&
          patch.node.name === '\u7be6\u51b7\u673a' &&
          patch.node.metadata?.stationId === 'grate_cooler',
      ),
    ).toBe(true)

    const rawMealFeed = result.patches.find(
      (patch) =>
        patch.node.metadata?.stationId === 'raw_meal_feed' &&
        patch.node.metadata?.equipmentContract?.profileId === 'cement.bucket_elevator',
    )
    expect(rawMealFeed?.node.metadata).toMatchObject({
      resolver: 'semantic-assembly',
      equipmentAssembly: {
        kind: 'semantic-assembly',
        profileId: 'cement.bucket_elevator',
      },
      equipmentContract: {
        profileId: 'cement.bucket_elevator',
      },
    })

    const rawMealFeedConveyor = result.patches.find(
      (patch) =>
        patch.node.type === 'cable-tray' &&
        patch.node.metadata?.fromStationId === 'raw_meal_silo' &&
        patch.node.metadata?.toStationId === 'raw_meal_feed',
    )
    expect(rawMealFeedConveyor?.node.metadata).toMatchObject({
      fromPortId: 'raw_meal_out',
      toPortId: 'raw_meal_in',
      fromPortProfileId: 'cement.raw_meal_homogenization_silo',
      toPortProfileId: 'cement.bucket_elevator',
      visualKind: 'material_conveyor',
      resolver: 'native-material-conveyor',
    })

    const preheaterFeedConveyor = result.patches.find(
      (patch) =>
        patch.node.type === 'cable-tray' &&
        patch.node.metadata?.fromStationId === 'raw_meal_feed' &&
        patch.node.metadata?.toStationId === 'preheater_tower',
    )
    expect(preheaterFeedConveyor?.node.metadata).toMatchObject({
      fromPortId: 'raw_meal_out',
      toPortId: 'raw_meal_in',
      fromPortProfileId: 'cement.bucket_elevator',
      toPortProfileId: 'cement.preheater_tower',
      visualKind: 'material_conveyor',
      resolver: 'native-material-conveyor',
    })

    const clinkerConveyor = result.patches.find(
      (patch) =>
        patch.node.type === 'cable-tray' &&
        patch.node.metadata?.fromStationId === 'clinker_crusher' &&
        patch.node.metadata?.toStationId === 'clinker_conveying',
    )
    expect(clinkerConveyor?.node.metadata).toMatchObject({
      visualKind: 'material_conveyor',
      resolver: 'native-material-conveyor',
    })
    if (!clinkerConveyor || clinkerConveyor.node.type !== 'cable-tray') {
      throw new Error('expected full-plant clinker material conveyor')
    }
    expect(clinkerConveyor.node.width).toBe(0.72)

    const tertiaryAirDuct = result.patches.find(
      (patch) =>
        patch.node.type === 'sweep' &&
        patch.node.metadata?.stationId === 'tertiary_air_duct' &&
        patch.node.metadata?.fromStationId === 'grate_cooler' &&
        patch.node.metadata?.toStationId === 'preheater_tower',
    )
    expect(tertiaryAirDuct?.node.metadata).toMatchObject({
      connectionRole: 'gas',
      fromPortMedium: 'gas',
      toPortMedium: 'gas',
      visualKind: 'hot_gas_duct',
      resolver: 'native-rectangular-duct-sweep',
      routeConnectionLegs: [
        {
          fromStationId: 'grate_cooler',
          toStationId: 'tertiary_air_duct',
          visualKind: 'hot_gas_duct',
          fromPortId: 'cooler_exhaust_out',
          toPortId: 'cooler_air_in',
        },
        {
          fromStationId: 'tertiary_air_duct',
          toStationId: 'preheater_tower',
          visualKind: 'hot_gas_duct',
          fromPortId: 'tertiary_air_out',
          toPortId: 'tertiary_air_in',
        },
      ],
      primitiveContract: {
        duct: {
          crossSection: 'rectangular',
          width: 0.46,
          height: 0.28,
        },
      },
    })
    if (!tertiaryAirDuct || tertiaryAirDuct.node.type !== 'sweep') {
      throw new Error('expected tertiary air duct sweep')
    }
    expect(tertiaryAirDuct.node.path).toHaveLength(3)
    expect(tertiaryAirDuct.node.path[0]?.[1]).toBeGreaterThan(1.5)
    expect(tertiaryAirDuct.node.path[2]?.[1]).toBeGreaterThan(4)
    expect(
      result.patches.some(
        (patch) =>
          patch.node.type === 'box' &&
          patch.node.metadata?.role === 'process-line-connection-support' &&
          patch.node.metadata?.stationId === 'tertiary_air_duct' &&
          patch.node.metadata?.resolver === 'native-route-support',
      ),
    ).toBe(true)
    expect(
      result.patches.some(
        (patch) =>
          patch.node.type === 'pipe' &&
          patch.node.metadata?.fromStationId === 'tertiary_air_duct' &&
          patch.node.metadata?.toStationId === 'preheater_tower',
      ),
    ).toBe(false)
    expect(
      result.patches.some(
        (patch) =>
          patch.node.type === 'pipe' &&
          patch.node.metadata?.fromStationId === 'grate_cooler' &&
          patch.node.metadata?.toStationId === 'tertiary_air_duct',
      ),
    ).toBe(false)

    const ductDiameters = result.patches
      .filter(
        (patch) =>
          patch.node.type === 'pipe' &&
          (patch.node.metadata?.visualKind === 'hot_gas_duct' ||
            patch.node.metadata?.visualKind === 'air_duct'),
      )
      .map((patch) => (patch.node.type === 'pipe' ? patch.node.diameter : 0))
    expect(Math.max(...ductDiameters)).toBeLessThanOrEqual(0.16)
  }, 10000)

  test('composes refinery with crude, intermediate, and product semantic tank farms', () => {
    const result = composeProcessLine({
      prompt: '\u751f\u6210\u4e00\u4e2a\u70bc\u6cb9\u5382',
      plan: refineryPlan(),
      placement: { parentId: 'level_factory', generatedBy: 'factory-agent' },
    })

    expect(result.summary).toContain('Basic oil refinery complex')
    expect(result.stationPlacements).toHaveLength(16)
    expect(result.layoutDiagnostics.fits).toBe(true)
    expect(result.layoutDiagnostics.boundary.length).toBeGreaterThan(46)
    expect(result.layoutStrategy).toMatchObject({ style: 'parallel_bays', repaired: true })

    const tankStations = result.patches
      .filter(
        (patch) =>
          patch.node.type === 'assembly' &&
          patch.node.metadata?.equipmentAssembly &&
          patch.node.metadata?.equipmentContract,
      )
      .map((patch) => patch.node.metadata?.stationId)

    expect(tankStations).toEqual(
      expect.arrayContaining([
        'crude_storage_tank',
        'atmospheric_distillation_unit',
        'vacuum_distillation_unit',
        'intermediate_storage_tank',
        'product_storage_tank',
      ]),
    )
    const semanticAssemblies = result.patches.filter(
      (patch) => patch.node.type === 'assembly' && patch.node.metadata?.equipmentAssembly,
    )
    expect(
      semanticAssemblies
        .map((patch) => patch.node.metadata?.equipmentAssembly?.recipeId)
        .filter(Boolean),
    ).toEqual(
      expect.arrayContaining([
        'factory:distillation-unit',
        'factory:refinery-auxiliary-unit',
        'factory:refinery-reactor-unit',
        'factory:storage-tank',
      ]),
    )
    expect(
      result.patches.map((patch) => patch.node.metadata?.semanticRole),
    ).toEqual(
      expect.arrayContaining([
        'distillation_column_shell',
        'vacuum_column_shell',
        'helical_ladder_tread',
        'fcc_reactor',
        'hydrotreater_reactor',
        'reformer_reactor_train',
        'claus_reactor',
        'flare_stack',
        'main_pipe_header',
        'boiler_body',
      ]),
    )
    expect(
      result.patches.some(
        (patch) =>
          patch.node.type === 'item' &&
          ['crude_storage_tank', 'intermediate_storage_tank', 'product_storage_tank'].includes(
            String(patch.node.metadata?.stationId),
          ),
      ),
    ).toBe(false)
    expect(
      result.patches.some(
        (patch) =>
          patch.node.metadata?.fromStationId === 'vacuum_distillation_unit' &&
          patch.node.metadata?.toStationId === 'fluid_catalytic_cracking_unit',
      ),
    ).toBe(true)
    expect(
      result.patches.some(
        (patch) =>
          patch.node.metadata?.fromStationId === 'vacuum_distillation_unit' &&
          patch.node.metadata?.toStationId === 'delayed_coker_unit',
      ),
    ).toBe(true)
    expect(
      result.patches.some(
        (patch) =>
          patch.node.metadata?.fromStationId === 'fluid_catalytic_cracking_unit' &&
          patch.node.metadata?.toStationId === 'gas_fractionation_unit',
      ),
    ).toBe(true)
    expect(
      result.patches.some(
        (patch) =>
          patch.node.metadata?.fromStationId === 'catalytic_reformer_unit' &&
          patch.node.metadata?.toStationId === 'hydrotreating_unit',
      ),
    ).toBe(true)
    expect(
      result.patches.some(
        (patch) =>
          patch.node.metadata?.fromStationId === 'fluid_catalytic_cracking_unit' &&
          patch.node.metadata?.toStationId === 'flare_system',
      ),
    ).toBe(false)

    const controlRoomTypes = result.patches
      .filter((patch) => patch.node.metadata?.stationId === 'control_room')
      .map((patch) => patch.node.type)
    expect(controlRoomTypes).toEqual(
      expect.arrayContaining(['slab', 'wall', 'door', 'window', 'roof', 'roof-segment']),
    )
    expect(
      result.patches.some(
        (patch) =>
          patch.node.type === 'assembly' &&
          patch.node.metadata?.stationId === 'control_room' &&
          patch.node.metadata?.resolver === 'semantic-assembly',
      ),
    ).toBe(false)
    expect(result.primitiveRequests.map((request) => request.station.id)).not.toContain(
      'control_room',
    )
    const controlRoomWalls = result.patches.filter(
      (patch) => patch.node.type === 'wall' && patch.node.metadata?.stationId === 'control_room',
    )
    expect(controlRoomWalls).toHaveLength(4)
    for (const wall of controlRoomWalls) {
      if (wall.node.type !== 'wall') throw new Error('expected control room wall')
      expect(wall.node.height).toBe(2.5)
    }
    const controlRoomFloor = result.patches.find(
      (patch) =>
        patch.node.type === 'slab' &&
        patch.node.metadata?.stationId === 'control_room' &&
        patch.node.metadata?.role === 'layout-floor',
    )
    if (!controlRoomFloor || controlRoomFloor.node.type !== 'slab') {
      throw new Error('expected control room floor slab')
    }
    const controlRoomFloorBounds = polygonBounds(controlRoomFloor.node.polygon)
    expect(controlRoomFloorBounds.maxX - controlRoomFloorBounds.minX).toBe(5)
    expect(controlRoomFloorBounds.maxZ - controlRoomFloorBounds.minZ).toBe(4)
    expect(
      result.patches.some(
        (patch) =>
          patch.node.type === 'roof-segment' &&
          patch.node.metadata?.stationId === 'control_room' &&
          patch.node.roofType === 'flat',
      ),
    ).toBe(true)
    const boilerAssembly = result.patches.find(
      (patch) =>
        patch.node.type === 'assembly' && patch.node.metadata?.stationId === 'utility_boiler',
    )
    if (!boilerAssembly) throw new Error('expected utility boiler assembly')
    const boilerChildren = result.patches.filter(
      (patch) => patch.parentId === boilerAssembly.node.id,
    )
    const boilerBody = boilerChildren.find(
      (patch) => patch.node.type === 'box' && patch.node.metadata?.semanticRole === 'boiler_body',
    )
    if (!boilerBody || boilerBody.node.type !== 'box') throw new Error('expected boiler body')
    expect(boilerBody.node.height).toBeLessThan(2.5)
    const steamDrum = boilerChildren.find(
      (patch) =>
        patch.node.type === 'cylinder' && patch.node.metadata?.semanticRole === 'steam_drum',
    )
    if (!steamDrum || steamDrum.node.type !== 'cylinder') throw new Error('expected steam drum')
    expect(steamDrum.node.position[1] + steamDrum.node.radius).toBeLessThan(2.5)
    const boilerStack = boilerChildren.find(
      (patch) =>
        patch.node.type === 'frustum' && patch.node.metadata?.semanticRole === 'boiler_stack',
    )
    if (!boilerStack || boilerStack.node.type !== 'frustum')
      throw new Error('expected boiler stack')
    expect(boilerStack.node.position[1] + boilerStack.node.height / 2).toBeGreaterThan(2.5)

    const pipeRackAssembly = result.patches.find(
      (patch) => patch.node.type === 'assembly' && patch.node.metadata?.stationId === 'pipe_rack',
    )
    if (!pipeRackAssembly) throw new Error('expected pipe rack assembly')
    const pipeRackChildren = result.patches.filter(
      (patch) => patch.parentId === pipeRackAssembly.node.id,
    )
    const mainHeader = pipeRackChildren.find(
      (patch) =>
        patch.node.type === 'cylinder' && patch.node.metadata?.semanticRole === 'main_pipe_header',
    )
    if (!mainHeader || mainHeader.node.type !== 'cylinder')
      throw new Error('expected elevated pipe rack main header')
    expect(mainHeader.node.position[1]).toBeGreaterThanOrEqual(2)
    const parallelRun = pipeRackChildren.find(
      (patch) =>
        patch.node.type === 'cylinder' && patch.node.metadata?.semanticRole === 'parallel_pipe_run',
    )
    if (!parallelRun || parallelRun.node.type !== 'cylinder')
      throw new Error('expected elevated pipe rack parallel pipe run')
    expect(parallelRun.node.position[1]).toBeGreaterThanOrEqual(1.2)

    const distillationAssemblies = result.patches.filter(
      (patch) =>
        patch.node.type === 'assembly' &&
        ['atmospheric_distillation_unit', 'vacuum_distillation_unit'].includes(
          String(patch.node.metadata?.stationId),
        ),
    )
    expect(distillationAssemblies.length).toBeGreaterThanOrEqual(2)
    for (const assembly of distillationAssemblies) {
      const children = result.patches.filter((patch) => patch.parentId === assembly.node.id)
      expect(children.length).toBeGreaterThan(0)
      expect(
        children.every((patch) => {
          const position = 'position' in patch.node ? patch.node.position : undefined
          return !Array.isArray(position) || position[1] >= -0.001
        }),
      ).toBe(true)
    }
  }, 20000)

  test('keeps auto-placed refinery floor aligned with station placements', () => {
    const result = composeProcessLine({
      prompt: '\u751f\u6210\u4e00\u4e2a\u70bc\u6cb9\u5382',
      plan: refineryPlan(),
      placement: {
        parentId: 'level_factory',
        generatedBy: 'factory-agent',
        metadata: {
          sceneBounds: {
            min: [-20, -10],
            max: [20, 10],
            center: [0, 0],
            size: [40, 20],
          },
        },
      },
    })

    const floor = result.patches.find(
      (patch) => patch.node.type === 'slab' && patch.node.metadata?.role === 'layout-floor',
    )
    if (!floor || floor.node.type !== 'slab') throw new Error('expected refinery floor slab')
    const bounds = polygonBounds(floor.node.polygon)

    expect(bounds.minX).toBeGreaterThan(20)
    for (const placement of result.stationPlacements) {
      expect(placement.clearanceBox.minX).toBeGreaterThanOrEqual(bounds.minX - 0.001)
      expect(placement.clearanceBox.maxX).toBeLessThanOrEqual(bounds.maxX + 0.001)
      expect(placement.clearanceBox.minZ).toBeGreaterThanOrEqual(bounds.minZ - 0.001)
      expect(placement.clearanceBox.maxZ).toBeLessThanOrEqual(bounds.maxZ + 0.001)
    }
  }, 10000)
})
