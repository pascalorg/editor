import { describe, expect, test } from 'bun:test'
import type {
  GeneratedGeometryArtifact,
  GeneratedGeometryShapeSpec,
} from '../../../../packages/editor/src/lib/ai-generated-geometry-core'
import {
  applyDeviceProfileToPartInput,
  inferDeviceProfileDefinition,
} from '../../../../packages/core/src/lib/device-profile-registry'
import { executeGeometryToolCall } from '../../../../packages/editor/src/lib/ai-geometry-tool-executor'
import { loadDeviceProfiles } from '../device-profiles'
import {
  ensurePromptInPrimitiveContext,
  isSafeDeterministicProfileMatch,
  polishStage3SemanticArtifact,
  precisionPartDeterministicRoute,
  repairStage3SemanticArtifact,
  stage3QualityReview,
  stripNegatedTargetClauses,
} from './primitive-runner'
import { resolveProfileResourceCandidates } from './resource-profile-resolver'

function shape(
  semanticRole: string,
  sourcePartKind: string,
  name = semanticRole,
): GeneratedGeometryShapeSpec {
  return {
    kind: 'box',
    name,
    semanticRole,
    sourcePartKind,
    position: [0, 0, 0],
    rotation: [0, 0, 0],
    length: 1,
    width: 1,
    height: 1,
  }
}

function artifact(shapes: GeneratedGeometryShapeSpec[]): GeneratedGeometryArtifact {
  return {
    id: 'stage3_test',
    title: 'Stage3 test',
    sourceTool: 'compose_parts',
    sourceArgs: {},
    userPrompt: 'test',
    version: 1,
    createdAt: '2026-06-18T00:00:00.000Z',
    shapes,
    transforms: shapes.map((shape) => ({
      position: shape.position ?? [0, 0, 0],
      rotation: shape.rotation ?? [0, 0, 0],
    })),
    assemblyName: 'Stage3 test',
    assemblyPosition: [0, 0, 0],
    createdNames: shapes.map((item) => item.name ?? item.kind),
    shapeDetails: '',
  }
}

function profileForMatchTest(
  input: Record<string, unknown>,
): Parameters<typeof isSafeDeterministicProfileMatch>[0] {
  return input as Parameters<typeof isSafeDeterministicProfileMatch>[0]
}

describe('Stage3 primitive quality gate', () => {
  test('resolves refinery utility boiler from resource profiles before free primitive generation', async () => {
    const prompt =
      '\u751f\u6210\u4e00\u4e2a\u516c\u7528\u5de5\u7a0b\u9505\u7089'
    const loaded = await loadDeviceProfiles({
      extraPackDirs: ['cloud/industry.refinery.basic-0.1.0'],
    })
    const resolution = resolveProfileResourceCandidates(prompt, loaded.profiles)

    expect(resolution.selectedProfile).toMatchObject({
      id: 'refinery.utility_boiler',
      sourcePack: {
        id: 'industry.refinery.basic',
      },
    })
    expect(resolution.selectedCandidate).toMatchObject({
      matchedLabel: '\u516c\u7528\u5de5\u7a0b\u9505\u7089',
      matchKind: 'alias',
    })

    const profile = resolution.selectedProfile
    expect(profile).toBeDefined()
    expect(
      inferDeviceProfileDefinition({ prompt, name: prompt, object: prompt }, loaded.profiles)?.id,
    ).toBe('refinery.utility_boiler')

    const args = applyDeviceProfileToPartInput(profile!, {
      prompt,
      name: profile!.name,
      object: profile!.name,
      category: profile!.id,
      deviceProfile: profile!.id,
      profile: profile!.id,
      forceProfile: true,
    })
    const result = executeGeometryToolCall('compose_parts', args, {
      prompt,
      deviceProfiles: loaded.profiles,
    })

    expect(result.content).not.toContain('Invalid geometry tool call')
    expect(result.artifact?.sourceArgs.deviceProfile).toBe('refinery.utility_boiler')
    expect(result.artifact?.shapes.map((shape) => shape.semanticRole)).toEqual(
      expect.arrayContaining([
        'boiler_body',
        'boiler_stack',
        'steam_header',
        'boiler_control_box',
      ]),
    )
  })

  test('returns refinery distillation candidates for a generic distillation tower request', async () => {
    const prompt = '\u751f\u6210\u4e00\u4e2a\u84b8\u998f\u5854'
    const loaded = await loadDeviceProfiles({
      extraPackDirs: ['cloud/industry.refinery.basic-0.1.0'],
    })
    const resolution = resolveProfileResourceCandidates(prompt, loaded.profiles)

    expect(resolution.selectedProfile).toBeUndefined()
    expect(resolution.candidates.slice(0, 2).map((candidate) => candidate.profile.id)).toEqual([
      'refinery.atmospheric_distillation_unit',
      'refinery.vacuum_distillation_unit',
    ])
    expect(resolution.candidates.slice(0, 2).map((candidate) => candidate.matchedLabel)).toEqual([
      '\u5e38\u538b\u84b8\u998f\u5854',
      '\u51cf\u538b\u84b8\u998f\u5854',
    ])
  })

  test('prefers the specific refinery distillation profile when the prompt names it', async () => {
    const prompt = '\u751f\u6210\u4e00\u4e2a\u5e38\u538b\u84b8\u998f\u5854'
    const loaded = await loadDeviceProfiles({
      extraPackDirs: ['cloud/industry.refinery.basic-0.1.0'],
    })
    const resolution = resolveProfileResourceCandidates(prompt, loaded.profiles)

    expect(resolution.selectedProfile).toMatchObject({
      id: 'refinery.atmospheric_distillation_unit',
      sourcePack: {
        id: 'industry.refinery.basic',
      },
    })
    expect(resolution.candidates[0]).toMatchObject({
      matchedLabel: '\u5e38\u538b\u84b8\u998f\u5854',
      matchKind: 'alias',
    })
  })

  test('keeps the target prompt when callers provide only meta context', () => {
    const context = ensurePromptInPrimitiveContext(
      '生成一个建筑工地塔�?,
      'Primitive geometry assembly QA. Use compose_parts and preserve topology.',
    )

    expect(context).toContain('User request: 生成一个建筑工地塔�?)
    expect(context).toContain('Additional context:')
  })

  test('does not duplicate context that already includes the user prompt', () => {
    const context = ensurePromptInPrimitiveContext(
      '生成一个空调外�?,
      'User request: 生成一个空调外机\n\nUse primitive geometry.',
    )

    expect(context.match(/生成一个空调外�?g)?.length).toBe(1)
  })

  test('rejects deterministic profiles that only appear in negated prompt spans', () => {
    const profile = profileForMatchTest({
      id: 'process.raw_material_tank',
      name: 'Raw material storage tank',
      aliases: ['storage tank', 'tank'],
      status: 'stable',
    })

    expect(
      isSafeDeterministicProfileMatch(
        profile,
        'Generate a construction tower crane. Do not generate a mixer tank, storage tank, airplane, or generic box.',
      ),
    ).toBe(false)
  })

  test('rejects weak single-token profile aliases for unrelated deterministic routing', () => {
    const profile = profileForMatchTest({
      id: 'shell_tube_heat_exchanger',
      name: 'Shell-and-tube heat exchanger',
      aliases: ['condenser'],
      status: 'stable',
    })

    expect(
      isSafeDeterministicProfileMatch(
        profile,
        'Generate an outdoor air conditioner condenser unit with fan grille and side louvers.',
      ),
    ).toBe(false)
  })

  test('allows exact stable profile names and ids for deterministic routing', () => {
    const profile = profileForMatchTest({
      id: 'bicycle',
      name: 'Bicycle',
      aliases: ['bike'],
      status: 'stable',
    })

    expect(isSafeDeterministicProfileMatch(profile, 'Generate a bicycle with a red frame.')).toBe(
      true,
    )
  })

  test('ignores negated target clauses for deterministic precision routes', () => {
    expect(
      stripNegatedTargetClauses(
        'Generate an outdoor AC unit. Do not generate a pedestal fan, rotary screen, pump, or bicycle.',
      ),
    ).not.toMatch(/pump|bicycle/)
    expect(
      precisionPartDeterministicRoute(
        'Generate an outdoor AC unit. Do not generate a pedestal fan, rotary screen, pump, or bicycle.',
        null,
      ),
    ).toBeUndefined()
    expect(
      precisionPartDeterministicRoute(
        'Generate a tower crane. Do not generate a mixer tank, storage tank, airplane, or bicycle.',
        null,
      )?.label,
    ).toBe('hammerhead tower crane')
  })

  test('repairs round container output that used generic body boxes', () => {
    const review = stage3QualityReview(
      '\u751f\u6210\u4e00\u4e2a\u5706\u67f1\u6c34\u74f6',
      artifact([
        shape('bottle_body', 'generic_body'),
        shape('bottle_cap', 'generic_body'),
        shape('rim_ring', 'generic_detail_accent'),
      ]),
    )

    expect(review.passed).toBe(false)
    expect(review.issues).toContain(
      'Stage3 round container main body must use round primitive geometry, not generic_body box.',
    )
    expect(review.repairPlan).toMatchObject({
      label: 'canonical round container primitive',
      tool: 'compose_primitive',
    })
    expect((review.repairPlan?.args.shapes as Array<Record<string, unknown>>)[0]).toMatchObject({
      kind: 'cylinder',
      semanticRole: 'bottle_body',
    })
  })

  test('passes round container output with a cylindrical main body', () => {
    const review = stage3QualityReview(
      '\u751f\u6210\u4e00\u4e2a\u5706\u67f1\u6c34\u74f6',
      artifact([
        {
          ...shape('bottle_body', 'compose_primitive'),
          kind: 'cylinder',
          axis: 'y',
          radius: 0.06,
          height: 0.26,
        },
        {
          ...shape('bottle_cap', 'compose_primitive'),
          kind: 'cylinder',
          axis: 'y',
          radius: 0.04,
          height: 0.04,
        },
      ]),
    )

    expect(review.passed).toBe(true)
    expect(review.repairPlan).toBeUndefined()
  })

  test('does not repair gantry cranes into round containers because their parts mention cylinders', () => {
    const gantryArtifact = artifact([
      shape('gantry_girder', 'generic_body'),
      shape('gantry_leg', 'generic_body'),
      {
        ...shape('gantry_wheel', 'compose_primitive'),
        kind: 'cylinder',
        axis: 'x',
        radius: 0.12,
        height: 0.08,
      },
    ])
    gantryArtifact.shapeDetails = 'gantry wheel uses cylindrical primitive geometry'

    const review = stage3QualityReview(
      '\u751f\u6210\u4e00\u4e2a\u9f99\u95e8\u540a\uff0c\u5305\u542b\u4e24\u4fa7\u95e8\u67b6\u7acb\u67f1\u3001\u6a2a\u6881\u3001\u8f68\u9053\u3001\u5c0f\u8f66\u3001\u540a\u94a9\u548c\u5e95\u90e8\u884c\u8d70\u8f6e',
      gantryArtifact,
    )

    expect(review.issues).not.toContain(
      'Stage3 round container main body must use round primitive geometry, not generic_body box.',
    )
    expect(review.repairPlan).toBeUndefined()
  })

  test('fails when generated artifact drops declared required equipment roles', () => {
    const towerArtifact = artifact([
      shape('tower_body', 'structural_tower_frame'),
      shape('slew_platform', 'generic_body'),
      shape('counterweight_set', 'generic_base'),
    ])
    towerArtifact.geometryBrief = {
      category: 'tower_crane',
      requiredRoles: ['tower_body', 'slew_platform', 'jib_arm', 'hook_assembly'],
    }

    const review = stage3QualityReview(
      '\u751f\u6210\u4e00\u4e2a\u5efa\u7b51\u5de5\u5730\u7684\u5854\u540a',
      towerArtifact,
    )

    expect(review.passed).toBe(false)
    expect(review.requiresModelRepair).toBe(true)
    expect(review.issues).toContain('Stage3 missing declared required role "jib_arm".')
    expect(review.issues).toContain('Stage3 missing declared required role "hook_assembly".')
  })

  test('fails bridge crane drafts with collapsed beam and hook topology', () => {
    const craneArtifact = artifact([
      {
        ...shape('left_leg_column', 'generic_body'),
        position: [0, 4, 0],
        length: 0.4,
        width: 0.4,
        height: 8,
      },
      {
        ...shape('main_girder', 'generic_body'),
        position: [0, 4, 0],
        length: 8,
        width: 0.7,
        height: 0.5,
      },
      {
        ...shape('trolley_frame', 'generic_body'),
        position: [0, 4, 0],
        length: 1,
        width: 0.6,
        height: 0.4,
      },
      {
        ...shape('hook_block', 'generic_spout'),
        position: [0, 4.2, 0],
        length: 0.3,
        width: 0.2,
        height: 0.5,
      },
      {
        ...shape('crane_wheel', 'wheel_set'),
        position: [0, 0.2, 0],
        kind: 'cylinder',
        radius: 0.2,
        height: 0.1,
      },
    ])
    craneArtifact.geometryBrief = {
      category: 'overhead_crane',
      requiredRoles: [
        'left_leg_column',
        'main_girder',
        'trolley_frame',
        'hook_block',
        'crane_wheel',
      ],
    }

    const review = stage3QualityReview(
      '\u751f\u6210\u4e00\u4e2a\u5929\u8f66\uff0c\u5e26\u6a2a\u6881\u3001\u5c0f\u8f66\u3001\u540a\u94a9\u548c\u8f68\u9053',
      craneArtifact,
    )

    expect(review.passed).toBe(false)
    expect(review.requiresModelRepair).toBe(true)
    expect(review.issues).toContain(
      'Stage3 lifting structure span/beam must be above its support/mast.',
    )
    expect(review.issues).toContain('Stage3 lifting hook must hang below the trolley/carriage.')
  })

  test('does not treat a hook-only trolley label as the trolley carrier', () => {
    const towerArtifact = artifact([
      {
        ...shape('tower_body', 'tower_column'),
        position: [0, 1, 0],
        length: 0.4,
        width: 0.4,
        height: 2,
      },
      {
        ...shape('jib_arm', 'boom_arm'),
        position: [0, 2.25, 0],
        length: 5,
        width: 0.18,
        height: 0.16,
      },
      {
        ...shape('trolley_hook', 'generic_hook'),
        position: [1.5, 1.55, 0],
        length: 0.25,
        width: 0.1,
        height: 0.35,
      },
    ])
    towerArtifact.geometryBrief = {
      category: 'tower_crane',
      requiredRoles: ['tower_body', 'jib_arm', 'trolley_hook'],
    }

    const review = stage3QualityReview('生成一个塔吊吊�?, towerArtifact)

    expect(review.issues).not.toContain('Stage3 lifting hook must hang below the trolley/carriage.')
  })

  test('fails lifting equipment drafts that contain unrelated aircraft geometry', () => {
    const towerArtifact = artifact([
      { ...shape('tower_body', 'tower_column'), position: [0, 1, 0], height: 2 },
      { ...shape('jib_arm', 'boom_arm'), position: [0, 2.2, 0], length: 5, height: 0.2 },
      { ...shape('aircraft_wing', 'wing_panel'), position: [0, 2.4, 0], length: 4, height: 0.1 },
    ])
    towerArtifact.geometryBrief = { category: 'tower_crane' }

    const review = stage3QualityReview('生成塔吊', towerArtifact)

    expect(review.passed).toBe(false)
    expect(review.requiresModelRepair).toBe(true)
    expect(review.issues).toContain(
      'Stage3 lifting equipment contains unrelated aircraft geometry.',
    )
  })

  test('fails outdoor AC drafts with pedestal fan stand parts or floating feet', () => {
    const acArtifact = artifact([
      { ...shape('condenser_body', 'generic_body'), position: [0, 0.6, 0], height: 1 },
      { ...shape('fan_grill', 'protective_grill'), position: [0, 0.6, 0.51], height: 0.6 },
      { ...shape('support_feet', 'support_feet'), position: [0, 0.55, 0], height: 0.1 },
      { ...shape('fan_pole', 'vertical_pole'), position: [0, 0.8, 0], height: 1 },
    ])
    acArtifact.geometryBrief = { category: 'outdoor_ac_unit' }

    const review = stage3QualityReview('生成室外空调�?, acArtifact)

    expect(review.passed).toBe(false)
    expect(review.requiresModelRepair).toBe(true)
    expect(review.issues).toContain(
      'Stage3 outdoor enclosure must not include pedestal fan stand parts.',
    )
    expect(review.issues).toContain('Stage3 enclosure support feet must be below the main body.')
  })

  test('repairs generic lifting topology without adding device-specific routes', () => {
    const craneArtifact = artifact([
      { ...shape('tower_mast', 'generic_body'), position: [0, 2.5, 0], height: 5 },
      { ...shape('jib_boom', 'generic_body'), position: [0, 1, 0], length: 8, height: 0.4 },
      { ...shape('trolley', 'generic_body'), position: [0, 0.8, 0], height: 0.4 },
      { ...shape('hook_block', 'generic_body'), position: [0, 1.2, 0], height: 0.5 },
      { ...shape('aircraft_wing', 'wing_panel'), position: [0, 3, 0], length: 4, height: 0.1 },
    ])
    craneArtifact.geometryBrief = {
      category: 'tower_crane',
      requiredRoles: ['tower_mast', 'jib_boom', 'trolley', 'hook_block'],
    }

    const repaired = repairStage3SemanticArtifact('生成塔吊', craneArtifact)
    const review = repaired ? stage3QualityReview('生成塔吊', repaired.artifact) : undefined

    expect(repaired?.label).toBe('generic semantic topology repair')
    expect(repaired?.artifact.shapes.some((item) => item.semanticRole === 'aircraft_wing')).toBe(
      false,
    )
    expect(review?.passed).toBe(true)
  })

  test('normalizes tower crane topology with shared lifting equipment rules', () => {
    const towerArtifact = artifact([
      {
        ...shape('tower_mast', 'tower_column'),
        position: [0, 9, 0],
        length: 1.2,
        width: 1.2,
        height: 18,
      },
      {
        ...shape('main_jib', 'generic_body'),
        position: [5, 18.8, 0],
        length: 9,
        width: 0.35,
        height: 0.25,
      },
      {
        ...shape('counter_jib', 'generic_body'),
        position: [-2.2, 18.8, 0],
        length: 4,
        width: 0.35,
        height: 0.25,
      },
      {
        ...shape('tower_peak', 'generic_body'),
        position: [5, 22.4, 0],
        length: 0.4,
        width: 0.4,
        height: 1,
      },
      {
        ...shape('hook_block', 'generic_base'),
        position: [0, 15.6, 0],
        length: 0.3,
        width: 0.2,
        height: 0.45,
      },
      {
        ...shape('hook_block', 'generic_body'),
        position: [5, 22.9, 0],
        length: 0.3,
        width: 0.2,
        height: 0.45,
      },
    ])
    towerArtifact.geometryBrief = { category: 'tower_crane' }

    const repaired = repairStage3SemanticArtifact('生成一个建筑工地塔�?, towerArtifact)
    const next = repaired?.artifact
    const roles = next?.shapes.map((item) => item.semanticRole) ?? []
    const trolley = next?.shapes.find((item) => item.semanticRole === 'trolley')
    const rope = next?.shapes.find((item) => item.semanticRole === 'wire_rope')
    const hook = next?.shapes.find((item) => item.semanticRole === 'hook_block')
    const peak = next?.shapes.find((item) => item.semanticRole === 'tower_peak')

    expect(repaired?.label).toBe('generic semantic topology repair')
    expect(roles).toContain('trolley')
    expect(roles).toContain('wire_rope')
    expect(roles).toContain('pendant_cable')
    expect(next?.shapes.filter((item) => item.semanticRole === 'hook_block')).toHaveLength(1)
    expect(Math.abs((peak?.position?.[0] ?? 99) - 0)).toBeLessThan(0.05)
    expect(hook?.position?.[0]).toBeCloseTo(trolley?.position?.[0] ?? 0)
    expect(hook?.position?.[1] ?? 99).toBeLessThan(rope?.position?.[1] ?? 0)
    expect(rope?.position?.[1] ?? 99).toBeLessThan(trolley?.position?.[1] ?? 0)
    expect(next ? stage3QualityReview('tower crane', next).passed : false).toBe(true)
  })

  test('repairs outdoor enclosure feet and removes pedestal stand drift', () => {
    const acArtifact = artifact([
      { ...shape('condenser_body', 'generic_body'), position: [0, 0.6, 0], height: 1 },
      { ...shape('fan_guard', 'protective_grill'), position: [0, 0.6, 0.51], height: 0.6 },
      { ...shape('support_foot', 'generic_foot_set'), position: [0, 0.55, 0], height: 0.1 },
      { ...shape('fan_pole', 'vertical_pole'), position: [0, 0.8, 0], height: 1 },
    ])
    acArtifact.geometryBrief = { category: 'outdoor_ac_unit' }

    const repaired = repairStage3SemanticArtifact('生成室外空调�?, acArtifact)
    const review = repaired ? stage3QualityReview('生成室外空调�?, repaired.artifact) : undefined

    expect(repaired?.artifact.shapes.some((item) => item.semanticRole === 'fan_pole')).toBe(false)
    expect(review?.passed).toBe(true)
  })

  test('polishes lifting artifacts with frame, truss, and rope cues', () => {
    const craneArtifact = artifact([
      {
        ...shape('tower_mast', 'generic_body'),
        position: [0, 2.5, 0],
        length: 0.9,
        width: 0.9,
        height: 5,
      },
      {
        ...shape('main_jib', 'generic_body'),
        position: [2.5, 5.4, 0],
        length: 6,
        width: 0.5,
        height: 0.45,
      },
      {
        ...shape('trolley', 'generic_body'),
        position: [2.4, 5.15, 0],
        length: 0.6,
        width: 0.4,
        height: 0.3,
      },
      {
        ...shape('hook_block', 'generic_body'),
        position: [2.4, 3.6, 0],
        length: 0.25,
        width: 0.2,
        height: 0.35,
      },
    ])
    craneArtifact.geometryBrief = { category: 'tower_crane' }

    const polished = polishStage3SemanticArtifact('tower crane', craneArtifact)
    const roles = polished?.artifact.shapes.map((item) => item.semanticRole) ?? []

    expect(polished?.label).toBe('generic semantic visual polish')
    expect(roles).toContain('lattice_column')
    expect(roles).toContain('main_jib_truss_chord')
    expect(roles).toContain('wire_rope')
  })

  test('polishes outdoor enclosure face anchors and all feet', () => {
    const acArtifact = artifact([
      {
        ...shape('main_body', 'generic_body'),
        position: [0, 0.6, 0],
        length: 1.2,
        width: 0.5,
        height: 1,
      },
      {
        ...shape('front_fan_grille', 'protective_grill'),
        position: [0, 1.4, 0],
        length: 0.5,
        width: 0.1,
        height: 0.5,
      },
      {
        ...shape('side_heat_sink_vent', 'vent_grill'),
        position: [0, 1.2, 0],
        length: 0.5,
        width: 0.1,
        height: 0.4,
      },
      { ...shape('support_foot', 'generic_foot_set'), position: [-0.3, 0.7, -0.1], height: 0.1 },
      { ...shape('support_foot', 'generic_foot_set'), position: [0.3, 0.7, 0.1], height: 0.1 },
    ])
    acArtifact.geometryBrief = { category: 'outdoor_ac_unit' }

    const polished = polishStage3SemanticArtifact('outdoor ac unit', acArtifact)
    const front = polished?.artifact.shapes.find((item) => item.semanticRole === 'front_fan_grille')
    const side = polished?.artifact.shapes.find(
      (item) => item.semanticRole === 'side_heat_sink_vent',
    )
    const feet =
      polished?.artifact.shapes.filter((item) => item.semanticRole === 'support_foot') ?? []

    expect(front?.position?.[1]).toBeCloseTo(0.6)
    expect(front?.position?.[2]).toBeGreaterThan(0.25)
    expect(side?.position?.[0]).toBeLessThan(-0.55)
    expect(feet.every((item) => (item.position?.[1] ?? 1) < 0.1)).toBe(true)
  })

  test('moves outdoor AC fan impeller groups from side/top drift back to the front face', () => {
    const acArtifact = artifact([
      {
        ...shape('condenser_body', 'rounded_machine_body'),
        position: [0, 0.45, 0],
        length: 1.2,
        width: 0.5,
        height: 1,
      },
      {
        ...shape('fan_impeller', 'radial_blades'),
        position: [0.9, 1.1, 0],
        length: 0.12,
        width: 0.12,
        height: 0.12,
      },
      {
        ...shape('fan_impeller', 'radial_blades'),
        position: [1.05, 1.18, 0],
        length: 0.12,
        width: 0.12,
        height: 0.12,
      },
      {
        ...shape('protective_grill', 'protective_grill'),
        position: [0.9, 1.1, 0],
        length: 0.5,
        width: 0.05,
        height: 0.5,
      },
    ])
    acArtifact.geometryBrief = { category: 'outdoor_ac_unit' }

    const polished = polishStage3SemanticArtifact('outdoor ac unit', acArtifact)
    const fanParts =
      polished?.artifact.shapes.filter((item) => item.semanticRole === 'fan_impeller') ?? []
    const redundantProtectiveGrill =
      polished?.artifact.shapes.filter((item) => item.semanticRole === 'protective_grill') ?? []

    expect(fanParts.every((item) => Math.abs((item.position?.[0] ?? 99) - 0) < 0.2)).toBe(true)
    expect(fanParts.every((item) => (item.position?.[2] ?? 0) > 0.25)).toBe(true)
    expect(
      Math.abs((fanParts[1]?.position?.[1] ?? 0) - (fanParts[0]?.position?.[1] ?? 0)),
    ).toBeCloseTo(0.08)
    expect(redundantProtectiveGrill).toHaveLength(0)
  })

  test('routes robot arm prompts with negative guard rails to robot arm composer', () => {
    const prompt =
      '\u751f\u6210\u4e00\u4e2a\u5de5\u4e1a\u516d\u8f74\u673a\u5668\u81c2\uff0c\u53ea\u8981\u673a\u5668\u81c2\u672c\u4f53\uff0c\u4e0d\u8981\u5de5\u4f5c\u53f0\u3001\u63a7\u5236\u67dc\u3001\u62a4\u680f\u3002'

    expect(precisionPartDeterministicRoute(prompt, null)).toMatchObject({
      label: '6-axis industrial robot arm',
      family: 'robot_arm',
      args: {
        family: 'robot_arm',
        axisCount: 6,
        includeWorkcell: false,
        endEffector: 'tool-flange',
      },
    })
  })

  test('does not route outdoor AC unit fan grilles as pedestal fans', () => {
    const prompt =
      '\u751f\u6210\u4e00\u4e2a\u7a7a\u8c03\u5916\u673a\uff0c\u5e26\u98ce\u6247\u683c\u6805\u3001\u5916\u58f3\u3001\u4fa7\u9762\u6563\u70ed\u6805\u3001\u5e95\u5ea7\u652f\u811a'

    expect(precisionPartDeterministicRoute(prompt, null)?.family).not.toBe('fan')
  })

  test('routes construction tower cranes to a deterministic hammerhead topology', () => {
    const route = precisionPartDeterministicRoute('generate a construction tower crane', null)
    const parts = route?.args.parts as Array<Record<string, unknown>>

    expect(route).toMatchObject({
      label: 'hammerhead tower crane',
      family: 'generic',
      args: {
        family: 'generic',
        category: 'lifting equipment',
        requiredRoles: expect.arrayContaining([
          'tower_mast',
          'main_jib',
          'counter_jib',
          'trolley',
          'wire_rope',
          'hook_block',
          'pendant_cable',
        ]),
      },
    })
    expect(parts.map((part) => [part.id, part.kind, part.semanticRole])).toEqual(
      expect.arrayContaining([
        ['tower_mast', 'structural_tower_frame', 'tower_mast'],
        ['slewing_unit', 'generic_base', 'slewing_unit'],
        ['tower_peak', 'pyramid', 'tower_peak'],
        ['main_jib', 'generic_body', 'main_jib'],
        ['counter_jib', 'generic_body', 'counter_jib'],
        ['trolley', 'generic_body', 'trolley'],
        ['wire_rope', 'vertical_pole', 'wire_rope'],
        ['hook_block', 'generic_body', 'hook_block'],
      ]),
    )
    expect(parts.find((part) => part.id === 'tower_mast')).toMatchObject({
      primaryColor: '#facc15',
      metalColor: '#facc15',
      darkColor: '#facc15',
      accentColor: '#facc15',
    })
    expect(parts.find((part) => part.id === 'wire_rope')).toMatchObject({
      metalColor: '#111827',
    })
  })

  test('does not route gantry or overhead cranes through the tower crane shortcut', () => {
    expect(precisionPartDeterministicRoute('generate a gantry crane', null)?.label).not.toBe(
      'hammerhead tower crane',
    )
    expect(precisionPartDeterministicRoute('生成一个天�?, null)?.label).not.toBe(
      'hammerhead tower crane',
    )
  })

  test('still routes explicit inspection platform ladder prompts deterministically', () => {
    const prompt =
      '\u751f\u6210\u4e00\u4e2a\u5de5\u4e1a\u68c0\u4fee\u5e73\u53f0\u722c\u68af\uff0c\u8981\u6709\u62a4\u680f\u548c\u8e0f\u68cd\u3002'

    expect(precisionPartDeterministicRoute(prompt, null)).toMatchObject({
      label: 'industrial platform ladder',
      family: 'generic',
      args: {
        parts: [
          expect.objectContaining({ kind: 'platform_ladder', semanticRole: 'access_platform' }),
        ],
      },
    })
  })

  test('routes industrial pedestal fan prompts to editable fan parts', () => {
    const route = precisionPartDeterministicRoute(
      '\u751f\u6210\u4e00\u4e2a\u7ea2\u8272\u5de5\u4e1a\u843d\u5730\u98ce\u6247\uff0c\u8981\u516d\u7247\u53ef\u7f16\u8f91\u6247\u53f6\u3002',
      null,
    )
    const parts = route?.args.parts as Array<Record<string, unknown>>

    expect(route).toMatchObject({
      label: 'industrial pedestal fan',
      family: 'fan',
      args: {
        family: 'fan',
        primaryColor: '#ef4444',
      },
    })
    expect(parts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'fan_blade',
          semanticRole: 'fan_blade',
          count: 6,
          includeHub: true,
        }),
        expect.objectContaining({
          kind: 'protective_grill',
          semanticRole: 'protective_grill',
          detailLevel: 'low',
        }),
      ]),
    )
  })

  test('routes complete water pump prompts deterministically with stable topology', () => {
    const plainRoute = precisionPartDeterministicRoute('\u751f\u6210\u4e00\u4e2a\u6c34\u6cf5', null)
    const whiteRoute = precisionPartDeterministicRoute(
      '\u751f\u6210\u4e00\u4e2a\u6c34\u6cf5\uff0c\u989c\u8272\u767d\u8272',
      null,
    )
    const plainParts = plainRoute?.args.parts as Array<Record<string, unknown>>
    const whiteParts = whiteRoute?.args.parts as Array<Record<string, unknown>>

    expect(plainRoute).toMatchObject({
      label: 'centrifugal water pump',
      family: 'pump',
      args: {
        family: 'pump',
        primaryColor: '#64748b',
      },
    })
    expect(whiteRoute).toMatchObject({
      label: 'centrifugal water pump',
      family: 'pump',
      args: {
        family: 'pump',
        primaryColor: '#f8fafc',
      },
    })
    expect(whiteParts.map((part) => [part.id, part.kind, part.semanticRole])).toEqual(
      plainParts.map((part) => [part.id, part.kind, part.semanticRole]),
    )
    expect(whiteParts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'motor', position: [-0.28, 0.42, 0] }),
        expect.objectContaining({ id: 'volute', position: [0.24, 0.42, 0.04] }),
        expect.objectContaining({ id: 'inlet', position: [0.24, 0.42, 0.28], axis: 'z' }),
        expect.objectContaining({ id: 'outlet', position: [0.49, 0.5, 0.04], axis: 'x' }),
        expect.objectContaining({ id: 'flange_in', connectTo: 'inlet' }),
        expect.objectContaining({ id: 'flange_out', connectTo: 'outlet' }),
      ]),
    )
  })

  test('routes shaft plus three blade mixer prompts away from fan topology', () => {
    const route = precisionPartDeterministicRoute('生成一个搅拌器，一个杆子，下面是三片桨�?, null)
    const parts = route?.args.parts as Array<Record<string, unknown>>

    expect(route).toMatchObject({
      label: 'vertical shaft mixer impeller',
      family: 'generic',
      args: {
        category: 'mixer impeller component',
        requiredRoles: ['mixer_shaft', 'mixer_hub', 'mixer_blade'],
      },
    })
    expect(parts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'mixer_shaft', kind: 'vertical_pole' }),
        expect.objectContaining({ id: 'mixer_hub', kind: 'circular_base' }),
        expect.objectContaining({ id: 'mixer_blades', kind: 'mixer_blades', count: 3 }),
      ]),
    )
    expect(parts.some((part) => part.kind === 'fan_blade')).toBe(false)
    expect(parts.some((part) => part.kind === 'protective_grill')).toBe(false)
  })

  test('routes English shaft mixer prompts away from fan topology', () => {
    const route = precisionPartDeterministicRoute(
      'Generate a vertical mixer shaft with three impeller paddles at the bottom.',
      null,
    )
    const parts = route?.args.parts as Array<Record<string, unknown>>

    expect(route).toMatchObject({
      label: 'vertical shaft mixer impeller',
      family: 'generic',
      args: {
        category: 'mixer impeller component',
        requiredRoles: ['mixer_shaft', 'mixer_hub', 'mixer_blade'],
      },
    })
    expect(parts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'mixer_blades', kind: 'mixer_blades', count: 3 }),
      ]),
    )
    expect(parts.some((part) => part.kind === 'fan_blade')).toBe(false)
    expect(parts.some((part) => part.kind === 'protective_grill')).toBe(false)
  })

  test('passes canonical horizontal pressure tank output', () => {
    const review = stage3QualityReview(
      '生成一个卧式压力储罐，要有顶部接管、人孔法兰和鞍座支撑�?,
      artifact([
        shape('vessel_shell', 'cylindrical_tank'),
        shape('vessel_head', 'cylindrical_tank'),
        shape('top_nozzle', 'cylindrical_tank'),
        shape('manway_flange', 'cylindrical_tank'),
        shape('saddle_support', 'cylindrical_tank'),
      ]),
    )

    expect(review.passed).toBe(true)
    expect(review.repairPlan).toBeUndefined()
  })

  test('repairs pressure tank output that drifted into fan machinery', () => {
    const review = stage3QualityReview(
      '生成一个卧式压力储罐，要有顶部接管、人孔法兰和鞍座支撑�?,
      artifact([
        shape('machine_body', 'rounded_machine_body'),
        shape('fan_blades', 'radial_blades'),
        shape('protective_grill', 'vent_grill'),
      ]),
    )

    expect(review.passed).toBe(false)
    expect(review.score).toBeLessThan(0.75)
    expect(review.repairPlan).toMatchObject({
      label: 'canonical horizontal pressure tank',
      tool: 'compose_parts',
      args: {
        parts: [
          expect.objectContaining({ kind: 'cylindrical_tank', semanticRole: 'vessel_shell' }),
        ],
      },
    })
  })

  test('repairs inspection platform output that drifted into bicycle geometry', () => {
    const review = stage3QualityReview(
      '生成一个工业检修平台爬梯，要有护栏、爬梯侧轨和多根踏棍�?,
      artifact([
        shape('bicycle_tire', 'wheel_set'),
        shape('bicycle_frame', 'tube_frame'),
        shape('handlebar', 'handlebar'),
      ]),
    )

    expect(review.passed).toBe(false)
    expect(review.repairPlan).toMatchObject({
      label: 'canonical industrial platform ladder',
      args: {
        parts: [
          expect.objectContaining({ kind: 'platform_ladder', semanticRole: 'access_platform' }),
        ],
      },
    })
  })
})
