import { describe, expect, test } from 'bun:test'
import {
  applyPartOverrides,
  bomLines,
  bomWeightKg,
  duplicateMarks,
  type FormworkPart,
  type FormworkPartSpec,
  mergeFormworkPartOverride,
  orphanedOverrides,
  overUtilisedParts,
  partByMark,
  partMark,
  partQuantity,
  withoutPartOverrides,
  worstUtilisation,
} from './parts'

/**
 * The parts vocabulary, and the four ways it fails without saying so.
 *
 * A mark that moves when the scene is re-solved sends a drawing to site naming a
 * panel that no longer exists. A BOM that folds a drilled panel back in with
 * untouched stock loses the only record that it was drilled. An override whose mark
 * has gone silently does nothing. A weight total that treats "not stated" as zero
 * comes out short with nothing on screen to say so. None of the four throws, and
 * all four look right, which is why they are tested rather than reasoned about.
 */

/** Marks a whole list at once. The collector marks one part at a time as it emits it. */
function withMarks(specs: readonly FormworkPartSpec[]): FormworkPart[] {
  return specs.map((spec) => ({ ...spec, mark: partMark(spec) }))
}

function panel(stationMm: number, courseIndex = 0): FormworkPartSpec {
  return {
    kind: 'panel',
    locus: { on: 'run', face: 'side-a', stationMm, courseIndex },
    catalogId: 'framax-2700-900',
    description: 'Framax Xlife 2.70 × 0.90 m',
    provenance: 'standard',
    weightKg: 86,
    widthMm: 900,
    heightMm: 2700,
  }
}

describe('marks are positions, not counters', () => {
  test('a mark is a pure function of the spec', () => {
    expect(partMark(panel(1250))).toBe(partMark(panel(1250)))
  })

  test('inserting a part upstream does not renumber the ones after it', () => {
    const before = withMarks([panel(0), panel(900), panel(1800)])
    const after = withMarks([panel(0), panel(450), panel(900), panel(1800)])

    // The whole point: an override written against the 1800 panel still lands on it
    // after a corner unit appears upstream. A counter would shift it by one.
    expect(after.map((p) => p.mark)).toContain(before[2]?.mark as string)
  })

  test('the course is part of the mark, so a stack is not two of the same panel', () => {
    expect(partMark(panel(1250, 0))).not.toBe(partMark(panel(1250, 1)))
  })

  test('marks pad, so they sort in the order the parts stand in', () => {
    const marks = withMarks([panel(11_250), panel(900), panel(1800)])
      .map((p) => p.mark)
      .sort()

    // Four digits would sort 11250 before 1800, which is any wall over ten metres.
    expect(marks).toEqual(['P-A-1-00900', 'P-A-1-01800', 'P-A-1-11250'])
  })

  test('a negative station reads back, so a mark never contains a stray minus', () => {
    const mark = partMark(panel(-300))

    expect(mark).toBe('P-A-1-N00300')
    expect(mark.split('-')).toHaveLength(4)
  })

  test('a float that comes back a fraction short marks identically', () => {
    expect(partMark(panel(1249.9999999))).toBe(partMark(panel(1250)))
  })

  test('two cut boards at one station are told apart by their elevation', () => {
    const band = (elevationMm: number): FormworkPartSpec => ({
      kind: 'ply-piece',
      use: 'cut-board',
      locus: { on: 'run', face: 'side-a', stationMm: 1250, courseIndex: 0, elevationMm },
      description: 'Cut board',
      provenance: 'bespoke',
      widthMm: 137,
      heightMm: 400,
    })

    expect(partMark(band(0))).not.toBe(partMark(band(2100)))
  })

  test('two corner units on one spine are told apart by which way they run', () => {
    const leg = (towardEnd: boolean): FormworkPartSpec => ({
      kind: 'corner',
      side: 'inside',
      locus: { on: 'run', face: 'side-a', stationMm: 4000, towardEnd },
      description: 'Inside corner',
      provenance: 'standard',
      heightMm: 2700,
      legLengthsMm: [180, 300],
      owned: true,
    })

    expect(partMark(leg(true))).not.toBe(partMark(leg(false)))
  })

  test('a clash in the enumeration is reported rather than papered over', () => {
    // Suffixing the second one would depend on iteration order — the property this
    // module exists to avoid — and would hide the clash from the validator.
    const parts = withMarks([panel(900), panel(900)])

    expect(parts[0]?.mark).toBe(parts[1]?.mark as string)
    expect(duplicateMarks(parts)).toEqual(['P-A-1-00900'])
  })

  test('a clean enumeration has no duplicates', () => {
    expect(duplicateMarks(withMarks([panel(0), panel(900)]))).toEqual([])
  })
})

describe('overrides', () => {
  const parts = withMarks([panel(0), panel(900)])
  const first = parts[0]?.mark as string

  test('a substituted catalog id becomes modified, not standard', () => {
    const [swapped] = applyPartOverrides(parts, { [first]: { catalogId: 'framax-2700-750' } })

    expect(swapped?.catalogId).toBe('framax-2700-750')
    // A substitution is a decision about this pour; folding it back into general
    // stock loses the only record of it.
    expect(swapped?.provenance).toBe('modified')
  })

  test('an override naming the id the part already has is not a modification', () => {
    const [same] = applyPartOverrides(parts, { [first]: { catalogId: 'framax-2700-900' } })

    expect(same?.provenance).toBe('standard')
  })

  test('an omitted part stays in the list flagged rather than vanishing', () => {
    const applied = applyPartOverrides(parts, { [first]: { omitted: true } })

    expect(applied).toHaveLength(2)
    expect(applied[0]?.omitted).toBe(true)
  })

  test('a note is carried', () => {
    const [noted] = applyPartOverrides(parts, { [first]: { note: 'drilled for cast-in' } })

    expect(noted?.note).toBe('drilled for cast-in')
  })

  test('parts without an override are untouched', () => {
    const applied = applyPartOverrides(parts, { [first]: { omitted: true } })

    expect(applied[1]).toEqual(parts[1] as FormworkPart)
  })

  test('an override whose mark has gone is reported, not dropped on the floor', () => {
    // A wall shrinking below a panel is common and recoverable; a silently discarded
    // override is not.
    expect(orphanedOverrides(parts, { 'P-A-1-99999': { omitted: true } })).toEqual(['P-A-1-99999'])
  })

  test('an override that still matches is not orphaned', () => {
    expect(orphanedOverrides(parts, { [first]: { omitted: true } })).toEqual([])
  })

  test('a stale override is dropped only when something asks for it to be', () => {
    const overrides = { [first]: { omitted: true as const }, 'P-A-1-99999': { note: 'gone' } }

    expect(Object.keys(withoutPartOverrides(overrides, ['P-A-1-99999']))).toEqual([first])
  })
})

describe('merging one part’s override', () => {
  const mark = 'P-A-1-00900'

  test('a patch merges into what is already there rather than replacing it', () => {
    // The panel inspector writes one field at a time, so a note written after a
    // substitution must not drop the substitution.
    const merged = mergeFormworkPartOverride({ [mark]: { catalogId: 'framax-2700-750' } }, mark, {
      note: 'drilled for cast-in',
    })

    expect(merged[mark]).toEqual({ catalogId: 'framax-2700-750', note: 'drilled for cast-in' })
  })

  test('a sibling part’s override is untouched', () => {
    const merged = mergeFormworkPartOverride({ 'P-A-1-00000': { omitted: true } }, mark, {
      omitted: true,
    })

    expect(Object.keys(merged).sort()).toEqual(['P-A-1-00000', mark])
  })

  test('clearing the last field deletes the override rather than leaving an empty one', () => {
    // An empty override is reported as a stale edit by `orphanedOverrides` for the
    // rest of the project's life, against a part nobody actually edited.
    const merged = mergeFormworkPartOverride({ [mark]: { omitted: true } }, mark, {
      omitted: undefined,
    })

    expect(merged).toEqual({})
  })

  test('false and empty string clear rather than store, so “no” is not a claim', () => {
    // The tri-state controls hand back `false` for "not omitted" and `''` for a
    // cleared note, and storing either would make an untouched part read as edited.
    expect(
      mergeFormworkPartOverride({ [mark]: { omitted: true } }, mark, { omitted: false }),
    ).toEqual({})
    expect(mergeFormworkPartOverride({ [mark]: { note: 'x' } }, mark, { note: '' })).toEqual({})
  })

  test('the input record is not mutated', () => {
    const before = { [mark]: { omitted: true as const } }
    mergeFormworkPartOverride(before, 'P-A-1-01800', { omitted: true })

    expect(Object.keys(before)).toEqual([mark])
  })
})

describe('the bill', () => {
  test('identical parts collapse onto one line', () => {
    const lines = bomLines(withMarks([panel(0), panel(900), panel(1800)]))

    expect(lines).toHaveLength(1)
    expect(lines[0]?.quantity).toBe(3)
    expect(lines[0]?.marks).toHaveLength(3)
  })

  test('a drilled panel does not share a line with untouched stock', () => {
    // The same catalog item under the same label, one of them altered for this pour.
    // Provenance is the *only* thing separating them, which is the case a key built
    // from the id and the description alone gets wrong: one goes back on the rack and
    // one follows this job, so they are two things to a yard.
    const drilled: FormworkPartSpec = { ...panel(900), provenance: 'modified' }
    const lines = bomLines(withMarks([panel(0), drilled]))

    expect(lines).toHaveLength(2)
    expect(lines.map((line) => line.provenance).sort()).toEqual(['modified', 'standard'])
  })

  test('a substitution reaches the bill as its own line', () => {
    const parts = withMarks([panel(0), panel(900)])
    const applied = applyPartOverrides(parts, {
      [parts[0]?.mark as string]: { catalogId: 'framax-2700-750' },
    })

    expect(bomLines(applied)).toHaveLength(2)
  })

  test('two site-cut boards of different sizes stay on separate lines', () => {
    const board = (widthMm: number): FormworkPartSpec => ({
      kind: 'ply-piece',
      use: 'cut-board',
      locus: { on: 'run', face: 'side-a', stationMm: widthMm },
      description: `Cut board ${widthMm} × 2700 mm`,
      provenance: 'bespoke',
      widthMm,
      heightMm: 2700,
    })

    // Collapsing them would bill "2 boards" of no stated size, which is not a cut list.
    expect(bomLines(withMarks([board(137), board(240)]))).toHaveLength(2)
  })

  test('an omitted part leaves the quantities and the marks', () => {
    const parts = withMarks([panel(0), panel(900)])
    const applied = applyPartOverrides(parts, { [parts[0]?.mark as string]: { omitted: true } })
    const [line] = bomLines(applied)

    expect(line?.quantity).toBe(1)
    expect(line?.marks).toEqual([parts[1]?.mark as string])
  })

  test('a consumable is billed in its own unit and its own quantity', () => {
    const [line] = bomLines(
      withMarks([
        {
          kind: 'consumable',
          locus: { on: 'item', use: 'release-agent' },
          description: 'Release agent',
          provenance: 'standard',
          quantity: 12,
          unit: 'L',
        },
      ]),
    )

    expect(line?.quantity).toBe(12)
    expect(line?.unit).toBe('L')
  })

  test('quantity is one for everything that is not counted in bulk', () => {
    expect(partQuantity(withMarks([panel(0)])[0] as FormworkPart)).toBe(1)
  })

  test('lines come out in bill order — the face first, then what holds it', () => {
    const lines = bomLines(
      withMarks([
        {
          kind: 'tie',
          locus: { on: 'elevation', elevationMm: 500 },
          description: 'DW15 tie rod',
          provenance: 'standard',
          lengthMm: 1000,
          forceKn: 40,
          capacityKn: 90,
          capacityComponent: 'rod',
        },
        panel(0),
      ]),
    )

    expect(lines.map((line) => line.kind)).toEqual(['panel', 'tie'])
  })

  test('weight is per part times quantity', () => {
    const [line] = bomLines(withMarks([panel(0), panel(900)]))

    expect(line?.totalWeightKg).toBe(172)
    expect(bomWeightKg(bomLines(withMarks([panel(0), panel(900)])))).toEqual({
      totalKg: 172,
      complete: true,
    })
  })

  test('one unstated weight voids the line total rather than counting as zero', () => {
    const unweighed = { ...panel(900), weightKg: undefined }
    const [line] = bomLines(withMarks([panel(0), unweighed]))

    // A partial total is worse than none: it reads as the whole weight and is short.
    expect(line?.totalWeightKg).toBeUndefined()
    expect(bomWeightKg(bomLines(withMarks([panel(0), unweighed])))).toEqual({
      totalKg: 0,
      complete: false,
    })
  })

  test('an incomplete line does not silently reduce a total that has other lines', () => {
    const tie: FormworkPartSpec = {
      kind: 'tie',
      locus: { on: 'elevation', elevationMm: 500 },
      description: 'DW15 tie rod',
      provenance: 'standard',
      lengthMm: 1000,
      forceKn: 40,
      capacityKn: 90,
      capacityComponent: 'rod',
    }

    expect(bomWeightKg(bomLines(withMarks([panel(0), tie])))).toEqual({
      totalKg: 86,
      complete: false,
    })
  })
})

describe('what the structural figures are for', () => {
  function waler(utilisation: number, stationMm: number): FormworkPartSpec {
    return {
      kind: 'waler',
      member: 'waler',
      locus: { on: 'elevation', face: 'side-a', elevationMm: 500, stationMm },
      description: 'H20 waler',
      provenance: 'standard',
      lengthMm: 3000,
      structure: { utilisation, governingCheck: 'bending' },
    }
  }

  test('the worst part is the one a summary leads with', () => {
    const parts = withMarks([waler(0.4, 0), waler(1.2, 900), waler(0.9, 1800)])

    expect(worstUtilisation(parts)?.utilisation).toBe(1.2)
  })

  test('an omitted part is not the worst — it is not being built', () => {
    const parts = withMarks([waler(0.4, 0), waler(1.2, 900)])
    const applied = applyPartOverrides(parts, { [parts[1]?.mark as string]: { omitted: true } })

    expect(worstUtilisation(applied)?.utilisation).toBe(0.4)
  })

  test('parts with no structural figure do not count as zero-utilised', () => {
    expect(worstUtilisation(withMarks([panel(0)]))).toBeUndefined()
  })

  test('over capacity is what a validator reports', () => {
    const over = overUtilisedParts(withMarks([waler(0.99, 0), waler(1.01, 900)]))

    expect(over).toHaveLength(1)
    expect(over[0]?.structure?.utilisation).toBe(1.01)
  })

  test('an omitted overloaded part is not reported — nobody is erecting it', () => {
    const parts = withMarks([waler(1.4, 0)])
    const applied = applyPartOverrides(parts, { [parts[0]?.mark as string]: { omitted: true } })

    expect(overUtilisedParts(applied)).toEqual([])
  })
})

describe('lookup', () => {
  test('a part is found by its mark', () => {
    const parts = withMarks([panel(0), panel(900)])

    expect(partByMark(parts, parts[1]?.mark)).toEqual(parts[1] as FormworkPart)
  })

  test('nothing selected finds nothing', () => {
    expect(partByMark(withMarks([panel(0)]), undefined)).toBeUndefined()
  })

  test('a mark that is not there finds nothing rather than the first part', () => {
    expect(partByMark(withMarks([panel(0)]), 'P-A-1-99999')).toBeUndefined()
  })
})
