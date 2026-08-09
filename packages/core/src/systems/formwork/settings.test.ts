import { describe, expect, it } from 'bun:test'
import type { FormworkProjectSettingsNode } from '../../schema/nodes/formwork-project-settings'
import { DEFAULT_FORMWORK_SETTINGS, formworkSettings, mergeFormworkOwnedStock } from './settings'

/**
 * What the project stated, and what it merely has not said.
 *
 * Every case here is a way of losing that distinction, and each one loses it silently:
 * a merge that forgets the rest of the rack, a zero folded into absence, an emptied
 * group that reads as unstated. None of them fail — they all produce a stock list that
 * looks plausible and puts the wrong quantity on hire.
 */

const node = (overrides: Partial<FormworkProjectSettingsNode> = {}): FormworkProjectSettingsNode =>
  ({
    object: 'node',
    id: 'formwork-settings_test',
    type: 'formwork-settings',
    parentId: 'site_test',
    visible: true,
    metadata: {},
    children: [],
    ...overrides,
  }) as FormworkProjectSettingsNode

describe('mergeFormworkOwnedStock', () => {
  it('keeps the rest of the rack when one type is recorded', () => {
    // The failure the helper exists for. A stock list is edited one line at a time, and
    // the one-level merge would overwrite `owned` wholesale — so recording 40 of one
    // panel would tell the project it no longer owns the 200 it had.
    const merged = mergeFormworkOwnedStock(
      { owned: { 'panel-a': 200, 'prop-b': 300 } },
      {
        'panel-c': 40,
      },
    )

    expect(merged.owned).toEqual({ 'panel-a': 200, 'prop-b': 300, 'panel-c': 40 })
  })

  it('overwrites a type the rack already lists', () => {
    const merged = mergeFormworkOwnedStock({ owned: { 'panel-a': 200 } }, { 'panel-a': 260 })

    expect(merged.owned).toEqual({ 'panel-a': 260 })
  })

  it('removes a type on undefined', () => {
    // How a yard says it no longer owns the type at all — sold, scrapped, off the books.
    const merged = mergeFormworkOwnedStock(
      { owned: { 'panel-a': 200, 'prop-b': 300 } },
      { 'panel-a': undefined },
    )

    expect(merged.owned).toEqual({ 'prop-b': 300 })
  })

  it('keeps a stated zero rather than folding it into absence', () => {
    // "We own none of these" is a fact about a type a yard has run out of, and it is
    // the answer to a question somebody asked. Deleted, it becomes "nobody has said".
    const merged = mergeFormworkOwnedStock({ owned: { 'panel-a': 200 } }, { 'panel-a': 0 })

    expect(merged.owned).toEqual({ 'panel-a': 0 })
  })

  it('starts a rack from an absent group', () => {
    const merged = mergeFormworkOwnedStock(undefined, { 'panel-a': 200 })

    expect(merged.owned).toEqual({ 'panel-a': 200 })
  })

  it('leaves a stated-empty rack rather than deleting the group', () => {
    // Deliberately unlike `mergeFormworkCement`, which drops an emptied spec. A project
    // that has removed every line from its rack has *stated* it owns nothing; collapsing
    // that to an absent group turns the statement back into silence and the whole bill
    // back onto hire.
    const merged = mergeFormworkOwnedStock({ owned: { 'panel-a': 200 } }, { 'panel-a': undefined })

    expect(merged).toEqual({ owned: {} })
  })
})

describe('formworkSettings owned stock', () => {
  it('leaves the stock unresolved where the project has not stated one', () => {
    // The one resolved field with no default, against the rule every other field here
    // follows. `{}` would be the claim "owns nothing", which no unconfigured project has
    // made and which puts an entire bill on hire.
    expect(formworkSettings(node()).ownedStock).toBeUndefined()
    expect(DEFAULT_FORMWORK_SETTINGS.ownedStock).toBeUndefined()
  })

  it('resolves a stated-empty rack to an empty record, not to unstated', () => {
    // The distinction has to survive resolution or nothing downstream can act on it.
    expect(formworkSettings(node({ stock: { owned: {} } })).ownedStock).toEqual({})
  })

  it('passes the stated rack through', () => {
    expect(formworkSettings(node({ stock: { owned: { 'panel-a': 200 } } })).ownedStock).toEqual({
      'panel-a': 200,
    })
  })

  it('reads a stock group holding no owned record as unstated', () => {
    // `stock: {}` is a group that exists with nothing in it — reached by a patch that
    // set some future sibling field. Nobody has said what the yard owns.
    expect(formworkSettings(node({ stock: {} })).ownedStock).toBeUndefined()
  })
})
