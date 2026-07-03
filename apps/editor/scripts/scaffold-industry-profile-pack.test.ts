import { afterEach, describe, expect, test } from 'bun:test'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { loadPlugin, nodeRegistry } from '@pascal-app/core'
import { factoryEquipmentPlugin } from '@pascal-app/plugin-factory-equipment'
import { compileProcessStationEquipment } from '../lib/equipment-spec-compiler'
import { normalizeIndustryPackV2Manifest } from '../lib/industry-pack-v2'
import { auditProfilePackValidation, validateProfilePackDir } from '../lib/profile-packs'
import {
  normalizeIndustryPackSpec,
  scaffoldIndustryProfilePack,
} from './scaffold-industry-profile-pack'

const tempRoots: string[] = []

async function tempDir() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'pascal-profile-pack-scaffold-'))
  tempRoots.push(dir)
  return dir
}

describe('scaffold-industry-profile-pack', () => {
  afterEach(async () => {
    await Promise.all(
      tempRoots.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })),
    )
  })

  test('generates a valid minimal industry profile pack from a spec', async () => {
    const root = await tempDir()
    const specPath = path.join(root, 'spec.json')
    await fs.writeFile(
      specPath,
      JSON.stringify(
        {
          industry: 'test-industry',
          id: 'industry.test-industry.basic',
          name: 'Test Industry Basic Pack',
          description: 'Generated test pack.',
          capabilities: ['factory_creation'],
          factoryArchitectures: [
            {
              id: 'test_industry.factory.modular',
              label: 'Test industry factory',
              industry: 'test-industry',
              processId: 'test_industry_full',
              layoutStyle: 'linear',
              defaultDimensions: { length: 12, width: 6 },
              modules: [
                {
                  id: 'main_line',
                  displayLabel: 'Main line',
                  order: 10,
                  stationIds: ['feed_pump', 'buffer_tank'],
                },
              ],
            },
          ],
          processTemplates: [
            {
              processId: 'test_industry_full',
              processLabel: 'Test industry full line',
              processDisplayLabel: 'Test industry line',
              domain: 'industrial',
              aliases: ['test industry line', 'test factory line'],
              requiredRoles: ['test_machine'],
              defaultLayoutStyle: 'linear',
              defaultDimensions: { length: 12, width: 6 },
              stations: [
                {
                  id: 'feed_pump',
                  label: 'Feed pump',
                  displayLabel: 'Feed pump',
                  role: 'feed_pump',
                  equipmentHint: 'test_industry.feed_pump centrifugal pump',
                  footprintHint: 'medium',
                },
                {
                  id: 'buffer_tank',
                  label: 'Buffer tank',
                  displayLabel: 'Buffer tank',
                  role: 'buffer_tank',
                  equipmentHint: 'test_industry.buffer_tank vertical storage tank',
                  footprintHint: 'medium',
                },
              ],
              connections: [
                {
                  fromStationId: 'buffer_tank',
                  toStationId: 'feed_pump',
                  medium: 'liquid',
                  visualKind: 'pipe',
                },
              ],
            },
          ],
          devices: [
            {
              id: 'feed_pump',
              name: 'Feed pump',
              aliases: ['feed pump', 'centrifugal pump'],
              nodeKind: 'factory:pump',
              layoutFamily: 'pump_skid_layout',
              family: 'pump',
              defaultDimensions: { length: 2.4, width: 1, height: 1.3 },
              equipmentDefaults: { pumpType: 'centrifugal', flowRate: 160, motorPower: 22 },
              primarySemanticRole: 'pump_casing',
              parts: [
                {
                  kind: 'volute_casing',
                  semanticRole: 'pump_casing',
                  required: true,
                },
                {
                  kind: 'ribbed_motor_body',
                  semanticRole: 'pump_motor',
                  required: true,
                },
              ],
              forbiddenRoles: ['vehicle_cabin'],
              shapeCount: { min: 2, max: 24 },
            },
            {
              id: 'buffer_tank',
              name: 'Buffer tank',
              aliases: ['buffer tank', 'storage tank'],
              nodeKind: 'factory:tank',
              layoutFamily: 'vertical_tank_layout',
              family: 'tank',
              defaultDimensions: { length: 2.2, width: 2.2, height: 3.4 },
              equipmentDefaults: { orientation: 'vertical', capacity: 12, liquidLevel: 0.55 },
              primarySemanticRole: 'tank_shell',
              parts: [
                {
                  kind: 'cylindrical_tank',
                  semanticRole: 'tank_shell',
                  required: true,
                },
                {
                  kind: 'outlet_port',
                  semanticRole: 'tank_nozzle',
                  required: true,
                },
              ],
              shapeCount: { min: 2, max: 24 },
            },
          ],
        },
        null,
        2,
      ),
      'utf8',
    )

    const outputRoot = path.join(root, 'cloud')
    if (!nodeRegistry.has('factory:pump')) await loadPlugin(factoryEquipmentPlugin)
    const result = await scaffoldIndustryProfilePack({
      specPath,
      outputRoot,
      force: true,
    })
    const validation = await validateProfilePackDir(result.packDir)
    const audit = auditProfilePackValidation(validation)

    expect(result.manifest).toMatchObject({
      id: 'industry.test-industry.basic',
      version: '0.1.0',
      schemaVersion: '2.0',
      capabilities: ['factory_creation'],
      dependsOnPlugins: ['pascal:factory-equipment'],
      profiles: ['profiles/generated.json'],
      equipmentBindings: expect.arrayContaining([
        expect.objectContaining({ profileId: 'test_industry.feed_pump', nodeKind: 'factory:pump' }),
        expect.objectContaining({ profileId: 'test_industry.buffer_tank', nodeKind: 'factory:tank' }),
      ]),
      factoryArchitectures: ['factory-architectures/generated.json'],
      processTemplates: ['process-templates/generated.json'],
      qualityRules: ['quality-rules/generated-quality.json'],
    })
    expect(validation.profiles).toHaveLength(2)
    expect(validation.resources.factoryArchitectures).toHaveLength(1)
    expect(validation.resources.processTemplates).toHaveLength(1)
    expect(validation.profiles.map((profile) => profile.id)).toEqual(
      expect.arrayContaining(['test_industry.feed_pump', 'test_industry.buffer_tank']),
    )
    expect(audit).toMatchObject({ ok: true })
    expect(audit.summary).toMatchObject({ packKind: 'factory-capable' })
    expect(await fs.readFile(path.join(result.packDir, 'README.md'), 'utf8')).toContain(
      'Factory-capable pack',
    )

    expect(
      JSON.parse(
        await fs.readFile(
          path.join(result.packDir, 'factory-architectures', 'generated.json'),
          'utf8',
        ),
      ),
    ).toHaveLength(1)
    const processTemplates = JSON.parse(
      await fs.readFile(path.join(result.packDir, 'process-templates', 'generated.json'), 'utf8'),
    )
    expect(processTemplates).toHaveLength(1)
    expect(processTemplates[0].stations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'feed_pump', profileId: 'test_industry.feed_pump' }),
        expect.objectContaining({ id: 'buffer_tank', profileId: 'test_industry.buffer_tank' }),
      ]),
    )
    const v2Manifest = normalizeIndustryPackV2Manifest(validation.manifest)
    expect(
      compileProcessStationEquipment({
        manifest: v2Manifest,
        profiles: validation.resources.rawProfiles,
        station: { id: 'feed_pump', profileId: 'test_industry.feed_pump' },
      }),
    ).toMatchObject({ kind: 'equipment-node', spec: { nodeKind: 'factory:pump' } })
    expect(
      compileProcessStationEquipment({
        manifest: v2Manifest,
        profiles: validation.resources.rawProfiles,
        station: { id: 'buffer_tank', profileId: 'test_industry.buffer_tank' },
      }),
    ).toMatchObject({ kind: 'equipment-node', spec: { nodeKind: 'factory:tank' } })
  })

  test('rejects factory architecture quantity expansion fields', () => {
    expect(() =>
      normalizeIndustryPackSpec({
        industry: 'test-industry',
        capabilities: ['factory_creation'],
        factoryArchitectures: [
          {
            id: 'test.factory',
            label: 'Test factory',
            industry: 'test-industry',
            processId: 'test_full',
            layoutStyle: 'linear',
            defaultDimensions: { length: 12, width: 6 },
            modules: [
              {
                id: 'main_line',
                order: 10,
                stationIds: ['test_machine'],
                countParam: 'lineCount',
              },
            ],
          },
        ],
        processTemplates: [],
        devices: [
          {
            id: 'test_machine',
            name: 'Test machine',
            aliases: ['test machine'],
            primarySemanticRole: 'machine_body',
            parts: [{ kind: 'generic_body', semanticRole: 'machine_body' }],
          },
        ],
      }),
    ).toThrow(/countParam is not supported/)
  })

  test('reports authoring warnings for building and boiler profiles that are too generic', async () => {
    const root = await tempDir()
    const specPath = path.join(root, 'spec.json')
    await fs.writeFile(
      specPath,
      JSON.stringify(
        {
          industry: 'test-refinery',
          devices: [
            {
              id: 'control_room',
              name: 'Control room and MCC',
              aliases: ['control room', 'MCC'],
              preferredResolver: 'catalog-item',
              primarySemanticRole: 'control_room_body',
              parts: [
                { kind: 'generic_body', semanticRole: 'control_room_body' },
                { kind: 'control_box', semanticRole: 'mcc_panel' },
              ],
            },
            {
              id: 'utility_boiler',
              name: 'Utility boiler',
              aliases: ['steam boiler'],
              preferredResolver: 'profile-parts',
              primarySemanticRole: 'boiler_body',
              parts: [
                { kind: 'generic_body', semanticRole: 'boiler_body' },
                { kind: 'chimney_stack', semanticRole: 'boiler_stack' },
                { kind: 'pipe_manifold', semanticRole: 'steam_header' },
                { kind: 'control_box', semanticRole: 'boiler_control_box' },
              ],
            },
          ],
        },
        null,
        2,
      ),
      'utf8',
    )

    const result = await scaffoldIndustryProfilePack({
      specPath,
      outputRoot: path.join(root, 'cloud'),
      force: true,
      validate: false,
    })

    expect(result.authoringWarnings.map((warning) => warning.code)).toEqual(
      expect.arrayContaining([
        'control_building_catalog_resolver',
        'control_building_missing_shell_details',
        'boiler_missing_process_features',
      ]),
    )
    expect(await fs.readFile(path.join(result.packDir, 'README.md'), 'utf8')).toContain(
      '## Authoring Review',
    )
  })
})
