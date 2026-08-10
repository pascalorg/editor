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
    complete: boolean
    linesAtMinimumHirePeriod: number
    ownedQuantityExcluded: number
    gaps: string[]
    excludes: string[]
  }
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

  test('owned stock is left out of the price rather than priced at zero, and says how much', async () => {
    // A sunk asset amortising over a reuse count nothing in this model records. Priced at
    // zero it would report a job forming itself free the more of its own kit it uses.
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

    expect(partlyOwned.cost?.ownedQuantityExcluded).toBe(4)
    expect(partlyOwned.caveats.some((c) => c.includes('sunk asset'))).toBe(true)
    // Charged on the hired remainder rather than on the whole quantity, and the four
    // owned are missing from the charge rather than priced at zero within it.
    const hired = partlyOwned.bom.find((row) => row.catalogId === panel.catalogId)
      ?.hireCost as number
    const all = whole.bom.find((row) => row.catalogId === panel.catalogId)?.hireCost as number
    expect(hired).toBeCloseTo((all * (panel.quantity - 4)) / panel.quantity, 2)
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

  test('the element rows and the scope counts agree with each other', async () => {
    const { tools } = scene()
    await shutter(tools, 'wall_1')
    await shutter(tools, 'wall_2')

    const ground = await project(tools, { levelId: 'level_1' })

    expect(ground.elementCount).toBe(ground.elements.length)
    expect(ground.shutterCount).toBe(ground.elements.reduce((total, e) => total + e.shutters, 0))
  })
})
