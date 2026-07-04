import { describe, expect, test } from 'bun:test'
import {
  type AiChatHarnessMessage,
  buildGeometryAnalysisContext,
  buildGeometryContextResolverPrompt,
  buildGeometryHarnessContext,
  isLikelyGeometryRevisionRequest,
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
  editHistory: [
    {
      at: '2026-06-05T00:00:00.000Z',
      tool: 'revise_geometry',
      feedback: 'Do not make the cabin detached again.',
      intent: 'fix cabin proportions',
      summary: 'Integrated the glasshouse into the vehicle body.',
    },
  ],
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

  test('builds compact analysis context without full latest geometry json', () => {
    const context = buildGeometryAnalysisContext({
      messages: [
        { role: 'user', content: 'make a gear' },
        { role: 'assistant', content: 'created', geometryArtifact: artifact },
      ],
      latestArtifact: artifact,
      userRequest: 'make it a new color',
      policy: { recentTurnLimit: 4, messageTextLimit: 200, artifactJsonLimit: 10_000 },
    })

    expect(context).toContain('Latest generated geometry artifact for continuity:')
    expect(context).toContain('Primitive multi-turn revision memory:')
    expect(context).toContain(
      'Full latest generated geometry artifact JSON is intentionally omitted',
    )
    expect(context).not.toContain(
      'Full latest generated geometry artifact JSON for precise revision operations',
    )
    expect(context).not.toContain('"shapes"')
    expect(context).not.toContain('"profile"')
    expect(context).not.toContain('"placedNodeIds"')
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
    expect(context).toContain('Likely follow-up revision')
    expect(context).toContain('semanticRoles=vehicle_body:1, vehicle_tire:2')
    expect(context).toContain('Primitive multi-turn revision memory:')
    expect(context).toContain('Rejected approaches / do-not-repeat')
    expect(context).toContain('Do not make the cabin detached again.')
  })

  test('includes selected object capabilities for semantic edit targeting', () => {
    const context = buildGeometryHarnessContext({
      messages: [],
      latestArtifact: null,
      userRequest: 'set the selected tank liquid level to 60%',
      selectionCapabilities: [
        {
          nodeId: 'assembly_storage_tank',
          nodeType: 'assembly',
          label: 'Crude tank A',
          sources: ['semantic-assembly', 'industry-pack'],
          capabilities: [
            {
              id: 'semantic.params',
              label: 'Equipment parameters',
              target: 'assembly',
              editable: true,
            },
            { id: 'ports', label: 'Ports', target: 'assembly', editable: false },
          ],
          editableParts: [
            { nodeId: 'box_shell', semanticRole: 'vessel_shell', editable: true },
            { nodeId: 'box_liquid', semanticRole: 'liquid_volume', editable: true },
          ],
          ports: [{ id: 'inlet', medium: 'crude', side: 'west' }],
          dataBindings: [],
          profileId: 'refinery.crude_storage_tank',
          recipeId: 'factory:storage-tank',
          equipmentFamily: 'tank',
        },
      ],
    })

    expect(context).toContain('Canvas selection capability context:')
    expect(context).toContain('Crude tank A [assembly] id=assembly_storage_tank')
    expect(context).toContain('semantic.params:editable@assembly')
    expect(context).toContain('ports:read-only@assembly')
    expect(context).toContain('liquid_volume#box_liquid')
    expect(context).toContain('inlet(crude/west)')
    expect(context).toContain('Semantic live data binding targets:')
    expect(context).toContain('tank-level (Tank liquid level')
    expect(context).toContain('defaultPath=refinery.tank.level')
    expect(context).toContain('Prefer editable semantic parts/params')
  })

  test('classifies obvious follow-up feedback separately from new-object requests', () => {
    expect(isLikelyGeometryRevisionRequest('窗户和车顶分开了，比例不对', carArtifact)).toBe(true)
    expect(isLikelyGeometryRevisionRequest('make it wider and smoother', carArtifact)).toBe(true)
    expect(isLikelyGeometryRevisionRequest('make it a new color', carArtifact)).toBe(true)
    expect(isLikelyGeometryRevisionRequest('give this a different material', carArtifact)).toBe(
      true,
    )
    expect(
      isLikelyGeometryRevisionRequest(
        '\u98ce\u6247\u53f6\u5b50\u77ed\u4e86\u70b9\uff0c\u52a0\u957f\u4e00\u70b9',
        carArtifact,
      ),
    ).toBe(true)
    expect(isLikelyGeometryRevisionRequest('重新生成一个皮带输送机', carArtifact)).toBe(false)
    expect(isLikelyGeometryRevisionRequest('继续生成其他物品', carArtifact)).toBe(false)
    expect(isLikelyGeometryRevisionRequest('再生成一个烟囱', carArtifact)).toBe(false)
    expect(isLikelyGeometryRevisionRequest('换一个别的模型', carArtifact)).toBe(false)
    expect(isLikelyGeometryRevisionRequest('generate a new conveyor', carArtifact)).toBe(false)
    expect(isLikelyGeometryRevisionRequest('generate another object', carArtifact)).toBe(false)
    expect(isLikelyGeometryRevisionRequest('make a new object with red color', carArtifact)).toBe(
      false,
    )
    expect(isLikelyGeometryRevisionRequest('生成一个烟囱', carArtifact)).toBe(false)
  })

  test('does not carry old conversation text into a new-object request with no artifact', () => {
    const context = buildGeometryHarnessContext({
      messages: [
        { role: 'user', content: '生成一个储罐' },
        { role: 'assistant', content: '已生成储罐', geometryArtifact: artifact },
      ],
      latestArtifact: null,
      userRequest: '生成一个烟囱',
      policy: { recentTurnLimit: 4, messageTextLimit: 200, artifactJsonLimit: 10_000 },
    })

    expect(context).toContain('Current user request:\n生成一个烟囱')
    expect(context).toContain('Prior visible chat turns are omitted')
    expect(context).not.toContain('生成一个储罐')
    expect(context).not.toContain('Latest generated geometry artifact for continuity')
  })

  test('omits prior artifact details when a new-object request still has a latest artifact candidate', () => {
    const context = buildGeometryHarnessContext({
      messages: [
        { role: 'user', content: '生成一个电风扇' },
        { role: 'assistant', content: 'created fan', geometryArtifact: carArtifact },
      ],
      latestArtifact: carArtifact,
      userRequest: '继续生成其他物品，比如一个烟囱',
      policy: { recentTurnLimit: 4, messageTextLimit: 200, artifactJsonLimit: 10_000 },
    })

    expect(context).toContain('Treat this as a new-object request')
    expect(context).toContain('Prior visible chat turns are omitted')
    expect(context).toContain('not included because this request asks for a different/new object')
    expect(context).not.toContain('Latest generated geometry artifact for continuity')
    expect(context).not.toContain('"semanticRole":"vehicle_tire"')
    expect(context).not.toContain('生成一个电风扇')
  })

  test('can include full artifact from an explicit context resolver decision', () => {
    const context = buildGeometryHarnessContext({
      messages: [
        { role: 'user', content: '生成一个汽车轮子' },
        { role: 'assistant', content: 'created wheel', geometryArtifact: carArtifact },
      ],
      latestArtifact: carArtifact,
      userRequest: '汽车轮子粗一点，再生成下',
      contextDecision: {
        relationshipToLatestArtifact: 'modify_previous',
        contextPolicy: 'include_full_artifact',
        recommendedRoute: 'revise_geometry',
        confidence: 0.92,
        reason: 'The request asks to make the previous car wheel thicker and regenerate it.',
        editIntent: {
          type: 'semantic_size_change',
          target: 'wheel',
          dimension: 'thickness',
          strength: 'slight_increase',
        },
      },
      policy: { recentTurnLimit: 4, messageTextLimit: 200, artifactJsonLimit: 10_000 },
    })

    expect(context).toContain('Context resolver selected include_full_artifact')
    expect(context).toContain('汽车轮子粗一点，再生成下')
    expect(context).toContain('Full latest generated geometry artifact JSON')
    expect(context).toContain('"semanticRole":"vehicle_tire"')
    expect(context).toContain('"placedNodeIds":["node_1"]')
  })

  test('summary-only context keeps artifact identity without full shape json', () => {
    const context = buildGeometryHarnessContext({
      messages: [{ role: 'assistant', content: 'created car', geometryArtifact: carArtifact }],
      latestArtifact: carArtifact,
      userRequest: '生成一条船',
      contextDecision: {
        relationshipToLatestArtifact: 'different_object',
        contextPolicy: 'summary_only',
        recommendedRoute: 'new_geometry',
        confidence: 0.88,
        reason: 'The current request asks for a different object.',
      },
      policy: { recentTurnLimit: 4, messageTextLimit: 200, artifactJsonLimit: 10_000 },
    })

    expect(context).toContain('Latest generated geometry artifact summary for context only')
    expect(context).toContain('title=car')
    expect(context).toContain('semanticRoles=vehicle_body:1, vehicle_tire:2')
    expect(context).not.toContain(
      'Full latest generated geometry artifact JSON for precise revision',
    )
    expect(context).not.toContain('"shapes"')
    expect(context).not.toContain('"majorRadius":0.28')
  })

  test('context resolver prompt tells the model not to treat 再生成 as unrelated by itself', () => {
    const prompt = buildGeometryContextResolverPrompt({
      messages: [{ role: 'assistant', content: 'created wheel', geometryArtifact: carArtifact }],
      latestArtifact: carArtifact,
      userRequest: '汽车轮子粗一点，再生成下',
      policy: { recentTurnLimit: 4, messageTextLimit: 200, artifactJsonLimit: 10_000 },
    })

    expect(prompt).toContain('Do not treat phrases like "generate again", "再生成"')
    expect(prompt).toContain('Latest generated artifact summary:')
    expect(prompt).toContain('semanticRoles=vehicle_body:1, vehicle_tire:2')
  })

  test('marks truncated context with omitted character count', () => {
    expect(truncateHarnessContext('abcdef', 3)).toBe('abc\n...<truncated 3 chars>')
  })
})
