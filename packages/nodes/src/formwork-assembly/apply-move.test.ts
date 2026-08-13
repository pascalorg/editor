import { describe, expect, test } from 'bun:test'
import type { AnyNode, WallNode } from '@pascal-app/core'
import { moveKey } from '@pascal-app/core/formwork'
import { keyedMoves, moveOutcome, plannedMove } from './apply-move'
import type { FormworkAssemblyNode } from './schema'
import { solveProjectFormwork } from './solve-project'

/**
 * Taking the proposal, and then measuring it.
 *
 * The whole scene twice per test — solve, write the dates into a copy of the nodes, solve again —
 * because the claim being made is that the second figure comes off a *second measurement* rather
 * than off the proposal's own arithmetic. A fixture that stated a peak after the move would let
 * this pass while agreeing only with itself, which is the exact failure the module exists to
 * catch.
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
    end: [6, 0],
    thickness: 0.25,
    height: 6,
    frontSide: 'unknown',
    backSide: 'unknown',
    formworkType: 'steel-panel',
    ...overrides,
  } as WallNode
}

function makeAssembly(
  id: string,
  hostId: string,
  overrides: Partial<FormworkAssemblyNode> = {},
): FormworkAssemblyNode {
  return {
    object: 'node',
    id,
    type: 'formwork-assembly',
    parentId: hostId,
    visible: true,
    metadata: {},
    children: [],
    position: [0, 0, 0],
    rotation: [0, 0, 0],
    panelWidth: 0.6,
    fillerPosition: 'middle',
    segmentIndex: 0,
    liftIndex: 0,
    partOverrides: {},
    ...overrides,
  } as unknown as FormworkAssemblyNode
}

const LEADS = {
  pressureStandard: 'BS_8110',
  schedule: { erectionLeadDays: 1, returnLeadDays: 1 },
} as const

function sceneOf(
  members: Array<WallNode | FormworkAssemblyNode>,
  settings: Record<string, unknown>,
): Record<string, AnyNode> {
  const hosts = members.filter((node) => node.type !== 'formwork-assembly')
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
      height: 6,
    } as unknown as AnyNode,
    'formwork-settings_1': {
      object: 'node',
      id: 'formwork-settings_1',
      type: 'formwork-settings',
      parentId: 'site_1',
      visible: true,
      metadata: {},
      children: [],
      ...settings,
    } as unknown as AnyNode,
  }
  for (const member of members) nodes[member.id as string] = member as unknown as AnyNode
  return nodes
}

/** A rack holding this share of every peak, so no id is short that the others are not. */
function rackFor(nodes: Record<string, AnyNode>, share: number): Record<string, number> {
  const peaks = solveProjectFormwork(nodes).sets?.peaks ?? []
  return Object.fromEntries(
    peaks.map((peak) => [peak.catalogId, Math.floor(peak.peakQuantity * share)]),
  )
}

/**
 * Three walls in stated order, two of them poured on one day — so the pair overlaps, the middle
 * one has float before the third, and a rack of half the peak is short.
 */
function shortScene(
  overrides: { dates?: [string, string, string]; committed?: string[]; share?: number } = {},
): Record<string, AnyNode> {
  const dates = overrides.dates ?? ['2026-03-02', '2026-03-02', '2026-04-06']
  const committed = new Set(overrides.committed ?? [])
  const members: Array<WallNode | FormworkAssemblyNode> = [
    makeWall('wall_1', { castOrder: 1 } as Partial<WallNode>),
    makeWall('wall_2', { start: [0, 4], end: [6, 4], castOrder: 2 } as Partial<WallNode>),
    makeWall('wall_3', { start: [0, 8], end: [6, 8], castOrder: 3 } as Partial<WallNode>),
  ]
  for (const [index, date] of dates.entries()) {
    const id = `formwork-assembly_${index + 1}`
    members.push(
      makeAssembly(id, `wall_${index + 1}`, {
        pourAt: date,
        ...(committed.has(id) ? { committedPourAt: date } : {}),
      }),
    )
  }
  const bare = sceneOf(members, LEADS)
  return sceneOf(members, { ...LEADS, stock: { owned: rackFor(bare, overrides.share ?? 0.5) } })
}

const PANEL = 'doka-framax-panel-588104500'
const PROP = 'eurex-20-300'
const TIE = 'dywidag-15mm'

/**
 * One acquisition line, for the two cases the scene cannot produce on demand.
 *
 * `moveOutcome` reads nothing but `acquisition.lines`, and what has to be asserted is a peak
 * rising *inside* a rack against one crossing it — a pair of figures a fixture would have to be
 * tuned to and then re-tuned every time the catalog moves.
 */
function line(catalogId: string, peakQuantity: number, ownedQuantity: number) {
  return {
    catalogId,
    description: catalogId,
    peakQuantity,
    ownedQuantity,
    shortfall: Math.max(0, peakQuantity - ownedQuantity),
    peakOn: '2026-03-02',
  }
}

/** A solution stating only what the outcome reads, so the two cases above can be written down. */
function solutionOf(lines: ReturnType<typeof line>[]) {
  return { acquisition: { lines } } as unknown as Parameters<typeof moveOutcome>[0]
}

/** The dates a plan asks for, written into a copy of the scene — what each caller does its way. */
function withMoveApplied(
  nodes: Record<string, AnyNode>,
  writes: ReadonlyArray<{ assemblyId: string; pourAt: string }>,
): Record<string, AnyNode> {
  const out = { ...nodes }
  for (const write of writes) {
    out[write.assemblyId] = {
      ...(out[write.assemblyId] as AnyNode),
      pourAt: write.pourAt,
    } as AnyNode
  }
  return out
}

describe('plannedMove', () => {
  test('plans one write per member, each off its own date', () => {
    // The write, and the shape of it: a member is shifted from where it was rather than onto the
    // group's date, so a monolithic pour whose members are a day apart stays a day apart.
    const nodes = shortScene()
    const solution = solveProjectFormwork(nodes)
    const move = keyedMoves(solution.resequence as NonNullable<typeof solution.resequence>)[0]

    const plan = plannedMove(solution, move?.key as string)

    expect(plan.refusal).toBeUndefined()
    expect(plan.pourId).toBe('formwork-assembly_2')
    expect(plan.writes).toHaveLength(1)
    expect(plan.writes?.[0]).toMatchObject({
      assemblyId: 'formwork-assembly_2',
      wasPourAt: '2026-03-02',
    })
    expect(plan.writes?.[0]?.pourAt).not.toBe('2026-03-02')
    expect(plan.predicted?.peakAfter).toBeLessThan(plan.predicted?.peakBefore as number)
  })

  test('a superseded key is refused, naming the re-read rather than the missing record', () => {
    const solution = solveProjectFormwork(shortScene())

    const plan = plannedMove(solution, 'doka-framax-panel-588104500|formwork-assembly_2|999')

    expect(plan.refusal).toContain('superseded')
    expect(plan.writes).toBeUndefined()
  })

  test('a scope proposing nothing is refused differently from a stale key', () => {
    // Two different wrong expectations. Nothing short is not a proposal that has gone stale, and
    // sending the reader to re-read the takeoff for a key would be sending them nowhere.
    const nodes = shortScene({ share: 5 })
    const solution = solveProjectFormwork(nodes)

    expect(solution.resequence).toBeUndefined()
    const plan = plannedMove(solution, 'anything')
    expect(plan.refusal).toContain('Nothing in this scope proposes a move')
    expect(plan.refusal).not.toContain('superseded')
  })

  test('a committed pour is never offered, so its move cannot be keyed at all', () => {
    // The refusal that is not in this module: `resequence.ts` drops a booked pour from the
    // candidates, so there is no key to apply and nothing here has to guard it. Asserted because
    // the alternative — a plan that refused a booked pour — would mean the proposals were still
    // offering one.
    const solution = solveProjectFormwork(
      shortScene({ committed: ['formwork-assembly_1', 'formwork-assembly_2'] }),
    )
    const moves = keyedMoves(solution.resequence as NonNullable<typeof solution.resequence>)

    expect(moves.some((move) => move.pourId === 'formwork-assembly_2')).toBe(false)
    const answer = solution.resequence?.answers[0]
    expect(answer?.committedPourIds).toContain('formwork-assembly_2')
  })
})

describe('moveOutcome', () => {
  test('the peak reported is the one a second solve measured, not the one predicted', () => {
    // The claim the module exists for. Both figures are carried and the measured one is the
    // verdict, because the proposal was swept over a copy of the programme and the write landed
    // in the scene.
    const nodes = shortScene()
    const before = solveProjectFormwork(nodes)
    const plan = plannedMove(
      before,
      keyedMoves(before.resequence as NonNullable<typeof before.resequence>)[0]?.key as string,
    )
    const after = solveProjectFormwork(withMoveApplied(nodes, plan.writes ?? []))

    const outcome = moveOutcome(before, after, plan)

    const measuredLine = after.acquisition?.lines.find((line) => line.catalogId === plan.catalogId)
    expect(outcome.measuredPeak).toBe(measuredLine?.peakQuantity as number)
    expect(outcome.cleared).toBe(true)
    expect(outcome.shortfallAfter).toBe(0)
    expect(outcome.message).toContain('no longer short')
    // The caveat the proposals themselves carry, on every outcome: every other move in that
    // reply was measured against the date this write just changed.
    expect(outcome.message).toContain('re-read the takeoff')
  })

  test('the dates written are named, so a reply says what moved rather than that something did', () => {
    const nodes = shortScene()
    const before = solveProjectFormwork(nodes)
    const plan = plannedMove(
      before,
      keyedMoves(before.resequence as NonNullable<typeof before.resequence>)[0]?.key as string,
    )
    const after = solveProjectFormwork(withMoveApplied(nodes, plan.writes ?? []))

    const outcome = moveOutcome(before, after, plan)

    expect(outcome.moved).toEqual(plan.writes)
    expect(outcome.message).toContain('formwork-assembly_2 2026-03-02 → ')
  })

  test('a move that leaves the job short of nothing new raises nothing', () => {
    // The pair to the collateral case: one pour leaving the overlap relieves every id together,
    // so nothing is worse off and the reply must not invent a cost to report.
    const nodes = shortScene()
    const before = solveProjectFormwork(nodes)
    const plan = plannedMove(
      before,
      keyedMoves(before.resequence as NonNullable<typeof before.resequence>)[0]?.key as string,
    )
    const after = solveProjectFormwork(withMoveApplied(nodes, plan.writes ?? []))

    expect(moveOutcome(before, after, plan).raised).toEqual([])
  })

  test('a peak that rose inside the rack is not a cost, and one that went short is', () => {
    // The one place this deliberately differs from the proposal's own `raises`. That compares two
    // sweeps and has only peaks to compare; this has the rack in front of it. A prop peak of 40
    // rising to 52 against 60 owned costs nothing and must not be footnoted onto a clean move; a
    // tie peak crossing its rack is an order that was not there before.
    const outcome = moveOutcome(
      solutionOf([line(PANEL, 60, 40), line(PROP, 40, 60), line(TIE, 90, 100)]),
      solutionOf([line(PANEL, 30, 40), line(PROP, 52, 60), line(TIE, 130, 100)]),
      {
        key: 'k',
        catalogId: PANEL,
        description: 'Framax panel',
        pourId: 'formwork-assembly_2',
        days: 8,
        writes: [
          { assemblyId: 'formwork-assembly_2', pourAt: '2026-03-10', wasPourAt: '2026-03-02' },
        ],
        predicted: { peakBefore: 60, peakAfter: 30, shortfallAfter: 0 },
      },
    )

    expect(outcome.cleared).toBe(true)
    expect(outcome.raised.map((rise) => rise.catalogId)).toEqual([TIE])
    expect(outcome.raised[0]).toMatchObject({ from: 0, to: 30 })
    expect(outcome.message).toContain('left the job short of 1 other item')
  })

  test('a measured peak that disagrees with the prediction says which one is the answer', () => {
    // Reported whichever way it falls, and this is the direction that reads as good news: the
    // move did *better* than the proposal said. It is the same fault as doing worse — the copy of
    // the programme the proposal was swept over was not the scene — so printing the better figure
    // without the disagreement would be choosing which sweep to believe on how it reads.
    const outcome = moveOutcome(
      solutionOf([line(PANEL, 60, 40)]),
      solutionOf([line(PANEL, 20, 40)]),
      {
        key: 'k',
        catalogId: PANEL,
        description: 'Framax panel',
        pourId: 'formwork-assembly_2',
        days: 8,
        writes: [
          { assemblyId: 'formwork-assembly_2', pourAt: '2026-03-10', wasPourAt: '2026-03-02' },
        ],
        predicted: { peakBefore: 60, peakAfter: 30, shortfallAfter: 0 },
      },
    )

    expect(outcome.measuredPeak).toBe(20)
    expect(outcome.predictedPeak).toBe(30)
    expect(outcome.message).toContain('the measurement is the answer')
  })
})

describe('keyedMoves', () => {
  test('every proposal carries a key that finds it again', () => {
    // The join between the read and the write: a panel maps this and a model reads it, so a key
    // composed here has to be the key `resequenceMoveByKey` resolves.
    const solution = solveProjectFormwork(shortScene())
    const resequence = solution.resequence as NonNullable<typeof solution.resequence>

    const moves = keyedMoves(resequence)

    expect(moves.length).toBeGreaterThan(0)
    for (const move of moves) {
      expect(plannedMove(solution, move.key).refusal).toBeUndefined()
      expect(move.key).toBe(
        moveKey(
          move.catalogId,
          resequence.answers
            .find((answer) => answer.catalogId === move.catalogId)
            ?.moves.find(
              (entry) => entry.pourId === move.pourId && entry.days === move.days,
            ) as never,
        ),
      )
    }
  })
})
