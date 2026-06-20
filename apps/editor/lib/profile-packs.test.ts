import { afterEach, describe, expect, test } from 'bun:test'
import fs from 'node:fs/promises'
import path from 'node:path'
import { createDeviceProfileResolver } from '@pascal-app/core/lib/device-profile-registry'
import { loadDeviceProfiles } from './device-profiles'
import { findRepoRoot } from './generated-assets/manifest'
import {
  auditProfilePackValidation,
  installCloudProfilePack,
  installProfilePackZip,
  listCloudProfilePackCatalog,
  listCloudProfilePacks,
  listInstalledProfilePacks,
  profilePackIndexPath,
  profilePackStoreRoot,
  removeProfilePack,
  setProfilePackEnabled,
  validateProfilePackDir,
  validateProfilePackZip,
} from './profile-packs'

const PACK_PATH = 'industry.cement.basic@0.1.0'
const ROBOTICS_PACK_PATH = 'industry.robotics.basic@0.1.0'
const LOGISTICS_PACK_PATH = 'industry.logistics.basic@0.1.0'
const MACHINE_TOOLS_PACK_PATH = 'industry.machine-tools.basic@0.1.0'
const FINE_CHEMICAL_BASIC_PACK_PATH = 'industry.fine-chemical.basic@0.1.0'
const FINE_CHEMICAL_PHARMA_PACK_PATH = 'industry.fine-chemical.pharma-intermediate@0.1.0'
const KNOWLEDGE_PACK_DIR = 'codex-knowledge-pack-test'

async function cementZip() {
  const root = await findRepoRoot()
  return fs.readFile(
    path.join(
      root,
      'apps',
      'editor',
      'data',
      'profile-pack-cloud',
      'industry.cement.basic-0.1.0.zip',
    ),
  )
}

async function cleanInstalledPack() {
  const root = await findRepoRoot()
  await fs.rm(path.join(profilePackStoreRoot(root), PACK_PATH), { recursive: true, force: true })
  await fs.rm(path.join(profilePackStoreRoot(root), 'industry-cement-basic@0.1.0'), {
    recursive: true,
    force: true,
  })
  await fs.rm(path.join(profilePackStoreRoot(root), ROBOTICS_PACK_PATH), {
    recursive: true,
    force: true,
  })
  await fs.rm(path.join(profilePackStoreRoot(root), LOGISTICS_PACK_PATH), {
    recursive: true,
    force: true,
  })
  await fs.rm(path.join(profilePackStoreRoot(root), MACHINE_TOOLS_PACK_PATH), {
    recursive: true,
    force: true,
  })
  await fs.rm(path.join(profilePackStoreRoot(root), FINE_CHEMICAL_BASIC_PACK_PATH), {
    recursive: true,
    force: true,
  })
  await fs.rm(path.join(profilePackStoreRoot(root), FINE_CHEMICAL_PHARMA_PACK_PATH), {
    recursive: true,
    force: true,
  })
  await fs.rm(path.join(profilePackStoreRoot(root), KNOWLEDGE_PACK_DIR), {
    recursive: true,
    force: true,
  })
  await fs.rm(path.join(profilePackStoreRoot(root), 'enabled-packs.json'), { force: true })
}

describe('profile packs', () => {
  afterEach(async () => {
    await cleanInstalledPack()
  })

  test('validates the simulated cement cloud package', async () => {
    const validation = validateProfilePackZip(await cementZip())
    const audit = auditProfilePackValidation(validation)

    expect(validation.manifest).toMatchObject({
      id: 'industry.cement.basic',
      version: '0.1.0',
      industry: 'cement',
    })
    expect(validation.profiles).toHaveLength(25)
    expect(validation.profiles.map((profile) => profile.id)).toContain('cement.rotary_kiln')
    expect(audit).toMatchObject({
      ok: true,
      summary: { profileCount: 25, qualityRuleCount: 25 },
    })
  })

  test('validates and installs the robotics knowledge package', async () => {
    await cleanInstalledPack()
    const root = await findRepoRoot()
    const zip = await fs.readFile(
      path.join(
        root,
        'apps',
        'editor',
        'data',
        'profile-pack-cloud',
        'industry.robotics.basic-0.1.0.zip',
      ),
    )
    const validation = validateProfilePackZip(zip)

    expect(validation.manifest).toMatchObject({
      id: 'industry.robotics.basic',
      version: '0.1.0',
      industry: 'robotics',
    })
    expect(validation.profiles).toHaveLength(2)
    expect(validation.resources.layouts).toHaveLength(2)
    expect(validation.resources.partPresets.length).toBeGreaterThan(0)
    expect(validation.resources.qualityRules).toHaveLength(2)
    expect(validation.resources.editableSchemas.map((schema) => schema.id)).toContain(
      'robot_arm.common',
    )
    expect(auditProfilePackValidation(validation)).toMatchObject({
      ok: true,
      summary: {
        profileCount: 2,
        layoutCount: 2,
        partPresetCount: 7,
        qualityRuleCount: 2,
        editableSchemaCount: 1,
      },
    })

    const installed = await installCloudProfilePack('industry.robotics.basic', '0.1.0')
    expect(installed.pack).toMatchObject({
      id: 'industry.robotics.basic',
      path: ROBOTICS_PACK_PATH,
      profileCount: 2,
      layoutCount: 2,
      qualityRuleCount: 2,
    })

    const loaded = await loadDeviceProfiles()
    const robotProfile = loaded.profiles.find(
      (profile) => profile.id === 'robotics.six_axis_industrial_robot_arm',
    )
    expect(robotProfile).toMatchObject({
      source: 'imported_pack',
      sourcePack: { id: 'industry.robotics.basic', version: '0.1.0' },
      layoutTemplate: 'articulated_robot.six_axis',
      layoutHints: {
        robotArmDefaults: { axisCount: 6, includeWorkcell: false },
        layoutTemplate: { id: 'articulated_robot.six_axis' },
      },
      qualityRules: { id: 'quality.robot_arm.six_axis' },
      editableSchemaRef: 'robot_arm.common',
      resolvedEditableSchema: { id: 'robot_arm.common' },
    })
    const fourAxisRobotProfile = loaded.profiles.find(
      (profile) => profile.id === 'robotics.four_axis_industrial_robot_arm',
    )
    expect(fourAxisRobotProfile).toMatchObject({
      source: 'imported_pack',
      sourcePack: { id: 'industry.robotics.basic', version: '0.1.0' },
      layoutTemplate: 'articulated_robot.four_axis',
      layoutHints: {
        robotArmDefaults: { axisCount: 4, includeWorkcell: false },
        layoutTemplate: { id: 'articulated_robot.four_axis' },
      },
      qualityRules: { id: 'quality.robot_arm.four_axis' },
      editableSchemaRef: 'robot_arm.common',
      resolvedEditableSchema: {
        id: 'robot_arm.common',
        properties: { axisCount: { default: 4, min: 4, max: 4 } },
      },
    })
  })

  test('validates logistics AGV pack and loads AGV only from the resource pack', async () => {
    await cleanInstalledPack()
    const root = await findRepoRoot()
    const zip = await fs.readFile(
      path.join(
        root,
        'apps',
        'editor',
        'data',
        'profile-pack-cloud',
        'industry.logistics.basic-0.1.0.zip',
      ),
    )
    const validation = validateProfilePackZip(zip)

    expect(validation.manifest).toMatchObject({
      id: 'industry.logistics.basic',
      version: '0.1.0',
      industry: 'logistics',
    })
    expect(validation.profiles.map((profile) => profile.id)).toContain('agv_material_cart')

    const beforeInstall = await loadDeviceProfiles()
    expect(
      beforeInstall.profiles.find((profile) => profile.id === 'agv_material_cart'),
    ).toBeUndefined()

    const installed = await installCloudProfilePack('industry.logistics.basic', '0.1.0')
    expect(installed.pack).toMatchObject({
      id: 'industry.logistics.basic',
      path: LOGISTICS_PACK_PATH,
      profileCount: 1,
      qualityRuleCount: 1,
    })

    const loaded = await loadDeviceProfiles()
    const resolver = createDeviceProfileResolver(loaded.profiles)
    const agvProfile = loaded.profiles.find((profile) => profile.id === 'agv_material_cart')
    expect(agvProfile).toMatchObject({
      source: 'imported_pack',
      sourcePack: { id: 'industry.logistics.basic', version: '0.1.0' },
      qualityRules: { id: 'quality.agv_material_cart' },
    })
    expect(agvProfile?.parts.map((part) => part.kind)).toEqual(
      expect.arrayContaining([
        'mobile_platform_chassis',
        'lidar_sensor',
        'status_light_strip',
        'emergency_stop_button',
      ]),
    )
    expect(
      resolver.infer({ prompt: '\u751f\u6210\u4e00\u53f0\u81ea\u52a8\u642c\u8fd0\u8f66' })?.id,
    ).toBe('agv_material_cart')
  })

  test('machine-tools pack overrides builtin CNC profile predictably', async () => {
    await cleanInstalledPack()
    const root = await findRepoRoot()
    const zip = await fs.readFile(
      path.join(
        root,
        'apps',
        'editor',
        'data',
        'profile-pack-cloud',
        'industry.machine-tools.basic-0.1.0.zip',
      ),
    )
    const validation = validateProfilePackZip(zip)

    expect(validation.profiles.map((profile) => profile.id)).toContain('cnc_machining_center')
    const installed = await installCloudProfilePack('industry.machine-tools.basic', '0.1.0')
    expect(installed.pack).toMatchObject({
      id: 'industry.machine-tools.basic',
      path: MACHINE_TOOLS_PACK_PATH,
      profileCount: 1,
    })

    const loaded = await loadDeviceProfiles()
    const cncProfile = loaded.profiles.find((profile) => profile.id === 'cnc_machining_center')
    expect(cncProfile).toMatchObject({
      source: 'imported_pack',
      sourcePack: { id: 'industry.machine-tools.basic', version: '0.1.0' },
    })
    expect(cncProfile?.overrides).toEqual(
      expect.arrayContaining([expect.objectContaining({ source: 'builtin' })]),
    )
    expect(cncProfile?.parts.map((part) => part.kind)).toContain('operator_panel')
    expect(loaded.warnings.join('\n')).toContain(
      'builtin ignored because imported_pack has higher priority',
    )
  })

  test('installs profile pack dependencies automatically from the simulated cloud', async () => {
    await cleanInstalledPack()
    const root = await findRepoRoot()
    const extensionZip = await fs.readFile(
      path.join(
        root,
        'apps',
        'editor',
        'data',
        'profile-pack-cloud',
        'industry.fine-chemical.pharma-intermediate-0.1.0.zip',
      ),
    )
    const validation = validateProfilePackZip(extensionZip)

    expect(validation.manifest.dependsOn).toEqual([
      { id: 'industry.fine-chemical.basic', version: '>=0.1.0' },
    ])

    const installed = await installCloudProfilePack(
      'industry.fine-chemical.pharma-intermediate',
      '0.1.0',
    )
    expect(installed.pack).toMatchObject({
      id: 'industry.fine-chemical.pharma-intermediate',
      path: FINE_CHEMICAL_PHARMA_PACK_PATH,
      profileCount: 2,
    })
    expect(installed.installedDependencies).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'industry.fine-chemical.basic',
          path: FINE_CHEMICAL_BASIC_PACK_PATH,
        }),
      ]),
    )

    const packs = await listInstalledProfilePacks()
    expect(packs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'industry.fine-chemical.basic',
          enabled: true,
          dependedOnBy: expect.arrayContaining([
            expect.objectContaining({ id: 'industry.fine-chemical.pharma-intermediate' }),
          ]),
        }),
        expect.objectContaining({
          id: 'industry.fine-chemical.pharma-intermediate',
          enabled: true,
          dependsOn: [{ id: 'industry.fine-chemical.basic', version: '>=0.1.0' }],
        }),
      ]),
    )

    const loaded = await loadDeviceProfiles()
    const resolver = createDeviceProfileResolver(loaded.profiles)
    expect(
      resolver.infer({
        prompt: '\u751f\u6210\u4e00\u4e2a\u533b\u836f\u4e2d\u95f4\u4f53\u7ed3\u6676\u91dc',
      })?.id,
    ).toBe('fine_chemical.pharma.crystallization_kettle')
    expect(
      loaded.profiles.find((profile) => profile.id === 'fine_chemical.stirred_batch_reactor'),
    ).toMatchObject({
      source: 'imported_pack',
      sourcePack: { id: 'industry.fine-chemical.basic', version: '0.1.0' },
    })

    await expect(removeProfilePack(FINE_CHEMICAL_BASIC_PACK_PATH)).rejects.toThrow(
      'required by enabled pack',
    )
    await removeProfilePack(FINE_CHEMICAL_PHARMA_PACK_PATH)
    await removeProfilePack(FINE_CHEMICAL_BASIC_PACK_PATH)
    expect(await listInstalledProfilePacks()).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ id: 'industry.fine-chemical.basic' })]),
    )
  })

  test('validates knowledge-pack resources and attaches pack metadata to profiles', async () => {
    const root = await findRepoRoot()
    const packDir = path.join(profilePackStoreRoot(root), KNOWLEDGE_PACK_DIR)
    await fs.rm(packDir, { recursive: true, force: true })
    await fs.mkdir(path.join(packDir, 'profiles'), { recursive: true })
    await fs.mkdir(path.join(packDir, 'layouts'), { recursive: true })
    await fs.mkdir(path.join(packDir, 'part-presets'), { recursive: true })
    await fs.mkdir(path.join(packDir, 'quality-rules'), { recursive: true })
    await fs.writeFile(
      path.join(packDir, 'pack.json'),
      `${JSON.stringify(
        {
          id: 'industry.test.knowledge',
          name: 'Knowledge test pack',
          industry: 'test',
          version: '0.0.1',
          schemaVersion: '1.1',
          knowledgeSchemaVersion: '1.0',
          profiles: ['profiles/test-machine.json'],
          layouts: ['layouts/box-layout.json'],
          partPresets: ['part-presets/generic-body.json'],
          qualityRules: ['quality-rules/test-machine.json'],
        },
        null,
        2,
      )}\n`,
      'utf8',
    )
    await fs.writeFile(
      path.join(packDir, 'profiles', 'test-machine.json'),
      `${JSON.stringify(
        {
          id: 'test.knowledge_machine',
          name: 'Knowledge machine',
          aliases: ['knowledge machine'],
          family: 'machine_tool',
          layoutFamily: 'box_enclosure_layout',
          layoutTemplate: 'box_enclosure.compact',
          partPresets: { machine_enclosure: 'generic_body.compact' },
          qualityRules: 'quality.test_machine',
          editableSchemaRef: 'enclosure.common',
          primarySemanticRole: 'machine_enclosure',
          parts: [
            { kind: 'generic_base', semanticRole: 'machine_base', required: true },
            { kind: 'generic_body', semanticRole: 'machine_enclosure', required: true },
          ],
        },
        null,
        2,
      )}\n`,
      'utf8',
    )
    await fs.writeFile(
      path.join(packDir, 'layouts', 'box-layout.json'),
      `${JSON.stringify({ id: 'box_enclosure.compact', family: 'box_enclosure_layout' })}\n`,
      'utf8',
    )
    await fs.writeFile(
      path.join(packDir, 'part-presets', 'generic-body.json'),
      `${JSON.stringify({ id: 'generic_body.compact', partKind: 'generic_body' })}\n`,
      'utf8',
    )
    await fs.writeFile(
      path.join(packDir, 'quality-rules', 'test-machine.json'),
      `${JSON.stringify({ id: 'quality.test_machine', requiredRoles: ['machine_enclosure'] })}\n`,
      'utf8',
    )

    const validation = await validateProfilePackDir(packDir)
    const audit = auditProfilePackValidation(validation)

    expect(validation.resources.layouts).toHaveLength(1)
    expect(validation.resources.partPresets).toHaveLength(1)
    expect(validation.resources.qualityRules).toHaveLength(1)
    expect(validation.profiles[0]).toMatchObject({
      id: 'test.knowledge_machine',
      industry: 'test',
      layoutTemplate: 'box_enclosure.compact',
      editableSchemaRef: 'enclosure.common',
      sourcePack: { id: 'industry.test.knowledge', version: '0.0.1' },
    })
    expect(audit.ok).toBe(true)

    await fs.writeFile(
      profilePackIndexPath(root),
      `${JSON.stringify(
        {
          enabledPacks: [
            {
              id: 'industry.test.knowledge',
              version: '0.0.1',
              path: KNOWLEDGE_PACK_DIR,
              enabled: true,
              installedAt: new Date().toISOString(),
            },
          ],
        },
        null,
        2,
      )}\n`,
      'utf8',
    )
    const loaded = await loadDeviceProfiles()
    const loadedProfile = loaded.profiles.find((profile) => profile.id === 'test.knowledge_machine')
    expect(loadedProfile).toMatchObject({
      layoutHints: { layoutTemplate: { id: 'box_enclosure.compact' } },
      resolvedPartPresets: { 'generic_body.compact': { id: 'generic_body.compact' } },
      qualityRules: { id: 'quality.test_machine' },
    })
  })

  test('strict audit catches missing cross-resource references', async () => {
    const root = await findRepoRoot()
    const packDir = path.join(profilePackStoreRoot(root), KNOWLEDGE_PACK_DIR)
    await fs.rm(packDir, { recursive: true, force: true })
    await fs.mkdir(path.join(packDir, 'profiles'), { recursive: true })
    await fs.writeFile(
      path.join(packDir, 'pack.json'),
      `${JSON.stringify(
        {
          id: 'industry.audit.basic',
          name: 'Audit test pack',
          industry: 'audit',
          version: '0.0.1',
          schemaVersion: '1.1',
          profiles: ['profiles/test-machine.json'],
        },
        null,
        2,
      )}\n`,
      'utf8',
    )
    await fs.writeFile(
      path.join(packDir, 'profiles', 'test-machine.json'),
      `${JSON.stringify(
        {
          id: 'audit.test_machine',
          name: 'Audit machine',
          aliases: ['audit machine'],
          family: 'generic',
          layoutFamily: 'box_enclosure_layout',
          qualityRules: 'quality.audit.missing',
          primarySemanticRole: 'machine_enclosure',
          parts: [{ kind: 'generic_body', semanticRole: 'machine_enclosure', required: true }],
        },
        null,
        2,
      )}\n`,
      'utf8',
    )

    const audit = auditProfilePackValidation(await validateProfilePackDir(packDir))

    expect(audit.ok).toBe(false)
    expect(audit.issues.join('\n')).toContain(
      'Profile audit.test_machine references missing qualityRules "quality.audit.missing"',
    )
  })

  test('installs, toggles, and exposes enabled profile packs to the loader', async () => {
    await cleanInstalledPack()
    const installed = await installProfilePackZip(await cementZip())

    expect(installed.pack).toMatchObject({
      id: 'industry.cement.basic',
      enabled: true,
      profileCount: 25,
      path: PACK_PATH,
    })
    expect(await listInstalledProfilePacks()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'industry.cement.basic',
          enabled: true,
          profileCount: 25,
        }),
      ]),
    )

    const loaded = await loadDeviceProfiles()
    expect(loaded.profiles.find((profile) => profile.id === 'cement.rotary_kiln')).toMatchObject({
      source: 'imported_pack',
      family: 'tank',
    })

    await setProfilePackEnabled(PACK_PATH, false)
    const disabled = await loadDeviceProfiles()
    expect(disabled.profiles.find((profile) => profile.id === 'cement.rotary_kiln')).toBeUndefined()

    await removeProfilePack(PACK_PATH)
    expect(await listInstalledProfilePacks()).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ id: 'industry.cement.basic' })]),
    )
  })

  test('downloads from the simulated cloud and removes the installed pack', async () => {
    await cleanInstalledPack()

    const cloudPacks = await listCloudProfilePacks()
    expect(cloudPacks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'industry.cement.basic',
          installed: false,
          source: 'local_simulated_cloud',
        }),
      ]),
    )

    const installed = await installCloudProfilePack('industry.cement.basic', '0.1.0')
    expect(installed.pack.path).toBe(PACK_PATH)

    const afterInstall = await listCloudProfilePacks()
    expect(afterInstall.find((pack) => pack.id === 'industry.cement.basic')).toMatchObject({
      installed: true,
      enabled: true,
    })

    await removeProfilePack(PACK_PATH)
    const afterDelete = await listCloudProfilePacks()
    expect(afterDelete.find((pack) => pack.id === 'industry.cement.basic')).toMatchObject({
      installed: false,
      enabled: false,
    })
  })

  test('governs the simulated cloud catalog by industry, publish status, and dependencies', async () => {
    await cleanInstalledPack()

    const catalog = await listCloudProfilePackCatalog()
    const pharmaPack = catalog.packs.find(
      (pack) => pack.id === 'industry.fine-chemical.pharma-intermediate',
    )

    expect(catalog.summary.packCount).toBeGreaterThanOrEqual(6)
    expect(catalog.summary.industryCount).toBeGreaterThanOrEqual(6)
    expect(catalog.summary.blockedCount).toBe(0)
    expect(catalog.industries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'cement',
          packCount: 1,
          profileCount: 25,
        }),
        expect.objectContaining({
          id: 'fine-chemical.pharma-intermediate',
          packCount: 1,
        }),
      ]),
    )
    expect(pharmaPack).toEqual(
      expect.objectContaining({
        packType: 'extension',
        dependencyStatus: 'satisfied',
        publishStatus: 'publishable',
        governanceIssues: [],
      }),
    )
    expect(catalog.packs.every((pack) => pack.auditScore > 0)).toBe(true)
    expect(catalog.issues).toEqual([])
  })
})
