import { afterEach, describe, expect, test } from 'bun:test'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { auditProfilePackValidation, validateProfilePackDir } from '../lib/profile-packs'
import { scaffoldIndustryProfilePack } from './scaffold-industry-profile-pack'

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
                  stationIds: ['test_machine'],
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
                  id: 'test_machine',
                  label: 'Test machine',
                  displayLabel: 'Test machine',
                  role: 'test_machine',
                  equipmentHint: 'test_industry.test_machine generic test machine',
                  footprintHint: 'medium',
                },
                {
                  id: 'control_panel',
                  label: 'Control panel',
                  displayLabel: 'Control panel',
                  role: 'control_panel',
                  equipmentHint: 'industrial operator control panel',
                  footprintHint: 'small',
                },
              ],
              connections: [
                {
                  fromStationId: 'control_panel',
                  toStationId: 'test_machine',
                  medium: 'power',
                  visualKind: 'cable_tray',
                },
              ],
            },
          ],
          devices: [
            {
              id: 'test_machine',
              name: 'Test machine',
              aliases: ['test machine', 'test equipment'],
              layoutFamily: 'generic_industrial_layout',
              family: 'generic',
              defaultDimensions: { length: 1.2, width: 0.8, height: 0.9 },
              primarySemanticRole: 'machine_body',
              parts: [
                {
                  kind: 'generic_body',
                  semanticRole: 'machine_body',
                  required: true,
                  length: 1.2,
                  width: 0.8,
                  height: 0.9,
                },
                {
                  kind: 'operator_panel',
                  semanticRole: 'control_panel',
                  required: true,
                },
              ],
              forbiddenRoles: ['vehicle_cabin'],
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
      profiles: ['profiles/generated.json'],
      factoryArchitectures: ['factory-architectures/generated.json'],
      processTemplates: ['process-templates/generated.json'],
      qualityRules: ['quality-rules/generated-quality.json'],
    })
    expect(validation.profiles).toHaveLength(1)
    expect(validation.profiles[0]).toMatchObject({
      id: 'test_industry.test_machine',
      qualityRules: 'quality.test_industry.test_machine',
      primarySemanticRole: 'machine_body',
    })
    expect(audit).toMatchObject({ ok: true })

    expect(
      JSON.parse(
        await fs.readFile(
          path.join(result.packDir, 'factory-architectures', 'generated.json'),
          'utf8',
        ),
      ),
    ).toHaveLength(1)
    expect(
      JSON.parse(
        await fs.readFile(path.join(result.packDir, 'process-templates', 'generated.json'), 'utf8'),
      ),
    ).toHaveLength(1)
  })
})
