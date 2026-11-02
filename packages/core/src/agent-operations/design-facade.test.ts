import { describe, expect, test } from 'bun:test'
import { FACADE_REVISION_ROWS, facadeBrief } from './__fixtures__/design-facade-cases'
import { facadeRevision } from './design-facade'

describe('a facade revised within the turn', () => {
  test.each(FACADE_REVISION_ROWS)('$name', ({ first, latest, plainer }) => {
    expect(facadeRevision(first, facadeBrief(latest)) !== null).toBe(plainer)
  })
})
