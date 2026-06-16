import { describe, expect, test } from 'bun:test'
import type { GeneratedGeometryArtifact } from '../ai-generated-geometry-core'
import { buildPrimitiveRevisionMemory, formatPrimitiveRevisionMemory } from './revision-memory'

const mixerArtifact: GeneratedGeometryArtifact = {
  id: 'mixer_1',
  title: 'Mud mixer',
  sourceTool: 'compose_parts',
  sourceArgs: {},
  userPrompt: 'mud mixer with three blades',
  version: 2,
  createdAt: '2026-06-05T00:00:00.000Z',
  geometryBrief: { category: 'mixer' },
  shapes: [
    {
      kind: 'cylinder',
      name: 'shaft',
      semanticRole: 'mixer_shaft',
      sourcePartKind: 'mixer_shaft',
      position: [0, 0.7, 0],
      rotation: [0, 0, 0],
      axis: 'y',
      radius: 0.03,
      height: 1.4,
    },
    {
      kind: 'cylinder',
      name: 'hub',
      semanticRole: 'mixer_hub',
      sourcePartKind: 'mixer_hub',
      position: [0, 0.1, 0],
      rotation: [0, 0, 0],
      axis: 'y',
      radius: 0.07,
      height: 0.08,
    },
    ...[0, 1, 2].map((index): GeneratedGeometryArtifact['shapes'][number] => ({
      kind: 'extrude',
      name: `blade ${index + 1}`,
      semanticRole: 'mixer_blade',
      sourcePartKind: 'propeller_blade_set',
      position: [index, 0.1, 0],
      rotation: [0, 0, 0],
      profile: [
        [0, 0],
        [1, 0],
        [0, 1],
      ],
      depth: 0.03,
      material: { properties: { color: '#64748b' } },
    })),
  ],
  transforms: [],
  assemblyName: 'Mud mixer',
  assemblyPosition: [0, 0, 0],
  createdNames: ['shaft', 'hub', 'blade 1', 'blade 2', 'blade 3'],
  shapeDetails: 'mixer',
  semanticSummary: 'Validation: family=mixer, score=1.00',
  visualQualitySummary: 'Visual quality: family=industrial_equipment, score=0.90',
  editHistory: [
    {
      at: '2026-06-05T00:01:00.000Z',
      tool: 'revise_geometry',
      feedback: 'The three blades must stay on the same horizontal level.',
      intent: 'fix blade orientation',
      summary: 'Kept the shaft and hub; adjusted blade pitch.',
      operations: [
        { op: 'transform', selector: { semanticRole: 'mixer_blade' }, rotation: [0, 0, 0] },
      ],
    },
  ],
}

describe('primitive revision memory', () => {
  test('extracts route memory, constraints, rejected approaches, and failure learnings', () => {
    const memory = buildPrimitiveRevisionMemory({
      artifact: mixerArtifact,
      currentUserRequest: 'Do not use rectangular blades; keep the blade angle corrected.',
      messages: [
        { role: 'user', content: 'Those rectangular blades look wrong.' },
        {
          role: 'assistant',
          content: 'Invalid geometry tool call. required semantic role "mixer_hub" is missing.',
        },
      ],
    })

    expect(memory.family).toBe('mixer')
    expect(memory.routeMemory.join('\n')).toContain('propeller/mixer blade kernels')
    expect(memory.activeConstraints).toContain(
      'keep related blades/parts on the same horizontal level',
    )
    expect(memory.activeConstraints).toContain(
      'preserve corrected orientation/angle constraints during revisions',
    )
    expect(memory.rejectedApproaches.join('\n')).toContain('rectangular blades')
    expect(memory.failureLearnings.join('\n')).toContain('缺少必需语义部件')

    const formatted = formatPrimitiveRevisionMemory(memory)
    expect(formatted).toContain('Route memory')
    expect(formatted).toContain('Rejected approaches')
  })
})
