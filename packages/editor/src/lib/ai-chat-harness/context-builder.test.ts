import { describe, expect, test } from 'bun:test'
import {
  type AiChatHarnessMessage,
  buildGeometryHarnessContext,
  latestGeneratedGeometryArtifact,
  truncateHarnessContext,
} from './context-builder'

const artifact: NonNullable<AiChatHarnessMessage['geometryArtifact']> = {
  id: 'artifact_1',
  title: 'spur gear',
  sourceTool: 'compose_primitive',
  sourceArgs: {
    shapes: [
      {
        kind: 'extrude',
        semanticRole: 'spur_gear',
        profile: [
          [0.0495, 0],
          [0, 0.0495],
          [-0.0495, 0],
        ],
        depth: 0.02,
      },
    ],
  },
  userPrompt: 'gear',
  version: 1,
  createdAt: '2026-06-02T00:00:00.000Z',
  shapes: [
    {
      kind: 'extrude',
      position: [0, 0, 0],
      rotation: [0, 0, 0],
      semanticRole: 'spur_gear',
      profile: [
        [0.0495, 0],
        [0, 0.0495],
        [-0.0495, 0],
      ],
      depth: 0.02,
    },
  ],
  transforms: [{ position: [0, 0, 0], rotation: [0, 0, 0] }],
  assemblyName: null,
  assemblyPosition: [0, 0, 0],
  createdNames: ['spur gear'],
  shapeDetails: 'spur gear',
  placedNodeIds: ['node_1'],
}

const carArtifact: NonNullable<AiChatHarnessMessage['geometryArtifact']> = {
  ...artifact,
  id: 'car_artifact',
  title: 'car',
  sourceArgs: {
    shapes: [
      {
        kind: 'box',
        semanticRole: 'vehicle_body',
        position: [0, 0.5, 0],
        length: 4,
        width: 1.8,
        height: 0.6,
      },
      {
        kind: 'torus',
        semanticRole: 'vehicle_tire',
        position: [-1.2, 0.35, -0.95],
        majorRadius: 0.28,
        tubeRadius: 0.08,
        axis: 'x',
      },
      {
        kind: 'torus',
        semanticRole: 'vehicle_tire',
        position: [1.2, 0.35, -0.95],
        majorRadius: 0.28,
        tubeRadius: 0.08,
        axis: 'x',
      },
    ],
  },
  shapes: [
    {
      kind: 'box',
      position: [0, 0.5, 0],
      rotation: [0, 0, 0],
      semanticRole: 'vehicle_body',
      length: 4,
      width: 1.8,
      height: 0.6,
    },
    {
      kind: 'torus',
      position: [-1.2, 0.35, -0.95],
      rotation: [0, 0, 0],
      semanticRole: 'vehicle_tire',
      majorRadius: 0.28,
      tubeRadius: 0.08,
      axis: 'x',
    },
    {
      kind: 'torus',
      position: [1.2, 0.35, -0.95],
      rotation: [0, 0, 0],
      semanticRole: 'vehicle_tire',
      majorRadius: 0.28,
      tubeRadius: 0.08,
      axis: 'x',
    },
  ],
  createdNames: ['body', 'front tire', 'rear tire'],
  shapeDetails: 'car body and tires',
}

describe('ai chat harness context builder', () => {
  test('selects the latest non-superseded geometry artifact', () => {
    const messages: AiChatHarnessMessage[] = [
      { role: 'assistant', content: 'old', geometryArtifact: { ...artifact, id: 'old' } },
      {
        role: 'assistant',
        content: 'replaced',
        geometryArtifact: { ...artifact, id: 'replaced', supersededBy: 'new' },
      },
      { role: 'assistant', content: 'new', geometryArtifact: { ...artifact, id: 'new' } },
    ]

    expect(latestGeneratedGeometryArtifact(messages)?.id).toBe('new')
  })

  test('builds context with recent chat and full latest geometry structure', () => {
    const context = buildGeometryHarnessContext({
      messages: [
        { role: 'user', content: 'make a gear' },
        { role: 'assistant', content: 'created', geometryArtifact: artifact },
      ],
      latestArtifact: artifact,
      userRequest: 'scale it up five times',
      policy: { recentTurnLimit: 4, messageTextLimit: 200, artifactJsonLimit: 10_000 },
    })

    expect(context).toContain('Recent visible conversation context:')
    expect(context).toContain('Latest generated geometry artifact for continuity:')
    expect(context).toContain('"semanticRole":"spur_gear"')
    expect(context).toContain('"profile"')
    expect(context).toContain('"placedNodeIds":["node_1"]')
  })

  test('carries part-level geometry so the model can target a subpart revision', () => {
    const context = buildGeometryHarnessContext({
      messages: [
        { role: 'user', content: 'make a car' },
        { role: 'assistant', content: 'created car', geometryArtifact: carArtifact },
      ],
      latestArtifact: carArtifact,
      userRequest: 'make the wheels bigger',
      policy: { recentTurnLimit: 4, messageTextLimit: 200, artifactJsonLimit: 10_000 },
    })

    expect(context).toContain('make the wheels bigger')
    expect(context).toContain('"semanticRole":"vehicle_tire"')
    expect(context).toContain('"majorRadius":0.28')
    expect(context).toContain('"semanticRole":"vehicle_body"')
  })

  test('marks truncated context with omitted character count', () => {
    expect(truncateHarnessContext('abcdef', 3)).toBe('abc\n...<truncated 3 chars>')
  })
})
