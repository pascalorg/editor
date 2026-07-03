import { describe, expect, test } from 'bun:test'
import { resolveOpeningCommitDraft } from './opening-click-draft'

describe('resolveOpeningCommitDraft', () => {
  test('keeps the active transient draft for commit', () => {
    const draft = { id: 'door_draft' }

    expect(resolveOpeningCommitDraft(draft)).toBe(draft)
  })

  test('does not synthesize defaults when the transient draft is missing', () => {
    expect(resolveOpeningCommitDraft(null)).toBeNull()
    expect(resolveOpeningCommitDraft(undefined)).toBeNull()
  })
})
