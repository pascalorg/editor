// TZ must be set BEFORE ./index is loaded, so these tests import it dynamically
// inside each case (static imports hoist above this assignment and would run the
// date engine in the host zone, making both DST tests pass everywhere while
// asserting nothing). Only meaningful under vitest's default per-file isolation,
// since process.env.TZ is process-global.
process.env.TZ = 'America/New_York'
declare const process: { env: Record<string, string | undefined> }

import { describe, expect, it } from 'vitest'

describe('date DST behavior', () => {
  it('adds calendar days as wall-clock days across spring forward', async () => {
    const { parseDate } = await import('./index')
    const now = new Date(2026, 2, 7, 9, 0, 0)
    const result = parseDate('in 1 day', { now })
    if (!result.ok) {
      throw new Error(`parse failed: ${JSON.stringify(result.issues)}`)
    }
    expect(result.date).toEqual(new Date(2026, 2, 8, 9, 0, 0))
    expect(result.date.getTime() - now.getTime()).toBe(23 * 3_600_000)
  }, 30_000)

  it('humanizes exactly-24h calendar yesterday across spring forward', async () => {
    const { humanizeDate } = await import('./index')
    const now = new Date(2026, 2, 8, 9, 0, 0)
    const yesterday = new Date(2026, 2, 7, 9, 0, 0)
    expect(humanizeDate(yesterday, { now })).toBe('yesterday')
  }, 30_000)
})
