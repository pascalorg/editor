import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import fs from 'node:fs/promises'
import path from 'node:path'
import { createDeviceProfileResolver } from '@pascal-app/core/lib/device-profile-registry'
import { loadDeviceProfiles } from './device-profiles'
import { findRepoRoot } from './generated-assets/manifest'

const TEST_ID = 'codex_loader_test_machine'

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
  })

  afterAll(async () => {
    await removeIfExists(workspaceFile)
    await removeIfExists(generatedFile)
  })

  test('loads JSON profiles and applies source priority', async () => {
    const loaded = await loadDeviceProfiles()
    const profile = loaded.profiles.find((candidate) => candidate.id === TEST_ID)
    const resolver = createDeviceProfileResolver(loaded.profiles)

    expect(profile).toMatchObject({
      name: 'Workspace loader test machine',
      source: 'workspace',
      family: 'machine_tool',
    })
    expect(loaded.warnings.join('\n')).toContain('higher priority')
    expect(resolver.infer({ prompt: 'please generate a workspace loader machine' })?.id).toBe(
      TEST_ID,
    )
  })
})
