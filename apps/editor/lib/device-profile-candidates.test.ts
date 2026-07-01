import { afterAll, beforeEach, describe, expect, test } from 'bun:test'
import fs from 'node:fs/promises'
import path from 'node:path'
import type { GeneratedGeometryArtifact } from '../../../packages/editor/src/lib/ai-generated-geometry-core'
import { persistDeviceProfileCandidateFromArtifact } from './device-profile-candidates'
import { loadDeviceProfiles } from './device-profiles'
import { findRepoRoot } from './generated-assets/manifest'

const TEST_ID = 'codex_candidate_freeze_dryer'

async function candidateFile() {
  const root = await findRepoRoot()
  return path.join(
    root,
    'apps',
    'editor',
    '.generated',
    'device-profile-candidates',
    `${TEST_ID}.json`,
  )
}

async function workspaceFile() {
  const root = await findRepoRoot()
  return path.join(root, 'apps', 'editor', 'data', 'device-profiles', `${TEST_ID}.json`)
}

afterAll(async () => {
  await fs.rm(await candidateFile(), { force: true })
  await fs.rm(await workspaceFile(), { force: true })
})

describe('device profile candidate store', () => {
  beforeEach(async () => {
    await fs.rm(await candidateFile(), { force: true })
    await fs.rm(await workspaceFile(), { force: true })
  })

  test('does not persist runtime drafts unless candidate capture is explicitly enabled', async () => {
    const artifact = {
      id: 'artifact_candidate_disabled_test',
      title: 'Freeze dryer',
      sourceTool: 'compose_parts',
      sourceArgs: {
        deviceProfileDraft: {
          id: TEST_ID,
          name: 'Candidate Freeze Dryer',
          aliases: ['candidate freeze dryer'],
          layoutFamily: 'generic_industrial_layout',
          archetypeFamily: 'generic_industrial',
          family: 'generic',
          defaultDimensions: { length: 2, width: 1, height: 1.6 },
          parts: [
            { kind: 'generic_body', semanticRole: 'vacuum_chamber', required: true },
          ],
          primarySemanticRole: 'vacuum_chamber',
          description: 'Runtime test draft.',
        },
      },
      userPrompt: 'make a freeze dryer',
      version: 1,
      createdAt: new Date().toISOString(),
      shapes: [
        {
          kind: 'box',
          position: [0, 0.8, 0],
          rotation: [0, 0, 0],
          length: 2,
          width: 1,
          height: 1.6,
          semanticRole: 'vacuum_chamber',
          sourcePartKind: 'generic_body',
        },
      ],
      transforms: [],
      assemblyName: 'Freeze dryer',
      assemblyPosition: [0, 0, 0],
      createdNames: ['body'],
      shapeDetails: '',
      profileQuality: {
        semanticScore: 1,
        geometryScore: 1,
        editabilityScore: 1,
        visualCompletenessScore: 1,
        overallScore: 0.95,
        warnings: [],
        issues: [],
        metrics: { shapeCount: 1 },
      },
    } satisfies GeneratedGeometryArtifact

    const saved = await persistDeviceProfileCandidateFromArtifact('make a freeze dryer', artifact)
    expect(saved).toMatchObject({ saved: false, reason: 'disabled' })

    await expect(fs.stat(await candidateFile())).rejects.toThrow()
  })

  test('persists high quality runtime drafts and loads them as low-priority candidates', async () => {
    const artifact = {
      id: 'artifact_candidate_test',
      title: 'Freeze dryer',
      sourceTool: 'compose_parts',
      sourceArgs: {
        deviceProfileDraft: {
          id: TEST_ID,
          name: 'Candidate Freeze Dryer',
          aliases: ['candidate freeze dryer'],
          layoutFamily: 'generic_industrial_layout',
          archetypeFamily: 'generic_industrial',
          family: 'generic',
          defaultDimensions: { length: 2, width: 1, height: 1.6 },
          parts: [
            { kind: 'generic_body', semanticRole: 'vacuum_chamber', required: true },
            { kind: 'generic_base', semanticRole: 'machine_base', required: true },
          ],
          primarySemanticRole: 'vacuum_chamber',
          description: 'Runtime test draft.',
        },
      },
      userPrompt: 'make a freeze dryer',
      version: 1,
      createdAt: new Date().toISOString(),
      shapes: [
        {
          kind: 'box',
          position: [0, 0.8, 0],
          rotation: [0, 0, 0],
          length: 2,
          width: 1,
          height: 1.6,
          semanticRole: 'vacuum_chamber',
          sourcePartKind: 'generic_body',
        },
        {
          kind: 'box',
          position: [0, 0.05, 0],
          rotation: [0, 0, 0],
          length: 2,
          width: 1,
          height: 0.1,
          semanticRole: 'machine_base',
          sourcePartKind: 'generic_base',
        },
      ],
      transforms: [],
      assemblyName: 'Freeze dryer',
      assemblyPosition: [0, 0, 0],
      createdNames: ['body', 'base'],
      shapeDetails: '',
      profileQuality: {
        semanticScore: 1,
        geometryScore: 1,
        editabilityScore: 1,
        visualCompletenessScore: 1,
        overallScore: 0.95,
        warnings: [],
        issues: [],
        metrics: { shapeCount: 2 },
      },
    } satisfies GeneratedGeometryArtifact

    const saved = await persistDeviceProfileCandidateFromArtifact('make a freeze dryer', artifact, {
      enabled: true,
    })
    expect(saved).toMatchObject({ saved: true, profileId: TEST_ID })

    const loaded = await loadDeviceProfiles()
    expect(loaded.profiles.find((profile) => profile.id === TEST_ID)).toMatchObject({
      id: TEST_ID,
      status: 'candidate',
      source: 'generated_candidate',
    })

    await fs.mkdir(path.dirname(await workspaceFile()), { recursive: true })
    await fs.writeFile(
      await workspaceFile(),
      `${JSON.stringify(
        {
          ...artifact.sourceArgs.deviceProfileDraft,
          name: 'Workspace Freeze Dryer',
          status: 'stable',
          source: 'workspace',
        },
        null,
        2,
      )}\n`,
      'utf8',
    )
    const withWorkspace = await loadDeviceProfiles()
    expect(withWorkspace.profiles.find((profile) => profile.id === TEST_ID)).toMatchObject({
      name: 'Workspace Freeze Dryer',
      source: 'workspace',
    })
  })
})
