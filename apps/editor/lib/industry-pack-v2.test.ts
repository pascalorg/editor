import { loadPlugin, nodeRegistry } from '@pascal-app/core'
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
        nodeKind: 'factory:pump',
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
        nodeKind: 'factory:pump',
        mode: 'equipment-node',
      },
      {
        stationId: 'custom_skid',
        mode: 'generic-fallback',
        reason: 'No bounded equipment generator exists yet.',
      },
    ])
  })

  test('requires registered nodeKind and existing node schema target fields', () => {
    nodeRegistry._reset()
    const missingNode = validateIndustryPackV2({
      manifest: manifest(),
      profiles: [pumpProfile],
    })
    expect(missingNode.issues).toContain(
      'Equipment binding chemical.centrifugal_pump references unregistered nodeKind "factory:pump".',
    )
  })

  test('rejects incomplete port maps and unresolved factory stations', async () => {
    nodeRegistry._reset()
    await loadPlugin(factoryEquipmentPlugin)

    const result = validateIndustryPackV2({
      manifest: manifest({
        equipmentBindings: [
          {
            profileId: 'chemical.centrifugal_pump',
            nodeKind: 'factory:pump',
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
        'Binding chemical.centrifugal_pump paramMap target "missingField" is not in nodeKind "factory:pump".',
        'Binding chemical.centrifugal_pump is missing portMap for profile port "outlet".',
        'Binding chemical.centrifugal_pump maps profile port "inlet" to missing node port "missing-node-port".',
        'Factory station unknown_station is unresolved: Station has no profileId and no explicit genericFallback.',
      ]),
    )
  })
})
