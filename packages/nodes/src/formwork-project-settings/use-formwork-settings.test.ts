import { beforeEach, describe, expect, test } from 'bun:test'
import {
  type AnyNode,
  type AnyNodeId,
  findFormworkSettingsNode,
  nodeRegistry,
  registerNode,
  useScene,
} from '@pascal-app/core'
import type { AnyNodeDefinition } from '@pascal-app/core/registry'
import { formworkAssemblyDefinition } from '../formwork-assembly'
import { formworkProjectSettingsDefinition } from './definition'
import {
  clearFormworkOwnedStock,
  clearFormworkRates,
  clearFormworkSettings,
  setFormworkCementField,
  setFormworkLogisticsRates,
  setFormworkOwnedStock,
  setFormworkRate,
  setFormworkRateTerms,
  setFormworkSettingsField,
  setFormworkSettingsGroupField,
} from './use-formwork-settings'

/**
 * The settings write has three failure modes that all leave the UI looking correct:
 * an orphaned node that vanishes on the next load, a stale shutter that keeps the
 * spacings it was built with, and a default written into a field nobody stated —
 * which turns every assumption in the project into a claim. None of them throws.
 */

// bun:test has no DOM — node-actions schedules markDirty via requestAnimationFrame,
// so polyfill it as synchronous.
type RafFn = (cb: (t: number) => void) => number
;(globalThis as unknown as { requestAnimationFrame?: RafFn }).requestAnimationFrame ??= ((
  cb: (t: number) => void,
) => {
  cb(0)
  return 0
}) as RafFn
;(globalThis as unknown as { cancelAnimationFrame?: (id: number) => void }).cancelAnimationFrame ??=
  () => {}

// `createNode` validates against the registry, and `markDirty` reads `dirtyTracking`
// off it — the assembly definition is needed for the sweep to be observable at all.
for (const def of [formworkProjectSettingsDefinition, formworkAssemblyDefinition]) {
  const kind = (def as unknown as AnyNodeDefinition).kind
  if (!nodeRegistry.has(kind)) registerNode(def as unknown as AnyNodeDefinition)
}

const SITE_ID = 'site_settings_test' as AnyNodeId
const LEVEL_A = 'level_a' as AnyNodeId
const LEVEL_B = 'level_b' as AnyNodeId
const ASSEMBLY_A = 'fwasm_a' as AnyNodeId
const ASSEMBLY_B = 'fwasm_b' as AnyNodeId

function makeAssembly(id: AnyNodeId, parentId: AnyNodeId): AnyNode {
  return {
    id,
    type: 'formwork-assembly',
    parentId,
    object: 'node',
    visible: true,
    name: '',
    metadata: {},
    children: [],
    hostId: 'wall_x',
  } as unknown as AnyNode
}

function container(id: AnyNodeId, type: string, parentId: AnyNodeId | null, children: AnyNodeId[]) {
  return {
    id,
    type,
    parentId,
    object: 'node',
    visible: true,
    name: '',
    metadata: {},
    children,
  } as unknown as AnyNode
}

/** A site with two levels, one assembly on each — so a level-scoped sweep would miss one. */
function seedScene(): void {
  useScene.setState({
    nodes: {
      [SITE_ID]: container(SITE_ID, 'site', null, [LEVEL_A, LEVEL_B]),
      [LEVEL_A]: container(LEVEL_A, 'level', SITE_ID, [ASSEMBLY_A]),
      [LEVEL_B]: container(LEVEL_B, 'level', SITE_ID, [ASSEMBLY_B]),
      [ASSEMBLY_A]: makeAssembly(ASSEMBLY_A, LEVEL_A),
      [ASSEMBLY_B]: makeAssembly(ASSEMBLY_B, LEVEL_B),
    },
    rootNodeIds: [SITE_ID],
    dirtyNodes: new Set<AnyNodeId>(),
  } as never)
  useScene.temporal.getState().clear()
}

function settings() {
  return findFormworkSettingsNode(Object.values(useScene.getState().nodes))
}

describe('formwork settings write — node creation', () => {
  beforeEach(seedScene)

  test('creates the node on first write, parented to the site', () => {
    expect(settings()).toBeUndefined()

    setFormworkSettingsGroupField('placement', { riseRateMH: 2.5 })

    const node = settings()
    expect(node).toBeDefined()
    // Parented, or `setScene`'s orphan sweep eats it on the next load and the
    // project's pour silently reverts to the defaults.
    expect(node?.parentId).toBe(SITE_ID)
    expect((useScene.getState().nodes[SITE_ID] as { children: AnyNodeId[] }).children).toContain(
      node?.id as AnyNodeId,
    )
  })

  test('reuses the node on subsequent writes rather than creating a second', () => {
    setFormworkSettingsGroupField('placement', { riseRateMH: 2.5 })
    const firstId = settings()?.id
    setFormworkSettingsField('pressureStandard', 'ACI_347')

    const all = Object.values(useScene.getState().nodes).filter(
      (n) => n.type === 'formwork-settings',
    )
    expect(all).toHaveLength(1)
    expect(settings()?.id).toBe(firstId)
  })

  test('a scene with no site is left alone rather than given an orphan', () => {
    useScene.setState({ nodes: {}, rootNodeIds: [], dirtyNodes: new Set() } as never)

    setFormworkSettingsGroupField('placement', { riseRateMH: 2.5 })

    expect(Object.values(useScene.getState().nodes)).toHaveLength(0)
  })
})

describe('formwork settings write — dirty sweep', () => {
  beforeEach(seedScene)

  test('dirties assemblies on every level, not just one', () => {
    setFormworkSettingsGroupField('placement', { riseRateMH: 2.5 })

    const dirty = useScene.getState().dirtyNodes
    expect(dirty.has(ASSEMBLY_A)).toBe(true)
    expect(dirty.has(ASSEMBLY_B)).toBe(true)
  })

  test('the settings node itself is not dirtied — markDirty drops the kind', () => {
    setFormworkSettingsGroupField('placement', { riseRateMH: 2.5 })
    const id = settings()?.id as AnyNodeId

    // Registered `dirtyTracking: false`, so a sweep that marked it would be a no-op
    // dressed up as coverage. The assemblies above are what actually rebuild.
    expect(useScene.getState().dirtyNodes.has(id)).toBe(false)
  })
})

describe('formwork settings write — unset stays unset', () => {
  beforeEach(seedScene)

  test('only the stated field is written; siblings stay absent', () => {
    setFormworkSettingsGroupField('placement', { riseRateMH: 2.5 })

    const placement = settings()?.placement
    expect(placement?.riseRateMH).toBe(2.5)
    expect(placement).not.toHaveProperty('concreteTemperatureC')
    expect(settings()?.concrete).toBeUndefined()
  })

  test('a second field in the same group merges rather than replacing it', () => {
    setFormworkSettingsGroupField('placement', { riseRateMH: 2.5 })
    setFormworkSettingsGroupField('placement', { concreteTemperatureC: 12 })

    expect(settings()?.placement).toEqual({ riseRateMH: 2.5, concreteTemperatureC: 12 })
  })

  test('undefined hands a field back — the key is deleted, not stored as undefined', () => {
    setFormworkSettingsGroupField('placement', { riseRateMH: 2.5, concreteTemperatureC: 12 })
    setFormworkSettingsGroupField('placement', { riseRateMH: undefined })

    const placement = settings()?.placement
    expect(placement).toEqual({ concreteTemperatureC: 12 })
    expect(Object.hasOwn(placement ?? {}, 'riseRateMH')).toBe(false)
  })

  test('emptying a group removes the group, so it reads as unstated again', () => {
    setFormworkSettingsGroupField('placement', { riseRateMH: 2.5 })
    setFormworkSettingsGroupField('placement', { riseRateMH: undefined })

    expect(settings()?.placement).toBeUndefined()
  })

  test('curing is a group of its own, and writing it leaves the placing temperature alone', () => {
    // The two temperatures are separate fields because they move the design in opposite
    // directions: a colder mix pushes harder, a colder cure holds longer. A write that
    // touched both would be wrong for one of the two answers whatever it wrote.
    setFormworkSettingsGroupField('placement', { concreteTemperatureC: 25 })
    setFormworkSettingsGroupField('curing', { surfaceTemperatureC: 5 })

    expect(settings()?.curing).toEqual({ surfaceTemperatureC: 5 })
    expect(settings()?.placement).toEqual({ concreteTemperatureC: 25 })
  })
})

describe('formwork settings write — cement, the second nesting level', () => {
  beforeEach(seedScene)

  test('merges into concrete.cement without dropping a sibling concrete field', () => {
    setFormworkSettingsGroupField('concrete', { slumpMm: 180 })
    setFormworkCementField({ superplasticizer: true })

    expect(settings()?.concrete).toEqual({ slumpMm: 180, cement: { superplasticizer: true } })
  })

  test('two binder fields accumulate', () => {
    setFormworkCementField({ slagFraction: 0.75 })
    setFormworkCementField({ retarder: true })

    expect(settings()?.concrete?.cement).toEqual({ slagFraction: 0.75, retarder: true })
  })

  test('emptying the spec removes cement rather than leaving a stated empty object', () => {
    setFormworkCementField({ retarder: true })
    setFormworkCementField({ retarder: undefined })

    // `{}` here would read as a stated binder with no blend, which is not the same
    // claim as "nobody has said".
    expect(settings()?.concrete).toBeUndefined()
  })

  test('emptying the spec keeps a stated sibling concrete field', () => {
    setFormworkSettingsGroupField('concrete', { unitWeightKnM3: 24 })
    setFormworkCementField({ retarder: true })
    setFormworkCementField({ retarder: undefined })

    expect(settings()?.concrete).toEqual({ unitWeightKnM3: 24 })
  })
})

describe('formwork settings write — the yard’s own rack', () => {
  beforeEach(seedScene)

  const PANEL = 'doka-framax-panel-588104500'
  const OTHER = 'doka-framax-panel-588223500'

  test('a second type is added rather than replacing the rack', () => {
    // The reason `mergeFormworkOwnedStock` exists rather than the group merge, which
    // replaces `owned` wholesale — recording one panel type would forget the yard.
    setFormworkOwnedStock({ [PANEL]: 200 })
    setFormworkOwnedStock({ [OTHER]: 40 })

    expect(settings()?.stock).toEqual({ owned: { [PANEL]: 200, [OTHER]: 40 } })
  })

  test('a stated zero is kept, because owning none of a type is a fact about it', () => {
    setFormworkOwnedStock({ [PANEL]: 0 })

    expect(settings()?.stock).toEqual({ owned: { [PANEL]: 0 } })
  })

  test('removing the last line leaves a rack of nothing, which is still an answer', () => {
    // Every other group here reverts to unstated when emptied. This one must not: a
    // recorded empty rack prices the whole bill as hire, where an absent one shows no
    // split at all.
    setFormworkOwnedStock({ [PANEL]: 200 })
    setFormworkOwnedStock({ [PANEL]: undefined })

    expect(settings()?.stock).toEqual({ owned: {} })
  })

  test('clearing the rack is the separate, explicit way back to unstated', () => {
    setFormworkOwnedStock({ [PANEL]: 200 })

    clearFormworkOwnedStock()

    expect(settings()?.stock).toBeUndefined()
  })

  test('a rack write leaves a stated design input alone', () => {
    setFormworkSettingsGroupField('placement', { riseRateMH: 2.5 })
    setFormworkOwnedStock({ [PANEL]: 200 })

    expect(settings()?.placement).toEqual({ riseRateMH: 2.5 })
  })
})

describe('formwork settings write — what the project pays', () => {
  beforeEach(seedScene)

  const PANEL = 'doka-framax-panel-588104500'
  const OTHER = 'doka-framax-panel-588223500'

  test('two figures for one part accumulate, because they arrive from different documents', () => {
    // The reason the rate merge reaches a second level where the rack's stops at one:
    // a list price comes off a price list and a hire term off an agreement, and
    // replacing the rate object would make entering the second delete the first.
    setFormworkRate(PANEL, { purchasePerUnit: 420 })
    setFormworkRate(PANEL, { rentalPercentPerMonth: 3 })

    expect(settings()?.rates?.byCatalogId?.[PANEL]).toEqual({
      purchasePerUnit: 420,
      rentalPercentPerMonth: 3,
    })
  })

  test('a second part is added rather than replacing the table', () => {
    setFormworkRate(PANEL, { purchasePerUnit: 420 })
    setFormworkRate(OTHER, { purchasePerUnit: 380 })

    expect(Object.keys(settings()?.rates?.byCatalogId ?? {}).sort()).toEqual([PANEL, OTHER].sort())
  })

  test('null clears one figure and leaves the part priced', () => {
    setFormworkRate(PANEL, { purchasePerUnit: 420, rentalPercentPerMonth: 3 })
    setFormworkRate(PANEL, { rentalPercentPerMonth: null })

    expect(settings()?.rates?.byCatalogId?.[PANEL]).toEqual({ purchasePerUnit: 420 })
  })

  test('a rate emptied of every figure drops the part, because there is no priced-unknown', () => {
    // Unlike the rack, where 0 is the real answer to "how many do we own". No number
    // means "priced, amount unknown", so an empty rate is a row that prices nothing.
    setFormworkRate(PANEL, { purchasePerUnit: 420 })
    setFormworkRate(PANEL, { purchasePerUnit: null })

    expect(settings()?.rates?.byCatalogId).toEqual({})
  })

  test('the terms are stated on the group, and survive a table emptied of every part', () => {
    setFormworkRateTerms({ currency: 'GBP', minHireDays: 28 })
    setFormworkRate(PANEL, { purchasePerUnit: 420 })
    setFormworkRate(PANEL, { purchasePerUnit: null })

    expect(settings()?.rates).toEqual({ byCatalogId: {}, currency: 'GBP', minHireDays: 28 })
  })

  test('an empty terms patch opens the table without pricing anything', () => {
    // "The project has looked at its rates and recorded none" is a different answer from
    // "nobody has been asked", and it is the state the panel is in while a row is chosen.
    setFormworkRateTerms({})

    expect(settings()?.rates).toEqual({ byCatalogId: {} })
  })

  test('null against a term clears it without touching the priced parts', () => {
    setFormworkRateTerms({ currency: 'GBP', minHireDays: 28 })
    setFormworkRate(PANEL, { purchasePerUnit: 420 })

    setFormworkRateTerms({ minHireDays: null })

    expect(settings()?.rates).toEqual({
      byCatalogId: { [PANEL]: { purchasePerUnit: 420 } },
      currency: 'GBP',
    })
  })

  test('clearing the rates is the explicit way back to a takeoff with no money on it', () => {
    setFormworkRate(PANEL, { purchasePerUnit: 420 })

    clearFormworkRates()

    expect(settings()?.rates).toBeUndefined()
  })

  test('a rate write leaves the rack and a stated design input alone', () => {
    setFormworkSettingsGroupField('placement', { riseRateMH: 2.5 })
    setFormworkOwnedStock({ [PANEL]: 200 })

    setFormworkRate(PANEL, { purchasePerUnit: 420 })

    expect(settings()?.placement).toEqual({ riseRateMH: 2.5 })
    expect(settings()?.stock).toEqual({ owned: { [PANEL]: 200 } })
  })
})

describe('formwork settings write — the deliveries and the crane hours', () => {
  beforeEach(seedScene)

  test('the quantities go to logistics and the money to rates, in one edit', () => {
    // The split the whole group is arranged around: a payload and a cycle time are facts
    // about the job's plant, and the two charges are money, which is denominated in the
    // currency `rates` already states once.
    setFormworkSettingsGroupField('logistics', { lorryPayloadKg: 8000, minutesPerPick: 30 })
    setFormworkLogisticsRates({ transportPerLoad: 400, cranePerHour: 120 })

    expect(settings()?.logistics).toEqual({ lorryPayloadKg: 8000, minutesPerPick: 30 })
    // An empty part table beside them, as any write through `rates` opens: the project has
    // looked at its rates and priced no part, which is not the same as never being asked.
    expect(settings()?.rates).toEqual({
      byCatalogId: {},
      transportPerLoad: 400,
      cranePerHour: 120,
    })
  })

  test('the crane hire arrives after the haulier’s quote without deleting it', () => {
    // The reason this writer takes the two fields rather than the group: the quotes come
    // from two desks, and a group replace would make the second one erase the first.
    setFormworkLogisticsRates({ transportPerLoad: 400 })
    setFormworkLogisticsRates({ cranePerHour: 120 })

    expect(settings()?.rates).toEqual({
      byCatalogId: {},
      transportPerLoad: 400,
      cranePerHour: 120,
    })
  })

  test('null unstates one charge and leaves the other priced', () => {
    setFormworkLogisticsRates({ transportPerLoad: 400, cranePerHour: 120 })
    setFormworkLogisticsRates({ cranePerHour: null })

    expect(settings()?.rates).toEqual({ byCatalogId: {}, transportPerLoad: 400 })
  })

  test('a logistics charge lands beside the part rates rather than replacing the table', () => {
    setFormworkRateTerms({ currency: 'GBP' })
    setFormworkRate('doka-framax-panel-588104500', { purchasePerUnit: 420 })

    setFormworkLogisticsRates({ transportPerLoad: 400 })

    expect(settings()?.rates).toEqual({
      byCatalogId: { 'doka-framax-panel-588104500': { purchasePerUnit: 420 } },
      currency: 'GBP',
      transportPerLoad: 400,
    })
  })
})

describe('formwork settings write — the sheets the ply is cut from', () => {
  beforeEach(seedScene)

  const PLAIN = 'ply-1220x2440x18-plain'
  const BIRCH = 'ply-1250x2500x18-birch-wbp'

  test('a second sheet is added to the list rather than replacing the first', () => {
    // The rack's failure mode, and it costs sheets rather than a field: a nest allowed to
    // open the bigger sheet for the few boards that need it buys fewer of both.
    setFormworkSettingsGroupField('sheets', { stockIds: [PLAIN] })
    setFormworkSettingsGroupField('sheets', { stockIds: [PLAIN, BIRCH] })

    expect(settings()?.sheets).toEqual({ stockIds: [PLAIN, BIRCH] })
  })

  test('the racking policy arrives beside the sheets without unstating them', () => {
    // Two different people's answers — a merchant's list and the yard's own rule about what
    // is worth keeping — so the second must not erase the first.
    setFormworkSettingsGroupField('sheets', { stockIds: [PLAIN] })
    setFormworkSettingsGroupField('sheets', { minKeepWidthMm: 150, minKeepLengthMm: 600 })

    expect(settings()?.sheets).toEqual({
      minKeepLengthMm: 600,
      minKeepWidthMm: 150,
      stockIds: [PLAIN],
    })
  })

  test('undefined hands the list back to unstated, which is not a yard buying nothing', () => {
    // A list of no sheets and nobody having said are the same claim, and only one of them
    // should be reachable — a stated empty list would nest nothing and report a cut list.
    setFormworkSettingsGroupField('sheets', { stockIds: [PLAIN], minKeepWidthMm: 150 })
    setFormworkSettingsGroupField('sheets', { stockIds: undefined })

    expect(settings()?.sheets).toEqual({ minKeepWidthMm: 150 })
  })
})

describe('formwork settings write — reset', () => {
  beforeEach(seedScene)

  test('clearAll hands every group back', () => {
    setFormworkSettingsField('pressureStandard', 'ACI_347')
    setFormworkSettingsGroupField('placement', { riseRateMH: 2.5 })
    setFormworkSettingsGroupField('parts', { doubledWalers: true })
    setFormworkCementField({ retarder: true })
    setFormworkSettingsGroupField('curing', { surfaceTemperatureC: 8 })
    setFormworkOwnedStock({ 'doka-framax-panel-588104500': 200 })
    setFormworkRate('doka-framax-panel-588104500', { purchasePerUnit: 420 })
    setFormworkSettingsGroupField('crane', { hookHeightM: 40 })
    setFormworkSettingsGroupField('logistics', { lorryPayloadKg: 8000 })
    setFormworkSettingsGroupField('sheets', { stockIds: ['ply-1220x2440x18-plain'] })

    clearFormworkSettings()

    // Every group, not most of them: a reset that leaves one behind reports the shipped
    // defaults everywhere while the report still calls that group the project's decision.
    const node = settings()
    expect(node).toBeDefined()
    expect(node?.pressureStandard).toBeUndefined()
    expect(node?.placement).toBeUndefined()
    expect(node?.parts).toBeUndefined()
    expect(node?.concrete).toBeUndefined()
    expect(node?.curing).toBeUndefined()
    expect(node?.stock).toBeUndefined()
    expect(node?.rates).toBeUndefined()
    expect(node?.crane).toBeUndefined()
    expect(node?.logistics).toBeUndefined()
    expect(node?.sheets).toBeUndefined()
  })

  test('a reset still dirties the assemblies it re-sizes', () => {
    setFormworkSettingsGroupField('placement', { riseRateMH: 2.5 })
    useScene.setState({ dirtyNodes: new Set<AnyNodeId>() } as never)

    clearFormworkSettings()

    const dirty = useScene.getState().dirtyNodes
    expect(dirty.has(ASSEMBLY_A)).toBe(true)
    expect(dirty.has(ASSEMBLY_B)).toBe(true)
  })
})

describe('formwork settings write — history', () => {
  beforeEach(seedScene)

  test('the first ever edit is one undo step, leaving no empty settings node', () => {
    setFormworkSettingsGroupField('placement', { riseRateMH: 2.5 })
    expect(settings()).toBeDefined()

    useScene.temporal.getState().undo()

    // Creation and update collapse into one step, so an undo after the first edit
    // does not leave a settings node with nothing stated in it.
    expect(settings()).toBeUndefined()
  })
})
