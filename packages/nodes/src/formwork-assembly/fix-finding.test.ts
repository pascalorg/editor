import { describe, expect, test } from 'bun:test'
import type { AnyNode, WallNode } from '@pascal-app/core'
import { applyPourLimitsPatch, findingByKey } from '@pascal-app/core/formwork'
import { findingsWithRemedies, fixOutcome, plannedFix } from './fix-finding'
import { validateProjectFormwork } from './validate-project'

/**
 * Applying a fix, and the two ways that goes wrong quietly.
 *
 * The first is a fix that clears nothing and says it did. The second is a fix that
 * clears its own finding and raises another, which reads as a clean result to anything
 * comparing counts. Both are invisible to a caller that trusts the write, which is why
 * every test here goes through a real second validation rather than checking that the
 * planned arguments look right.
 *
 * The scene is built the same way `validate-project.test.ts` builds one, because the
 * remedies are only reachable through the project validation — the caps depend on the
 * element's own openings and joints, and a fabricated `Finding` would test the plumbing
 * against figures no check produced.
 */

function makeWall(id: string, overrides: Partial<WallNode> = {}): WallNode {
  return {
    object: 'node',
    id,
    type: 'wall',
    parentId: 'level_1',
    visible: true,
    metadata: {},
    children: [],
    start: [0, 0],
    end: [8, 0],
    thickness: 0.25,
    height: 8,
    frontSide: 'unknown',
    backSide: 'unknown',
    formworkType: 'steel-panel',
    ...overrides,
  } as WallNode
}

/** A void in a wall, on the wall-child convention every opening tool writes. */
function makeWindow(id: string, wallId: string, along: number, centreY: number): AnyNode {
  return {
    object: 'node',
    id,
    type: 'window',
    parentId: wallId,
    wallId,
    visible: true,
    metadata: {},
    children: [],
    position: [along, centreY, 0],
    width: 1.2,
    height: 1.4,
  } as unknown as AnyNode
}

function sceneOf(...members: AnyNode[]): Record<string, AnyNode> {
  const hosts = members.filter((node) => node.type === 'wall')
  const nodes: Record<string, AnyNode> = {
    level_1: {
      object: 'node',
      id: 'level_1',
      type: 'level',
      parentId: null,
      visible: true,
      metadata: {},
      children: hosts.map((host) => host.id as string),
      elevation: 0,
      height: 10,
      level: 0,
    } as unknown as AnyNode,
  }
  for (const member of members) nodes[member.id as string] = member as unknown as AnyNode
  return nodes
}

/**
 * The scene with one plan applied, the way every caller applies it: through
 * `applyPourLimitsPatch`, so a cap the tool would refuse is refused here too.
 *
 * The shutters are not rebuilt, because this wall has none — the three surfaces each
 * rebuild through their own store, and what they share is the decision and the verdict.
 */
function withFix(
  nodes: Record<string, AnyNode>,
  plan: ReturnType<typeof plannedFix>,
): Record<string, AnyNode> {
  const host = nodes[plan.elementId as string] as WallNode
  const patch = applyPourLimitsPatch(host.type, plan.limits ?? {})
  expect(patch.error).toBeUndefined()
  return { ...nodes, [host.id as string]: { ...host, ...patch.writes } as AnyNode }
}

/** A wall whose 4 m lift joint lands in the middle of a window. */
function straddled(): Record<string, AnyNode> {
  return sceneOf(
    makeWall('wall_1', { maxLiftHeight: 4 } as Partial<WallNode>),
    makeWindow('window_1', 'wall_1', 4, 4),
  )
}

describe('planning a fix', () => {
  test('the fixable finding carries an element and a cap, and nothing else', () => {
    const nodes = straddled()
    const { report } = validateProjectFormwork(nodes)
    const finding = report.findings.find((f) => f.invariant === 'OPENING_STRADDLES_LIFT_JOINT')
    expect(finding).toBeDefined()

    const plan = plannedFix(finding as NonNullable<typeof finding>)

    expect(plan.refusal).toBeUndefined()
    expect(plan.elementId).toBe('wall_1')
    expect(Object.keys(plan.limits ?? {})).toEqual(['maxLiftHeight'])
    // Not optional and not the caller's judgement: a cap changes how many pours the
    // element has and builds nothing, so a fix that stopped at the write would leave the
    // element cast in more pours than it is formed for.
    expect(plan.rebuild).toBe(true)
  })

  test('a finding needing a decision is refused, and the refusal names the field', () => {
    // The distinction the whole module exists for. Offering a button here would be
    // offering to choose the pour sequence on the user's behalf.
    const nodes = sceneOf(
      makeWall('wall_1', { castOrder: 1, formworkMode: 'single-sided-a' } as Partial<WallNode>),
    )
    const { report } = validateProjectFormwork(nodes)
    const finding = report.findings.find((f) => f.invariant === 'SINGLE_SIDED_ANCHOR_NOT_EARLIER')
    expect(finding).toBeDefined()

    const plan = plannedFix(finding as NonNullable<typeof finding>)

    expect(plan.limits).toBeUndefined()
    expect(plan.refusal).toContain('castOrder')
    expect(plan.refusal).toContain('set_element_construction')
  })

  test('every finding says what would clear it, fixable or not', () => {
    // A row with no next step is a defect the reader can only stare at, so the sentence
    // is on all of them and only the button is conditional.
    const { report } = validateProjectFormwork(straddled())
    const rows = findingsWithRemedies(report.findings)

    expect(rows.length).toBeGreaterThan(0)
    for (const row of rows) {
      expect(row.remedy.length, row.invariant).toBeGreaterThan(40)
      expect(row.key, row.invariant).toContain(row.invariant)
      // Fixable or refused, never both and never neither — the two are the same bit read
      // two ways, and a row that said nothing would render a button that does nothing.
      expect(row.fixable === (row.refusal === undefined), row.invariant).toBe(true)
    }
  })
})

describe('the verdict, taken from a second validation', () => {
  test('a cap that clears the joint reports the finding gone', () => {
    const nodes = straddled()
    const before = validateProjectFormwork(nodes).report
    const finding = before.findings.find((f) => f.invariant === 'OPENING_STRADDLES_LIFT_JOINT')
    const plan = plannedFix(finding as NonNullable<typeof finding>)

    const after = validateProjectFormwork(withFix(nodes, plan)).report
    const outcome = fixOutcome(before, after, plan.key)

    expect(outcome.cleared).toBe(true)
    expect(outcome.remaining).toBeUndefined()
    expect(outcome.message).toStartWith('Fixed')
    expect(after.errorCount).toBeLessThanOrEqual(before.errorCount)
  })

  test('a write that leaves the check firing is reported as not fixed', () => {
    // The failure this path exists to catch: a plausible write, a plausible reply, and the
    // shutter still unbuildable. Reproduced by applying a cap nobody derived — 4.6 m looks
    // like a change and is not one, because the splitter divides 8 m evenly and lands the
    // joint back at 4 m, in the same window.
    const nodes = straddled()
    const before = validateProjectFormwork(nodes).report
    const finding = before.findings.find((f) => f.invariant === 'OPENING_STRADDLES_LIFT_JOINT')
    const plan = plannedFix(finding as NonNullable<typeof finding>)
    const pretend = withFix(nodes, { ...plan, limits: { maxLiftHeight: 4.6 } })

    const after = validateProjectFormwork(pretend).report
    const outcome = fixOutcome(before, after, plan.key)

    expect(outcome.cleared).toBe(false)
    expect(outcome.message).toStartWith('Not fixed')
    // The message carries the current figures rather than the ones the fix was offered
    // for, so the reader sees where the joint is now.
    expect(outcome.remaining?.invariant).toBe('OPENING_STRADDLES_LIFT_JOINT')
  })

  test('the key survives a joint moving, which is what makes the verdict honest', () => {
    // If the key held the elevation, a joint that moved and still crossed the opening
    // would read as one finding cleared and one raised — the exact wrong answer. A 1.3 m cap
    // is the sharp version: the 4 m joint is gone and two others, at 3.43 m and 4.57 m, are
    // through the same window.
    const nodes = straddled()
    const before = validateProjectFormwork(nodes).report
    const finding = before.findings.find((f) => f.invariant === 'OPENING_STRADDLES_LIFT_JOINT')
    const plan = plannedFix(finding as NonNullable<typeof finding>)
    const after = validateProjectFormwork(
      withFix(nodes, { ...plan, limits: { maxLiftHeight: 1.3 } }),
    ).report

    const still = findingByKey(after.findings, plan.key)
    expect(still).toBeDefined()
    expect(still?.locus?.elevationM).not.toBe(finding?.locus?.elevationM)
    expect(fixOutcome(before, after, plan.key).raised).toEqual([])
  })

  test('a fix that raises something new says so alongside clearing its own', () => {
    // A fix that clears one error and raises two is worth naming before anybody moves on,
    // and no caller would notice it by reading a success flag. Keyed rather than counted,
    // so only genuinely new defects appear here.
    const before = validateProjectFormwork(straddled()).report
    const invented = {
      invariant: 'UNFORMABLE_STRIP' as const,
      severity: 'error' as const,
      elementIds: ['wall_9'] as never,
      message: 'a stretch nothing closes',
    }
    const after = {
      ...before,
      findings: [
        ...before.findings.filter((f) => f.invariant !== 'OPENING_STRADDLES_LIFT_JOINT'),
        invented,
      ],
      errorCount: before.errorCount + 1,
    }

    const outcome = fixOutcome(before, after, `OPENING_STRADDLES_LIFT_JOINT|wall_1,window_1`)

    expect(outcome.cleared).toBe(true)
    expect(outcome.raised.map((f) => f.invariant)).toEqual(['UNFORMABLE_STRIP'])
    expect(outcome.message).toContain('a stretch nothing closes')
    expect(outcome.after.errorCount).toBe(before.errorCount + 1)
  })
})
