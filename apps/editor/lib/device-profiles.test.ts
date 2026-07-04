import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import fs from 'node:fs/promises'
import path from 'node:path'
import { inferDeviceProfileDefinition } from '@pascal-app/core/lib/device-profile-registry'
import { loadDeviceProfiles } from './device-profiles'
import { findRepoRoot } from './generated-assets/manifest'

const TEST_ID = 'codex_loader_test_machine'
const EXTRA_PACK_PROFILE_ID = 'codex_extra_pack_loader_machine'

async function writeJson(filePath: string, value: unknown) {
  await fs.mkdir(path.dirname(filePath), { recursive: true })
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
}

async function removeIfExists(filePath: string) {
  await fs.rm(filePath, { force: true }).catch(() => {})
}

describe('device profile source loader', () => {
  let workspaceFile = ''
  let generatedFile = ''
  let extraPackDir = ''

  beforeAll(async () => {
    const root = await findRepoRoot()
    workspaceFile = path.join(root, 'apps', 'editor', 'data', 'device-profiles', `${TEST_ID}.json`)
    generatedFile = path.join(
      root,
      'apps',
      'editor',
      '.generated',
      'device-profile-candidates',
      `${TEST_ID}.json`,
    )
    extraPackDir = path.join(
      root,
      'apps',
      'editor',
      '.generated',
      'device-profile-pack-loader-test',
    )
    await writeJson(generatedFile, {
      id: TEST_ID,
      name: 'Generated loader test machine',
      aliases: ['generated loader machine'],
      family: 'generic',
      layoutFamily: 'generic_industrial_layout',
      primarySemanticRole: 'main_body',
      parts: [
        { kind: 'generic_base', semanticRole: 'support_base', required: true },
        { kind: 'generic_body', semanticRole: 'main_body', required: true },
      ],
    })
    await writeJson(workspaceFile, {
      id: TEST_ID,
      name: 'Workspace loader test machine',
      aliases: ['workspace loader machine'],
      family: 'machine_tool',
      layoutFamily: 'box_enclosure_layout',
      primarySemanticRole: 'machine_enclosure',
      parts: [
        { kind: 'generic_base', semanticRole: 'machine_base', required: true },
        { kind: 'generic_body', semanticRole: 'machine_enclosure', required: true },
        { kind: 'control_box', semanticRole: 'control_panel' },
      ],
    })
    await writeJson(path.join(extraPackDir, 'pack.json'), {
      id: 'codex.extra-pack-loader-test',
      name: 'Extra pack loader test',
      industry: 'test',
      version: '0.0.1',
      schemaVersion: '1.1',
      profiles: ['profiles/extra.json'],
    })
    await writeJson(path.join(extraPackDir, 'profiles', 'extra.json'), {
      id: EXTRA_PACK_PROFILE_ID,
      name: 'Extra pack loader test machine',
      aliases: ['extra pack loader machine'],
      family: 'generic',
      layoutFamily: 'generic_industrial_layout',
      primarySemanticRole: 'main_body',
      parts: [
        { kind: 'generic_base', semanticRole: 'support_base', required: true },
        { kind: 'generic_body', semanticRole: 'main_body', required: true },
      ],
    })
  }, 30_000)

  afterAll(async () => {
    await removeIfExists(workspaceFile)
    await removeIfExists(generatedFile)
    await fs.rm(extraPackDir, { recursive: true, force: true }).catch(() => {})
  }, 30_000)

  test('loads JSON profiles and applies source priority', async () => {
    const loaded = await loadDeviceProfiles()
    const profile = loaded.profiles.find((candidate) => candidate.id === TEST_ID)

    expect(profile).toMatchObject({
      name: 'Workspace loader test machine',
      source: 'workspace',
      family: 'machine_tool',
    })
    expect(loaded.warnings.join('\n')).toContain('higher priority')
  })

  test('loads profiles from explicit extra pack directories without installing the pack', async () => {
    const loaded = await loadDeviceProfiles({ extraPackDirs: [extraPackDir] })
    const profile = loaded.profiles.find((candidate) => candidate.id === EXTRA_PACK_PROFILE_ID)

    expect(profile).toMatchObject({
      name: 'Extra pack loader test machine',
      source: 'imported_pack',
      sourcePack: {
        id: 'codex.extra-pack-loader-test',
        version: '0.0.1',
        industry: 'test',
      },
    })
  })

  test('matches cement rotary kiln from a loaded industry pack before freeform generation', async () => {
    const root = await findRepoRoot()
    const loaded = await loadDeviceProfiles({
      extraPackDirs: [
        path.join(
          root,
          'cloud',
          'industry.cement.basic-0.1.0',
        ),
      ],
    })
    const profile = inferDeviceProfileDefinition(
      {
        prompt: '创建一个回转窑',
        name: '创建一个回转窑',
        object: '创建一个回转窑',
      },
      loaded.profiles,
    )

    expect(profile).toMatchObject({
      id: 'cement.rotary_kiln',
      source: 'imported_pack',
      sourcePack: {
        id: 'industry.cement.basic',
        version: '0.1.0',
        industry: 'cement',
      },
    })
  })
})
