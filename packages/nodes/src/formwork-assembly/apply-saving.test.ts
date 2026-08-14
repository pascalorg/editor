import { describe, expect, test } from 'bun:test'
import type { AnyNode, WallNode } from '@pascal-app/core'
import {
  type FormworkSavings,
  type SavingProposal,
  STOCKABLE_CATALOG_PARTS,
  savingKey,
} from '@pascal-app/core/formwork'
import { formworkSavings, plannedSaving, savingOutcome } from './apply-saving'
import type { FormworkAssemblyNode } from './schema'
import { type ProjectFormwork, solveProjectFormwork } from './solve-project'

/**
 * The cheaper way to form the same building, offered and then measured.
 *
 * The claim being made is that the second figure comes off a *second measurement* rather than
 * off the proposal's own arithmetic, so the outcome tests solve nothing — they hand the module
 * two solutions stating the totals, the same way `apply-move.test.ts` hands `moveOutcome` two
 * acquisition lines. The derivation tests do solve, for the branches that are deterministic:
 * a scope with dates, a rack and rates produces priced cycle proposals, and one without rates
 * says which input is missing rather than claiming nothing is cheaper.
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

function rackFor(nodes: Record<string, AnyNode>, share: number): Record<string, number> {
  const peaks = solveProjectFormwork(nodes).sets?.peaks ?? []
  return Object.fromEntries(
    peaks.map((peak) => [peak.catalogId, Math.floor(peak.peakQuantity * share)]),
  )
}

const rates = {
  currency: 'GBP',
  byCatalogId: Object.fromEntries(
    STOCKABLE_CATALOG_PARTS.map((part) => [part.id, { rentalPerUnitPerMonth: 10 }]),
  ),
}

/** Three walls in stated order, two poured on one day, a rack of half the peak — apply-move's scene. */
function shortScene(priced: boolean): Record<string, AnyNode> {
  const dates = ['2026-03-02', '2026-03-02', '2026-04-06']
  const members: Array<WallNode | FormworkAssemblyNode> = [
    makeWall('wall_1', { castOrder: 1 } as Partial<WallNode>),
    makeWall('wall_2', { start: [0, 4], end: [6, 4], castOrder: 2 } as Partial<WallNode>),
    makeWall('wall_3', { start: [0, 8], end: [6, 8], castOrder: 3 } as Partial<WallNode>),
  ]
  for (const [index, date] of dates.entries()) {
    members.push(
      makeAssembly(`formwork-assembly_${index + 1}`, `wall_${index + 1}`, { pourAt: date }),
    )
  }
  const bare = sceneOf(members, LEADS)
  return sceneOf(members, {
    ...LEADS,
    ...(priced ? { rates } : {}),
    stock: { owned: rackFor(bare, 0.5) },
  })
}

function substitutionProposal(overrides: Partial<SavingProposal> = {}): SavingProposal {
  const merged = {
    class: 'substitution' as const,
    target: 'doka-framax-xlife',
    alternative: 'peri-trio',
    description: 'peri-trio forms this scope cheaper than the build in use now.',
    saving: {
      label: 'Hire, recharge and consumables over this job',
      from: 4000,
      to: 3000,
      delta: -1000,
      unit: 'GBP',
    },
    currency: 'GBP',
    tradeOffs: [] as SavingProposal['tradeOffs'],
    write: 'system' as const,
    ...overrides,
  }
  return { ...merged, key: savingKey(merged.class, merged.target, merged.alternative) }
}

function readOf(...proposals: SavingProposal[]): FormworkSavings {
  return {
    currency: 'GBP',
    proposals,
    classes: {
      substitution: { proposals: proposals.filter((entry) => entry.class === 'substitution') },
      cycle: { proposals: proposals.filter((entry) => entry.class === 'cycle') },
      reuse: { proposals: [] },
      'grid-relaxation': { proposals: [] },
      standardisation: { proposals: [] },
    },
  }
}

describe('formworkSavings', () => {
  test('an unpriced project refuses the substitution class with the missing input named', () => {
    const members = [makeWall('wall_1'), makeAssembly('formwork-assembly_1', 'wall_1')]
    const nodes = sceneOf(members, LEADS)
    const savings = formworkSavings(nodes, {}, solveProjectFormwork(nodes))

    expect(savings.classes.substitution.proposals).toEqual([])
    expect(savings.classes.substitution.refusal?.kind).toBe('missing-input')
    expect((savings.classes.substitution.refusal as { needs: string }).needs).toContain('rates')
  })

  test('a priced project whose options are all dearer says nothing cheaper exists', () => {
    // Uniform rates make the money follow the fitting count, and TRIO fits this wall with more
    // parts than Framax — so it is priced and dearer, which is the branch that must say
    // "nothing cheaper" rather than "missing input".
    const members = [makeWall('wall_1'), makeAssembly('formwork-assembly_1', 'wall_1')]
    const nodes = sceneOf(members, { ...LEADS, rates })
    const savings = formworkSavings(nodes, {}, solveProjectFormwork(nodes))

    expect(savings.classes.substitution.refusal?.kind).toBe('nothing-cheaper')
  })

  test('a dated, racked, priced scope offers cycle savings priced off the hire they avoid', () => {
    const nodes = shortScene(true)
    const solution = solveProjectFormwork(nodes)
    const savings = formworkSavings(nodes, {}, solution)

    const cycle = savings.classes.cycle.proposals
    expect(cycle.length).toBeGreaterThan(0)
    const proposal = cycle[0] as SavingProposal
    expect(proposal.class).toBe('cycle')
    expect(proposal.key).toMatch(/^cycle\|[^|]+\|[^|]+\|-?\d+$/)
    expect(proposal.saving?.delta).toBeLessThan(0)
    expect(proposal.saving?.to).toBe(0)
    expect(proposal.write).toBe('pour-move')
    expect(proposal.tradeOffs.some((axis) => axis.label === 'Days the pour moves')).toBe(true)
  })

  test('an unpriced dated scope says the cycle class needs the hire rates, not that nothing clears', () => {
    const nodes = shortScene(false)
    const savings = formworkSavings(nodes, {}, solveProjectFormwork(nodes))

    expect(savings.classes.cycle.proposals).toEqual([])
    expect(savings.classes.cycle.refusal?.kind).toBe('missing-input')
  })

  test('the refused classes answer with the reason the spec names, not with silence', () => {
    const members = [makeWall('wall_1'), makeAssembly('formwork-assembly_1', 'wall_1')]
    const nodes = sceneOf(members, LEADS)
    const savings = formworkSavings(nodes, {}, solveProjectFormwork(nodes))

    expect(savings.classes['grid-relaxation'].refusal?.kind).toBe('nothing-cheaper')
    expect(savings.classes.reuse.refusal?.kind).toBe('missing-input')
    expect(savings.classes.standardisation.refusal?.kind).toBe('missing-input')
    for (const savingClass of [
      'substitution',
      'cycle',
      'reuse',
      'grid-relaxation',
      'standardisation',
    ] as const) {
      expect(savings.classes[savingClass]).toBeDefined()
    }
  })
})

describe('plannedSaving', () => {
  test('a substitution plans one system write per shutter in scope', () => {
    const members = [makeWall('wall_1'), makeAssembly('formwork-assembly_1', 'wall_1')]
    const nodes = sceneOf(members, LEADS)
    const solution = solveProjectFormwork(nodes)
    const plan = plannedSaving(readOf(substitutionProposal()), solution, substitutionProposal().key)

    expect(plan.refusal).toBeUndefined()
    expect(plan.write).toBe('system')
    expect(plan.predicted).toEqual({ amount: 1000, currency: 'GBP' })
    expect(plan.writes).toEqual([{ assemblyId: 'formwork-assembly_1', systemId: 'peri-trio' }])
  })

  test('a cycle plans through the move’s own plan, so the two cannot disagree about the dates', () => {
    const nodes = shortScene(true)
    const solution = solveProjectFormwork(nodes)
    const savings = formworkSavings(nodes, {}, solution)
    const proposal = savings.classes.cycle.proposals[0] as SavingProposal

    const plan = plannedSaving(savings, solution, proposal.key)

    expect(plan.refusal).toBeUndefined()
    expect(plan.write).toBe('pour-move')
    expect(plan.catalogId).toBe(proposal.target)
    expect(plan.movePlan?.writes?.length).toBeGreaterThan(0)
  })

  test('a stale key is refused as superseded, not reported as a missing record', () => {
    const members = [makeWall('wall_1'), makeAssembly('formwork-assembly_1', 'wall_1')]
    const nodes = sceneOf(members, LEADS)
    const plan = plannedSaving(readOf(), solveProjectFormwork(nodes), 'cycle|nothing|x|4')

    expect(plan.refusal).toContain('superseded')
  })
})

describe('savingOutcome', () => {
  function planOf(overrides: Partial<Parameters<typeof savingOutcome>[2]> = {}) {
    return {
      key: substitutionProposal().key,
      class: 'substitution' as const,
      description: 'peri-trio forms this scope cheaper.',
      predicted: { amount: 1000, currency: 'GBP' },
      write: 'system' as const,
      ...overrides,
    }
  }

  test('the measurement wins in either direction, with the same prominence', () => {
    const plan = planOf()
    const before = { cost: { totalCost: 4000, currency: 'GBP' } } as unknown as ProjectFormwork

    const under = savingOutcome(
      before,
      { cost: { totalCost: 3200 } } as unknown as ProjectFormwork,
      plan,
    )
    const over = savingOutcome(
      before,
      { cost: { totalCost: 2500 } } as unknown as ProjectFormwork,
      plan,
    )

    // Under-delivery is a shortfall, over-delivery is the same fault in the other direction —
    // both must carry the sentence that the measurement is the answer.
    expect(under.achieved).toBe(false)
    expect(over.achieved).toBe(true)
    expect(under.message).toContain('measurement is the answer')
    expect(over.message).toContain('measurement is the answer')
    expect(under.measured?.amount).toBe(800)
    expect(over.measured?.amount).toBe(1500)
  })

  test('a saving that matches its claim is reported as claimed, without the disagreement sentence', () => {
    const before = { cost: { totalCost: 4000 } } as unknown as ProjectFormwork
    const after = { cost: { totalCost: 3000 } } as unknown as ProjectFormwork

    const outcome = savingOutcome(before, after, planOf())

    expect(outcome.achieved).toBe(true)
    expect(outcome.message).toContain('as claimed')
    expect(outcome.message).not.toContain('measurement is the answer')
  })

  test('a re-derivation that cannot produce a total is unmeasured, never confirmed at the claim', () => {
    const before = { cost: { totalCost: 4000 } } as unknown as ProjectFormwork
    const after = {} as unknown as ProjectFormwork

    const outcome = savingOutcome(before, after, planOf())

    expect(outcome.achieved).toBe(false)
    expect(outcome.unmeasured).toBeDefined()
    expect(outcome.measured).toBeUndefined()
    expect(outcome.message).toContain('unmeasured')
    expect(outcome.message).not.toContain('as claimed')
  })

  test('a cycle measures the hire it avoided off the acquisition’s own lines', () => {
    const plan = planOf({
      class: 'cycle',
      key: 'cycle|doka-framax-panel-588104500|formwork-assembly_2|4',
      catalogId: 'doka-framax-panel-588104500',
      predicted: { amount: 600, currency: 'GBP' },
      write: 'pour-move',
    })
    const before = {
      acquisition: { lines: [{ catalogId: 'doka-framax-panel-588104500', hireCost: 600 }] },
    } as unknown as ProjectFormwork
    const after = {
      acquisition: { lines: [{ catalogId: 'doka-framax-panel-588104500', hireCost: 0 }] },
    } as unknown as ProjectFormwork

    const outcome = savingOutcome(before, after, plan)

    expect(outcome.achieved).toBe(true)
    expect(outcome.measured?.amount).toBe(600)
    expect(outcome.message).toContain('as claimed')
  })
})
