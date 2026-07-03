import { afterEach, describe, expect, test } from 'bun:test'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { loadPlugin, nodeRegistry } from '@pascal-app/core'
import { factoryEquipmentPlugin } from '@pascal-app/plugin-factory-equipment'
import { compileProcessStationEquipment } from '../lib/equipment-spec-compiler'
import { normalizeIndustryPackV2Manifest } from '../lib/industry-pack-v2'
import { auditProfilePackValidation, validateProfilePackDir } from '../lib/profile-packs'
import { migrateIndustryProfilePackToV2 } from './migrate-industry-profile-pack-v2'

const tempRoots: string[] = []

async function tempDir() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'pascal-profile-pack-migrate-'))
  tempRoots.push(dir)
  return dir
}

describe('migrate-industry-profile-pack-v2', () => {
  afterEach(async () => {
    await Promise.all(
      tempRoots.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })),
    )
  })

  test('converts a v1.1 profile pack directory into a v2 equipment binding pack', async () => {
    const root = await tempDir()
    const source = path.join(root, 'source')
    const out = path.join(root, 'migrated')
    await fs.mkdir(path.join(source, 'profiles'), { recursive: true })
    await fs.mkdir(path.join(source, 'quality-rules'), { recursive: true })
    await fs.mkdir(path.join(source, 'factory-architectures'), { recursive: true })
    await fs.mkdir(path.join(source, 'process-templates'), { recursive: true })
    await fs.writeFile(
      path.join(source, 'pack.json'),
      `${JSON.stringify(
        {
          id: 'industry.audit.basic',
          name: 'Audit Basic',
          industry: 'audit',
          version: '0.1.0',
          schemaVersion: '1.1',
          capabilities: ['factory_creation'],
          profiles: ['profiles/equipment.json'],
          qualityRules: ['quality-rules/equipment.json'],
          factoryArchitectures: ['factory-architectures/factory.json'],
          processTemplates: ['process-templates/line.json'],
        },
        null,
        2,
      )}\n`,
      'utf8',
    )
    await fs.writeFile(
      path.join(source, 'profiles', 'equipment.json'),
      `${JSON.stringify(
        [
          {
            id: 'audit.feed_pump',
            name: 'Feed pump',
            aliases: ['feed pump', 'centrifugal pump'],
            family: 'pump',
            defaultDimensions: { length: 2.1, width: 0.9, height: 1.1 },
            qualityRules: 'quality.audit.feed_pump',
            primarySemanticRole: 'pump_casing',
            parts: [
              { kind: 'volute_casing', semanticRole: 'pump_casing', required: true },
            ],
          },
          {
            id: 'audit.buffer_tank',
            name: 'Buffer tank',
            aliases: ['buffer tank', 'storage tank'],
            family: 'tank',
            defaultDimensions: { length: 2.4, width: 2.4, height: 3.2 },
            qualityRules: 'quality.audit.buffer_tank',
            primarySemanticRole: 'tank_shell',
            parts: [{ kind: 'cylindrical_tank', semanticRole: 'tank_shell', required: true }],
          },
        ],
        null,
        2,
      )}\n`,
      'utf8',
    )
    await fs.writeFile(
      path.join(source, 'quality-rules', 'equipment.json'),
      `${JSON.stringify(
        [
          { id: 'quality.audit.feed_pump', requiredRoles: ['pump_casing'] },
          { id: 'quality.audit.buffer_tank', requiredRoles: ['tank_shell'] },
        ],
        null,
        2,
      )}\n`,
      'utf8',
    )
    await fs.writeFile(
      path.join(source, 'factory-architectures', 'factory.json'),
      `${JSON.stringify(
        {
          id: 'audit.factory',
          processId: 'audit_line',
          modules: [{ id: 'main', stationIds: ['buffer_tank', 'feed_pump'] }],
        },
        null,
        2,
      )}\n`,
      'utf8',
    )
    await fs.writeFile(
      path.join(source, 'process-templates', 'line.json'),
      `${JSON.stringify(
        {
          processId: 'audit_line',
          stations: [
            { id: 'buffer_tank', label: 'Buffer tank', equipmentHint: 'audit.buffer_tank' },
            { id: 'feed_pump', label: 'Feed pump', equipmentHint: 'audit.feed_pump' },
          ],
        },
        null,
        2,
      )}\n`,
      'utf8',
    )

    if (!nodeRegistry.has('factory:pump')) await loadPlugin(factoryEquipmentPlugin)
    const result = await migrateIndustryProfilePackToV2({ packDir: source, outDir: out })
    const validation = await validateProfilePackDir(out)
    const audit = auditProfilePackValidation(validation)

    expect(result.manifest).toMatchObject({
      schemaVersion: '2.0',
      dependsOnPlugins: ['pascal:factory-equipment'],
      equipmentBindings: expect.arrayContaining([
        expect.objectContaining({ profileId: 'audit.feed_pump', nodeKind: 'factory:pump' }),
        expect.objectContaining({ profileId: 'audit.buffer_tank', nodeKind: 'factory:tank' }),
      ]),
    })
    expect(audit.ok).toBe(true)

    const templates = JSON.parse(
      await fs.readFile(path.join(out, 'process-templates', 'line.json'), 'utf8'),
    )
    expect(templates[0].stations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'feed_pump', profileId: 'audit.feed_pump' }),
        expect.objectContaining({ id: 'buffer_tank', profileId: 'audit.buffer_tank' }),
      ]),
    )

    const manifest = normalizeIndustryPackV2Manifest(validation.manifest)
    expect(
      compileProcessStationEquipment({
        manifest,
        profiles: validation.resources.rawProfiles,
        station: { id: 'feed_pump', profileId: 'audit.feed_pump' },
      }),
    ).toMatchObject({ kind: 'equipment-node', spec: { nodeKind: 'factory:pump' } })
    expect(
      compileProcessStationEquipment({
        manifest,
        profiles: validation.resources.rawProfiles,
        station: { id: 'buffer_tank', profileId: 'audit.buffer_tank' },
      }),
    ).toMatchObject({ kind: 'equipment-node', spec: { nodeKind: 'factory:tank' } })
  })
})
