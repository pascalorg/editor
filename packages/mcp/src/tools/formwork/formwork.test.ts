import { beforeEach, describe, expect, test } from 'bun:test'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { validationSummary } from '@pascal-app/core/formwork'
import type { AnyNode, AnyNodeId } from '@pascal-app/core/schema'
import { validateProjectFormwork } from '@pascal-app/nodes/formwork-assembly/headless'
import { SceneBridge } from '../../bridge/scene-bridge'
import { registerFormworkTools } from './index'

/**
 * The formwork questions, asked from outside the editor.
 *
 * Three things are being asserted, and none of them is the arithmetic — `invariants.test.ts`
 * and `validate-project.test.ts` own that. First, that the solve runs at all in this
 * process: it reaches `three` and the geometry builders, and the MCP server has no DOM,
 * so a chain that had picked up a renderer would throw here rather than answer. Second,
 * that the answers are the *same* answers — a server telling a yard something the user's
 * own screen does not say is worse than a server that declines. Third, that a scope the
 * caller got wrong is refused, because "nothing wrong on level_9" is a sentence a model
 * will produce about a level that does not exist.
 */

interface Reply {
  scope: string
  elementCount: number
  errorCount: number
  warningCount: number
  findings: Array<{
    invariant: string
    severity: 'error' | 'warning'
    elementIds: string[]
    message: string
    locus: { alongM?: number; elevationM?: number } | null
  }>
  summary: string[]
  shutteredIds: string[]
  notChecked: Array<{ invariant: string; needs: string }>
}

interface BillReply {
  scope: string
  elementCount: number
  shutterCount: number
  elements: Array<{ id: string; kind: string; shutters: number; coversWholePour: boolean }>
  unshuttered: string[]
  bom: Array<{
    description: string
    catalogId: string | null
    quantity: number
    unit: string
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
  caveats: string[]
}

/**
 * A wall with a window, shuttered in 2.70 m panels.
 *
 * The panel width is the whole condition: 2.70 m panels are drilled at 1.35 and 4.65 m
 * along, so a window from 0.8 to 5.6 m puts every station in the void and leaves the
 * 800 mm pier at each end untied. At the 0.6 m default the holes come every 300 mm and
 * there is nothing to report. Built as raw nodes because no tool sets the panel width.
 */
function walledWithOpening(): Record<string, unknown> {
  return {
    level_1: {
      object: 'node',
      id: 'level_1',
      type: 'level',
      parentId: null,
      visible: true,
      metadata: {},
      children: ['wall_1'],
      elevation: 0,
      height: 6,
      level: 0,
    },
    wall_1: {
      object: 'node',
      id: 'wall_1',
      type: 'wall',
      parentId: 'level_1',
      visible: true,
      metadata: {},
      children: ['window_1', 'formwork-assembly_1'],
      start: [0, 0],
      end: [6, 0],
      thickness: 0.25,
      height: 3,
      frontSide: 'unknown',
      backSide: 'unknown',
      formworkType: 'steel-panel',
    },
    window_1: {
      object: 'node',
      id: 'window_1',
      type: 'window',
      parentId: 'wall_1',
      wallId: 'wall_1',
      visible: true,
      metadata: {},
      children: [],
      position: [3.2, 1.5, 0],
      width: 4.8,
      height: 2.4,
    },
    'formwork-assembly_1': {
      object: 'node',
      id: 'formwork-assembly_1',
      type: 'formwork-assembly',
      parentId: 'wall_1',
      visible: true,
      metadata: {},
      children: [],
      position: [0, 0, 0],
      rotation: [0, 0, 0],
      panelWidth: 2.7,
      fillerPosition: 'middle',
      segmentIndex: 0,
      liftIndex: 0,
      partOverrides: {},
    },
  }
}

/**
 * A U — a 500 mm link wall with a return at each end, all one pour.
 *
 * Both ends take a corner unit, and on a 250 mm wall the outside legs want 550 mm each
 * of a 500 mm face. Raw nodes again, because `pourId` is what makes the junctions
 * monolithic and so corner-unit work rather than a bulkhead, and no tool sets it.
 */
function shortReturn(): Record<string, unknown> {
  const wall = (id: string, start: [number, number], end: [number, number]) => ({
    object: 'node',
    id,
    type: 'wall',
    parentId: 'level_1',
    visible: true,
    metadata: {},
    children: [],
    start,
    end,
    thickness: 0.25,
    height: 3,
    frontSide: 'unknown',
    backSide: 'unknown',
    formworkType: 'steel-panel',
    castOrder: 1,
    pourId: 'P1',
  })
  return {
    level_1: {
      object: 'node',
      id: 'level_1',
      type: 'level',
      parentId: null,
      visible: true,
      metadata: {},
      children: ['link', 'left', 'right'],
      elevation: 0,
      height: 6,
      level: 0,
    },
    link: wall('link', [0, 0], [0.5, 0]),
    left: wall('left', [0, 0], [0, 3]),
    right: wall('right', [0.5, 0], [0.5, 3]),
  }
}

/**
 * Two levels, one wall thicker than any tie assembly reaches, one wall unshuttered.
 *
 * Enough for a level scope to be wrong in either direction, and for the difference
 * between "in scope" and "had a layout to check" to be visible.
 */
function twoLevels(): Record<string, unknown> {
  const wall = (id: string, parentId: string, y: number, thickness = 0.25, formed = true) => ({
    object: 'node',
    id,
    type: 'wall',
    parentId,
    visible: true,
    metadata: {},
    children: formed ? [`formwork-assembly_${id}`] : [],
    start: [0, y],
    end: [6, y],
    thickness,
    height: 6,
    frontSide: 'unknown',
    backSide: 'unknown',
    formworkType: 'steel-panel',
  })
  const assembly = (hostId: string) => ({
    object: 'node',
    id: `formwork-assembly_${hostId}`,
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
  })
  return {
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
    'formwork-assembly_wall_1': assembly('wall_1'),
    // Thicker than any system tie assembly reaches, and nobody has formed it — so it
    // is in scope, has no layout, and is the reason `shutteredIds` is a separate list.
    wall_2: wall('wall_2', 'level_1', 4, 1.4, false),
    wall_3: wall('wall_3', 'level_2', 0),
    'formwork-assembly_wall_3': assembly('wall_3'),
  }
}

/**
 * A 9 m wall with nothing formed on it — tall enough that a lift cap splits it.
 *
 * `null` leaves `formworkType` off the node entirely, which is one of the two ways an
 * element says nobody has chosen a system for it.
 */
function tallWall(formworkType: string | null = 'steel-panel'): Record<string, unknown> {
  return {
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
      children: ['level_1'],
    },
    level_1: {
      object: 'node',
      id: 'level_1',
      type: 'level',
      parentId: 'building_1',
      visible: true,
      metadata: {},
      children: ['wall_1'],
      elevation: 0,
      height: 9,
      level: 0,
    },
    wall_1: {
      object: 'node',
      id: 'wall_1',
      type: 'wall',
      parentId: 'level_1',
      visible: true,
      metadata: {},
      children: [],
      start: [0, 0],
      end: [6, 0],
      thickness: 0.25,
      height: 9,
      frontSide: 'unknown',
      backSide: 'unknown',
      ...(formworkType === null ? {} : { formworkType }),
    },
  }
}

/**
 * Three plain walls on one level, for an order the project states rather than a lift chain.
 *
 * A lift chain has no room in it — lift 2 cannot move while lift 1 stands where it is — so a
 * pour with somewhere to go has to come from elements the project sequenced itself.
 */
function threeWalls(): Record<string, unknown> {
  const wall = (id: string, y: number) => ({
    object: 'node',
    id,
    type: 'wall',
    parentId: 'level_1',
    visible: true,
    metadata: {},
    children: [],
    start: [0, y],
    end: [6, y],
    thickness: 0.25,
    height: 6,
    frontSide: 'unknown',
    backSide: 'unknown',
    formworkType: 'steel-panel',
  })
  return {
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
      children: ['level_1'],
    },
    level_1: {
      object: 'node',
      id: 'level_1',
      type: 'level',
      parentId: 'building_1',
      visible: true,
      metadata: {},
      children: ['wall_1', 'wall_2', 'wall_3'],
      elevation: 0,
      height: 6,
      level: 0,
    },
    wall_1: wall('wall_1', 0),
    wall_2: wall('wall_2', 4),
    wall_3: wall('wall_3', 8),
  }
}

/** A slab and a column beside a wall, for the reads and writes that branch on kind. */
function threeKinds(): Record<string, unknown> {
  return {
    ...tallWall(null),
    level_1: {
      object: 'node',
      id: 'level_1',
      type: 'level',
      parentId: 'building_1',
      visible: true,
      metadata: {},
      children: ['wall_1', 'column_1', 'slab_1'],
      elevation: 0,
      height: 9,
      level: 0,
    },
    column_1: {
      object: 'node',
      id: 'column_1',
      type: 'column',
      parentId: 'level_1',
      visible: true,
      metadata: {},
      children: [],
      position: [3, 0, 2],
      crossSection: 'square',
      width: 0.4,
      depth: 0.4,
      radius: 0.2,
      height: 9,
      formworkType: 'steel-panel',
    },
    slab_1: {
      object: 'node',
      id: 'slab_1',
      type: 'slab',
      parentId: 'level_1',
      visible: true,
      metadata: {},
      children: [],
      polygon: [
        [0, 0],
        [6, 0],
        [6, 5],
        [0, 5],
      ],
      holes: [],
      elevation: 9,
      thickness: 0.25,
    },
  }
}

/** The project's recorded rack, which is what the bill splits owned from hired against. */
function withStock(
  nodes: Record<string, unknown>,
  owned: Record<string, number>,
): Record<string, unknown> {
  return withSettings(nodes, { stock: { owned } })
}

/** The settings node, for the groups a bill reads other than the rack. */
function withSettings(
  nodes: Record<string, unknown>,
  settings: Record<string, unknown>,
): Record<string, unknown> {
  return {
    ...nodes,
    'formwork-settings_1': {
      object: 'node',
      id: 'formwork-settings_1',
      type: 'formwork-settings',
      parentId: 'site_1',
      visible: true,
      metadata: {},
      children: [],
      ...settings,
    },
  }
}

describe('the formwork MCP tools', () => {
  let client: Client
  let bridge: SceneBridge

  const load = (nodes: Record<string, unknown>) => {
    const roots = Object.values(nodes)
      .filter((node) => (node as { parentId: string | null }).parentId === null)
      .map((node) => (node as { id: string }).id)
    bridge.setScene(nodes as unknown as Record<AnyNodeId, AnyNode>, roots as unknown as AnyNodeId[])
  }

  const call = async <T>(name: string, args: Record<string, unknown> = {}): Promise<T> => {
    const result = await client.callTool({ name, arguments: args })
    return JSON.parse(
      (result.content as Array<{ type: string; text: string }>)[0]?.text ?? 'null',
    ) as T
  }

  beforeEach(async () => {
    bridge = new SceneBridge()
    bridge.setScene({}, [])
    const server = new McpServer({ name: 'test', version: '0.0.0' })
    registerFormworkTools(server, bridge)
    const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair()
    client = new Client({ name: 'test-client', version: '0.0.0' })
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)])
  })

  test('every formwork tool is registered, so an agent can find them', async () => {
    const { tools } = await client.listTools()

    expect(tools.map((tool) => tool.name)).toEqual(
      expect.arrayContaining([
        'list_castable_elements',
        'set_element_construction',
        'inspect_project_formwork',
        'validate_formwork',
        'inspect_formwork_settings',
        'set_formwork_settings',
        'inspect_formwork_parts',
        'set_formwork_part',
        'set_pour_limits',
        'inspect_pour_units',
        'attach_formwork',
        'set_pour_date',
        'commit_pour',
      ]),
    )
  })

  test('solves a wall in a process with no DOM, and bills it', async () => {
    // The claim the headless entry point makes. The solve reaches `three` and the
    // geometry builders; a chain that had picked up a renderer would throw here.
    expect(typeof document).toBe('undefined')
    load(walledWithOpening())

    const reply = await call<BillReply>('inspect_project_formwork')

    expect(reply.elementCount).toBe(1)
    expect(reply.bom.length).toBeGreaterThan(0)
    expect(reply.totalWeightKg).toBeGreaterThan(0)
    expect(reply.elements[0]?.id).toBe('wall_1')
  })

  test('names the elements in scope that nobody has formed', async () => {
    // Omitted, an unformed wall makes a floor look like a floor that needs nothing —
    // and it is the most likely reason a total is lower than the caller expects.
    load(twoLevels())

    const reply = await call<BillReply>('inspect_project_formwork', { levelId: 'level_1' })

    expect(reply.elements.map((element) => element.id)).toEqual(['wall_1'])
    expect(reply.unshuttered).toEqual(['wall_2'])
  })

  test('bills one level and does not carry the floor above', async () => {
    load(twoLevels())

    const ground = await call<BillReply>('inspect_project_formwork', { levelId: 'level_1' })
    const whole = await call<BillReply>('inspect_project_formwork')

    expect(ground.elements.map((element) => element.id)).toEqual(['wall_1'])
    expect(whole.elements.map((element) => element.id)).toEqual(['wall_1', 'wall_3'])
    expect(whole.totalWeightKg).toBeGreaterThan(ground.totalWeightKg)
  })

  test('reports a pier an opening leaves with no tie, and where to strut it', async () => {
    // The finding no other tool can produce. The shutter drops the ties landing in the
    // void — correctly — and neither the parts list nor the takeoff records what
    // dropping them left untied, so an agent holding the whole scene cannot derive it.
    load(walledWithOpening())

    const reply = await call<Reply>('validate_formwork')

    const gap = reply.findings.find((finding) => finding.invariant === 'OPENING_LEAVES_TIE_GAP')
    expect(gap?.severity).toBe('warning')
    expect(gap?.elementIds).toEqual(['wall_1', 'window_1'])
    expect(gap?.message).toContain('800 mm')
    expect(gap?.message).toContain('strut')
    expect(gap?.locus?.elevationM).toBeCloseTo(0.775, 6)
  })

  test('reports a return too short for the corner units it needs', async () => {
    // The other finding no tool can derive. The takeoff bills two corner units and
    // every figure in it is self-consistent, because the panel run between them is
    // measured as though both fit; an agent reading the bill sees a wall that costs
    // what it should and cannot be built.
    load(shortReturn())

    const reply = await call<Reply>('validate_formwork')

    const clash = reply.findings.find((finding) => finding.invariant === 'CORNER_UNITS_OVERLAP')
    expect(clash?.severity).toBe('error')
    expect(clash?.elementIds).toContain('link')
    expect(clash?.message).toContain('500 mm long')
    expect(clash?.message).toContain('bespoke box')
  })

  test('keeps the two severities apart rather than reporting one count', async () => {
    // An error is something the crew cannot do and a warning is an exception somebody
    // signs. Summed, the reader cannot tell which they are looking at.
    load(walledWithOpening())

    const reply = await call<Reply>('validate_formwork')

    expect(reply.errorCount + reply.warningCount).toBe(reply.findings.length)
    expect(reply.findings.filter((f) => f.severity === 'error')).toHaveLength(reply.errorCount)
    expect(reply.findings.filter((f) => f.severity === 'warning')).toHaveLength(reply.warningCount)
  })

  test('the sentences are the ones the panel and the chat both print', async () => {
    // The reason this tool is thin over a shared module rather than its own summariser.
    // Three phrasings of one fault is how a user comes to believe there are three.
    const nodes = walledWithOpening()
    load(nodes)

    const reply = await call<Reply>('validate_formwork')
    const onScreen = validationSummary(
      validateProjectFormwork(nodes as unknown as Record<string, AnyNode>).report,
    )

    expect(reply.summary).toEqual(onScreen)
  })

  test('says which assertions could not run here', async () => {
    // A report of failures alone reads as a clean bill of health for everything it
    // never examined — rebar clashes and crane capacity among them.
    load(twoLevels())

    const reply = await call<Reply>('validate_formwork', { levelId: 'level_1' })

    expect(reply.notChecked.map((entry) => entry.invariant)).toContain('TIES_THROUGH_REBAR')
    for (const entry of reply.notChecked) expect(entry.needs.length).toBeGreaterThan(0)
  })

  test('names which elements had a layout to check at all', async () => {
    // Two walls in scope, one formed. A pass over the unformed one is not a pass: four
    // of the assertions are properties of a layout it does not have.
    load(twoLevels())

    const reply = await call<Reply>('validate_formwork', { levelId: 'level_1' })

    expect(reply.elementCount).toBe(2)
    expect(reply.shutteredIds).toEqual(['wall_1'])
  })

  test('checks only the elements named when given a selection', async () => {
    load(twoLevels())

    const reply = await call<Reply>('validate_formwork', { elementIds: ['wall_1'] })

    expect(reply.shutteredIds).toEqual(['wall_1'])
    expect(reply.findings.flatMap((finding) => finding.elementIds)).not.toContain('wall_3')
  })

  test('an empty selection is an empty scope, not the whole scene', async () => {
    load(twoLevels())

    const reply = await call<Reply>('validate_formwork', { elementIds: [] })

    expect(reply.findings).toEqual([])
    expect(reply.summary.join(' ')).toContain('Nothing in this scope to check.')
  })

  test('both tools refuse a level that does not exist', async () => {
    // Scoped to a typo, the honest answer is indistinguishable from a floor that
    // passed — and it is the answer a model will repeat to the user as reassurance.
    load(twoLevels())

    for (const name of ['validate_formwork', 'inspect_project_formwork']) {
      const result = await client.callTool({ name, arguments: { levelId: 'level_9' } })

      expect(result.isError).toBe(true)
      const text = (result.content as Array<{ type: string; text: string }>)[0]?.text ?? ''
      expect(text).toContain('no level with id level_9')
      expect(text).toContain('list_levels')
    }
  })

  test('reports no owned/hired split until the project records a rack', async () => {
    // Absent, not a split of zeros. A bill reading "everything on hire" is a claim
    // about the yard that nobody made, and a model given zeros will repeat it.
    load(twoLevels())

    const reply = await call<BillReply>('inspect_project_formwork', { levelId: 'level_1' })

    expect(reply.supply).toBeUndefined()
    expect(reply.bom.every((line) => line.toHire === undefined)).toBe(true)
  })

  test('splits each line and the whole bill once the rack is recorded', async () => {
    load(twoLevels())
    const plain = await call<BillReply>('inspect_project_formwork', { levelId: 'level_1' })
    const panel = plain.bom.find((line) => line.catalogId !== null) as {
      catalogId: string
      quantity: number
    }
    load(withStock(twoLevels(), { [panel.catalogId]: 4, 'eurex-20-top': 50 }))

    const reply = await call<BillReply>('inspect_project_formwork', { levelId: 'level_1' })

    const line = reply.bom.find((row) => row.catalogId === panel.catalogId)
    expect(line?.fromOwnStock).toBe(4)
    expect(line?.toHire).toBe(panel.quantity - 4)
    expect(reply.supply?.fromOwnStock).toBe(4)
    // A type the bill never draws on, named rather than dropped.
    expect(reply.supply?.ownedNotUsedHere).toEqual(['eurex-20-top'])
    expect(reply.caveats.some((caveat) => caveat.includes('not a total'))).toBe(true)
  })

  test('every line says how long it is held, and always answers', async () => {
    // Unlike the supply split, which is absent until a rack is recorded. A strike period
    // is a consequence of the code the project is already designed under, so silence
    // about the curing inputs names an assumption rather than withholding the answer.
    load(twoLevels())

    const reply = await call<BillReply>('inspect_project_formwork', { levelId: 'level_1' })

    expect(reply.supply).toBeUndefined()
    expect(reply.hire.longestDaysHeld).toBeGreaterThan(0)
    expect(reply.hire.assumed.length).toBeGreaterThan(0)
    const panel = reply.bom.find((line) => line.catalogId !== null)
    expect(panel?.struckAs).toBe('vertical-form')
    // Null rather than 0 for a part nothing strikes — a 0 reads as plant returned the
    // same day, and it is a figure a model will multiply by a rate.
    const notStruck = reply.bom.filter((line) => line.daysHeld === null)
    expect(notStruck.length).toBeGreaterThan(0)
    expect(notStruck.every((line) => line.struckAs === null)).toBe(true)
  })

  test('says which clock its periods are on, and when they came from another family', async () => {
    // The shipped default is DIN, which publishes no striking table — its family answers
    // removal in EN 13670. Falling to BS 8110 is right and it is a substitution.
    load(twoLevels())
    const din = await call<BillReply>('inspect_project_formwork', { levelId: 'level_1' })

    expect(din.hire.standard).toBe('BS_8110')
    expect(din.hire.basis).toBe('calendar')
    expect(din.hire.substitutedFromAnotherCodeFamily).toBe(true)
    expect(din.caveats.some((caveat) => caveat.includes('publishes no striking periods'))).toBe(
      true,
    )

    load(withSettings(twoLevels(), { pressureStandard: 'ACI_347' }))
    const aci = await call<BillReply>('inspect_project_formwork', { levelId: 'level_1' })

    // Cumulative hours above 10 °C, not calendar days. A programme written off the wrong
    // clock strikes early in a cold spring, and only this field says which it is.
    expect(aci.hire.basis).toBe('qualifying-time')
    expect(aci.hire.substitutedFromAnotherCodeFamily).toBe(false)
    expect(aci.caveats.some((caveat) => caveat.includes('above 10 °C'))).toBe(true)
  })

  test('a recorded curing temperature lengthens the hire and drops the assumption', async () => {
    load(twoLevels())
    const assumed = await call<BillReply>('inspect_project_formwork', { levelId: 'level_1' })

    load(withSettings(twoLevels(), { curing: { surfaceTemperatureC: 5 } }))
    const cold = await call<BillReply>('inspect_project_formwork', { levelId: 'level_1' })

    expect(cold.hire.longestDaysHeld).toBeGreaterThan(assumed.hire.longestDaysHeld)
    expect(cold.hire.assumed.some((entry) => entry.includes('No curing surface'))).toBe(false)
  })

  test('there is no money in the bill until the project records a rate', async () => {
    // The one input in the model with no conservative fallback, so absent is the answer
    // rather than a total of zero — which is the single figure an agent would quote.
    load(withStock(twoLevels(), {}))

    const reply = await call<BillReply>('inspect_project_formwork', { levelId: 'level_1' })

    expect(reply.cost).toBeUndefined()
    expect(reply.bom.every((line) => line.lineCost === undefined)).toBe(true)
  })

  test('prices the bill against a recorded rate, and says what the price leaves out', async () => {
    load(twoLevels())
    const plain = await call<BillReply>('inspect_project_formwork', { levelId: 'level_1' })
    const panel = plain.bom.find((line) => line.catalogId !== null) as { catalogId: string }
    load(
      withSettings(twoLevels(), {
        rates: {
          currency: 'GBP',
          byCatalogId: { [panel.catalogId]: { purchasePerUnit: 420, rentalPercentPerMonth: 3 } },
        },
      }),
    )

    const reply = await call<BillReply>('inspect_project_formwork', { levelId: 'level_1' })

    expect(reply.cost?.currency).toBe('GBP')
    expect(reply.cost?.hire).toBeGreaterThan(0)
    expect(reply.bom.find((row) => row.catalogId === panel.catalogId)?.lineCost).toBeGreaterThan(0)
    // Only one part is priced, so the rest of the bill is not: the total is a floor and
    // the reply says so rather than leaving an agent to notice.
    expect(reply.cost?.complete).toBe(false)
    expect(reply.caveats.some((caveat) => caveat.includes('a floor rather than a price'))).toBe(
      true,
    )
    // This is the cost of holding the formwork, not of forming the job.
    expect(reply.cost?.excludes.some((entry) => entry.includes('labour'))).toBe(true)
  })

  test('the minimum hire period is what the invoice reconciles with', async () => {
    // A wall form struck in 12 hours against a 28-day minimum is charged for 28 days,
    // and on a fast cycle that difference is most of the cost of the job.
    load(twoLevels())
    const plain = await call<BillReply>('inspect_project_formwork', { levelId: 'level_1' })
    const panel = plain.bom.find((line) => line.catalogId !== null) as { catalogId: string }
    const rate = { [panel.catalogId]: { rentalPerUnitPerMonth: 30 } }

    load(withSettings(twoLevels(), { rates: { byCatalogId: rate } }))
    const held = await call<BillReply>('inspect_project_formwork', { levelId: 'level_1' })
    load(withSettings(twoLevels(), { rates: { minHireDays: 28, byCatalogId: rate } }))
    const charged = await call<BillReply>('inspect_project_formwork', { levelId: 'level_1' })

    const line = charged.bom.find((row) => row.catalogId === panel.catalogId)
    expect(line?.daysCharged).toBe(28)
    expect(line?.atMinimumHirePeriod).toBe(true)
    expect(charged.cost?.linesAtMinimumHirePeriod).toBe(1)
    expect(held.cost?.hire).toBeGreaterThan(0)
    expect(charged.cost?.hire).toBeGreaterThan((held.cost?.hire as number) * 10)
    expect(charged.caveats.some((c) => c.includes('pouring more with the same set'))).toBe(true)
  })

  test('a project with no norms is told there is no labour, rather than shown none', async () => {
    // The absence an agent is likeliest to read as "this job needs no labour", and the
    // only one here with no product table to fall back to.
    load(twoLevels())

    const reply = await call<BillReply>('inspect_project_formwork', { levelId: 'level_1' })

    expect(reply.labour).toBeUndefined()
    expect(reply.noLabourBecause).toContain('no output norms')
    expect(reply.noLabourBecause).toContain('Never estimate them')
  })

  test('the gang’s hours are reported beside the money and never inside it', async () => {
    // Two costs negotiated with two different people: a shorter programme cuts the hire
    // and leaves the hours exactly where they were. An agent that adds them has quoted a
    // formwork price nobody will recognise.
    load(twoLevels())
    const plain = await call<BillReply>('inspect_project_formwork', { levelId: 'level_1' })
    const panel = plain.bom.find((line) => line.catalogId !== null) as { catalogId: string }
    load(
      withSettings(twoLevels(), {
        labour: { byPartKind: { panel: { erectHours: 0.5, strikeHours: 0.25 } } },
        rates: {
          currency: 'GBP',
          gangRatePerHour: 32,
          byCatalogId: { [panel.catalogId]: { rentalPercentPerMonth: 3, purchasePerUnit: 420 } },
        },
      }),
    )

    const reply = await call<BillReply>('inspect_project_formwork', { levelId: 'level_1' })

    expect(reply.labour?.erectManHours).toBeGreaterThan(0)
    expect(reply.labour?.strikeManHours).toBeGreaterThan(0)
    expect(reply.labour?.totalManHours).toBeCloseTo(
      (reply.labour?.erectManHours ?? 0) + (reply.labour?.strikeManHours ?? 0),
      2,
    )
    expect(reply.labour?.cost).toBeCloseTo((reply.labour?.totalManHours ?? 0) * 32, 1)
    expect(reply.labour?.currency).toBe('GBP')
    // The hours are absent from the money block, and the money block says where they are.
    expect(reply.cost?.total).not.toBe(reply.labour?.cost)
    expect(reply.cost?.excludes.some((entry) => entry.includes('deliberately not in total'))).toBe(
      true,
    )
    // Man-hours rather than a duration, said as data rather than left to the description.
    expect(reply.labour?.excludes.some((entry) => entry.includes('gang size'))).toBe(true)
  })

  test('the hours are tabled per operation, and the uncovered fittings are named', async () => {
    // A norm is per kind, so a panel-only table covers a fraction of a steel-panel bill —
    // and a total that reads complete while missing every tie is the failure this reports.
    load(
      withSettings(twoLevels(), {
        labour: { byPartKind: { panel: { erectHours: 0.5, strikeHours: 0.25 } } },
      }),
    )

    const reply = await call<BillReply>('inspect_project_formwork', { levelId: 'level_1' })

    expect(reply.labour?.byOperation.map((row) => row.operation)).toEqual(['Panel'])
    const panels = reply.labour?.byOperation[0] as { fittings: number; totalManHours: number }
    expect(panels.totalManHours).toBeCloseTo(panels.fittings * 0.75, 2)
    expect(reply.labour?.complete).toBe(false)
    expect(reply.labour?.unnormedFittings).toBeGreaterThan(0)
    expect(reply.labour?.unnormedKinds).toContain('Tie')
    // No gang rate recorded, so hours with no money against them rather than free hours.
    expect(reply.labour?.cost).toBeNull()
    expect(reply.labour?.gaps.some((gap) => gap.includes('no money'))).toBe(true)
    expect(reply.caveats.some((c) => c.includes('carry no norm at all'))).toBe(true)
  })

  test('an empty scene answers rather than throwing', async () => {
    const bill = await call<BillReply>('inspect_project_formwork')
    const validation = await call<Reply>('validate_formwork')

    expect(bill.bom).toEqual([])
    expect(bill.elementCount).toBe(0)
    expect(validation.findings).toEqual([])
    expect(validation.summary.join(' ')).toContain('Nothing in this scope to check.')
  })

  /**
   * The pour, stated and read back from outside the editor.
   *
   * The merge behaviour itself belongs to `settings-patch.test.ts` in core, which owns
   * the shared contract; what is asserted here is what only this layer can get wrong —
   * that the node lands where the loader will not sweep it, that a refusal leaves the
   * project having stated nothing, and that a figure written through this surface
   * actually reaches the bill the other three tools quote.
   */
  describe('the project settings pair', () => {
    interface SettingsReply {
      anythingStated: boolean
      resolved: {
        riseRateMH: number
        concreteTemperatureC: number
        pressureStandard: string
        rates: Record<string, unknown> | null
      }
      stated: {
        placement?: Record<string, number>
        curing?: Record<string, number>
        rates?: Record<string, unknown>
      } | null
      assumedDefaults: { riseRateMH: number; concreteTemperatureC: number }
      shuttersAffectedByAChange: number
    }
    interface WriteReply {
      changed: string[]
      designsTo: { riseRateMH: number; concreteTemperatureC: number; pressureStandard: string }
      shuttersReDesigned: number
      message: string
    }

    const settingsNodes = () =>
      Object.values(bridge.getNodes()).filter(
        (node) => (node as { type: string }).type === 'formwork-settings',
      )

    test('an untouched scene reads as assumed, and reading is not a decision', async () => {
      load(twoLevels())

      const reply = await call<SettingsReply>('inspect_formwork_settings')

      expect(reply.anythingStated).toBe(false)
      expect(reply.stated).toBeNull()
      expect(reply.resolved.riseRateMH).toBe(reply.assumedDefaults.riseRateMH)
      // Null, not an empty table: the two commercial groups have no assumed default, so
      // "nobody has recorded a rate" is the answer rather than "this job costs nothing".
      expect(reply.resolved.rates).toBeNull()
      // The count is what a write would reach, so the caller can say so before writing.
      expect(reply.shuttersAffectedByAChange).toBe(2)
      expect(settingsNodes()).toHaveLength(0)
    })

    test('a stated pour comes back stated, on a node parented to the site', async () => {
      load(twoLevels())

      const write = await call<WriteReply>('set_formwork_settings', {
        placement: { riseRateMH: 2, concreteTemperatureC: 15 },
        pressureStandard: 'ACI_347',
      })
      const reply = await call<SettingsReply>('inspect_formwork_settings')

      expect(write.changed).toEqual(expect.arrayContaining(['placement', 'pressureStandard']))
      expect(write.designsTo).toEqual({
        riseRateMH: 2,
        concreteTemperatureC: 15,
        pressureStandard: 'ACI_347',
      })
      expect(reply.stated?.placement).toEqual({ riseRateMH: 2, concreteTemperatureC: 15 })
      // Unparented, the store's loader sweeps it: the pour survives the reply and is gone
      // on the next load, silently back to the shipped defaults.
      const node = settingsNodes()[0] as { parentId: string }
      expect(node.parentId).toBe('site_1')
    })

    test('a second write reuses the node rather than making a rival', async () => {
      load(twoLevels())

      await call('set_formwork_settings', { placement: { riseRateMH: 2 } })
      await call('set_formwork_settings', { curing: { surfaceTemperatureC: 5 } })

      expect(settingsNodes()).toHaveLength(1)
    })

    test('null hands a figure back to the default rather than storing it', async () => {
      load(twoLevels())

      await call('set_formwork_settings', { placement: { riseRateMH: 2 } })
      await call('set_formwork_settings', { placement: { riseRateMH: null } })
      const reply = await call<SettingsReply>('inspect_formwork_settings')

      expect(reply.stated?.placement).toBeNull()
      expect(reply.resolved.riseRateMH).toBe(reply.assumedDefaults.riseRateMH)
    })

    test('a scene with no site is refused rather than given an orphan', async () => {
      // `walledWithOpening` is rooted at a level, so there is nowhere the node would
      // survive a reload. Written anyway, it is a pour the project appears to have
      // stated and has not.
      load(walledWithOpening())

      const result = await client.callTool({
        name: 'set_formwork_settings',
        arguments: { placement: { riseRateMH: 2 } },
      })

      expect(result.isError).toBe(true)
      expect(settingsNodes()).toHaveLength(0)
    })

    test('a catalog id that names nothing is refused, and states nothing', async () => {
      // The refusal is the point: a bad id does not fail loudly downstream — the design
      // chain falls back to its own default part, so the project would believe it had
      // specified a beam while every span was solved against another.
      load(twoLevels())

      const result = await client.callTool({
        name: 'set_formwork_settings',
        arguments: { parts: { beamId: 'peri-h20' } },
      })

      expect(result.isError).toBe(true)
      const text = (result.content as Array<{ type: string; text: string }>)[0]?.text ?? ''
      expect(text).toContain('peri-h20')
      expect(settingsNodes()).toHaveLength(0)
    })

    test('an empty call is refused rather than creating an empty record', async () => {
      load(twoLevels())

      const result = await client.callTool({ name: 'set_formwork_settings', arguments: {} })

      expect(result.isError).toBe(true)
      expect(settingsNodes()).toHaveLength(0)
    })

    test('the reply counts the shutters it re-designed and asks for no re-attach', async () => {
      load(twoLevels())

      const write = await call<WriteReply>('set_formwork_settings', {
        placement: { riseRateMH: 2 },
      })

      expect(write.shuttersReDesigned).toBe(2)
      expect(write.message).toContain('nothing to regenerate')
      // A re-attach would rebuild what had not changed and discard every per-part
      // decision on the shutters to do it.
      expect(write.message).not.toContain('attach_formwork')
    })

    test('a pour stated here reaches the bill the other tools quote', async () => {
      // The parity claim, and the reason this pair was not deferred: without it every
      // figure this surface returned was designed against a default nothing could change.
      // A colder cure lengthens the hold, so the hire period is where it shows.
      load(twoLevels())
      const assumed = await call<BillReply>('inspect_project_formwork', { levelId: 'level_1' })

      await call('set_formwork_settings', { curing: { surfaceTemperatureC: 5 } })
      const cold = await call<BillReply>('inspect_project_formwork', { levelId: 'level_1' })

      expect(cold.hire.longestDaysHeld).toBeGreaterThan(assumed.hire.longestDaysHeld)
      expect(cold.hire.assumed.some((entry) => entry.includes('No curing surface'))).toBe(false)
    })

    test('a rack stated here is what the bill splits owned from hired against', async () => {
      load(twoLevels())
      const plain = await call<BillReply>('inspect_project_formwork', { levelId: 'level_1' })
      const panel = plain.bom.find((line) => line.catalogId !== null) as {
        catalogId: string
        quantity: number
      }
      expect(plain.supply).toBeUndefined()

      await call('set_formwork_settings', { ownedStock: { [panel.catalogId]: 4 } })
      const reply = await call<BillReply>('inspect_project_formwork', { levelId: 'level_1' })

      expect(reply.supply?.fromOwnStock).toBe(4)
      expect(reply.bom.find((row) => row.catalogId === panel.catalogId)?.toHire).toBe(
        panel.quantity - 4,
      )
    })

    test('a rate stated here is what puts money on the bill at all', async () => {
      // The parity that matters most on this group: without the write, an outside agent
      // could read that a bill has no price and have no way to record one.
      load(twoLevels())
      const plain = await call<BillReply>('inspect_project_formwork', { levelId: 'level_1' })
      const panel = plain.bom.find((line) => line.catalogId !== null) as { catalogId: string }
      expect(plain.cost).toBeUndefined()

      await call('set_formwork_settings', {
        rates: {
          currency: 'GBP',
          minHireDays: 28,
          byCatalogId: { [panel.catalogId]: { rentalPerUnitPerMonth: 30 } },
        },
      })
      const reply = await call<BillReply>('inspect_project_formwork', { levelId: 'level_1' })

      expect(reply.cost?.currency).toBe('GBP')
      expect(reply.cost?.total).toBeGreaterThan(0)
      expect(reply.cost?.linesAtMinimumHirePeriod).toBe(1)
    })

    test('a hire percentage with no list price under it is refused rather than stored', async () => {
      // It would be accepted, reported as recorded, and price nothing — and a model that
      // has just been told "ok" will tell the user the hire rate is set.
      load(twoLevels())
      const plain = await call<BillReply>('inspect_project_formwork', { levelId: 'level_1' })
      const panel = plain.bom.find((line) => line.catalogId !== null) as { catalogId: string }

      const result = await client.callTool({
        name: 'set_formwork_settings',
        arguments: { rates: { byCatalogId: { [panel.catalogId]: { rentalPercentPerMonth: 3 } } } },
      })

      expect(result.isError).toBe(true)
      const text = (result.content as Array<{ type: string; text: string }>)[0]?.text ?? ''
      expect(text).toContain('no purchasePerUnit')
      // Refused before the node is written, so the project still has no rates at all.
      const after = await call<BillReply>('inspect_project_formwork', { levelId: 'level_1' })
      expect(after.cost).toBeUndefined()
    })

    test('a rate written here is readable back, so the agent can check its own work', async () => {
      // A field a surface can write and not read is one it cannot verify, and rates are
      // the group where that matters most: nothing downstream would look wrong.
      load(twoLevels())
      const plain = await call<BillReply>('inspect_project_formwork', { levelId: 'level_1' })
      const panel = plain.bom.find((line) => line.catalogId !== null) as { catalogId: string }

      await call('set_formwork_settings', {
        rates: { currency: 'GBP', byCatalogId: { [panel.catalogId]: { purchasePerUnit: 420 } } },
      })
      const reply = await call<SettingsReply>('inspect_formwork_settings')

      expect(reply.stated?.rates).toEqual({
        currency: 'GBP',
        byCatalogId: { [panel.catalogId]: { purchasePerUnit: 420 } },
      })
    })

    test('a rate against a catalog id that names nothing is refused', async () => {
      // Same reason the rack's ids are checked, and the same failure: it would be stored
      // and match no bill line, so the project believes it has priced something.
      load(twoLevels())

      const result = await client.callTool({
        name: 'set_formwork_settings',
        arguments: { rates: { byCatalogId: { 'peri-trio-imaginary': { purchasePerUnit: 100 } } } },
      })

      expect(result.isError).toBe(true)
      const text = (result.content as Array<{ type: string; text: string }>)[0]?.text ?? ''
      expect(text).toContain('peri-trio-imaginary')
    })
  })

  /**
   * One shutter, part by part — and the write that needs a solve before it can refuse.
   *
   * The report shape is `parts-report.test.ts`' and the merge is `part-patch.test.ts`',
   * both shared with the editor's chat tools. What only this layer can get wrong is the
   * resolution: `partOverrides` is keyed by mark and takes any string, so a mark the model
   * misremembered writes cleanly here and then lives in the project as a stale edit against
   * a part nobody touched. Every refusal below is asserted to have written nothing.
   */
  describe('the parts pair', () => {
    interface PartsReply {
      kind: string
      shutters: Array<{
        assemblyId: string
        segment: number
        lift: number
        partCount: number
        parts: Array<{
          mark: string
          kind: string
          label: string
          catalogId: string | null
          weightKg: number | null
          omittedFromOrder: boolean
          note: string | null
        }>
      }>
      bom: Array<{
        description: string
        catalogId: string | null
        quantity: number
        marks: string[]
      }>
      totalWeightKg: number
      duplicateMarks: Array<{ assemblyId: string; mark: string }>
      staleEdits: Array<{ assemblyId: string; mark: string }>
      coversWholeElement: boolean
      coverageCaveat: string | null
    }
    interface PartWriteReply {
      mark: string
      assemblyId: string
      part: string
      recorded: string[]
      message: string
    }

    const overrides = (assemblyId = 'formwork-assembly_1') =>
      (bridge.getNodes() as unknown as Record<string, { partOverrides?: Record<string, unknown> }>)[
        assemblyId
      ]?.partOverrides ?? {}

    const firstPanel = async () => {
      const reply = await call<PartsReply>('inspect_formwork_parts', { elementId: 'wall_1' })
      const part = reply.shutters[0]?.parts.find((entry) => entry.kind === 'panel')
      if (!part) throw new Error('no panel solved')
      return { part, reply }
    }

    test('solves a wall in a process with no DOM and reports its marks', async () => {
      expect(typeof document).toBe('undefined')
      load(walledWithOpening())

      const reply = await call<PartsReply>('inspect_formwork_parts', { elementId: 'wall_1' })

      expect(reply.kind).toBe('wall')
      expect(reply.shutters[0]?.partCount).toBeGreaterThan(0)
      expect(reply.shutters[0]?.parts.every((part) => part.mark.length > 0)).toBe(true)
      expect(reply.bom.length).toBeGreaterThan(0)
      expect(reply.totalWeightKg).toBeGreaterThan(0)
      // A single-lift wall is wholly covered, and every mark in it is distinct.
      expect(reply.coversWholeElement).toBe(true)
      expect(reply.duplicateMarks).toEqual([])
      expect(reply.staleEdits).toEqual([])
    })

    test('the kind filter trims the list and leaves the bill whole', async () => {
      // Presentational, and only that: a filtered `partCount` or `bom` is how a model
      // comes to quote twelve parts for a wall that has ninety.
      load(walledWithOpening())

      const all = await call<PartsReply>('inspect_formwork_parts', { elementId: 'wall_1' })
      const panels = await call<PartsReply>('inspect_formwork_parts', {
        elementId: 'wall_1',
        kind: 'panel',
      })

      expect(panels.shutters[0]?.parts.length).toBeGreaterThan(0)
      expect(panels.shutters[0]?.parts.every((part) => part.kind === 'panel')).toBe(true)
      expect(panels.shutters[0]?.parts.length).toBeLessThan(all.shutters[0]?.parts.length ?? 0)
      expect(panels.shutters[0]?.partCount).toBe(all.shutters[0]?.partCount)
      expect(panels.bom).toEqual(all.bom)
      expect(panels.totalWeightKg).toBe(all.totalWeightKg)
    })

    test('an unshuttered element is sent to attach_formwork, not answered with an empty bill', async () => {
      load(twoLevels())

      const read = await client.callTool({
        name: 'inspect_formwork_parts',
        arguments: { elementId: 'wall_2' },
      })
      const write = await client.callTool({
        name: 'set_formwork_part',
        arguments: { elementId: 'wall_2', mark: 'P-A-1-00300', omitted: true },
      })

      expect(read.isError).toBe(true)
      expect((read.content as Array<{ text: string }>)[0]?.text).toContain('attach_formwork')
      expect(write.isError).toBe(true)
      expect((write.content as Array<{ text: string }>)[0]?.text).toContain('attach_formwork')
    })

    test('a level id is refused as not castable rather than as unshuttered', async () => {
      // The id most plausibly wrong is a real one — `list_castable_elements` reports a
      // wall's parentId beside it — and "call attach_formwork on level_1" is a dead end.
      load(twoLevels())

      const result = await client.callTool({
        name: 'inspect_formwork_parts',
        arguments: { elementId: 'level_1' },
      })

      expect(result.isError).toBe(true)
      const text = (result.content as Array<{ text: string }>)[0]?.text ?? ''
      expect(text).toContain('wall, column or slab')
      expect(text).not.toContain('attach_formwork')
    })

    test('a mark this shutter does not have is refused, and writes nothing', async () => {
      load(walledWithOpening())

      const result = await client.callTool({
        name: 'set_formwork_part',
        arguments: { elementId: 'wall_1', mark: 'P-Z-9-99999', omitted: true },
      })

      expect(result.isError).toBe(true)
      const text = (result.content as Array<{ text: string }>)[0]?.text ?? ''
      expect(text).toContain('inspect_formwork_parts')
      expect(overrides()).toEqual({})
    })

    test('a catalog id that names nothing is refused, and writes nothing', async () => {
      load(walledWithOpening())
      const { part } = await firstPanel()

      const result = await client.callTool({
        name: 'set_formwork_part',
        arguments: { elementId: 'wall_1', mark: part.mark, catalogId: 'peri-tr-240' },
      })

      expect(result.isError).toBe(true)
      expect((result.content as Array<{ text: string }>)[0]?.text).toContain('peri-tr-240')
      expect(overrides()).toEqual({})
    })

    test('an omitted part leaves the bill and the weight, and stays in the shutter', async () => {
      load(walledWithOpening())
      const { part, reply: before } = await firstPanel()

      const write = await call<PartWriteReply>('set_formwork_part', {
        elementId: 'wall_1',
        mark: part.mark,
        omitted: true,
        note: 'already on site',
      })
      const after = await call<PartsReply>('inspect_formwork_parts', { elementId: 'wall_1' })

      expect(write.recorded).toEqual(['left off the order', 'note recorded'])
      expect(after.bom.flatMap((line) => line.marks)).not.toContain(part.mark)
      expect(after.totalWeightKg).toBeLessThan(before.totalWeightKg)
      // Still erected, still drawn — somebody else supplied it. So the count holds.
      expect(after.shutters[0]?.partCount).toBe(before.shutters[0]?.partCount)
      const kept = after.shutters[0]?.parts.find((entry) => entry.mark === part.mark)
      expect(kept?.omittedFromOrder).toBe(true)
      expect(kept?.note).toBe('already on site')
    })

    test('two edits to one mark merge rather than replace', async () => {
      load(walledWithOpening())
      const { part } = await firstPanel()

      await call('set_formwork_part', { elementId: 'wall_1', mark: part.mark, omitted: true })
      await call('set_formwork_part', {
        elementId: 'wall_1',
        mark: part.mark,
        note: 'hired elsewhere',
      })
      const after = await call<PartsReply>('inspect_formwork_parts', { elementId: 'wall_1' })

      const kept = after.shutters[0]?.parts.find((entry) => entry.mark === part.mark)
      expect(kept?.omittedFromOrder).toBe(true)
      expect(kept?.note).toBe('hired elsewhere')
    })

    test('clearing the last field leaves no stale edit behind', async () => {
      // An emptied record is still a key against a mark, and `staleEdits` reads every key
      // it cannot resolve as somebody's forgotten decision.
      load(walledWithOpening())
      const { part } = await firstPanel()

      await call('set_formwork_part', { elementId: 'wall_1', mark: part.mark, omitted: true })
      await call('set_formwork_part', { elementId: 'wall_1', mark: part.mark, omitted: false })
      const after = await call<PartsReply>('inspect_formwork_parts', { elementId: 'wall_1' })

      expect(overrides()).toEqual({})
      expect(after.staleEdits).toEqual([])
      expect(
        after.shutters[0]?.parts.find((entry) => entry.mark === part.mark)?.omittedFromOrder,
      ).toBe(false)
    })

    test('a substitution reaches the bill the other tools quote', async () => {
      // The parity claim for this pair: a decision recorded here is not an annotation, it
      // is what the yard is told to order.
      load(walledWithOpening())
      const { part } = await firstPanel()
      const substitute = 'eurex-20-top'

      await call('set_formwork_part', {
        elementId: 'wall_1',
        mark: part.mark,
        catalogId: substitute,
      })
      const after = await call<PartsReply>('inspect_formwork_parts', { elementId: 'wall_1' })

      expect(after.shutters[0]?.parts.find((entry) => entry.mark === part.mark)?.catalogId).toBe(
        substitute,
      )
      expect(after.bom.some((line) => line.catalogId === substitute)).toBe(true)
    })

    test('a wall in several lifts shares marks between them without reporting a clash', async () => {
      // A mark's station and elevation are measured within its own pour unit, so lift 0
      // and lift 1 legitimately share every mark. Flattened, a correct wall reports every
      // part it has as a duplicate.
      load(walledWithOpening())
      bridge.updateNode('wall_1' as AnyNodeId, { maxLiftHeight: 1.5 } as Partial<AnyNode>)

      const reply = await call<PartsReply>('inspect_formwork_parts', { elementId: 'wall_1' })

      expect(reply.duplicateMarks).toEqual([])
      // One shutter for two pour units, so every figure above is short by the other lift.
      expect(reply.coversWholeElement).toBe(false)
      expect(reply.coverageCaveat).toContain('attach_formwork')
    })
  })

  /**
   * How the element is cast, and the shutters that follow from it.
   *
   * The pure reconciliation is `attach.test.ts`', the words are `pour-patch.test.ts`', and
   * the chat surface's equivalents are `chat-ai-formwork-reattach.test.ts`. What only this
   * layer can get wrong is the *graph*: whether a re-attach through the store leaves one
   * shutter or two, whether the child list survives, and whether a rebuild that fails
   * halfway leaves an element formed for nothing. Every assertion is on quantities and on
   * the words of the reply, because neither failure raises an error and both produce
   * output that reads as entirely reasonable.
   */
  describe('the pour pair', () => {
    interface AttachReply {
      elementId: string
      assemblyIds: string[]
      added: number
      kept: number
      removed: number
      discardedPartDecisions: number
      joints: number
      message: string
    }
    interface LimitsReply {
      kind: string
      changed: string[]
      pourUnitCount: number
      shutterCount: number
      coverageCaveat: string | null
      message: string
    }
    interface PartsShape {
      shutters: Array<{ assemblyId: string; partCount: number; parts: Array<{ mark: string }> }>
      totalWeightKg: number
      duplicateMarks: Array<{ assemblyId: string; mark: string }>
      coversWholeElement: boolean
      coverageCaveat: string | null
    }

    const graphNodes = () => Object.values(bridge.getNodes()) as unknown as AnyNode[]
    const assemblies = () => graphNodes().filter((node) => node.type === 'formwork-assembly')
    const joints = () => graphNodes().filter((node) => node.type === 'construction-joint')
    const parts = () => call<PartsShape>('inspect_formwork_parts', { elementId: 'wall_1' })

    test('shutters an element nobody has formed, and says nothing about keeping anything', async () => {
      load(tallWall())

      const reply = await call<AttachReply>('attach_formwork', { elementId: 'wall_1' })

      expect(assemblies()).toHaveLength(1)
      expect(reply.added).toBe(1)
      expect(reply.assemblyIds).toHaveLength(1)
      expect(reply.message).toBe('ok')
    })

    test('parents each shutter to the element, so a reload rebuilds the tree', async () => {
      // The store maintains the child list; a shutter missing from it is one that appears
      // in the outliner and nowhere else.
      load(tallWall())

      await call('attach_formwork', { elementId: 'wall_1' })

      const wall = bridge.getNodes()['wall_1' as AnyNodeId] as unknown as { children: string[] }
      expect(wall.children).toEqual(assemblies().map((node) => node.id))
    })

    test.each([
      null,
      'none',
    ])('an element whose formworkType is %p is sent to set_element_construction', async (formworkType) => {
      // Nothing is shuttered on the user's behalf. An attach that picked a system would
      // put a bill on the job nobody specified. `none` is a stated decision to cast
      // against something else, so it is refused as firmly as an absent field.
      load(tallWall(formworkType))

      const result = await client.callTool({
        name: 'attach_formwork',
        arguments: { elementId: 'wall_1' },
      })

      expect(result.isError).toBe(true)
      expect((result.content as Array<{ text: string }>)[0]?.text).toContain(
        'set_element_construction',
      )
      expect(assemblies()).toHaveLength(0)
    })

    test('called twice, adds no second copy and does not double the bill', async () => {
      // What an append cost: every mark twice, the weight doubled, and a purchase order
      // for two shutters where the wall needs one. A settings change tells the agent to
      // come back here, so the second call is the expected case rather than the mistake.
      load(tallWall())
      await call('attach_formwork', { elementId: 'wall_1' })
      const before = await parts()

      const reply = await call<AttachReply>('attach_formwork', { elementId: 'wall_1' })
      const after = await parts()

      expect(assemblies()).toHaveLength(1)
      expect(after.shutters).toHaveLength(1)
      expect(after.shutters[0]?.partCount).toBe(before.shutters[0]?.partCount ?? 0)
      expect(after.totalWeightKg).toBeCloseTo(before.totalWeightKg, 6)
      expect(after.duplicateMarks).toEqual([])
      expect(reply.message).toContain('unchanged')
      expect(reply.message).toContain('intact')
    })

    test('a re-attach keeps the same node, so every per-part decision survives', async () => {
      load(tallWall())
      await call('attach_formwork', { elementId: 'wall_1' })
      const id = assemblies()[0]?.id as string
      const mark = (await parts()).shutters[0]?.parts[0]?.mark as string
      await call('set_formwork_part', { elementId: 'wall_1', mark, omitted: true })

      await call('attach_formwork', { elementId: 'wall_1' })

      expect(assemblies()[0]?.id).toBe(id)
      // The decision the yard recorded. A rebuild here re-orders a part somebody said was
      // already on site.
      expect(
        (assemblies()[0] as unknown as { partOverrides: Record<string, unknown> }).partOverrides,
      ).toEqual({ [mark]: { omitted: true } })
    })

    test('a pour limit is reported as leaving the element short, not just as a split', async () => {
      // The whole hazard in one assertion. Without the caveat the reply is "cast in 3
      // pours" and the agent quotes a one-third takeoff as the wall's.
      load(tallWall())
      await call('attach_formwork', { elementId: 'wall_1' })

      const reply = await call<LimitsReply>('set_pour_limits', {
        elementId: 'wall_1',
        maxLiftHeight: 3,
      })

      expect(reply.changed).toEqual(['maxLiftHeight 3 m'])
      expect(reply.pourUnitCount).toBe(3)
      expect(reply.shutterCount).toBe(1)
      expect(reply.message).toContain('cast in 3 pours')
      expect(reply.message).toContain('1 of the 3 pours are shuttered')
      expect(reply.coverageCaveat).toContain('attach_formwork')
    })

    test('says nothing about coverage on an element nobody has formed', async () => {
      // That element needs a shutter at all, which is attach_formwork's own sentence —
      // and two remedies in one reply is one too many to choose between.
      load(tallWall())

      const reply = await call<LimitsReply>('set_pour_limits', {
        elementId: 'wall_1',
        maxLiftHeight: 3,
      })

      expect(reply.pourUnitCount).toBe(3)
      expect(reply.coverageCaveat).toBeNull()
      expect(reply.message).not.toContain('attach_formwork')
    })

    test('re-attaching after a cap builds the missing shutters, keeps the survivor, and joints them', async () => {
      load(tallWall())
      await call('attach_formwork', { elementId: 'wall_1' })
      const id = assemblies()[0]?.id as string
      await call('set_pour_limits', { elementId: 'wall_1', maxLiftHeight: 3 })

      const reply = await call<AttachReply>('attach_formwork', { elementId: 'wall_1' })

      expect(assemblies()).toHaveLength(3)
      expect(assemblies().map((node) => node.id)).toContain(id)
      expect(reply.added).toBe(2)
      expect(reply.kept).toBe(1)
      expect(reply.message).toContain('2 added')
      expect(reply.message).toContain('1 kept')
      // Two cuts between three lifts, each a roughened face with starters through it. A
      // split that emitted no joint would leave that work unbilled and unselectable.
      expect(joints()).toHaveLength(2)
      expect(joints().every((node) => node.parentId === 'level_1')).toBe(true)
    })

    test('a second re-attach does not stack another set of joints', async () => {
      load(tallWall())
      await call('attach_formwork', { elementId: 'wall_1' })
      await call('set_pour_limits', { elementId: 'wall_1', maxLiftHeight: 3 })
      await call('attach_formwork', { elementId: 'wall_1' })

      const reply = await call<AttachReply>('attach_formwork', { elementId: 'wall_1' })

      expect(joints()).toHaveLength(2)
      expect(reply.joints).toBe(0)
    })

    test('re-attaching raises the takeoff to the whole element and clears the caveat', async () => {
      load(tallWall())
      await call('attach_formwork', { elementId: 'wall_1' })
      const oneLift = await parts()

      await call('set_pour_limits', { elementId: 'wall_1', maxLiftHeight: 3 })
      await call('attach_formwork', { elementId: 'wall_1' })
      const threeLifts = await parts()

      expect(threeLifts.shutters).toHaveLength(3)
      // Three lifts of a 9 m wall form more than one 9 m pour's worth: each is struck and
      // re-erected, and each gets its own stop-ends.
      expect(threeLifts.totalWeightKg).toBeGreaterThan(oneLift.totalWeightKg)
      // A mark is a position within its own pour unit, so the lifts share marks by design.
      expect(threeLifts.duplicateMarks).toEqual([])
      expect(threeLifts.coversWholeElement).toBe(true)
      expect(threeLifts.coverageCaveat).toBeNull()
    })

    test('clearing the cap removes the orphaned shutters and names what it cost', async () => {
      load(tallWall())
      await call('attach_formwork', { elementId: 'wall_1' })
      await call('set_pour_limits', { elementId: 'wall_1', maxLiftHeight: 3 })
      await call('attach_formwork', { elementId: 'wall_1' })
      // A decision recorded on a lift that is about to stop existing.
      const upper = assemblies().find(
        (node) => (node as unknown as { liftIndex: number }).liftIndex === 2,
      )?.id as AnyNodeId
      bridge.updateNode(upper, { partOverrides: { 'P-A-1-00000': { omitted: true } } } as never)

      const limits = await call<LimitsReply>('set_pour_limits', {
        elementId: 'wall_1',
        maxLiftHeight: null,
      })
      const reply = await call<AttachReply>('attach_formwork', { elementId: 'wall_1' })

      expect(limits.changed).toEqual(['maxLiftHeight cleared'])
      // The other direction of the same fault: three shutters for one pour.
      expect(limits.coverageCaveat).toContain('3 shutters for 1 pour')
      expect(assemblies()).toHaveLength(1)
      expect(reply.removed).toBe(2)
      expect(reply.discardedPartDecisions).toBe(1)
      // Counted and handed to the model, because deleting recorded work silently is the
      // one thing a repair routine must not do.
      expect(reply.message).toContain('2 removed')
      expect(reply.message).toContain('discarding 1 part decision')
      expect(reply.message).toContain('say so')
    })

    test('a rebuild leaves no stale child entry behind', async () => {
      // The deletes and the creates go through one patch, so the wall's child list has to
      // come out matching the shutters that exist — a stale id is a shutter in the tree
      // with nothing to render.
      load(tallWall())
      await call('attach_formwork', { elementId: 'wall_1' })
      await call('set_pour_limits', { elementId: 'wall_1', maxLiftHeight: 3 })
      await call('attach_formwork', { elementId: 'wall_1' })

      await call('set_pour_limits', { elementId: 'wall_1', maxLiftHeight: null })
      await call('attach_formwork', { elementId: 'wall_1' })

      const wall = bridge.getNodes()['wall_1' as AnyNodeId] as unknown as { children: string[] }
      expect(wall.children).toEqual(assemblies().map((node) => node.id))
    })

    test('a limit on a slab is recorded and reported as not splitting it', async () => {
      // The schema takes all three fields on a slab and the splitter reads none of them,
      // so a plain "ok" here reads as a slab about to be poured in bays.
      load({
        level_1: {
          object: 'node',
          id: 'level_1',
          type: 'level',
          parentId: null,
          visible: true,
          metadata: {},
          children: ['slab_1'],
          elevation: 0,
          height: 3,
          level: 0,
        },
        slab_1: {
          object: 'node',
          id: 'slab_1',
          type: 'slab',
          parentId: 'level_1',
          visible: true,
          metadata: {},
          children: [],
          polygon: [
            [0, 0],
            [6, 0],
            [6, 5],
            [0, 5],
          ],
          elevation: 3,
          thickness: 0.25,
          formworkType: 'plywood',
        },
      })

      const reply = await call<LimitsReply>('set_pour_limits', {
        elementId: 'slab_1',
        maxLiftHeight: 0.1,
      })

      expect(reply.pourUnitCount).toBe(1)
      expect(reply.message).toContain('one pour')
      expect(
        (bridge.getNodes()['slab_1' as AnyNodeId] as unknown as { maxLiftHeight?: number })
          .maxLiftHeight,
      ).toBe(0.1)
    })

    test('a call that states no limit is refused rather than answered "ok"', async () => {
      load(tallWall())

      const result = await client.callTool({
        name: 'set_pour_limits',
        arguments: { elementId: 'wall_1' },
      })

      expect(result.isError).toBe(true)
      expect((result.content as Array<{ text: string }>)[0]?.text).toContain('nothing to set')
    })

    test('a level id is refused as not castable by both tools', async () => {
      load(twoLevels())

      const limits = await client.callTool({
        name: 'set_pour_limits',
        arguments: { elementId: 'level_1', maxLiftHeight: 3 },
      })
      const attach = await client.callTool({
        name: 'attach_formwork',
        arguments: { elementId: 'level_1' },
      })

      expect(limits.isError).toBe(true)
      expect(attach.isError).toBe(true)
      expect((attach.content as Array<{ text: string }>)[0]?.text).toContain('wall, column or slab')
    })
  })

  /**
   * When each pour happens — the one write on this surface addressed to a shutter.
   *
   * `schedule-patch.test.ts` owns what a date string means and `schedule.test.ts` owns the
   * arithmetic. What only this layer can get wrong is the addressing: that an element id is
   * refused rather than silently dating one of three lifts, that a refused date leaves the
   * pour exactly as it was, and that a cleared date reaches the store as a deleted key
   * rather than a stored null — which would be a date-shaped absence the programme reads
   * as programmed.
   */
  describe('the pour dates', () => {
    interface DateReply {
      assemblyId: string
      elementId: string | null
      pourAt: string | null
      message: string
    }

    const shutterIds = async (): Promise<string[]> => {
      await call('attach_formwork', { elementId: 'wall_1' })
      return (Object.values(bridge.getNodes()) as unknown as AnyNode[])
        .filter((node) => node.type === 'formwork-assembly')
        .map((node) => node.id as string)
    }
    const stored = (id: string) =>
      bridge.getNodes()[id as AnyNodeId] as unknown as { pourAt?: string }

    test('a stated date lands on the shutter and names the element back', async () => {
      // The element is named back because the caller asked about a wall and was made to
      // address a shutter — without it the reply is an id the user has never seen.
      load(tallWall())
      const [id] = await shutterIds()

      const reply = await call<DateReply>('set_pour_date', {
        assemblyId: id as string,
        pourAt: '2026-03-02',
      })

      expect(reply.pourAt).toBe('2026-03-02')
      expect(reply.elementId).toBe('wall_1')
      expect(stored(id as string).pourAt).toBe('2026-03-02')
    })

    test('an element id is refused and sent to the read that lists pours', async () => {
      // The likeliest mistake this tool invites. Accepted, it would have to pick one of
      // three lifts, and a 9 m wall's three pours are a week apart.
      load(tallWall())
      await shutterIds()

      const result = await client.callTool({
        name: 'set_pour_date',
        arguments: { assemblyId: 'wall_1', pourAt: '2026-03-02' },
      })

      expect(result.isError).toBe(true)
      expect((result.content as Array<{ text: string }>)[0]?.text).toContain('schedule.pours')
    })

    test('a day the calendar does not have leaves the pour programmed as it was', async () => {
      load(tallWall())
      const [id] = await shutterIds()
      await call('set_pour_date', { assemblyId: id as string, pourAt: '2026-03-02' })

      const result = await client.callTool({
        name: 'set_pour_date',
        arguments: { assemblyId: id as string, pourAt: '2026-02-30' },
      })

      expect(result.isError).toBe(true)
      // Validated before anything is written, so the earlier date survives rather than the
      // pour ending up half-changed.
      expect(stored(id as string).pourAt).toBe('2026-03-02')
    })

    test('null deletes the key rather than storing a date-shaped absence', async () => {
      load(tallWall())
      const [id] = await shutterIds()
      await call('set_pour_date', { assemblyId: id as string, pourAt: '2026-03-02' })

      const reply = await call<DateReply>('set_pour_date', {
        assemblyId: id as string,
        pourAt: null,
      })

      expect(reply.pourAt).toBeNull()
      expect('pourAt' in stored(id as string)).toBe(false)
    })

    test('a dated pour puts a programme on the bill, and an undated project puts none', async () => {
      load(withSettings(tallWall(), { schedule: { erectionLeadDays: 2, returnLeadDays: 3 } }))
      const [id] = await shutterIds()

      const before = await call<BillReply>('inspect_project_formwork')
      await call('set_pour_date', { assemblyId: id as string, pourAt: '2026-03-02' })
      const after = await call<BillReply>('inspect_project_formwork')

      // Nothing dated is no calendar at all rather than one starting today: a date is the
      // only input here with neither a code nor a product behind it.
      expect(before.schedule).toBeUndefined()
      expect(after.schedule?.firstPour).toBe('2026-03-02')
      expect(after.schedule?.plantWantedOnSite).toBe('2026-02-28')
      expect(after.schedule?.datedPours).toBe(1)
      expect(after.schedule?.pours[0]?.assemblyId).toBe(id)
    })

    test('with three lifts and one date, the window says how much of the job it leaves out', async () => {
      // A programme over 1 of 3 pours is a true statement about one pour and a wrong one
      // about the wall, and only this count says which.
      load(withSettings(tallWall(), { schedule: { erectionLeadDays: 1 } }))
      await call('attach_formwork', { elementId: 'wall_1' })
      await call('set_pour_limits', { elementId: 'wall_1', maxLiftHeight: 3 })
      const ids = await shutterIds()
      await call('set_pour_date', { assemblyId: ids[0] as string, pourAt: '2026-03-02' })

      const reply = await call<BillReply>('inspect_project_formwork')

      expect(ids).toHaveLength(3)
      expect(reply.schedule?.datedPours).toBe(1)
      expect(reply.schedule?.undatedPours).toBe(2)
      expect(reply.schedule?.complete).toBe(false)
      // The undated pours come last rather than heading the programme as though they began
      // the job — which is what a sort over a sentinel does.
      expect(reply.schedule?.pours[0]?.pourAt).toBe('2026-03-02')
      expect(reply.schedule?.pours.at(-1)?.pourAt).toBeNull()
    })
  })

  /**
   * Which of those dates anybody has agreed to.
   *
   * `schedule-patch.test.ts` owns what committing means and `commitments.test.ts` the sweep.
   * What only this layer can get wrong is the pair of writes acting on one another: that the
   * day stored is the day the pour *has* rather than one the caller could name, that
   * committing an undated pour is refused rather than stored as a commitment to nothing, and
   * that moving a committed pour afterwards goes through and is reported — because the one
   * thing this surface must not do is quietly re-book the plant against a day nobody agreed.
   */
  describe('committing a pour', () => {
    interface CommitReply {
      assemblyId: string
      elementId: string | null
      committedPourAt: string | null
      message: string
    }

    const shutterIds = async (): Promise<string[]> => {
      await call('attach_formwork', { elementId: 'wall_1' })
      return (Object.values(bridge.getNodes()) as unknown as AnyNode[])
        .filter((node) => node.type === 'formwork-assembly')
        .map((node) => node.id as string)
    }
    const stored = (id: string) =>
      bridge.getNodes()[id as AnyNodeId] as unknown as {
        pourAt?: string
        committedPourAt?: string
      }

    test('the day agreed comes off the pour rather than out of the call', async () => {
      // The whole shape of the tool. A caller made to restate the date could book a day the
      // programme does not have, so the input is a boolean and the day is read from the pour.
      load(tallWall())
      const [id] = await shutterIds()
      await call('set_pour_date', { assemblyId: id as string, pourAt: '2026-03-02' })

      const reply = await call<CommitReply>('commit_pour', {
        assemblyId: id as string,
        committed: true,
      })

      expect(reply.committedPourAt).toBe('2026-03-02')
      expect(reply.elementId).toBe('wall_1')
      expect(stored(id as string).committedPourAt).toBe('2026-03-02')
    })

    test('committing a pour nobody has dated is refused, not stored as a commitment to nothing', async () => {
      load(tallWall())
      const [id] = await shutterIds()

      const result = await client.callTool({
        name: 'commit_pour',
        arguments: { assemblyId: id as string, committed: true },
      })

      expect(result.isError).toBe(true)
      expect((result.content as Array<{ text: string }>)[0]?.text).toContain('set_pour_date first')
      expect('committedPourAt' in stored(id as string)).toBe(false)
    })

    test('releasing deletes the key rather than storing a date-shaped absence', async () => {
      load(tallWall())
      const [id] = await shutterIds()
      await call('set_pour_date', { assemblyId: id as string, pourAt: '2026-03-02' })
      await call('commit_pour', { assemblyId: id as string, committed: true })

      const reply = await call<CommitReply>('commit_pour', {
        assemblyId: id as string,
        committed: false,
      })

      expect(reply.committedPourAt).toBeNull()
      expect('committedPourAt' in stored(id as string)).toBe(false)
      // The date itself survives: releasing a commitment unprogrammes nothing.
      expect(stored(id as string).pourAt).toBe('2026-03-02')
    })

    test('an element id is refused and sent to the read that lists pours', async () => {
      load(tallWall())
      await shutterIds()

      const result = await client.callTool({
        name: 'commit_pour',
        arguments: { assemblyId: 'wall_1', committed: true },
      })

      expect(result.isError).toBe(true)
      expect((result.content as Array<{ text: string }>)[0]?.text).toContain('schedule.pours')
    })

    test('a commitment puts what is booked on the bill, uncommitted puts a reason instead', async () => {
      load(withSettings(tallWall(), { schedule: { returnLeadDays: 3 } }))
      const [id] = await shutterIds()
      await call('set_pour_date', { assemblyId: id as string, pourAt: '2026-03-02' })

      const before = await call<BillReply>('inspect_project_formwork')
      await call('commit_pour', { assemblyId: id as string, committed: true })
      const after = await call<BillReply>('inspect_project_formwork')

      // Absent with a reason rather than absent silently: an empty block beside a present
      // programme reads as a fault in the tool rather than as nobody having agreed anything.
      expect(before.committed).toBeUndefined()
      expect(before.noCommitmentsBecause).toContain('commit_pour')
      expect(after.committed?.committedPours).toBe(1)
      expect(after.committed?.committedAssemblyIds).toEqual([id])
      expect(after.committed?.spokenForFrom).not.toBeNull()
      expect(after.committed?.drifted).toEqual([])
      expect(after.noCommitmentsBecause).toBeUndefined()
    })

    test('moving a booked pour goes through and is reported as a drift off the booking', async () => {
      // The one interaction between the two writes, and the design decision worth pinning:
      // sites move booked pours, so this is not an error — but the hire desk is still holding
      // the old day, and nothing else in the answer would show it.
      load(withSettings(tallWall(), { schedule: { returnLeadDays: 3 } }))
      const [id] = await shutterIds()
      await call('set_pour_date', { assemblyId: id as string, pourAt: '2026-03-02' })
      await call('commit_pour', { assemblyId: id as string, committed: true })

      const moved = await call('set_pour_date', { assemblyId: id as string, pourAt: '2026-03-09' })
      const reply = await call<BillReply>('inspect_project_formwork')

      expect(moved).toBeDefined()
      expect(stored(id as string).committedPourAt).toBe('2026-03-02')
      expect(reply.committed?.drifted).toEqual([
        {
          assemblyId: id as string,
          bookedFor: '2026-03-02',
          nowPouredOn: '2026-03-09',
          daysOut: 7,
        },
      ])
      expect(reply.caveats.some((line) => line.includes('a call to make'))).toBe(true)
    })

    test('a date cleared out from under a booking is the third case, not a zero drift', async () => {
      load(withSettings(tallWall(), { schedule: { returnLeadDays: 3 } }))
      const [id] = await shutterIds()
      await call('set_pour_date', { assemblyId: id as string, pourAt: '2026-03-02' })
      await call('commit_pour', { assemblyId: id as string, committed: true })
      await call('set_pour_date', { assemblyId: id as string, pourAt: null })

      const reply = await call<BillReply>('inspect_project_formwork')

      // No programme left to sweep, so the block is gone — but the caveat has to survive it,
      // because plant is still reserved for a pour the programme no longer places.
      expect(reply.committed?.drifted[0]?.nowPouredOn ?? null).toBeNull()
      expect(reply.caveats.some((line) => line.includes('no longer places'))).toBe(true)
    })
  })

  /**
   * How many sets to own or hire — the answer the bill cannot give.
   *
   * `sets.test.ts` owns the sweep and `solve-project.test.ts` owns the wiring. What only
   * this layer can get wrong is what a model is handed: that `mostAtOnce` never exceeds the
   * bill quantity it will be read beside, that a programme too partial to sweep produces no
   * count *and* a stated reason, and that an unprogrammed project produces neither — an
   * absent count with no reason beside a present programme is the one shape here a model
   * reads as a fault in the tool rather than as a missing input.
   */
  describe('how many sets to own or hire', () => {
    const shutterIds = async (): Promise<string[]> => {
      await call('attach_formwork', { elementId: 'wall_1' })
      return (Object.values(bridge.getNodes()) as unknown as AnyNode[])
        .filter((node) => node.type === 'formwork-assembly')
        .map((node) => node.id as string)
    }
    const dated = () => withSettings(tallWall(), { schedule: { returnLeadDays: 3 } })

    test('one pour needs its whole bill at once, and the count says so', async () => {
      load(dated())
      const [id] = await shutterIds()
      await call('set_pour_date', { assemblyId: id as string, pourAt: '2026-03-02' })

      const reply = await call<BillReply>('inspect_project_formwork')

      expect(reply.sets?.poursAtOnce).toBe(1)
      expect(reply.sets?.countedPours).toBe(reply.sets?.totalPours)
      expect(reply.sets?.gaps).toEqual([])
      // A single pour reuses nothing, so the count *is* the bill — and every peak is a
      // quantity the reader can find on the line above it rather than a larger number the
      // bill cannot account for.
      for (const item of reply.sets?.items ?? []) {
        const line = reply.bom.find((entry) => entry.catalogId === item.catalogId)
        expect(item.mostAtOnce).toBeLessThanOrEqual(line?.quantity ?? 0)
        expect(item.reuses).toBe(1)
      }
      expect(reply.sets?.rack.length).toBeGreaterThan(0)
    })

    test('three lifts a fortnight apart share one set, so the order is a third of the bill', async () => {
      // The whole reason the module exists: what passes through the job is three lifts of
      // panels and what somebody buys is one lift's worth, used three times.
      load(dated())
      await call('attach_formwork', { elementId: 'wall_1' })
      await call('set_pour_limits', { elementId: 'wall_1', maxLiftHeight: 3 })
      const ids = await shutterIds()
      for (const [index, id] of ids.entries()) {
        await call('set_pour_date', {
          assemblyId: id,
          pourAt: `2026-03-${String(2 + index * 14).padStart(2, '0')}`,
        })
      }

      const reply = await call<BillReply>('inspect_project_formwork')

      expect(ids).toHaveLength(3)
      expect(reply.sets?.countedPours).toBe(3)
      // No two lifts are standing on the same day, so no peak is higher than one lift.
      expect(reply.sets?.poursAtOnce).toBe(1)
      const panel = reply.sets?.items.find((item) => item.reuses > 1)
      expect(panel).toBeDefined()
      expect(panel?.mostAtOnce).toBeLessThan(panel?.fittedInTotal ?? 0)
    })

    test('one date in three pours gets no count, and the reason it has none', async () => {
      // A sweep over a third of the programme reports a peak of one set, and one set is
      // what a reader orders. So there is deliberately no figure — and the reason travels
      // as a field, because an absent count beside a present programme reads as a bug.
      load(dated())
      await call('attach_formwork', { elementId: 'wall_1' })
      await call('set_pour_limits', { elementId: 'wall_1', maxLiftHeight: 3 })
      const ids = await shutterIds()
      await call('set_pour_date', { assemblyId: ids[0] as string, pourAt: '2026-03-02' })

      const reply = await call<BillReply>('inspect_project_formwork')

      expect(reply.schedule).toBeDefined()
      expect(reply.sets).toBeUndefined()
      expect(reply.noSetCountBecause).toContain('1 of 3')
      expect(reply.caveats.some((caveat) => caveat.startsWith('No set count'))).toBe(true)
    })

    test('an unprogrammed project gets neither a count nor a reason', async () => {
      load(dated())
      await shutterIds()

      const reply = await call<BillReply>('inspect_project_formwork')

      // Nothing is missing that the answer does not already show: there is no programme,
      // and a count is a statement about dates.
      expect(reply.schedule).toBeUndefined()
      expect(reply.sets).toBeUndefined()
      expect(reply.noSetCountBecause).toBeUndefined()
    })
  })

  /**
   * What to go out and get, and whether to buy it.
   *
   * `acquire.test.ts` owns the arithmetic and `solve-project.test.ts` the wiring. What only
   * this layer can get wrong is what an agent is handed: a shortfall it cannot tell apart
   * from `toHire`, a verdict with no payback beside it, and — the shape that reads as a bug —
   * an absent block beside a present peak with nothing saying which input is missing.
   */
  describe('what to acquire', () => {
    /** Three lifts a fortnight apart, so one set serves all three, plus whatever settings. */
    const sequential = async (settings: Record<string, unknown>): Promise<BillReply> => {
      load(withSettings(tallWall(), { schedule: { returnLeadDays: 3 }, ...settings }))
      await call('attach_formwork', { elementId: 'wall_1' })
      await call('set_pour_limits', { elementId: 'wall_1', maxLiftHeight: 3 })
      // Re-attached, because the lift height is what splits the wall into three pours and
      // the shutters built before it was set are one.
      await call('attach_formwork', { elementId: 'wall_1' })
      const ids = (Object.values(bridge.getNodes()) as unknown as AnyNode[])
        .filter((node) => node.type === 'formwork-assembly')
        .map((node) => node.id as string)
      for (const [index, id] of ids.entries()) {
        await call('set_pour_date', {
          assemblyId: id,
          pourAt: `2026-03-${String(2 + index * 14).padStart(2, '0')}`,
        })
      }
      return await call<BillReply>('inspect_project_formwork')
    }

    test('the shortfall is the peak over the rack, well under the bill’s hired quantity', async () => {
      // The error this block exists to prevent. Three lifts pass their panels through the
      // job and only one lift's stand at once, so an agent quoting `toHire` as an order has
      // quoted one three times too big.
      const empty = await sequential({ stock: { owned: {} } })
      const panel = empty.sets?.items.find((item) => item.reuses > 1) as { catalogId: string }
      const reply = await sequential({ stock: { owned: { [panel.catalogId]: 4 } } })

      const line = reply.acquire?.items.find((item) => item.catalogId === panel.catalogId)
      const hired = reply.bom.find((entry) => entry.catalogId === panel.catalogId)?.toHire as number
      expect(line?.owned).toBe(4)
      expect(line?.shortBy).toBe((line?.mostAtOnce as number) - 4)
      expect(line?.shortBy).toBeLessThan(hired)
      expect(line?.poursCausingThePeak.length).toBeGreaterThan(0)
      expect(reply.acquire?.shortfallQuantity).toBeGreaterThan(0)
    })

    test('a rack covering the peak leaves spare, and spare is not a saving', async () => {
      const empty = await sequential({ stock: { owned: {} } })
      const panel = empty.sets?.items.find((item) => item.reuses > 1) as { catalogId: string }
      const reply = await sequential({ stock: { owned: { [panel.catalogId]: 500 } } })

      const line = reply.acquire?.items.find((item) => item.catalogId === panel.catalogId)
      expect(line?.shortBy).toBe(0)
      expect(line?.spare).toBeGreaterThan(0)
      expect(reply.caveats.some((c) => c.includes('spare capacity for another job'))).toBe(true)
    })

    test('a verdict never arrives without the payback that makes it arguable', async () => {
      const empty = await sequential({ stock: { owned: {} } })
      const panel = empty.sets?.items.find((item) => item.reuses > 1) as { catalogId: string }
      const reply = await sequential({
        stock: { owned: { [panel.catalogId]: 4 } },
        rates: {
          currency: 'GBP',
          byCatalogId: { [panel.catalogId]: { purchasePerUnit: 210, rentalPercentPerMonth: 3 } },
        },
      })

      const line = reply.acquire?.items.find((item) => item.catalogId === panel.catalogId)
      expect(reply.acquire?.currency).toBe('GBP')
      // Hire wins on one job at a trade rate, however many times the set is refitted: hire
      // is per unit per month, so uses do not enter the comparison at all.
      expect(line?.cheaperOverThisJob).toBe('hire')
      expect(line?.paysBackOverJobs).toBeGreaterThan(1)
      expect(reply.acquire?.buyTheShortfall).toBeGreaterThan(
        reply.acquire?.hireTheShortfall as number,
      )
    })

    test('a shortfall with no rate carries no verdict, rather than a default one', async () => {
      const empty = await sequential({ stock: { owned: {} } })
      const panel = empty.sets?.items.find((item) => item.reuses > 1) as { catalogId: string }
      const reply = await sequential({ stock: { owned: { [panel.catalogId]: 4 } } })

      const line = reply.acquire?.items.find((item) => item.catalogId === panel.catalogId)
      expect(line?.shortBy).toBeGreaterThan(0)
      expect(line?.cheaperOverThisJob).toBeUndefined()
      expect(line?.paysBackOverJobs).toBeUndefined()
    })

    test('a peak with no rack names the missing input rather than reading as a fault', async () => {
      const reply = await sequential({})

      expect(reply.sets).toBeDefined()
      expect(reply.acquire).toBeUndefined()
      expect(reply.noAcquisitionBecause).toContain('ownedStock')
      expect(reply.caveats.some((c) => c.includes('what to buy or hire'))).toBe(true)
    })

    test('a rack with no programme is told about the dates once, not about two absences', async () => {
      load(withStock(tallWall(), {}))
      await call('attach_formwork', { elementId: 'wall_1' })

      const reply = await call<BillReply>('inspect_project_formwork')

      expect(reply.sets).toBeUndefined()
      expect(reply.acquire).toBeUndefined()
      expect(reply.noAcquisitionBecause).toBeUndefined()
      expect(reply.caveats.some((c) => c.includes('what to buy or hire'))).toBe(false)
    })

    test('the yard’s own rack is charged beside the total, never inside it', async () => {
      const empty = await sequential({ stock: { owned: {} } })
      const panel = empty.sets?.items.find((item) => item.reuses > 1) as { catalogId: string }
      const reply = await sequential({
        stock: { owned: { [panel.catalogId]: 4 } },
        rates: { byCatalogId: { [panel.catalogId]: { rentalPerUnitPerMonth: 30 } } },
      })

      expect(reply.cost?.ownStock).toBeGreaterThan(0)
      // The claim the field's name makes, and the one an agent must not undo by adding them.
      expect(reply.cost?.total).toBe(reply.cost?.hire)
      expect(reply.bom.find((e) => e.catalogId === panel.catalogId)?.ownStockCost).toBeGreaterThan(
        0,
      )
      expect(reply.cost?.excludes.some((line) => line.includes('internal recharge'))).toBe(true)
    })
  })

  /**
   * What waits on what, and whether to move a pour instead of raising an order.
   *
   * `sequence.test.ts` and `resequence.test.ts` own the arithmetic. What only this layer can
   * get wrong is what an agent is handed, and each of these is a sentence a model would say
   * out loud from the wrong shape: a float column with no provenance under it reads as a
   * critical path, a 0 and an absent allowance are opposite claims that look alike in JSON,
   * and a refusal dropped rather than named reads as no answer at all.
   */
  describe('what has to happen before what', () => {
    /** One wall in three lifts a fortnight apart — a lift chain, which is precedence. */
    const inLifts = async (settings: Record<string, unknown>): Promise<BillReply> => {
      load(withSettings(tallWall(), { schedule: { returnLeadDays: 3 }, ...settings }))
      await call('attach_formwork', { elementId: 'wall_1' })
      await call('set_pour_limits', { elementId: 'wall_1', maxLiftHeight: 3 })
      await call('attach_formwork', { elementId: 'wall_1' })
      const ids = (Object.values(bridge.getNodes()) as unknown as AnyNode[])
        .filter((node) => node.type === 'formwork-assembly')
        .map((node) => node.id as string)
      for (const [index, id] of ids.entries()) {
        await call('set_pour_date', {
          assemblyId: id,
          pourAt: `2026-03-${String(2 + index * 14).padStart(2, '0')}`,
        })
      }
      return await call<BillReply>('inspect_project_formwork')
    }

    /** Three walls in a stated cast order, two on one day and the third with room after. */
    const inOrder = async (
      settings: Record<string, unknown>,
      thirdAt = '2026-03-30',
    ): Promise<BillReply> => {
      load(withSettings(threeWalls(), { schedule: { returnLeadDays: 3 }, ...settings }))
      for (const [index, elementId] of ['wall_1', 'wall_2', 'wall_3'].entries()) {
        await call('attach_formwork', { elementId })
        await call('set_element_construction', { elementId, castOrder: index + 1 })
      }
      const dates = ['2026-03-02', '2026-03-02', thirdAt]
      const ids = (Object.values(bridge.getNodes()) as unknown as AnyNode[])
        .filter((node) => node.type === 'formwork-assembly')
        .map((node) => node.id as string)
      for (const [index, id] of ids.entries())
        await call('set_pour_date', { assemblyId: id, pourAt: dates[index] as string })
      return await call<BillReply>('inspect_project_formwork')
    }

    test('the dependency carries the reason it exists, not only the pair', async () => {
      // A dependency an agent cannot justify is one it presents as a rule of the tool. The
      // reason here is physical and the same one a foreman would give.
      const reply = await inLifts({})

      expect(reply.sequence?.pours).toHaveLength(3)
      expect(reply.sequence?.dependencies.length).toBe(2)
      expect(reply.sequence?.dependencies[0]?.because).toContain('bears on the lift below')
      const middle = reply.sequence?.pours.find((pour) => pour.waitsOn.length > 0)
      expect(middle?.holdsUp.length).toBeGreaterThan(0)
    })

    test('the float is bounded by the neighbours’ dates, and the caveats refuse the phrase', async () => {
      const reply = await inLifts({})

      const floated = reply.sequence?.pours.filter((pour) => pour.allowanceDays !== null) ?? []
      expect(floated.length).toBeGreaterThan(0)
      for (const pour of floated) {
        expect(pour.noEarlierThan).not.toBeNull()
        expect(pour.noLaterThan).not.toBeNull()
      }
      expect(reply.caveats.some((caveat) => caveat.includes('not a critical path'))).toBe(true)
      expect(
        reply.caveats.some((caveat) => caveat.includes('Float is not slack a gang can spend')),
      ).toBe(true)
    })

    test('a pour nothing bounds carries a null allowance rather than a zero', async () => {
      // The two are opposite claims — nothing says, against pinned — and an agent reading a 0
      // out loud has told the user a pour cannot move.
      // Two walls on two levels, neither carrying a cast order and neither cut into lifts, so
      // nothing in the scene puts one before the other.
      load(withSettings(twoLevels(), { schedule: { returnLeadDays: 3 } }))
      for (const elementId of ['wall_1', 'wall_3']) await call('attach_formwork', { elementId })
      const ids = (Object.values(bridge.getNodes()) as unknown as AnyNode[])
        .filter((node) => node.type === 'formwork-assembly')
        .map((node) => node.id as string)
      for (const [index, id] of ids.entries()) {
        await call('set_pour_date', { assemblyId: id, pourAt: `2026-03-0${2 + index}` })
      }

      const reply = await call<BillReply>('inspect_project_formwork')

      expect(reply.sequence?.unsequencedPours).toHaveLength(ids.length)
      for (const pour of reply.sequence?.pours ?? []) {
        expect(pour.waitsOn).toEqual([])
        expect(pour.holdsUp).toEqual([])
      }
      expect(reply.sequence?.gaps.join(' ')).toContain('every pour is treated as concurrent')
      expect(
        reply.caveats.some((caveat) => caveat.includes('Nothing in this scope states an order')),
      ).toBe(true)
    })

    test('no dated pour leaves the block off rather than reporting an unbounded one', async () => {
      load(withSettings(tallWall(), {}))
      await call('attach_formwork', { elementId: 'wall_1' })

      const reply = await call<BillReply>('inspect_project_formwork')

      expect(reply.sequence).toBeUndefined()
      expect(reply.moveInsteadOfBuying).toBeUndefined()
    })

    test('a shortfall gets the move that clears it, with the peak it leaves behind', async () => {
      // Two walls on one day put both bills on site at once, and the second has a month of
      // room before the third — so there is somewhere for a pour to go.
      const empty = await inOrder({ stock: { owned: {} } })
      const panel = empty.sets?.items[0] as { catalogId: string; mostAtOnce: number }
      const reply = await inOrder({
        stock: { owned: { [panel.catalogId]: panel.mostAtOnce - 1 } },
      })

      const answer = reply.moveInsteadOfBuying?.find((entry) => entry.catalogId === panel.catalogId)
      expect(answer?.shortBy).toBe(1)
      expect(answer?.noMoveBecause).toBeUndefined()
      const move = answer?.moves[0]
      expect(move?.peakBefore).toBe(panel.mostAtOnce)
      expect(move?.peakAfter).toBeLessThan(panel.mostAtOnce)
      expect(move?.fromDate).toBe('2026-03-02')
      expect(move?.toDate).not.toBe('2026-03-02')
      // Present even when empty, because a move with no price beside it reads as free.
      expect(move?.raisesElsewhere).toBeDefined()
      expect(
        reply.caveats.some((caveat) => caveat.includes('argument to take to the planner')),
      ).toBe(true)
    })

    test('a shortfall no move can clear is told to buy it, rather than getting no row', async () => {
      // The firing half of the same check. All three on one day, each pinned by the others:
      // the honest answer is that the shortfall has to be bought, and a dropped row reads as
      // the tool having nothing to say about it.
      const empty = await inOrder({ stock: { owned: {} } }, '2026-03-02')
      const panel = empty.sets?.items[0] as { catalogId: string; mostAtOnce: number }
      const reply = await inOrder(
        { stock: { owned: { [panel.catalogId]: panel.mostAtOnce - 1 } } },
        '2026-03-02',
      )

      const answer = reply.moveInsteadOfBuying?.find((entry) => entry.catalogId === panel.catalogId)
      expect(answer?.noMoveBecause).toContain('bought or hired')
      expect(answer?.moves).toEqual([])
      expect(answer?.pinnedPours.length).toBeGreaterThan(0)
      expect(reply.caveats.some((caveat) => caveat.includes('pinned by the dates around it'))).toBe(
        true,
      )
    })

    test('nothing short means no proposal at all, and the precedence still reads', async () => {
      // The rack is derived from the scope's own peaks rather than stated: a steel-panel wall
      // bills ties and walers as well as panels, and a rack holding only panels leaves those
      // short — which is a real shortfall, and the module would be right to answer it.
      const empty = await inLifts({ stock: { owned: {} } })
      const owned = Object.fromEntries(
        (empty.sets?.items ?? []).map((item) => [item.catalogId, item.mostAtOnce]),
      )
      const reply = await inLifts({ stock: { owned } })

      expect(reply.acquire?.shortfallQuantity).toBe(0)
      expect(reply.sequence?.dependencies.length).toBeGreaterThan(0)
      expect(reply.moveInsteadOfBuying).toBeUndefined()
    })
  })

  /**
   * The elements, how each is built, and how each will be cast — the three reads and the
   * one write everything above is solved from.
   *
   * `construction-patch.test.ts` owns the write contract. What is asserted here is what
   * only this layer can get wrong: that a field the editor's AI can see is not missing
   * from the MCP list, that an unstate reaches the store as a deletion rather than a
   * stored null, and that a `formworkType` written with nothing built behind it is
   * reported as outstanding rather than as "ok" — the one failure on this surface that
   * produces no error, no empty result and no shutter.
   */
  describe('the elements, and how they are built', () => {
    interface ListReply {
      scope: string
      elementCount: number
      shutteredCount: number
      unshuttered: string[]
      elements: Array<Record<string, unknown>>
    }
    interface ConstructionReply {
      kind: string
      changed: string[]
      shutterCount: number
      formworkOutstanding: boolean
      message: string
    }
    interface UnitsReply {
      kind: string
      limits: { maxLiftHeight: number | null; maxPourLength: number | null }
      pourUnitCount: number
      shutterCount: number
      totalVolumeCuM: number
      units: Array<{
        segment: number
        lift: number
        baseElevation: number
        topElevation: number
        volumeCuM: number
        bearsOnLiftBelow: boolean
        startCut: string | null
        endCut: string | null
      }>
      coverageCaveat: string | null
      message: string
    }

    const wall = (nodes: Record<string, unknown> = {}) =>
      bridge.getNodes()['wall_1' as AnyNodeId] as unknown as Record<string, unknown> & typeof nodes

    test('lists each kind with the extent its concrete is placed over', async () => {
      // A wall runs between two points, a column stands at one, a slab is a polygon. One
      // shape for all three would describe two of them wrongly.
      load(threeKinds())

      const reply = await call<ListReply>('list_castable_elements')

      expect(reply.elementCount).toBe(3)
      const byId = new Map(reply.elements.map((element) => [element.id as string, element]))
      expect(byId.get('wall_1')).toMatchObject({ kind: 'wall', start: [0, 0], end: [6, 0] })
      expect(byId.get('column_1')).toMatchObject({ kind: 'column', position: [3, 0, 2] })
      expect(byId.get('slab_1')).toMatchObject({ kind: 'slab', thickness: 0.25 })
      expect(byId.get('slab_1')?.polygon).toHaveLength(4)
    })

    test('names the elements a bill will silently leave out', async () => {
      // The field that earns the tool. An unformed element is absent from every bill, and
      // a bill of what exists reads as complete — so a floor short by three walls totals
      // cleanly with nothing in the figures to show it.
      load(threeKinds())

      const reply = await call<ListReply>('list_castable_elements')

      expect(reply.unshuttered).toEqual(['column_1', 'slab_1', 'wall_1'])
      expect(reply.shutteredCount).toBe(0)

      await call('attach_formwork', { elementId: 'column_1' })
      const after = await call<ListReply>('list_castable_elements')

      expect(after.unshuttered).toEqual(['slab_1', 'wall_1'])
      expect(after.shutteredCount).toBe(1)
    })

    test('carries every construction field, so neither AI has to ask the user to restate one', async () => {
      load(threeKinds())
      await call('set_element_construction', {
        elementId: 'wall_1',
        formworkType: 'steel-panel',
        castOrder: 3,
        exposureClass: 'water-retaining',
        tieSpacing: 0.45,
      })

      const reply = await call<ListReply>('list_castable_elements')
      const element = reply.elements.find((entry) => entry.id === 'wall_1')

      expect(element).toMatchObject({
        formworkType: 'steel-panel',
        castOrder: 3,
        exposureClass: 'water-retaining',
        tieSpacing: 0.45,
      })
    })

    test('scopes the list to one level, because a pour is planned per floor', async () => {
      load(twoLevels())

      const ground = await call<ListReply>('list_castable_elements', { levelId: 'level_1' })
      const whole = await call<ListReply>('list_castable_elements')

      expect(ground.elements.map((element) => element.id)).toEqual(['wall_1', 'wall_2'])
      expect(whole.elements.map((element) => element.id)).toEqual(['wall_1', 'wall_2', 'wall_3'])
    })

    test('a level id nobody has is refused rather than answered as an empty floor', async () => {
      load(twoLevels())

      const result = await client.callTool({
        name: 'list_castable_elements',
        arguments: { levelId: 'level_9' },
      })

      expect(result.isError).toBe(true)
      expect((result.content as Array<{ text: string }>)[0]?.text).toContain('level_9')
    })

    test('writes the construction fields, and tells the agent nothing is built yet', async () => {
      // The most likely failure on this surface is this call succeeding: a correct
      // formworkType, reported ok, and no attach behind it — a project that believes it
      // specified a steel-panel wall and holds no shutter and no bill.
      load(tallWall(null))

      const reply = await call<ConstructionReply>('set_element_construction', {
        elementId: 'wall_1',
        formworkType: 'steel-panel',
        castOrder: 2,
      })

      expect(wall().formworkType).toBe('steel-panel')
      expect(wall().castOrder).toBe(2)
      expect(reply.formworkOutstanding).toBe(true)
      expect(reply.message).toContain('attach_formwork')
    })

    test('says nothing about a build once the shutter exists', async () => {
      load(tallWall())
      await call('attach_formwork', { elementId: 'wall_1' })

      const reply = await call<ConstructionReply>('set_element_construction', {
        elementId: 'wall_1',
        castOrder: 4,
      })

      expect(reply.formworkOutstanding).toBe(false)
      expect(reply.shutterCount).toBe(1)
      expect(reply.message).not.toContain('attach_formwork')
    })

    test('null unstates a field rather than storing a null', async () => {
      // An unstated spacing is what encodes "solve this from the pour". Stored as null it
      // would read as a stated figure of nothing.
      load(tallWall())
      await call('set_element_construction', { elementId: 'wall_1', tieSpacing: 0.45 })

      await call('set_element_construction', { elementId: 'wall_1', tieSpacing: null })

      expect('tieSpacing' in wall()).toBe(false)
    })

    test('a slab-only field on a wall is refused, and nothing is written', async () => {
      // Dropped silently it would be a decision the user believes was recorded.
      load(tallWall())

      const result = await client.callTool({
        name: 'set_element_construction',
        arguments: { elementId: 'wall_1', formworkType: 'plywood', edgeFaceCount: 2 },
      })

      expect(result.isError).toBe(true)
      expect((result.content as Array<{ text: string }>)[0]?.text).toContain('slabs only')
      // The whole call is refused, so the field beside it does not land either.
      expect(wall().formworkType).toBe('steel-panel')
    })

    test('reports the split, why each cut is there, and what one delivery has to supply', async () => {
      load(tallWall())
      await call('set_pour_limits', { elementId: 'wall_1', maxLiftHeight: 3 })

      const reply = await call<UnitsReply>('inspect_pour_units', { elementId: 'wall_1' })

      expect(reply.pourUnitCount).toBe(3)
      expect(reply.units.map((unit) => unit.lift)).toEqual([0, 1, 2])
      expect(reply.units[0]).toMatchObject({ baseElevation: 0, topElevation: 3 })
      // A lift joint is horizontal, so it is not a cut along the centreline: the elevations
      // and the cap it was solved from are what answer "why is there a joint at 3 m".
      expect(reply.units[0]?.endCut).toBeNull()
      expect(reply.limits.maxLiftHeight).toBe(3)
      expect(reply.units[0]?.bearsOnLiftBelow).toBe(false)
      expect(reply.units[1]?.bearsOnLiftBelow).toBe(true)
      expect(reply.message).toContain('3 lifts up it')
      // Per unit, because that is what the plant delivers before the first concrete sets.
      // 6 × 0.25 × 3 per lift, and the total is the wall.
      expect(reply.units[0]?.volumeCuM).toBeCloseTo(4.5, 6)
      expect(reply.totalVolumeCuM).toBeCloseTo(13.5, 6)
    })

    test('gives a plan cut core’s sentence rather than the enum name', async () => {
      // An MCP host has no system prompt to translate MAX_POUR_LENGTH with, so the reason
      // has to arrive already readable or the joint gets reported as a code.
      load(tallWall())
      await call('set_pour_limits', { elementId: 'wall_1', maxPourLength: 2.5 })

      const reply = await call<UnitsReply>('inspect_pour_units', { elementId: 'wall_1' })

      expect(reply.pourUnitCount).toBe(3)
      expect(reply.units[0]?.startCut).toBeNull()
      expect(reply.units[0]?.endCut).toBe('Split for shrinkage control — over the max pour length')
      expect(reply.units[1]?.startCut).toBe(reply.units[0]?.endCut)
      expect(reply.units[2]?.endCut).toBeNull()
    })

    test('an unsplit element is one unit with no cut reasons to give', async () => {
      load(tallWall())

      const reply = await call<UnitsReply>('inspect_pour_units', { elementId: 'wall_1' })

      expect(reply.pourUnitCount).toBe(1)
      expect(reply.limits).toEqual({
        maxLiftHeight: null,
        maxPourLength: null,
        maxPourVolume: null,
      })
      expect(reply.units[0]?.startCut).toBeNull()
      expect(reply.units[0]?.endCut).toBeNull()
      expect(reply.message).toContain('cast in one pour')
    })

    test('reports an element formed for fewer pours than it is cast in', async () => {
      // The same fault the parts read and the limit write report, in the same words:
      // three readings of one short takeoff is how a user comes to believe there are
      // three problems.
      load(tallWall())
      await call('attach_formwork', { elementId: 'wall_1' })
      await call('set_pour_limits', { elementId: 'wall_1', maxLiftHeight: 3 })

      const reply = await call<UnitsReply>('inspect_pour_units', { elementId: 'wall_1' })

      expect(reply.shutterCount).toBe(1)
      expect(reply.coverageCaveat).toContain('attach_formwork')
      expect(reply.message).toContain('1 of the 3 pours are shuttered')
    })

    test('a slab is one pour unit whatever limits are set on it', async () => {
      // Both splits cut along a centreline and a slab has none. The limit is recorded,
      // and reporting a split here would be a slab about to be poured in bays.
      load(threeKinds())
      await call('set_pour_limits', { elementId: 'slab_1', maxPourLength: 2 })

      const reply = await call<UnitsReply>('inspect_pour_units', { elementId: 'slab_1' })

      expect(reply.pourUnitCount).toBe(1)
      expect(reply.units).toHaveLength(1)
    })
  })
})
