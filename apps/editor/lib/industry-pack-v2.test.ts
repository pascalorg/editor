import { loadPlugin, nodeRegistry, semanticRecipeRegistry } from '@pascal-app/core'
import { factoryEquipmentPlugin } from '@pascal-app/plugin-factory-equipment'
import { afterEach, describe, expect, test } from 'bun:test'
import {
  normalizeIndustryPackV2Manifest,
  validateIndustryPackV2,
  type IndustryPackV2ProcessTemplate,
  type IndustryPackV2ValidationProfile,
} from './industry-pack-v2'

const pumpProfile: IndustryPackV2ValidationProfile = {
  id: 'chemical.centrifugal_pump',
  name: 'Centrifugal pump',
  defaultDimensions: { length: 2.6, width: 1.1, height: 1.4 },
  processPorts: [
    { id: 'inlet', medium: 'water', diameter: 0.18 },
    { id: 'outlet', medium: 'water', diameter: 0.12 },
  ],
}

const pumpLine: IndustryPackV2ProcessTemplate = {
  processId: 'chemical.pump_line',
  stations: [
    { id: 'transfer_pump', profileId: 'chemical.centrifugal_pump' },
    {
      id: 'custom_skid',
      label: 'Custom skid',
      genericFallback: { reason: 'No bounded equipment generator exists yet.' },
    },
  ],
}

const flareProfile: IndustryPackV2ValidationProfile = {
  id: 'refinery.flare_system',
  name: 'Flare system',
  defaultDimensions: { length: 4.2, width: 2.6, height: 14 },
  equipmentDefaults: { variant: 'flare' },
  processPorts: [
    { id: 'relief_gas_in', medium: 'gas', diameter: 0.18 },
    { id: 'flare_tip', medium: 'gas', diameter: 0.12 },
  ],
}

const desalterProfile: IndustryPackV2ValidationProfile = {
  id: 'refinery.desalter',
  name: 'Crude desalter',
  preferredResolver: 'profile-parts',
  defaultDimensions: { length: 4.8, width: 1.4, height: 1.6 },
  processPorts: [
    { id: 'crude_in', medium: 'material', diameter: 0.18 },
    { id: 'desalted_crude_out', medium: 'material', diameter: 0.16 },
  ],
  parts: [
    { kind: 'cylindrical_tank', semanticRole: 'desalter_vessel' },
    { kind: 'control_box', semanticRole: 'electrical_control_box' },
  ],
}

function manifest(overrides: Record<string, unknown> = {}) {
  return normalizeIndustryPackV2Manifest({
    id: 'industry.chemical.basic',
    name: 'Chemical Basic',
    industry: 'chemical',
    version: '1.0.0',
    schemaVersion: '2.0',
    dependsOnPlugins: ['pascal:factory-equipment'],
    profiles: ['profiles/pumps.json'],
    equipmentBindings: [
      {
        profileId: 'chemical.centrifugal_pump',
        recipeId: 'factory:centrifugal-pump',
        paramMap: {
          'defaultDimensions.length': 'length',
          'defaultDimensions.width': 'width',
          'defaultDimensions.height': 'height',
          'processPorts.inlet.diameter': 'inletDiameter',
          'processPorts.outlet.diameter': 'outletDiameter',
        },
        portMap: {
          inlet: 'inlet',
          outlet: 'outlet',
        },
      },
    ],
    ...overrides,
  })
}

describe('industry pack v2', () => {
  afterEach(() => {
    nodeRegistry._reset()
    semanticRecipeRegistry._reset()
  })

  test('rejects non-v2 manifests instead of migrating legacy packs', () => {
    expect(() =>
      normalizeIndustryPackV2Manifest({
        id: 'industry.chemical.basic',
        name: 'Chemical Basic',
        industry: 'chemical',
        version: '1.0.0',
        schemaVersion: '1.1',
        profiles: ['profiles/pumps.json'],
      }),
    ).toThrow(/schemaVersion "2\.0"/)
  })

  test('validates equipment bindings against registered factory nodes', async () => {
    nodeRegistry._reset()
    semanticRecipeRegistry._reset()
    await loadPlugin(factoryEquipmentPlugin)

    const result = validateIndustryPackV2({
      manifest: manifest(),
      profiles: [pumpProfile],
      processTemplates: [pumpLine],
    })

    expect(result).toMatchObject({ ok: true, issues: [] })
    expect(result.stationResolutions).toEqual([
      {
        stationId: 'transfer_pump',
        profileId: 'chemical.centrifugal_pump',
        recipeId: 'factory:centrifugal-pump',
        mode: 'semantic-assembly',
      },
      {
        stationId: 'custom_skid',
        mode: 'generic-fallback',
        reason: 'No bounded equipment generator exists yet.',
      },
    ])
  })

  test('requires registered recipeId and existing recipe target fields', () => {
    nodeRegistry._reset()
    semanticRecipeRegistry._reset()
    const missingNode = validateIndustryPackV2({
      manifest: manifest(),
      profiles: [pumpProfile],
    })
    expect(missingNode.issues).toContain(
      'Equipment binding chemical.centrifugal_pump references unregistered recipeId "factory:centrifugal-pump".',
    )
  })

  test('rejects incomplete port maps and unresolved factory stations', async () => {
    nodeRegistry._reset()
    semanticRecipeRegistry._reset()
    await loadPlugin(factoryEquipmentPlugin)

    const result = validateIndustryPackV2({
      manifest: manifest({
        equipmentBindings: [
          {
            profileId: 'chemical.centrifugal_pump',
            recipeId: 'factory:centrifugal-pump',
            paramMap: {
              'defaultDimensions.length': 'missingField',
              'processPorts.inlet.diameter': 'inletDiameter',
            },
            portMap: {
              inlet: 'missing-node-port',
            },
          },
        ],
      }),
      profiles: [pumpProfile],
      processTemplates: [{ processId: 'bad', stations: [{ id: 'unknown_station' }] }],
    })

    expect(result.ok).toBe(false)
    expect(result.issues).toEqual(
      expect.arrayContaining([
        'Binding chemical.centrifugal_pump paramMap target "missingField" is not in recipe "factory:centrifugal-pump".',
        'Binding chemical.centrifugal_pump is missing portMap for profile port "outlet".',
        'Binding chemical.centrifugal_pump maps profile port "inlet" to missing recipe port "missing-node-port".',
        'Factory station unknown_station is unresolved: Station has no profileId and no explicit genericFallback.',
      ]),
    )
  })

  test('validates dynamic recipe ports with binding-derived params', async () => {
    nodeRegistry._reset()
    semanticRecipeRegistry._reset()
    await loadPlugin(factoryEquipmentPlugin)

    const result = validateIndustryPackV2({
      manifest: manifest({
        profiles: ['profiles/refinery.json'],
        equipmentBindings: [
          {
            profileId: 'refinery.flare_system',
            recipeId: 'factory:refinery-auxiliary-unit',
            paramMap: {
              'defaultDimensions.length': 'length',
              'defaultDimensions.width': 'width',
              'defaultDimensions.height': 'height',
              'equipmentDefaults.variant': 'variant',
            },
            portMap: {
              relief_gas_in: 'relief_gas_in',
              flare_tip: 'flare_tip',
            },
          },
        ],
      }),
      profiles: [flareProfile],
    })

    expect(result).toMatchObject({ ok: true, issues: [] })

    const staticPortResult = validateIndustryPackV2({
      manifest: manifest({
        profiles: ['profiles/refinery.json'],
        equipmentBindings: [
          {
            profileId: 'refinery.flare_system',
            recipeId: 'factory:refinery-auxiliary-unit',
            paramMap: {
              'defaultDimensions.length': 'length',
              'equipmentDefaults.variant': 'variant',
            },
            portMap: {
              relief_gas_in: 'rack_in',
              flare_tip: 'rack_out',
            },
          },
        ],
      }),
      profiles: [flareProfile],
    })

    expect(staticPortResult.ok).toBe(false)
    expect(staticPortResult.issues).toEqual(
      expect.arrayContaining([
        'Binding refinery.flare_system maps profile port "relief_gas_in" to missing recipe port "rack_in".',
        'Binding refinery.flare_system maps profile port "flare_tip" to missing recipe port "rack_out".',
      ]),
    )
  })

  test('treats explicit profile-parts devices as resolved semantic assemblies', async () => {
    nodeRegistry._reset()
    semanticRecipeRegistry._reset()
    await loadPlugin(factoryEquipmentPlugin)

    const result = validateIndustryPackV2({
      manifest: manifest(),
      profiles: [pumpProfile, desalterProfile],
      processTemplates: [
        {
          processId: 'refinery.basic',
          stations: [{ id: 'desalter', profileId: 'refinery.desalter' }],
        },
      ],
    })

    expect(result.ok).toBe(true)
    expect(result.warnings).not.toContain('Profile refinery.desalter has no equipment binding.')
    expect(result.stationResolutions).toContainEqual({
      stationId: 'desalter',
      profileId: 'refinery.desalter',
      mode: 'profile-parts',
    })
  })

  test('allows v2 packs that are entirely semantic profile-parts', async () => {
    nodeRegistry._reset()
    semanticRecipeRegistry._reset()
    await loadPlugin(factoryEquipmentPlugin)

    const result = validateIndustryPackV2({
      manifest: manifest({ equipmentBindings: [] }),
      profiles: [desalterProfile],
      processTemplates: [
        {
          processId: 'refinery.basic',
          stations: [{ id: 'desalter', profileId: 'refinery.desalter' }],
        },
      ],
    })

    expect(result.ok).toBe(true)
    expect(result.issues).toEqual([])
    expect(result.stationResolutions).toEqual([
      {
        stationId: 'desalter',
        profileId: 'refinery.desalter',
        mode: 'profile-parts',
      },
    ])
  })
})
