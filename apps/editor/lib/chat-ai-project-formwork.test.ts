import { describe, expect, test } from 'bun:test'
import type { SceneGraph } from '@pascal-app/core/clone-scene-graph'
import { buildTools } from './chat-ai'

/**
 * The AI asked what a floor needs.
 *
 * Before `inspect_project_formwork` this was a question the model could only answer
 * by calling the per-element tool once per wall and adding the results up, which is
 * the one arithmetic it must not do: the same panel type on two walls is one line on
 * a delivery note, and summing two bills of it produces a plausible order that no
 * yard can pick. Everything here is therefore about the aggregation being one solve
 * over the scope rather than a sum of solves, and about the two facts a project total
 * hides — an element in scope with no shutter at all, and one formed for fewer pours
 * than it is cast in.
 */

type ToolMap = ReturnType<typeof buildTools>

const call = (tools: ToolMap, name: keyof ToolMap, input: unknown): Promise<string> =>
  (tools[name].execute as (i: unknown) => Promise<string>)(input)

interface ProjectReport {
  scope: string
  elementCount: number
  shutterCount: number
  elements: Array<{
    id: string
    kind: string
    shutters: number
    pourUnits: number
    coversWholePour: boolean
  }>
  unshuttered: string[]
  bom: Array<{
    description: string
    catalogId: string | null
    quantity: number
    totalWeightKg: number | null
    fromOwnStock?: number
    toHire?: number
    consumed?: number
    daysHeld: number | null
    struckAs: string | null
    mixedPeriods?: string[]
    daysCharged?: number
    atMinimumHirePeriod?: boolean
    hireCost?: number
    rechargeCost?: number
    purchaseCost?: number
    lineCost?: number
    ownStockCost?: number
    costGaps?: string[]
  }>
  totalWeightKg: number
  totalWeightComplete: boolean
  hire: {
    standard: string
    basis: string
    longestDaysHeld: number
    periods: Array<{ struckAs: string; days: number; governingRule: string }>
    assumed: string[]
    substitutedFromAnotherCodeFamily: boolean
  }
  supply?: {
    fromOwnStock: number
    toHire: number
    consumed: number
    hiredAlteredHere: number
    hiredWeightKg: number | null
    ownedNotUsedHere: string[]
  }
  cost?: {
    currency: string | null
    hire: number
    recharge: number
    purchase: number
    total: number
    ownStock: number
    complete: boolean
    linesAtMinimumHirePeriod: number
    ownedQuantityExcluded: number
    gaps: string[]
    excludes: string[]
  }
  labour?: {
    currency: string | null
    erectManHours: number
    strikeManHours: number
    totalManHours: number
    cost: number | null
    complete: boolean
    byOperation: Array<{
      operation: string
      fittings: number
      erectManHours: number
      strikeManHours: number
      totalManHours: number
      cost: number | null
    }>
    unnormedFittings: number
    unnormedKinds: string[]
    gaps: string[]
    excludes: string[]
  }
  noLabourBecause?: string
  schedule?: {
    plantWantedOnSite: string | null
    firstPour: string | null
    lastPour: string | null
    lastStrike: string | null
    plantFreeAgain: string | null
    daysOnSite: number | null
    datedPours: number
    undatedPours: number
    earliestOnly: boolean
    complete: boolean
    gaps: string[]
    pours: Array<{
      assemblyId: string
      pourAt: string | null
      erectAt: string | null
      strikeAt: string | null
      releaseAt: string | null
      strikes: Array<{ struckAs: string; date: string }>
    }>
  }
  sets?: {
    poursAtOnce: number
    poursAtOnceOn: string | null
    countedPours: number
    totalPours: number
    items: Array<{
      description: string
      catalogId: string
      mostAtOnce: number
      neededFrom: string
      fittedInTotal: number
      reuses: number
    }>
    rack: Array<{ kind: string; mostAtOnce: number }>
    gaps: string[]
  }
  noSetCountBecause?: string
  acquire?: {
    currency: string | null
    shortfallQuantity: number
    hireTheShortfall: number
    buyTheShortfall: number
    complete: boolean
    items: Array<{
      description: string
      catalogId: string
      mostAtOnce: number
      neededBy: string
      owned: number
      shortBy: number
      spare: number
      daysCommitted: number
      inUseFraction: number
      poursCausingThePeak: string[]
      hireCost?: number
      purchaseCost?: number
      cheaperOverThisJob?: string
      paysBackOverJobs?: number
      gaps?: string[]
    }>
    gaps: string[]
  }
  noAcquisitionBecause?: string
  sequence?: {
    windowFrom: string | null
    windowTo: string | null
    pinnedPours: string[]
    unsequencedPours: string[]
    pours: Array<{
      pourId: string
      assemblyIds: string[]
      elementIds: string[]
      castInOneOperation: boolean
      pourAt: string | null
      waitsOn: string[]
      holdsUp: string[]
      noEarlierThan: string | null
      noLaterThan: string | null
      allowanceDays: number | null
      couldComeForwardDays: number | null
      couldGoBackDays: number | null
      gaps?: string[]
    }>
    dependencies: Array<{ before: string; after: string; because: string }>
    brokenByTheStatedDates: string[]
    gaps: string[]
  }
  moveInsteadOfBuying?: Array<{
    description: string
    catalogId: string
    shortBy: number
    neededBy: string
    pinnedPours: string[]
    committedPours: string[]
    noMoveBecause?: string
    moves: Array<{
      pourId: string
      assemblyIds: string[]
      days: number
      fromDate: string
      toDate: string
      peakBefore: number
      peakAfter: number
      stillShortBy: number
      clearsTheShortage: boolean
      allowanceLeftDays: number
      raisesElsewhere: Array<{ description: string; catalogId: string; from: number; to: number }>
    }>
  }>
  committed?: {
    committedPours: number
    totalPours: number
    committedAssemblyIds: string[]
    spokenForFrom: string | null
    spokenForTo: string | null
    items: Array<{
      description: string
      catalogId: string
      committedQuantity: number
      from: string
      to: string
      days: number
      pours: string[]
    }>
    rack: Array<{ kind: string; committedQuantity: number }>
    drifted: Array<{
      assemblyId: string
      bookedFor: string
      nowPouredOn: string | null
      daysOut: number | null
    }>
    gaps: string[]
  }
  noCommitmentsBecause?: string
  beyondCapacity: Array<{ elementId: string; mark: string }>
  caveats: string[]
}

interface PartsReport {
  bom: Array<{ description: string; quantity: number }>
  totalWeightKg: number
}

/**
 * Two levels, two walls on the ground and one above, so a level scope can be wrong
 * in both directions — missing what it should carry and carrying what it should not.
 */
function scene(): { graph: SceneGraph; tools: ToolMap } {
  const wall = (id: string, parentId: string, y: number) => ({
    object: 'node',
    id,
    type: 'wall',
    parentId,
    visible: true,
    metadata: {},
    children: [],
    start: [0, y],
    end: [6, y],
    thickness: 0.25,
    height: 6,
    frontSide: 'unknown',
    backSide: 'unknown',
  })
  const graph = {
    nodes: {
      site_1: {
        object: 'node',
        id: 'site_1',
        type: 'site',
        parentId: null,
        visible: true,
        metadata: {},
        children: ['building_1'],
      },
      building_1: {
        object: 'node',
        id: 'building_1',
        type: 'building',
        parentId: 'site_1',
        visible: true,
        metadata: {},
        children: ['level_1', 'level_2'],
      },
      level_1: {
        object: 'node',
        id: 'level_1',
        type: 'level',
        parentId: 'building_1',
        visible: true,
        metadata: {},
        children: ['wall_1', 'wall_2'],
        elevation: 0,
        height: 6,
        level: 0,
      },
      level_2: {
        object: 'node',
        id: 'level_2',
        type: 'level',
        parentId: 'building_1',
        visible: true,
        metadata: {},
        children: ['wall_3'],
        elevation: 6,
        height: 6,
        level: 1,
      },
      wall_1: wall('wall_1', 'level_1', 0),
      wall_2: wall('wall_2', 'level_1', 4),
      wall_3: wall('wall_3', 'level_2', 0),
    },
    rootNodeIds: ['site_1'],
  } as unknown as SceneGraph
  const tools = buildTools(graph, [], () => {})
  return { graph, tools }
}

async function shutter(tools: ToolMap, elementId: string) {
  await call(tools, 'set_element_construction', { elementId, formworkType: 'steel-panel' })
  await call(tools, 'attach_formwork', { elementId })
}

const project = async (tools: ToolMap, input: unknown = {}): Promise<ProjectReport> =>
  JSON.parse(await call(tools, 'inspect_project_formwork', input)) as ProjectReport

const element = async (tools: ToolMap, elementId: string): Promise<PartsReport> =>
  JSON.parse(await call(tools, 'inspect_formwork_parts', { elementId })) as PartsReport

describe('inspect_project_formwork', () => {
  test('bills two walls as one order rather than two takeoffs', async () => {
    // The whole reason the tool exists. Two identical walls need twice the panels on
    // one line, not the same line twice, and the model cannot be asked to work out
    // which of the two it is looking at.
    const { tools } = scene()
    await shutter(tools, 'wall_1')
    await shutter(tools, 'wall_2')
    const one = await element(tools, 'wall_1')

    const both = await project(tools, { levelId: 'level_1' })

    const line = both.bom.find((row) => row.description === one.bom[0]?.description)
    expect(line?.quantity).toBe((one.bom[0]?.quantity ?? 0) * 2)
    expect(both.bom.filter((row) => row.description === one.bom[0]?.description)).toHaveLength(1)
    expect(both.totalWeightKg).toBeGreaterThan(one.totalWeightKg)
  })

  test('scopes to a level, and does not carry the floor above', async () => {
    const { tools } = scene()
    await shutter(tools, 'wall_1')
    await shutter(tools, 'wall_3')

    const ground = await project(tools, { levelId: 'level_1' })

    expect(ground.elements.map((e) => e.id)).toEqual(['wall_1'])
    expect(ground.shutterCount).toBe(1)
  })

  test('the whole scene is more than either level', async () => {
    const { tools } = scene()
    await shutter(tools, 'wall_1')
    await shutter(tools, 'wall_3')

    const whole = await project(tools)
    const ground = await project(tools, { levelId: 'level_1' })

    expect(whole.elements.map((e) => e.id)).toEqual(['wall_1', 'wall_3'])
    expect(whole.totalWeightKg).toBeGreaterThan(ground.totalWeightKg)
  })

  test('bills only the elements named when given a selection', async () => {
    const { tools } = scene()
    await shutter(tools, 'wall_1')
    await shutter(tools, 'wall_2')

    const named = await project(tools, { elementIds: ['wall_2'] })

    expect(named.elements.map((e) => e.id)).toEqual(['wall_2'])
  })

  test('names the elements in scope with no shutter at all', async () => {
    // The likeliest reason a total is lower than a user expects, and invisible in a
    // bill that lists only what exists. An empty row would read as "needs nothing".
    const { tools } = scene()
    await shutter(tools, 'wall_1')

    const ground = await project(tools, { levelId: 'level_1' })

    expect(ground.unshuttered).toEqual(['wall_2'])
    expect(ground.elements.map((e) => e.id)).toEqual(['wall_1'])
  })

  test('says nothing is unshuttered once everything is formed', async () => {
    const { tools } = scene()
    await shutter(tools, 'wall_1')
    await shutter(tools, 'wall_2')

    expect((await project(tools, { levelId: 'level_1' })).unshuttered).toEqual([])
  })

  test('a bill with nothing in it is not an empty success', async () => {
    const { tools } = scene()

    const empty = await project(tools)

    expect(empty.elementCount).toBe(0)
    expect(empty.bom).toEqual([])
    expect(empty.unshuttered).toEqual(['wall_1', 'wall_2', 'wall_3'])
  })

  test('a level that does not exist is refused, not silently billed as nothing', async () => {
    // Scoped to a typo, the honest answer looks exactly like a floor with no
    // formwork on it, and the model would report a level as unformed.
    const { tools } = scene()
    await shutter(tools, 'wall_1')

    const reply = await call(tools, 'inspect_project_formwork', { levelId: 'level_9' })

    expect(reply).toStartWith('Error:')
    expect(reply).toContain('list_castable_elements')
  })

  test('an element cast in more pours than it is formed for drags the total short, and says so', async () => {
    // The failure a project scope makes worse rather than better: one under-formed
    // element among five, and every figure in the bill is individually correct.
    const { tools } = scene()
    await shutter(tools, 'wall_1')
    await shutter(tools, 'wall_2')
    await call(tools, 'set_pour_limits', { elementId: 'wall_2', maxLiftHeight: 2 })

    const ground = await project(tools, { levelId: 'level_1' })

    const short = ground.elements.find((e) => e.id === 'wall_2')
    expect(short?.pourUnits).toBe(3)
    expect(short?.shutters).toBe(1)
    expect(short?.coversWholePour).toBe(false)
    expect(ground.caveats.join(' ')).toContain('wall_2 is cast in 3 pours and formed for 1')
  })

  test('the caveat clears once the missing shutters are built', async () => {
    const { tools } = scene()
    await shutter(tools, 'wall_1')
    await call(tools, 'set_pour_limits', { elementId: 'wall_1', maxLiftHeight: 2 })
    const short = await project(tools, { levelId: 'level_1' })

    await call(tools, 'attach_formwork', { elementId: 'wall_1' })
    const whole = await project(tools, { levelId: 'level_1' })

    expect(short.caveats.some((c) => c.includes('formed for 1'))).toBe(true)
    expect(whole.caveats.some((c) => c.includes('formed for'))).toBe(false)
    expect(whole.elements[0]?.coversWholePour).toBe(true)
    expect(whole.totalWeightKg).toBeGreaterThan(short.totalWeightKg)
  })

  test('a per-part omission recorded on one wall reaches the project bill', async () => {
    // Proof the aggregation reads the shutters rather than re-solving beside them.
    // A second enumeration at project scope would quietly re-order everything the
    // yard had taken off the list.
    const { tools } = scene()
    await shutter(tools, 'wall_1')
    const before = await project(tools, { elementIds: ['wall_1'] })
    const parts = JSON.parse(
      await call(tools, 'inspect_formwork_parts', { elementId: 'wall_1', kind: 'panel' }),
    ) as { shutters: Array<{ parts: Array<{ mark: string }> }> }
    const mark = parts.shutters[0]?.parts[0]?.mark as string

    await call(tools, 'set_formwork_part', { elementId: 'wall_1', mark, omitted: true })
    const after = await project(tools, { elementIds: ['wall_1'] })

    expect(after.totalWeightKg).toBeLessThan(before.totalWeightKg)
  })

  test('reports whether the weight total is the lifting weight of the set', async () => {
    const { tools } = scene()
    await shutter(tools, 'wall_1')

    const solved = await project(tools)

    expect(typeof solved.totalWeightComplete).toBe('boolean')
    // A complete flag and a weight caveat side by side would be worse than either,
    // so the two have to agree whichever way this scene falls.
    expect(solved.caveats.some((c) => c.includes('no published weight'))).toBe(
      !solved.totalWeightComplete,
    )
  })

  test('reports no owned/hired split until the project records a rack', async () => {
    // Absent, not a split of zeros. A bill reading "everything on hire" is a claim
    // about the yard the project never made.
    const { tools } = scene()
    await shutter(tools, 'wall_1')

    const solved = await project(tools, { elementIds: ['wall_1'] })

    expect(solved.supply).toBeUndefined()
    expect(solved.bom.every((row) => row.toHire === undefined)).toBe(true)
  })

  test('splits every line and the whole bill once the rack is recorded', async () => {
    const { tools } = scene()
    await shutter(tools, 'wall_1')
    const before = await project(tools, { elementIds: ['wall_1'] })
    const panel = before.bom.find((row) => row.catalogId !== null) as { catalogId: string }

    await call(tools, 'set_formwork_settings', {
      ownedStock: { [panel.catalogId]: 4, 'eurex-20-top': 50 },
    })
    const after = await project(tools, { elementIds: ['wall_1'] })

    const line = after.bom.find((row) => row.catalogId === panel.catalogId)
    expect(line?.fromOwnStock).toBe(4)
    expect(line?.toHire).toBe((line?.quantity ?? 0) - 4)
    expect(after.supply?.fromOwnStock).toBe(4)
    expect(after.supply?.toHire).toBeGreaterThan(0)
    // A type the bill never draws on, named rather than dropped — the model can tell
    // the yard what it is holding for this pour and not using.
    expect(after.supply?.ownedNotUsedHere).toEqual(['eurex-20-top'])
  })

  test('the split sits on the line it belongs to, not on whichever line is nearby', async () => {
    // Indexed positionally against the bill, so a mismatch puts every figure against
    // the wrong description and nothing in the report reveals it.
    const { tools } = scene()
    await shutter(tools, 'wall_1')
    await call(tools, 'set_formwork_settings', { ownedStock: {} })

    const solved = await project(tools, { elementIds: ['wall_1'] })

    for (const row of solved.bom) {
      expect((row.fromOwnStock ?? 0) + (row.toHire ?? 0) + (row.consumed ?? 0)).toBe(row.quantity)
      // Nothing off a catalog goes back on a rack, so it is consumed whatever is owned.
      if (row.catalogId === null) expect(row.consumed).toBe(row.quantity)
    }
  })

  test('a rack recorded as empty prices the bill as hire, and says the split is per scope', async () => {
    const { tools } = scene()
    await shutter(tools, 'wall_1')
    await call(tools, 'set_formwork_settings', { ownedStock: {} })

    const solved = await project(tools, { elementIds: ['wall_1'] })

    expect(solved.supply?.fromOwnStock).toBe(0)
    expect(solved.supply?.toHire).toBeGreaterThan(0)
    // Nothing came off the rack, so there is no per-scope figure to warn about.
    expect(solved.caveats.some((c) => c.includes('not a total'))).toBe(false)
  })

  test('warns that two levels’ owned figures cannot be added', async () => {
    const { tools } = scene()
    await shutter(tools, 'wall_1')
    const before = await project(tools, { elementIds: ['wall_1'] })
    const panel = before.bom.find((row) => row.catalogId !== null) as { catalogId: string }
    await call(tools, 'set_formwork_settings', { ownedStock: { [panel.catalogId]: 4 } })

    const solved = await project(tools, { elementIds: ['wall_1'] })

    expect(solved.caveats.some((c) => c.includes('not a total'))).toBe(true)
  })

  test('reports how long every line is held, and which part is not struck at all', async () => {
    // The second factor a hire charge needs, and the one the model would otherwise
    // invent. Unlike the supply split it is always answered, because a strike period is
    // a consequence of the code the project is already designed under.
    const { tools } = scene()
    await shutter(tools, 'wall_1')

    const solved = await project(tools, { elementIds: ['wall_1'] })

    expect(solved.hire.longestDaysHeld).toBeGreaterThan(0)
    const panel = solved.bom.find((row) => row.catalogId !== null)
    expect(panel?.struckAs).toBe('vertical-form')
    expect(panel?.daysHeld).toBeGreaterThan(0)
    // Null rather than 0 — a tie is cut off inside the wall, and a 0 reads as plant
    // returned the same day, which is a figure the model would multiply.
    const notStruck = solved.bom.filter((row) => row.daysHeld === null)
    expect(notStruck.length).toBeGreaterThan(0)
    expect(notStruck.every((row) => row.struckAs === null)).toBe(true)
    // And the code's own default column is named rather than presented as the job's
    // decision — nobody stated a curing temperature here.
    expect(solved.hire.assumed.some((entry) => entry.includes('No curing surface'))).toBe(true)
  })

  test('says which clock the periods are on, and names what the code assumed', async () => {
    // The failure that turns a correct figure into a missed date: under ACI these are
    // cumulative hours above 10 °C, so a model reporting calendar days strikes early.
    const { tools } = scene()
    await shutter(tools, 'wall_1')
    await call(tools, 'set_formwork_settings', { pressureStandard: 'ACI_347' })

    const solved = await project(tools, { elementIds: ['wall_1'] })

    expect(solved.hire.basis).toBe('qualifying-time')
    expect(solved.hire.substitutedFromAnotherCodeFamily).toBe(false)
    expect(solved.caveats.some((c) => c.includes('above 10 °C'))).toBe(true)
    // A flat 12 h with no lookup behind it, so nothing was assumed to reach it — ACI's
    // assumptions are the soffit table's bands, and a wall never touches them.
    expect(solved.hire.assumed).toEqual([])
    expect(solved.hire.periods[0]?.governingRule).toContain('§3.7.2.3')
  })

  test('the shipped default says its periods came from another code family', async () => {
    // DIN publishes no striking table at all — its family answers removal in EN 13670,
    // which is uncovered. Falling to BS 8110 is right, and it is a substitution.
    const { tools } = scene()
    await shutter(tools, 'wall_1')

    const solved = await project(tools, { elementIds: ['wall_1'] })

    expect(solved.hire.standard).toBe('BS_8110')
    expect(solved.hire.substitutedFromAnotherCodeFamily).toBe(true)
    expect(solved.caveats.some((c) => c.includes('DIN 18218 publishes no striking periods'))).toBe(
      true,
    )
  })

  test('the curing temperature the project records lengthens the periods', async () => {
    // The write half of the parity, end to end: the model can state a January cure and
    // see the hire lengthen, and the assumption it replaced disappears.
    const { tools } = scene()
    await shutter(tools, 'wall_1')
    const assumed = await project(tools, { elementIds: ['wall_1'] })

    await call(tools, 'set_formwork_settings', { curing: { surfaceTemperatureC: 5 } })
    const cold = await project(tools, { elementIds: ['wall_1'] })

    expect(cold.hire.longestDaysHeld).toBeGreaterThan(assumed.hire.longestDaysHeld)
    expect(assumed.hire.assumed.some((entry) => entry.includes('No curing surface'))).toBe(true)
    expect(cold.hire.assumed.some((entry) => entry.includes('No curing surface'))).toBe(false)
  })

  test('the period sits on the line it belongs to, in the bill’s own order', async () => {
    // Indexed positionally against the bill, like the supply split — out of step, every
    // duration is attributed to the wrong description and nothing reveals it.
    const { tools } = scene()
    await shutter(tools, 'wall_1')

    const solved = await project(tools, { elementIds: ['wall_1'] })

    for (const row of solved.bom) {
      expect(row.daysHeld === null).toBe(row.struckAs === null)
      if (row.daysHeld !== null)
        expect(row.daysHeld).toBeLessThanOrEqual(solved.hire.longestDaysHeld)
    }
  })

  test('says nothing about money until the project records a rate', async () => {
    // The one input with no conservative fallback, so absent is the whole answer. A 0
    // here is the single number a model would repeat to a user as a price, and a takeoff
    // reading "£0" is a tender nobody can withdraw once it has been sent.
    const { tools } = scene()
    await shutter(tools, 'wall_1')
    await call(tools, 'set_formwork_settings', { ownedStock: {} })

    const solved = await project(tools, { elementIds: ['wall_1'] })

    expect(solved.cost).toBeUndefined()
    expect(solved.bom.every((row) => row.lineCost === undefined)).toBe(true)
    expect(solved.caveats.some((c) => c.includes('labour'))).toBe(false)
  })

  test('prices the bill once a rate is recorded, and leads with what the price is not', async () => {
    const { tools } = scene()
    await shutter(tools, 'wall_1')
    const before = await project(tools, { elementIds: ['wall_1'] })
    const panel = before.bom.find((row) => row.catalogId !== null) as { catalogId: string }

    await call(tools, 'set_formwork_settings', {
      rates: {
        currency: 'GBP',
        byCatalogId: { [panel.catalogId]: { purchasePerUnit: 420, rentalPercentPerMonth: 3 } },
      },
    })
    const solved = await project(tools, { elementIds: ['wall_1'] })

    expect(solved.cost?.currency).toBe('GBP')
    expect(solved.cost?.hire).toBeGreaterThan(0)
    const line = solved.bom.find((row) => row.catalogId === panel.catalogId)
    expect(line?.lineCost).toBeGreaterThan(0)
    expect(line?.daysCharged).toBeGreaterThan(0)
    // Only the panel is priced, so the rest of the bill is not — and a total over a
    // partly-priced bill is a floor, which the model is told rather than left to infer.
    expect(solved.cost?.complete).toBe(false)
    expect(solved.caveats.some((c) => c.includes('a floor rather than a price'))).toBe(true)
    // Not boilerplate: this is the cost of holding the formwork, not of forming the job.
    expect(solved.cost?.excludes.some((entry) => entry.includes('labour'))).toBe(true)
  })

  test('a list price with no hire rate beside it prices nothing, and names what is missing', async () => {
    // The gap worth having a name for. A list price is not a hire rate, and a line
    // carrying one and not the other would otherwise be indistinguishable from a free one.
    const { tools } = scene()
    await shutter(tools, 'wall_1')
    const before = await project(tools, { elementIds: ['wall_1'] })
    const panel = before.bom.find((row) => row.catalogId !== null) as { catalogId: string }

    await call(tools, 'set_formwork_settings', {
      rates: { byCatalogId: { [panel.catalogId]: { purchasePerUnit: 420 } } },
    })
    const solved = await project(tools, { elementIds: ['wall_1'] })

    const line = solved.bom.find((row) => row.catalogId === panel.catalogId)
    expect(line?.hireCost).toBeUndefined()
    expect(line?.costGaps?.some((gap) => gap.includes('no hire rate recorded'))).toBe(true)
    expect(solved.cost?.currency).toBeNull()
  })

  test('a minimum hire period is charged rather than the time held, and is flagged', async () => {
    // Most of the answer on a fast cycle: a wall form struck in 12 hours against a
    // 28-day minimum is charged for 28 days, and the remedy is not striking sooner.
    const { tools } = scene()
    await shutter(tools, 'wall_1')
    const before = await project(tools, { elementIds: ['wall_1'] })
    const panel = before.bom.find((row) => row.catalogId !== null) as { catalogId: string }
    const rates = { byCatalogId: { [panel.catalogId]: { rentalPerUnitPerMonth: 30 } } }

    await call(tools, 'set_formwork_settings', { rates })
    const unbounded = await project(tools, { elementIds: ['wall_1'] })
    await call(tools, 'set_formwork_settings', { rates: { minHireDays: 28 } })
    const charged = await project(tools, { elementIds: ['wall_1'] })

    const line = charged.bom.find((row) => row.catalogId === panel.catalogId)
    expect(line?.daysCharged).toBe(28)
    expect(line?.atMinimumHirePeriod).toBe(true)
    expect(charged.cost?.linesAtMinimumHirePeriod).toBe(1)
    // The unbounded figure has to be a real price for the comparison to mean anything —
    // a 0 there would make any charge greater than ten times it.
    const held = unbounded.cost?.hire as number
    expect(held).toBeGreaterThan(0)
    expect(charged.cost?.hire).toBeGreaterThan(held * 10)
    expect(charged.caveats.some((c) => c.includes('pouring more with the same set'))).toBe(true)
  })

  test('owned stock is charged as an internal hire, beside the total rather than in it', async () => {
    // Priced at zero it would report a job forming itself free the more of its own kit it
    // uses. Charged at the project's own rate it costs what a plant department recharges its
    // own site — and stays out of `total`, which is the cash figure a model quotes.
    const { tools } = scene()
    await shutter(tools, 'wall_1')
    const before = await project(tools, { elementIds: ['wall_1'] })
    const panel = before.bom.find((row) => row.catalogId !== null) as {
      catalogId: string
      quantity: number
    }
    const rates = { byCatalogId: { [panel.catalogId]: { rentalPerUnitPerMonth: 30 } } }

    await call(tools, 'set_formwork_settings', { rates })
    const whole = await project(tools, { elementIds: ['wall_1'] })
    await call(tools, 'set_formwork_settings', { ownedStock: { [panel.catalogId]: 4 } })
    const partlyOwned = await project(tools, { elementIds: ['wall_1'] })

    // Nothing left uncharged, so the zero means the recharge is complete rather than that
    // the yard owns nothing.
    expect(partlyOwned.cost?.ownedQuantityExcluded).toBe(0)
    expect(partlyOwned.cost?.ownStock).toBeGreaterThan(0)
    expect(partlyOwned.cost?.total).toBe(partlyOwned.cost?.hire)
    const row = partlyOwned.bom.find((entry) => entry.catalogId === panel.catalogId)
    expect(row?.ownStockCost).toBeGreaterThan(0)
    // Charged on the hired remainder rather than on the whole quantity, and the four
    // owned are charged separately rather than priced at zero within it.
    const hired = row?.hireCost as number
    const all = whole.bom.find((entry) => entry.catalogId === panel.catalogId)?.hireCost as number
    expect(hired).toBeCloseTo((all * (panel.quantity - 4)) / panel.quantity, 2)
    // At the same rate on both sides, so the two figures reconcile to the unowned charge.
    expect(hired + (row?.ownStockCost as number)).toBeCloseTo(all, 2)
  })

  test('the price sits on the line it belongs to, in the bill’s own order', async () => {
    // Indexed positionally against the bill, like the split and the period. Out of step,
    // every figure is attributed to the wrong description and nothing reveals it.
    const { tools } = scene()
    await shutter(tools, 'wall_1')
    const before = await project(tools, { elementIds: ['wall_1'] })
    const panel = before.bom.find((row) => row.catalogId !== null) as { catalogId: string }
    await call(tools, 'set_formwork_settings', {
      rates: { byCatalogId: { [panel.catalogId]: { rentalPerUnitPerMonth: 30 } } },
    })

    const solved = await project(tools, { elementIds: ['wall_1'] })

    const priced = solved.bom.filter((row) => row.lineCost !== undefined)
    expect(priced).toHaveLength(1)
    expect(priced[0]?.catalogId).toBe(panel.catalogId)
    // Nothing made on site is priced off a catalog rate, and it says so rather than
    // reading as a line somebody forgot to fill in.
    for (const row of solved.bom) {
      if (row.catalogId === null)
        expect(row.costGaps?.some((gap) => gap.includes('Made on site'))).toBe(true)
    }
  })

  test('says there are no hours rather than showing none, until a norm is stated', async () => {
    // The absence a model is likeliest to turn into "no labour needed", and the only one in
    // this answer with no product table and no code behind it to fall back to.
    const { tools } = scene()
    await shutter(tools, 'wall_1')

    const solved = await project(tools, { elementIds: ['wall_1'] })

    expect(solved.labour).toBeUndefined()
    expect(solved.noLabourBecause).toContain('no output norms')
    expect(solved.noLabourBecause).toContain('Never estimate them')
  })

  test('reports the gang’s hours beside the money, never folded into it', async () => {
    // Two costs, negotiated with two different people, moving for different reasons: a
    // shorter programme cuts the hire and leaves the hours where they were. A model that
    // adds them has quoted a formwork price no estimator will recognise.
    const { tools } = scene()
    await shutter(tools, 'wall_1')
    const before = await project(tools, { elementIds: ['wall_1'] })
    const panel = before.bom.find((row) => row.catalogId !== null) as { catalogId: string }

    await call(tools, 'set_formwork_settings', {
      rates: {
        currency: 'GBP',
        gangRatePerHour: 32,
        byCatalogId: { [panel.catalogId]: { rentalPerUnitPerMonth: 30 } },
      },
      labourNorms: { panel: { erectHours: 0.5, strikeHours: 0.25 } },
    })
    const solved = await project(tools, { elementIds: ['wall_1'] })

    expect(solved.labour?.erectManHours).toBeGreaterThan(0)
    expect(solved.labour?.strikeManHours).toBeGreaterThan(0)
    expect(solved.labour?.cost).toBeCloseTo((solved.labour?.totalManHours ?? 0) * 32, 1)
    expect(solved.labour?.currency).toBe('GBP')
    // The money block sends the reader to the hours instead of claiming there are none.
    expect(solved.cost?.excludes.some((e) => e.includes('deliberately not in total'))).toBe(true)
    // Man-hours rather than a duration, carried as data because it is the sentence the
    // model has to repeat: nothing in this model knows the gang size.
    expect(solved.labour?.excludes.some((e) => e.includes('gang size'))).toBe(true)
    expect(solved.caveats.some((c) => c.includes('not a duration'))).toBe(true)
  })

  test('tables the hours per operation and names the fittings no norm covers', async () => {
    // A norm is per kind, so a panel-only table covers a fraction of a steel-panel bill —
    // and a total that reads complete while missing every tie in the job is the failure.
    const { tools } = scene()
    await shutter(tools, 'wall_1')

    await call(tools, 'set_formwork_settings', {
      labourNorms: { panel: { erectHours: 0.5, strikeHours: 0.25 } },
    })
    const solved = await project(tools, { elementIds: ['wall_1'] })

    expect(solved.labour?.byOperation.map((row) => row.operation)).toEqual(['Panel'])
    const panels = solved.labour?.byOperation[0] as { fittings: number; totalManHours: number }
    expect(panels.totalManHours).toBeCloseTo(panels.fittings * 0.75, 2)
    expect(solved.labour?.complete).toBe(false)
    expect(solved.labour?.unnormedFittings).toBeGreaterThan(0)
    expect(solved.labour?.unnormedKinds).toContain('Tie')
    // No gang rate, so hours with no money against them rather than hours that are free.
    expect(solved.labour?.cost).toBeNull()
    expect(solved.caveats.some((c) => c.includes('carry no norm at all'))).toBe(true)
  })

  test('the element rows and the scope counts agree with each other', async () => {
    const { tools } = scene()
    await shutter(tools, 'wall_1')
    await shutter(tools, 'wall_2')

    const ground = await project(tools, { levelId: 'level_1' })

    expect(ground.elementCount).toBe(ground.elements.length)
    expect(ground.shutterCount).toBe(ground.elements.reduce((total, e) => total + e.shutters, 0))
  })
})

/**
 * The day each pour happens, stated by the AI.
 *
 * `schedule-patch.test.ts` owns which strings are dates and `schedule.test.ts` owns the
 * arithmetic. What only this surface can get wrong is the addressing and the mutation: that
 * an element id is refused rather than silently dating one of three lifts, that a cleared
 * date is deleted from the node rather than stored as a date-shaped absence, and that the
 * bill carries no programme at all until somebody has dated a pour.
 */
describe('set_pour_date', () => {
  const shutterIds = (graph: SceneGraph): string[] =>
    Object.values(graph.nodes as unknown as Record<string, { id: string; type: string }>)
      .filter((node) => node.type === 'formwork-assembly')
      .map((node) => node.id)
  const stored = (graph: SceneGraph, id: string) =>
    (graph.nodes as unknown as Record<string, { pourAt?: string }>)[id] as { pourAt?: string }

  test('a stated date lands on the shutter and names the element back', async () => {
    // The element is named back because the user asked about a wall and the tool made the
    // model address a shutter — without it the reply quotes an id nobody has seen.
    const { graph, tools } = scene()
    await shutter(tools, 'wall_1')
    const [id] = shutterIds(graph)

    const reply = await call(tools, 'set_pour_date', { assemblyId: id, pourAt: '2026-03-02' })

    expect(reply).toContain('2026-03-02')
    expect(reply).toContain('wall_1')
    expect(stored(graph, id as string).pourAt).toBe('2026-03-02')
  })

  test('an element id is refused and sent to the read that lists pours', async () => {
    const { graph, tools } = scene()
    await shutter(tools, 'wall_1')

    const reply = await call(tools, 'set_pour_date', {
      assemblyId: 'wall_1',
      pourAt: '2026-03-02',
    })

    expect(reply).toContain('schedule.pours')
    expect(stored(graph, 'wall_1').pourAt).toBeUndefined()
  })

  test('a day the calendar does not have leaves the pour programmed as it was', async () => {
    // The check a regex cannot make. Stored, 2026-02-30 is read as 1 March by every date
    // derived from it and reported back as the date the user gave.
    const { graph, tools } = scene()
    await shutter(tools, 'wall_1')
    const [id] = shutterIds(graph)
    await call(tools, 'set_pour_date', { assemblyId: id, pourAt: '2026-03-02' })

    const reply = await call(tools, 'set_pour_date', { assemblyId: id, pourAt: '2026-02-30' })

    expect(reply).toContain('no such day')
    expect(stored(graph, id as string).pourAt).toBe('2026-03-02')
  })

  test('null deletes the key rather than storing a date-shaped absence', async () => {
    const { graph, tools } = scene()
    await shutter(tools, 'wall_1')
    const [id] = shutterIds(graph)
    await call(tools, 'set_pour_date', { assemblyId: id, pourAt: '2026-03-02' })

    await call(tools, 'set_pour_date', { assemblyId: id, pourAt: null })

    expect('pourAt' in stored(graph, id as string)).toBe(false)
  })

  test('a dated pour puts a programme on the bill, and an undated project puts none', async () => {
    const { graph, tools } = scene()
    await shutter(tools, 'wall_1')
    await call(tools, 'set_formwork_settings', {
      schedule: { erectionLeadDays: 2, returnLeadDays: 3 },
    })
    const [id] = shutterIds(graph)

    const before = await project(tools, { elementIds: ['wall_1'] })
    await call(tools, 'set_pour_date', { assemblyId: id, pourAt: '2026-03-02' })
    const after = await project(tools, { elementIds: ['wall_1'] })

    // No date is no calendar rather than one starting today: a pour date is the only input
    // in this model with neither a code nor a product behind it.
    expect(before.schedule).toBeUndefined()
    expect(after.schedule?.firstPour).toBe('2026-03-02')
    expect(after.schedule?.plantWantedOnSite).toBe('2026-02-28')
    expect(after.schedule?.datedPours).toBe(1)
    expect(after.schedule?.pours[0]?.assemblyId).toBe(id)
    // Arrival to release, which is not the longest hold: the erection and return leads are
    // in this and in neither of the periods.
    expect(after.schedule?.daysOnSite).toBeGreaterThan(after.hire.longestDaysHeld)
  })

  test('with two walls and one dated, the window says how much of the job it leaves out', async () => {
    // A programme over 1 of 2 pours is true about one pour and wrong about the floor, and
    // only this count says which.
    const { graph, tools } = scene()
    await shutter(tools, 'wall_1')
    await shutter(tools, 'wall_2')
    await call(tools, 'set_formwork_settings', { schedule: { erectionLeadDays: 1 } })
    const [id] = shutterIds(graph)
    await call(tools, 'set_pour_date', { assemblyId: id, pourAt: '2026-03-02' })

    const solved = await project(tools, { levelId: 'level_1' })

    expect(solved.schedule?.datedPours).toBe(1)
    expect(solved.schedule?.undatedPours).toBe(1)
    expect(solved.schedule?.complete).toBe(false)
    // The undated pour comes last rather than heading the programme as though it began the
    // job, which is what a sort over a sentinel string does.
    expect(solved.schedule?.pours[0]?.pourAt).toBe('2026-03-02')
    expect(solved.schedule?.pours.at(-1)?.pourAt).toBeNull()
    expect(solved.caveats.some((c) => c.includes('1 of 2 pours have no date'))).toBe(true)
  })
})

/**
 * Which of those dates anybody has agreed to.
 *
 * `commitments.test.ts` owns the sweep and `schedule-patch.test.ts` what committing means.
 * What only this surface can get wrong is the two writes acting on one another: that the day
 * stored is the day the pour has rather than one the model could name, that committing an
 * undated pour is refused rather than recorded as a commitment to nothing, and that moving a
 * booked pour afterwards goes through and comes back as a drift — because the one thing this
 * surface must never do is silently re-book plant against a day nobody agreed to.
 */
describe('commit_pour', () => {
  const shutterIds = (graph: SceneGraph): string[] =>
    Object.values(graph.nodes as unknown as Record<string, { id: string; type: string }>)
      .filter((node) => node.type === 'formwork-assembly')
      .map((node) => node.id)
  const stored = (graph: SceneGraph, id: string) =>
    (graph.nodes as unknown as Record<string, { pourAt?: string; committedPourAt?: string }>)[
      id
    ] as { pourAt?: string; committedPourAt?: string }

  const datedShutter = async () => {
    const { graph, tools } = scene()
    await shutter(tools, 'wall_1')
    await call(tools, 'set_formwork_settings', { schedule: { returnLeadDays: 3 } })
    const [id] = shutterIds(graph)
    await call(tools, 'set_pour_date', { assemblyId: id, pourAt: '2026-03-02' })
    return { graph, tools, id: id as string }
  }

  test('the day agreed comes off the pour rather than out of the call', async () => {
    // The shape of the tool, and the reason it takes a boolean: a model made to restate the
    // date could book a day the programme does not have.
    const { graph, tools, id } = await datedShutter()

    const reply = await call(tools, 'commit_pour', { assemblyId: id, committed: true })

    expect(reply).toContain('2026-03-02')
    expect(reply).toContain('wall_1')
    expect(stored(graph, id).committedPourAt).toBe('2026-03-02')
  })

  test('committing an undated pour is refused rather than recorded against nothing', async () => {
    const { graph, tools } = scene()
    await shutter(tools, 'wall_1')
    const [id] = shutterIds(graph)

    const reply = await call(tools, 'commit_pour', { assemblyId: id, committed: true })

    expect(reply).toContain('set_pour_date first')
    expect('committedPourAt' in stored(graph, id as string)).toBe(false)
  })

  test('an element id is refused and sent to the read that lists pours', async () => {
    const { graph, tools } = scene()
    await shutter(tools, 'wall_1')

    const reply = await call(tools, 'commit_pour', { assemblyId: 'wall_1', committed: true })

    expect(reply).toContain('schedule.pours')
    expect(stored(graph, 'wall_1').committedPourAt).toBeUndefined()
  })

  test('releasing deletes the key and leaves the date standing', async () => {
    const { graph, tools, id } = await datedShutter()
    await call(tools, 'commit_pour', { assemblyId: id, committed: true })

    await call(tools, 'commit_pour', { assemblyId: id, committed: false })

    expect('committedPourAt' in stored(graph, id)).toBe(false)
    expect(stored(graph, id).pourAt).toBe('2026-03-02')
  })

  test('a commitment puts what is booked on the bill, and no commitment puts a reason', async () => {
    const { tools, id } = await datedShutter()

    const before = await project(tools, { elementIds: ['wall_1'] })
    await call(tools, 'commit_pour', { assemblyId: id, committed: true })
    const after = await project(tools, { elementIds: ['wall_1'] })

    // Absent with a reason rather than absent silently: an empty block beside a present
    // programme reads as a fault in the tool rather than as nobody having agreed anything.
    expect(before.committed).toBeUndefined()
    expect(before.noCommitmentsBecause).toContain('commit_pour')
    expect(after.committed?.committedPours).toBe(1)
    expect(after.committed?.committedAssemblyIds).toEqual([id])
    expect(after.committed?.drifted).toEqual([])
    expect(after.noCommitmentsBecause).toBeUndefined()
  })

  test('moving a booked pour goes through, and the bill reports the drift', async () => {
    // Sites move booked pours, so this is deliberately not an error — but the hire desk is
    // still holding the old day, and nothing else in the answer would show it.
    const { graph, tools, id } = await datedShutter()
    await call(tools, 'commit_pour', { assemblyId: id, committed: true })

    await call(tools, 'set_pour_date', { assemblyId: id, pourAt: '2026-03-09' })
    const solved = await project(tools, { elementIds: ['wall_1'] })

    expect(stored(graph, id).committedPourAt).toBe('2026-03-02')
    expect(solved.committed?.drifted).toEqual([
      { assemblyId: id, bookedFor: '2026-03-02', nowPouredOn: '2026-03-09', daysOut: 7 },
    ])
    expect(solved.caveats.some((c) => c.includes('a call to make'))).toBe(true)
  })

  test('a booked pour is left out of the move proposals and named in them', async () => {
    // The exclusion, on the surface where a model would otherwise keep proposing a move
    // somebody has already agreed not to make. Three walls in cast order — two on one day and
    // the third a month later — because with only two the pair pins itself and nothing moves.
    const build = async (owned: Record<string, number>, commit: boolean) => {
      const { graph, tools } = scene()
      for (const [index, elementId] of ['wall_1', 'wall_2', 'wall_3'].entries()) {
        await shutter(tools, elementId)
        await call(tools, 'set_element_construction', { elementId, castOrder: index + 1 })
      }
      await call(tools, 'set_formwork_settings', {
        schedule: { returnLeadDays: 3 },
        ownedStock: owned,
      })
      const dates = ['2026-03-02', '2026-03-02', '2026-03-30']
      const ids = shutterIds(graph)
      for (const [index, id] of ids.entries())
        await call(tools, 'set_pour_date', { assemblyId: id, pourAt: dates[index] as string })
      if (commit)
        await call(tools, 'commit_pour', { assemblyId: ids[1] as string, committed: true })
      return { ids, solved: await project(tools) }
    }

    const { solved: empty } = await build({}, false)
    const panel = empty.sets?.items[0] as { catalogId: string; mostAtOnce: number }
    const rack = { [panel.catalogId]: panel.mostAtOnce - 1 }
    const free = await build(rack, false)
    const booked = await build(rack, true)

    // Every build is a fresh scene, so the two runs share no ids — each is checked against its
    // own second pour. Free, that is the one with a month of room. Booked, the move is nobody's
    // to make, and the pour is still standing in the overlap, so the shortage is unchanged.
    const answerFor = ({ solved }: { solved: ProjectReport }) =>
      solved.moveInsteadOfBuying?.find((entry) => entry.catalogId === panel.catalogId)
    expect(answerFor(free)?.moves[0]?.pourId).toBe(free.ids[1] as string)
    const answer = answerFor(booked)
    expect(answer?.committedPours).toEqual([booked.ids[1] as string])
    expect(answer?.moves.some((move) => move.pourId === booked.ids[1])).toBe(false)
    expect(answer?.shortBy).toBe(answerFor(free)?.shortBy as number)
  })
})

/**
 * How many sets the job needs — the question the bill is the wrong scope for.
 *
 * `sets.test.ts` owns the sweep. What only this surface can get wrong is what the model is
 * handed: that the same two walls poured a fortnight apart and poured on one day produce
 * different orders off an identical bill, that a programme too partial to sweep produces no
 * count *and* a stated reason, and that an unprogrammed project produces neither — an
 * absent count with no reason beside a present programme is the one shape here the model
 * would report as a fault rather than as a missing input.
 */
describe('the set count', () => {
  const shutterIds = (graph: SceneGraph): string[] =>
    Object.values(graph.nodes as unknown as Record<string, { id: string; type: string }>)
      .filter((node) => node.type === 'formwork-assembly')
      .map((node) => node.id)

  const twoDatedWalls = async (dates: [string, string]) => {
    const { graph, tools } = scene()
    await shutter(tools, 'wall_1')
    await shutter(tools, 'wall_2')
    await call(tools, 'set_formwork_settings', { schedule: { returnLeadDays: 3 } })
    const ids = shutterIds(graph)
    for (const [index, id] of ids.entries())
      await call(tools, 'set_pour_date', { assemblyId: id, pourAt: dates[index] as string })
    return await project(tools, { levelId: 'level_1' })
  }

  test('two walls a fortnight apart share one set, so the order is half the bill', async () => {
    // The reason the module exists. What passes through the job is two walls' worth of
    // panels and what somebody buys is one wall's worth, used twice.
    const solved = await twoDatedWalls(['2026-03-02', '2026-03-16'])

    expect(solved.sets?.countedPours).toBe(2)
    expect(solved.sets?.gaps).toEqual([])
    // Nothing is standing on the same day as anything else, so no peak exceeds one wall.
    expect(solved.sets?.poursAtOnce).toBe(1)
    const panel = solved.sets?.items.find((item) => item.reuses > 1)
    expect(panel?.reuses).toBeCloseTo(2, 1)
    expect(panel?.mostAtOnce).toBe((panel?.fittedInTotal ?? 0) / 2)
    expect(panel?.neededFrom).toBe('2026-03-02')
  })

  test('the same two walls poured on one day need both sets, and the count is the bill', async () => {
    // Identical geometry, identical bill, twice the order — which is the whole claim, and
    // it is only visible by holding the bill still and moving the dates.
    const apart = await twoDatedWalls(['2026-03-02', '2026-03-16'])
    const together = await twoDatedWalls(['2026-03-02', '2026-03-02'])

    expect(together.sets?.poursAtOnce).toBe(2)
    for (const item of together.sets?.items ?? []) {
      // Nothing is reused, so every peak is the line's whole quantity — the count is the
      // bill, said out loud rather than left as two matching numbers on different panels.
      const line = together.bom.find((row) => row.catalogId === item.catalogId)
      expect(item.mostAtOnce).toBe(line?.quantity)
      expect(item.reuses).toBe(1)
    }
    const panel = apart.sets?.items.find((item) => item.reuses > 1) as { catalogId: string }
    const same = together.sets?.items.find((item) => item.catalogId === panel.catalogId)
    expect(same?.mostAtOnce).toBeGreaterThan(
      apart.sets?.items.find((item) => item.catalogId === panel.catalogId)?.mostAtOnce ?? 0,
    )
  })

  test('one date in two pours gets no count, and the reason it has none', async () => {
    // A sweep over half a programme reports a peak of one set, and one set is what a reader
    // orders. So there is deliberately no figure, and the reason travels as a field.
    const { graph, tools } = scene()
    await shutter(tools, 'wall_1')
    await shutter(tools, 'wall_2')
    const [id] = shutterIds(graph)
    await call(tools, 'set_pour_date', { assemblyId: id, pourAt: '2026-03-02' })

    const solved = await project(tools, { levelId: 'level_1' })

    expect(solved.schedule).toBeDefined()
    expect(solved.sets).toBeUndefined()
    expect(solved.noSetCountBecause).toContain('1 of 2')
    expect(solved.caveats.some((c) => c.startsWith('No set count'))).toBe(true)
  })

  test('an unprogrammed project gets neither a count nor a reason', async () => {
    const { tools } = scene()
    await shutter(tools, 'wall_1')

    const solved = await project(tools, { levelId: 'level_1' })

    // Nothing is missing that the answer does not already show: there is no programme, and
    // a set count is a statement about dates.
    expect(solved.schedule).toBeUndefined()
    expect(solved.sets).toBeUndefined()
    expect(solved.noSetCountBecause).toBeUndefined()
  })
})

/**
 * What the yard has to go out and get, as the AI reads it.
 *
 * `acquire.test.ts` owns the arithmetic. What only this surface can get wrong is what a model
 * carries away: a shortfall confused with the bill's hired quantity, a verdict quoted without
 * the payback that makes it arguable, and an absent rack read as a yard that owns nothing.
 */
describe('what to acquire', () => {
  const shutterIds = (graph: SceneGraph): string[] =>
    Object.values(graph.nodes as unknown as Record<string, { id: string; type: string }>)
      .filter((node) => node.type === 'formwork-assembly')
      .map((node) => node.id)

  /** Two walls a fortnight apart, so the same set serves both, plus whatever settings. */
  const sequential = async (settings: Record<string, unknown>) => {
    const { graph, tools } = scene()
    await shutter(tools, 'wall_1')
    await shutter(tools, 'wall_2')
    await call(tools, 'set_formwork_settings', { schedule: { returnLeadDays: 3 }, ...settings })
    for (const [index, id] of shutterIds(graph).entries()) {
      await call(tools, 'set_pour_date', {
        assemblyId: id,
        pourAt: index === 0 ? '2026-03-02' : '2026-03-16',
      })
    }
    return await project(tools, { levelId: 'level_1' })
  }

  test('the shortfall is the peak over the rack, and it is under the bill’s hired quantity', async () => {
    // The error this block exists to prevent. Both walls pass their panels through the job
    // and the rack covers part of one wall's, so the split hires far more than the peak
    // needs at once — and a model quoting the split has quoted an order three times too big.
    const solved = await sequential({ stock: { owned: {} } })
    const panel = solved.sets?.items.find((item) => item.reuses > 1) as { catalogId: string }
    const withRack = await sequential({ stock: { owned: { [panel.catalogId]: 4 } } })

    const line = withRack.acquire?.items.find((item) => item.catalogId === panel.catalogId)
    const hired = withRack.bom.find((row) => row.catalogId === panel.catalogId)?.toHire as number
    expect(line?.owned).toBe(4)
    expect(line?.shortBy).toBe((line?.mostAtOnce as number) - 4)
    expect(line?.shortBy).toBeLessThan(hired)
    expect(line?.neededBy).toBe('2026-03-02')
    expect(line?.poursCausingThePeak?.length).toBeGreaterThan(0)
    expect(solved.acquire?.shortfallQuantity).toBeGreaterThan(0)
  })

  test('a rack that covers the peak leaves spare rather than a saving', async () => {
    const solved = await sequential({ stock: { owned: {} } })
    const panel = solved.sets?.items.find((item) => item.reuses > 1) as { catalogId: string }
    const stocked = await sequential({ stock: { owned: { [panel.catalogId]: 500 } } })

    const line = stocked.acquire?.items.find((item) => item.catalogId === panel.catalogId)
    expect(line?.shortBy).toBe(0)
    expect(line?.spare).toBeGreaterThan(0)
    // The sentence a model must not turn into money — the rack is already paid for.
    expect(stocked.caveats.some((c) => c.includes('spare capacity for another job'))).toBe(true)
  })

  test('a verdict never travels without the payback that makes it arguable', async () => {
    const first = await sequential({ stock: { owned: {} } })
    const panel = first.sets?.items.find((item) => item.reuses > 1) as { catalogId: string }
    const priced = await sequential({
      stock: { owned: { [panel.catalogId]: 4 } },
      rates: {
        currency: 'GBP',
        byCatalogId: { [panel.catalogId]: { purchasePerUnit: 210, rentalPercentPerMonth: 3 } },
      },
    })

    const line = priced.acquire?.items.find((item) => item.catalogId === panel.catalogId)
    expect(priced.acquire?.currency).toBe('GBP')
    // Hire on any one job, because hire is a few per cent of new value a month — and the
    // payback in jobs is the figure a yard settles against its own order book.
    expect(line?.cheaperOverThisJob).toBe('hire')
    expect(line?.paysBackOverJobs).toBeGreaterThan(1)
    expect(priced.caveats.some((c) => c.includes('Read the payback rather than the verdict'))).toBe(
      true,
    )
  })

  test('a shortfall with no rates carries no verdict at all, rather than a default one', async () => {
    const solved = await sequential({ stock: { owned: {} } })
    const panel = solved.sets?.items.find((item) => item.reuses > 1) as { catalogId: string }
    const unpriced = await sequential({ stock: { owned: { [panel.catalogId]: 4 } } })

    const line = unpriced.acquire?.items.find((item) => item.catalogId === panel.catalogId)
    // The half of this that needs no commercial input is still reported: "you are short 6"
    // is useful with no price on it.
    expect(line?.shortBy).toBeGreaterThan(0)
    expect(line?.cheaperOverThisJob).toBeUndefined()
    expect(line?.paysBackOverJobs).toBeUndefined()
  })

  test('a programme with no rack says which input is missing, not that the yard owns nothing', async () => {
    const solved = await sequential({})

    expect(solved.sets).toBeDefined()
    expect(solved.acquire).toBeUndefined()
    expect(solved.noAcquisitionBecause).toContain('ownedStock')
    expect(solved.caveats.some((c) => c.includes('what to buy or hire'))).toBe(true)
  })

  test('a rack with no programme is told about the dates once, not about two absences', async () => {
    const { tools } = scene()
    await shutter(tools, 'wall_1')
    await call(tools, 'set_formwork_settings', { stock: { owned: {} } })

    const solved = await project(tools, { levelId: 'level_1' })

    expect(solved.sets).toBeUndefined()
    expect(solved.acquire).toBeUndefined()
    expect(solved.noAcquisitionBecause).toBeUndefined()
    expect(solved.caveats.some((c) => c.includes('what to buy or hire'))).toBe(false)
  })
})

/**
 * What waits on what, as the AI reads it.
 *
 * `sequence.test.ts` and `resequence.test.ts` own the arithmetic. What only this surface can
 * get wrong is what the model carries away, and every one of these is a sentence it would say
 * out loud from the wrong shape: a float column read as a critical path, an allowance read as
 * slack two pours can both spend, a refusal dropped instead of named, and a move presented as
 * a plan when nothing here knows about the gang or the crane.
 */
describe('what has to happen before what', () => {
  const shutterIds = (graph: SceneGraph): string[] =>
    Object.values(graph.nodes as unknown as Record<string, { id: string; type: string }>)
      .filter((node) => node.type === 'formwork-assembly')
      .map((node) => node.id)

  /** Two walls in stated cast order, so there is a real dependency between them. */
  const ordered = async (dates: [string, string], settings: Record<string, unknown> = {}) => {
    const { graph, tools } = scene()
    for (const [index, elementId] of ['wall_1', 'wall_2'].entries()) {
      await shutter(tools, elementId)
      await call(tools, 'set_element_construction', { elementId, castOrder: index + 1 })
    }
    await call(tools, 'set_formwork_settings', { schedule: { returnLeadDays: 3 }, ...settings })
    for (const [index, id] of shutterIds(graph).entries())
      await call(tools, 'set_pour_date', { assemblyId: id, pourAt: dates[index] as string })
    return await project(tools, { levelId: 'level_1' })
  }

  test('the dependency carries the reason it exists, not only the pair', async () => {
    // A dependency the model cannot justify is one it presents as a rule of the tool. This one
    // is the project's own stated cast order, and the sentence names the elements.
    const solved = await ordered(['2026-03-02', '2026-03-16'])

    expect(solved.sequence?.pours).toHaveLength(2)
    expect(solved.sequence?.dependencies).toHaveLength(1)
    expect(solved.sequence?.dependencies[0]?.because).toContain('explicit cast order')
    const first = solved.sequence?.pours[0]
    expect(first?.holdsUp).toEqual([solved.sequence?.pours[1]?.pourId as string])
    expect(solved.sequence?.pours[1]?.waitsOn).toEqual([first?.pourId as string])
  })

  test('the allowance is bounded by the neighbour’s date, and the caveats refuse the phrase', async () => {
    const solved = await ordered(['2026-03-02', '2026-03-16'])

    const second = solved.sequence?.pours[1]
    expect(second?.noEarlierThan).toBe('2026-03-02')
    expect(second?.allowanceDays).toBeGreaterThan(0)
    // The two sentences that matter more than the numbers, and both travel with the answer
    // rather than living in the tool description the model may or may not still be holding.
    expect(solved.caveats.some((c) => c.includes('not a critical path'))).toBe(true)
    expect(solved.caveats.some((c) => c.includes('Float is not slack a gang can spend'))).toBe(true)
  })

  test('a pour nothing orders against anything says so rather than reporting an allowance', async () => {
    const { graph, tools } = scene()
    await shutter(tools, 'wall_1')
    await shutter(tools, 'wall_2')
    await call(tools, 'set_formwork_settings', { schedule: { returnLeadDays: 3 } })
    for (const [index, id] of shutterIds(graph).entries())
      await call(tools, 'set_pour_date', { assemblyId: id, pourAt: `2026-03-0${2 + index}` })

    const solved = await project(tools, { levelId: 'level_1' })

    expect(solved.sequence?.unsequencedPours).toHaveLength(2)
    expect(solved.sequence?.dependencies).toEqual([])
    expect(solved.caveats.some((c) => c.includes('Nothing in this scope states an order'))).toBe(
      true,
    )
  })

  test('no dated pour leaves the block off rather than reporting an unbounded one', async () => {
    const { tools } = scene()
    await shutter(tools, 'wall_1')

    const solved = await project(tools, { levelId: 'level_1' })

    expect(solved.sequence).toBeUndefined()
    expect(solved.moveInsteadOfBuying).toBeUndefined()
  })

  /**
   * Three walls in stated cast order over the whole scene, so the middle one has somewhere
   * to go: two on one day and the third a month later. Two walls alone are always pinned —
   * with nothing after the second, the programme's own span is the pair's own dates.
   */
  const threeOrdered = async (settings: Record<string, unknown>, thirdAt = '2026-03-30') => {
    const { graph, tools } = scene()
    for (const [index, elementId] of ['wall_1', 'wall_2', 'wall_3'].entries()) {
      await shutter(tools, elementId)
      await call(tools, 'set_element_construction', { elementId, castOrder: index + 1 })
    }
    await call(tools, 'set_formwork_settings', { schedule: { returnLeadDays: 3 }, ...settings })
    const dates = ['2026-03-02', '2026-03-02', thirdAt]
    for (const [index, id] of shutterIds(graph).entries())
      await call(tools, 'set_pour_date', { assemblyId: id, pourAt: dates[index] as string })
    return await project(tools)
  }

  test('a shortage names the pour to move and the peak the move leaves behind', async () => {
    // The answer that is often cheaper than the order: two walls on one day put both bills on
    // site at once, and the second has a month of room before the third.
    const empty = await threeOrdered({ stock: { owned: {} } })
    const panel = empty.sets?.items[0] as { catalogId: string; mostAtOnce: number }
    const solved = await threeOrdered({
      stock: { owned: { [panel.catalogId]: panel.mostAtOnce - 1 } },
    })

    const answer = solved.moveInsteadOfBuying?.find((entry) => entry.catalogId === panel.catalogId)
    expect(answer?.shortBy).toBe(1)
    expect(answer?.noMoveBecause).toBeUndefined()
    const move = answer?.moves[0]
    expect(move?.peakBefore).toBe(panel.mostAtOnce)
    expect(move?.peakAfter).toBeLessThan(panel.mostAtOnce)
    expect(move?.fromDate).toBe('2026-03-02')
    expect(move?.toDate).not.toBe('2026-03-02')
    // Present even when empty, because a move with no price beside it reads as free.
    expect(move?.raisesElsewhere).toBeDefined()
    expect(solved.caveats.some((c) => c.includes('argument to take to the planner'))).toBe(true)
  })

  test('a shortage no move can clear is told to buy it, rather than getting no row', async () => {
    // The firing half of the same check. All three on one day and each pinned by the others:
    // the honest answer is that the shortfall has to be bought, and a dropped row reads as
    // the tool having nothing to say.
    const empty = await threeOrdered({ stock: { owned: {} } }, '2026-03-02')
    const panel = empty.sets?.items[0] as { catalogId: string; mostAtOnce: number }
    const solved = await threeOrdered(
      { stock: { owned: { [panel.catalogId]: panel.mostAtOnce - 1 } } },
      '2026-03-02',
    )

    const answer = solved.moveInsteadOfBuying?.find((entry) => entry.catalogId === panel.catalogId)
    expect(answer?.noMoveBecause).toContain('bought or hired')
    expect(answer?.moves).toEqual([])
    expect(answer?.pinnedPours.length).toBeGreaterThan(0)
    expect(solved.caveats.some((c) => c.includes('pinned by the dates around it'))).toBe(true)
  })

  test('nothing short means no proposal, and the precedence still reads', async () => {
    // The rack comes off the scope's own peaks: a steel-panel wall bills ties and walers too,
    // and a rack holding only panels would leave those genuinely short.
    const empty = await ordered(['2026-03-02', '2026-03-16'], { stock: { owned: {} } })
    const owned = Object.fromEntries(
      (empty.sets?.items ?? []).map((item) => [item.catalogId, item.mostAtOnce]),
    )
    const solved = await ordered(['2026-03-02', '2026-03-16'], { stock: { owned } })

    expect(solved.acquire?.shortfallQuantity).toBe(0)
    expect(solved.sequence?.dependencies).toHaveLength(1)
    expect(solved.moveInsteadOfBuying).toBeUndefined()
  })
})
