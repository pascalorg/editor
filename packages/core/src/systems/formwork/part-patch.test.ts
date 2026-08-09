import { describe, expect, test } from 'bun:test'
import type { FormworkPartOverride } from '../../schema/nodes/formwork-assembly'
import { applyFormworkPartPatch, noFormworkAssembly, unknownPartMark } from './part-patch'

/**
 * The per-part write contract every AI surface shares.
 *
 * `parts.test.ts` owns what an override does to a solved part, and the merge itself is
 * `mergeFormworkPartOverride`'s. What is asserted here is the layer above both: what an
 * *agent* is allowed to say, what it means by `null`, which catalog ids are real, and
 * which of two refusals a caller gets. Each of those fails silently on the surface that
 * gets it wrong — a bad catalog id is accepted and quietly designed around, a cleared
 * field leaves an empty record that reads as somebody's forgotten decision, and a merged
 * refusal sends the agent to the wrong remedy while looking perfectly helpful.
 */

const MARK = 'P-A-1-01800'
const REAL_CATALOG_ID = 'eurex-20-top'

const current = (fields: Partial<FormworkPartOverride>): Record<string, FormworkPartOverride> => ({
  [MARK]: fields,
})

describe('the per-part write contract', () => {
  test('a call that states nothing is refused rather than recorded as a no-op', () => {
    // Otherwise the reply is "ok" over a project that changed nothing, and the model
    // moves on believing the substitution it meant to make is on the drawing.
    const result = applyFormworkPartPatch(undefined, { mark: MARK })

    expect(result.error).toContain('nothing to set')
    expect(result.overrides).toBeUndefined()
  })

  test('a catalog id that names nothing is refused, not designed around', () => {
    // The failure this check exists for is silent: the design chain falls back to its own
    // default part, so the project would believe it had specified a beam while every span
    // was solved against another.
    const result = applyFormworkPartPatch(undefined, { mark: MARK, catalogId: 'peri-h20' })

    expect(result.error).toContain('peri-h20')
    expect(result.overrides).toBeUndefined()
  })

  test('a real catalog id is recorded, and read back in the words the reply uses', () => {
    const result = applyFormworkPartPatch(undefined, { mark: MARK, catalogId: REAL_CATALOG_ID })

    expect(result.overrides?.[MARK]).toEqual({ catalogId: REAL_CATALOG_ID })
    expect(result.recorded).toEqual([`now ${REAL_CATALOG_ID}`])
  })

  test('null hands a field back rather than storing it', () => {
    // The third state. An agent needs to set a field, leave it alone, or clear it, where
    // the record has only two — so `null` has to mean something distinct from absent.
    const result = applyFormworkPartPatch(current({ catalogId: REAL_CATALOG_ID, omitted: true }), {
      mark: MARK,
      catalogId: null,
    })

    expect(result.overrides?.[MARK]).toEqual({ omitted: true })
    expect(result.recorded).toEqual(['substitution cleared'])
  })

  test('an absent field is left alone, so one edit does not clear another', () => {
    const result = applyFormworkPartPatch(current({ catalogId: REAL_CATALOG_ID }), {
      mark: MARK,
      note: 'damaged, swapped on site',
    })

    expect(result.overrides?.[MARK]).toEqual({
      catalogId: REAL_CATALOG_ID,
      note: 'damaged, swapped on site',
    })
  })

  test('clearing the last field removes the mark rather than leaving an empty record', () => {
    // An emptied record is still a key against a mark, and a key that cannot be resolved
    // is reported as a stale edit — against a part nobody is any longer editing.
    const result = applyFormworkPartPatch(current({ omitted: true }), {
      mark: MARK,
      omitted: false,
    })

    expect(result.overrides).toEqual({})
    expect(result.recorded).toEqual(['back on the order'])
  })

  test('an empty note reads as cleared, not as recorded', () => {
    // The merge deletes '' the same way it deletes null, so "note recorded" over it would
    // leave the user believing the drawing carries a reason it does not.
    const result = applyFormworkPartPatch(current({ note: 'why' }), { mark: MARK, note: '' })

    expect(result.overrides).toEqual({})
    expect(result.recorded).toEqual(['note cleared'])
  })

  test('another mark on the same assembly is untouched', () => {
    const result = applyFormworkPartPatch(
      { ...current({ omitted: true }), 'T-A-1-00900': { note: 'strut instead' } },
      { mark: MARK, catalogId: REAL_CATALOG_ID },
    )

    expect(result.overrides?.['T-A-1-00900']).toEqual({ note: 'strut instead' })
  })

  test('the two refusals send the agent to different places', () => {
    // A wrong mark on a shuttered wall is a lookup to redo; an unshuttered element needs
    // other calls first. Merged into one sentence, one of the two is always wrong.
    expect(unknownPartMark('wall_1', MARK, 94)).toContain('inspect_formwork_parts')
    expect(unknownPartMark('wall_1', MARK, 94)).toContain('94 parts')
    expect(unknownPartMark('wall_1', MARK, 94)).not.toContain('attach_formwork')

    expect(noFormworkAssembly('wall_1', MARK)).toContain('attach_formwork')
    expect(noFormworkAssembly('wall_1', MARK)).toContain(MARK)
    // The read has no mark to name, and needs the construction stated before a shutter
    // can be attached at all.
    expect(noFormworkAssembly('wall_1')).toContain('set_element_construction')
    expect(noFormworkAssembly('wall_1')).not.toContain(MARK)
  })
})
