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
      resolved: { riseRateMH: number; concreteTemperatureC: number; pressureStandard: string }
      stated: { placement?: Record<string, number>; curing?: Record<string, number> } | null
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
