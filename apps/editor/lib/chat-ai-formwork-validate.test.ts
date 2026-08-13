import { describe, expect, test } from 'bun:test'
import type { SceneGraph } from '@pascal-app/core/clone-scene-graph'
import { validationSummary } from '@pascal-app/core/formwork'
import type { AnyNode } from '@pascal-app/core/schema'
import { validateProjectFormwork } from '@pascal-app/nodes/formwork-assembly'
import { buildTools } from './chat-ai'

/**
 * The AI asked whether the job can be built.
 *
 * A different question from what it costs, and the model has no way of deriving one
 * from the other: a bill can total perfectly for a shutter that opens under pressure.
 * So the tests here are about the model getting the answer in a form it cannot round
 * off — the two severities apart, because an error is a thing the crew cannot do and a
 * warning is an exception somebody signs; the unchecked assertions present, because a
 * list of failures alone reads as a clean bill of health for everything never
 * examined; and the sentences word for word the ones in the Buildability panel, so a
 * user comparing the chat to the screen is not left working out whether they are
 * looking at one fault or two.
 */

type ToolMap = ReturnType<typeof buildTools>

const call = (tools: ToolMap, name: keyof ToolMap, input: unknown): Promise<string> =>
  (tools[name].execute as (i: unknown) => Promise<string>)(input)

interface ValidationReply {
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

/**
 * A wall with a window in it, already shuttered in 2.70 m panels.
 *
 * Built as nodes rather than through `attach_formwork`, because the panel width is
 * the whole condition and no tool sets it: 2.70 m panels are drilled at 1.35 and
 * 4.65 m along, so a window from 0.8 to 5.6 m puts every station in the void and
 * leaves the pier at each end with no tie. At the 0.6 m default the holes come every
 * 300 mm and there is nothing to report.
 */
function walledWithOpening(): ToolMap {
  const graph = {
    nodes: {
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
    },
    rootNodeIds: ['level_1'],
  } as unknown as SceneGraph
  return buildTools(graph, [], () => {})
}

/**
 * A U — a 500 mm link wall between two returns, all one pour.
 *
 * Raw nodes for the same reason: `pourId` is what makes the junctions monolithic, and
 * so corner-unit work rather than a bulkhead at each end, and no tool sets it. On a
 * 250 mm wall each outside leg wraps to 550 mm, so the two want 1100 mm of a 500 mm
 * face — which the bill records as two corner units and a shorter panel run.
 */
function shortReturn(): { graph: SceneGraph; tools: ToolMap } {
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
  const graph = {
    nodes: {
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
    },
    rootNodeIds: ['level_1'],
  } as unknown as SceneGraph
  return { graph, tools: buildTools(graph, [], () => {}) }
}

/**
 * A wall with a pour break carrying a waterstop, shuttered in 2.70 m panels.
 *
 * Nodes again, and for two reasons this time. The panel width is half the condition —
 * 2.70 m panels drill at 1.35 / 3.00 / 4.65 m along, and the bar sits on the middle
 * one. The other half is that a *construction* joint is a soft partition, so the pour
 * is not cut at it and the drilled grid crosses it; at an expansion joint the shutter
 * stops there and there is no hole over the bar to find. No tool writes either.
 */
function walledWithWaterstop(): ToolMap {
  const graph = {
    nodes: {
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
        children: ['formwork-assembly_1'],
        start: [0, 0],
        end: [6, 0],
        thickness: 0.25,
        height: 3,
        frontSide: 'unknown',
        backSide: 'unknown',
        formworkType: 'steel-panel',
      },
      joint_1: {
        object: 'node',
        id: 'joint_1',
        type: 'construction-joint',
        parentId: 'level_1',
        visible: true,
        metadata: {},
        children: [],
        kind: 'construction',
        elementIds: ['wall_1'],
        along: 3,
        treatments: [{ kind: 'waterstop', waterstopType: 'pvc-central' }],
        solverPlaced: false,
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
    },
    rootNodeIds: ['level_1'],
  } as unknown as SceneGraph
  return buildTools(graph, [], () => {})
}

/** Two levels, so a level scope can be wrong in either direction. */
function scene(): { graph: SceneGraph; tools: ToolMap } {
  const wall = (id: string, parentId: string, y: number, thickness = 0.25) => ({
    object: 'node',
    id,
    type: 'wall',
    parentId,
    visible: true,
    metadata: {},
    children: [],
    start: [0, y],
    end: [6, y],
    thickness,
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
      // Thicker than any system tie assembly reaches, which is the check that only
      // runs on the catalog the element is actually formed in.
      wall_2: wall('wall_2', 'level_1', 4, 1.4),
      wall_3: wall('wall_3', 'level_2', 0),
    },
    rootNodeIds: ['site_1'],
  } as unknown as SceneGraph
  return { graph, tools: buildTools(graph, [], () => {}) }
}

async function shutter(tools: ToolMap, elementId: string) {
  await call(tools, 'set_element_construction', { elementId, formworkType: 'steel-panel' })
  await call(tools, 'attach_formwork', { elementId })
}

const validate = async (tools: ToolMap, input: unknown = {}): Promise<ValidationReply> =>
  JSON.parse(await call(tools, 'validate_formwork', input)) as ValidationReply

describe('validate_formwork', () => {
  test('faults a wall no tie in its system holds, and names the thickness', async () => {
    const { tools } = scene()
    await shutter(tools, 'wall_2')

    const reply = await validate(tools, { levelId: 'level_1' })

    const tie = reply.findings.find((finding) => finding.invariant === 'WALL_OUTSIDE_TIE_RANGE')
    expect(tie).toBeDefined()
    // Actionable means naming the figure that failed. "Outside the tie range" alone is
    // a claim the reader cannot check.
    expect(tie?.message).toContain('1400 mm')
    expect(tie?.elementIds).toEqual(['wall_2'])
  })

  test('reports a stated rate the concrete supply cannot feed, once a supply is stated', async () => {
    const { tools } = scene()
    await shutter(tools, 'wall_1')

    // Nothing to check until somebody records how fast the concrete arrives.
    const before = await validate(tools, { levelId: 'level_1' })
    expect(before.findings.some((f) => f.invariant === 'POUR_RATE_OVER_CONCRETE_SUPPLY')).toBe(
      false,
    )

    await call(tools, 'set_formwork_settings', {
      placement: { riseRateMH: 3 },
      concreteSupply: { batchPlantOutputM3PerHour: 1 },
    })

    const after = await validate(tools, { levelId: 'level_1' })
    const starved = after.findings.find((f) => f.invariant === 'POUR_RATE_OVER_CONCRETE_SUPPLY')
    expect(starved?.severity).toBe('warning')
    expect(starved?.message).toContain('m³/h')
  })

  test('keeps the two severities apart rather than reporting one count', async () => {
    const { tools } = scene()
    await shutter(tools, 'wall_1')
    await shutter(tools, 'wall_2')

    const reply = await validate(tools, { levelId: 'level_1' })

    expect(reply.errorCount + reply.warningCount).toBe(reply.findings.length)
    expect(reply.findings.filter((f) => f.severity === 'error')).toHaveLength(reply.errorCount)
    expect(reply.findings.filter((f) => f.severity === 'warning')).toHaveLength(reply.warningCount)
  })

  test('the model reads the sentences the panel shows, word for word', async () => {
    // Three phrasings of one fault is how a user comes to believe two of them are
    // different problems.
    const { graph, tools } = scene()
    await shutter(tools, 'wall_2')

    const reply = await validate(tools, { levelId: 'level_1' })
    const onScreen = validationSummary(
      validateProjectFormwork(graph.nodes as unknown as Record<string, AnyNode>, {
        parentId: 'level_1',
      }).report,
    )

    expect(reply.summary).toEqual(onScreen)
  })

  test('says which assertions could not run here', async () => {
    // A report of failures alone reads as a clean bill of health for everything it
    // never examined — rebar clashes and crane capacity among them.
    const { tools } = scene()
    await shutter(tools, 'wall_1')

    const reply = await validate(tools, { levelId: 'level_1' })

    expect(reply.notChecked.map((entry) => entry.invariant)).toContain('TIES_THROUGH_REBAR')
    for (const entry of reply.notChecked) expect(entry.needs.length).toBeGreaterThan(0)
  })

  test('the layout and pressure checks are unchecked until something is shuttered', async () => {
    // They are properties of a solved layout, and an element nobody has formed has no
    // layout to fault. Absent from the list they would read as passed.
    const { tools } = scene()

    const bare = await validate(tools, { levelId: 'level_1' })
    await shutter(tools, 'wall_1')
    await shutter(tools, 'wall_2')
    const formed = await validate(tools, { levelId: 'level_1' })

    const names = (reply: ValidationReply) => reply.notChecked.map((entry) => entry.invariant)
    expect(names(bare)).toContain('UNFORMABLE_STRIP')
    expect(names(bare)).toContain('WALL_OUTSIDE_TIE_RANGE')
    expect(names(formed)).not.toContain('UNFORMABLE_STRIP')
    expect(names(formed)).not.toContain('WALL_OUTSIDE_TIE_RANGE')
  })

  test('names which elements had a layout to check at all', async () => {
    const { tools } = scene()
    await shutter(tools, 'wall_1')

    const reply = await validate(tools, { levelId: 'level_1' })

    expect(reply.elementCount).toBe(2)
    expect(reply.shutteredIds).toEqual(['wall_1'])
  })

  test('scopes to a level, and does not carry the floor above', async () => {
    const { tools } = scene()
    await shutter(tools, 'wall_2')
    await shutter(tools, 'wall_3')

    const ground = await validate(tools, { levelId: 'level_1' })

    expect(ground.findings.flatMap((finding) => finding.elementIds)).not.toContain('wall_3')
    expect(ground.elementCount).toBe(2)
  })

  test('checks only the elements named when given a selection', async () => {
    const { tools } = scene()
    await shutter(tools, 'wall_1')
    await shutter(tools, 'wall_2')

    const named = await validate(tools, { elementIds: ['wall_1'] })

    expect(named.shutteredIds).toEqual(['wall_1'])
    expect(named.findings.flatMap((finding) => finding.elementIds)).not.toContain('wall_2')
  })

  test('a level that does not exist is refused, not reported as nothing wrong', async () => {
    // Scoped to a typo, the honest answer looks exactly like a floor that passed.
    const { tools } = scene()
    await shutter(tools, 'wall_2')

    const reply = await call(tools, 'validate_formwork', { levelId: 'level_9' })

    expect(reply).toStartWith('Error:')
    expect(reply).toContain('list_castable_elements')
  })

  test('reports a pier an opening leaves with no tie, and where to strut it', async () => {
    // The model cannot derive this from anything else it can ask for. The shutter
    // drops the ties that land in the void — correctly — and neither the parts list
    // nor the takeoff records what dropping them left untied.
    const tools = walledWithOpening()

    const reply = await validate(tools)

    const gap = reply.findings.find((finding) => finding.invariant === 'OPENING_LEAVES_TIE_GAP')
    expect(gap?.severity).toBe('warning')
    expect(gap?.elementIds).toEqual(['wall_1', 'window_1'])
    expect(gap?.message).toContain('800 mm')
    expect(gap?.message).toContain('strut')
    expect(gap?.locus?.elevationM).toBeCloseTo(0.775, 6)
  })

  test('reports a tie drilled through a waterstop, and the two ways out of it', async () => {
    // The one clash where every other answer the model can ask for says the wall is
    // fine: the tie is inside capacity, the run closes, the bill totals. A model
    // reading the takeoff would present an order for a tank that leaks at one hole.
    const tools = walledWithWaterstop()

    const reply = await validate(tools)

    const clash = reply.findings.find((finding) => finding.invariant === 'TIE_THROUGH_WATERSTOP')
    expect(clash?.severity).toBe('error')
    expect(clash?.elementIds).toEqual(['wall_1', 'joint_1'])
    expect(clash?.message).toContain('200 mm PVC waterstop')
    // Both fixes, because the model will otherwise offer the first one it reads and a
    // yard that cannot move the joint needs to hear about the watertight assembly.
    expect(clash?.message).toContain('Move the joint')
    expect(clash?.message).toContain('taper tie')
    expect(clash?.locus?.alongM).toBeCloseTo(3, 6)
  })

  test('reports a return too short for two corner units, and names the length', async () => {
    // The other thing the model cannot derive. The takeoff bills both units and every
    // figure in it is self-consistent — `panelRuns` subtracts each blocked stretch in
    // turn, so an overlap leaves less run rather than an open one — so an agent
    // reading the bill sees a wall that costs what it should and cannot be built.
    const { tools } = shortReturn()

    const reply = await validate(tools)

    const clash = reply.findings.find((finding) => finding.invariant === 'CORNER_UNITS_OVERLAP')
    expect(clash?.severity).toBe('error')
    expect(clash?.elementIds).toContain('link')
    expect(clash?.message).toContain('500 mm long')
    expect(clash?.message).toContain('bespoke box')
  })

  test('the corner clash is reported on a scene nobody has shuttered', async () => {
    // Unlike the tie gap below. A corner leg length comes from the catalog and, absent
    // one, from the figure both shipped systems agree on — so this answer is available
    // before any shutter exists, and telling the model to go and form something first
    // would send it after evidence it does not need.
    const { tools } = shortReturn()

    const reply = await validate(tools)

    expect(reply.shutteredIds).toEqual([])
    expect(reply.findings.some((finding) => finding.invariant === 'CORNER_UNITS_OVERLAP')).toBe(
      true,
    )
    expect(reply.notChecked.map((entry) => entry.invariant)).not.toContain('CORNER_UNITS_OVERLAP')
  })

  test('the clash check is unchecked until something is shuttered', async () => {
    // Where a tie can pass is a property of the drilled frames, so a wall nobody has
    // formed has no grid to be short of. Absent from the list it would read as passed.
    const { tools } = scene()

    const bare = await validate(tools, { levelId: 'level_1' })

    expect(bare.notChecked.map((entry) => entry.invariant)).toContain('OPENING_LEAVES_TIE_GAP')
  })

  test('an empty scope is not an empty pass', async () => {
    const { tools } = scene()

    const reply = await validate(tools, { elementIds: [] })

    expect(reply.findings).toEqual([])
    expect(reply.shutteredIds).toEqual([])
    expect(reply.summary.join(' ')).toContain('Nothing in this scope to check.')
  })
})

/**
 * The questions the model must not answer itself.
 *
 * Every finding above is presented to the model with what would clear it, and for about
 * half of them the honest answer is "nothing this feature writes". Left at that, a model
 * does the natural and wrong thing: it proposes a detail. On the two subjects where these
 * findings actually land — a seal across a joint in a water-retaining structure, an anchor
 * load into hardened concrete — a detail the model invented is a leak or a collapse rather
 * than a re-order, and it is somebody else's liability to state.
 *
 * The wording and the split belong to `rfi.test.ts` in core. What matters here is that the
 * tool exists on this surface at all, that it reads the scene rather than an argument, and
 * that the two things the model would otherwise get wrong survive: a count of questions is
 * not a count of problems, and this is not a register.
 */
describe('formwork_rfis', () => {
  interface RfiReply {
    scope: string
    questions: Array<{
      invariant: string
      addressee: string
      addresseeLabel: string
      question: string
      elementIds: string[]
      context: string[]
      beforePour: boolean
    }>
    beforePourCount: number
    findingCount: number
    summary: string[]
  }

  const rfis = async (tools: ToolMap, input: unknown = {}): Promise<RfiReply> =>
    JSON.parse(await call(tools, 'formwork_rfis', input)) as RfiReply

  test('asks the engineer about the seal, in words the model did not write', async () => {
    // The tie drilled through the waterstop: an error, no write here clears it, and the
    // answer — a watertight tie or a relocated joint — is the engineer's to give.
    const tools = walledWithWaterstop()

    const reply = await rfis(tools)

    const seal = reply.questions.find((q) => q.invariant === 'TIE_THROUGH_WATERSTOP')
    expect(seal?.addressee).toBe('engineer-of-record')
    expect(seal?.addresseeLabel).toBe('Engineer of record')
    expect(seal?.elementIds).toContain('wall_1')
    expect(seal?.beforePour).toBe(true)
    // The question asks for something. A template restating the defect would come back
    // agreed and unblock nothing.
    expect(seal?.question).toMatch(/\?|Confirm|Specify|State/)
  })

  test('the figures on the form are the check’s own, not a second version', async () => {
    const tools = walledWithWaterstop()

    const validation = await validate(tools)
    const reply = await rfis(tools)

    for (const question of reply.questions) {
      for (const line of question.context) {
        expect(validation.findings.some((finding) => finding.message === line)).toBe(true)
      }
    }
  })

  test('stays quiet about the corner clash, which is ours to lay out again', async () => {
    // An RFI about two corner units that overlap is a designer being asked to do the
    // temporary-works engineering the sender is responsible for. The finding is still an
    // error and validate_formwork still reports it — this tool just is not where it goes.
    const { tools } = shortReturn()

    const validation = await validate(tools)
    const reply = await rfis(tools)

    expect(validation.findings.some((f) => f.invariant === 'CORNER_UNITS_OVERLAP')).toBe(true)
    expect(reply.questions.map((q) => q.invariant)).not.toContain('CORNER_UNITS_OVERLAP')
    // And the denominator says so, rather than leaving the model to read a short list of
    // questions as a job with few problems.
    expect(reply.findingCount).toBe(validation.findings.length)
  })

  test('says nothing at all where a scope raises no questions', async () => {
    const { tools } = scene()

    const reply = await rfis(tools, { elementIds: [] })

    expect(reply.questions).toEqual([])
    expect(reply.summary).toEqual([])
  })

  test('refuses a level that does not exist, like the check it is derived from', async () => {
    const { tools } = scene()

    const reply = await call(tools, 'formwork_rfis', { levelId: 'level_9' })

    expect(reply).toStartWith('Error:')
    expect(reply).toContain('list_castable_elements')
  })

  test('tells the model outright that this is not a register', async () => {
    // The sentence that keeps a list of questions from being reported as questions sent.
    const tools = walledWithWaterstop()

    const reply = await rfis(tools)

    expect(reply.summary.join(' ')).toContain('not a register')
    expect(reply.summary.join(' ')).toContain('engineer of record')
  })
})
