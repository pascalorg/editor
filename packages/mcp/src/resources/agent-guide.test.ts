import { describe, expect, test } from 'bun:test'
import { AGENT_GUIDE } from './agent-guide'

/** A recipe voice: an order of work, a required step, a method mandate. */
const MANDATE =
  /\bmust\b|\bfirst\b.*\bcall\b|Standard Workflow|Required Final Checks|Prefer semantic tools|Do not hand-write/i
/** A bullet that opens with an order. */
const ORDER = /^- (Call|Use|Prefer|Do not|Always|Never|Then|Read|Return|Leave|Let) /

/** Lines that say what must hold for a call to be accepted: contracts, not method. */
const CONTRACT_LINES = [
  // add_terrain_break's input rules.
  '- `add_terrain_break` adds a vertical cliff',
  // group_nodes' contract on generated cladding.
  'Generated cladding must be copied before it can group independently',
]

const lines = AGENT_GUIDE.split('\n')
const isContract = (line: string) => CONTRACT_LINES.some((marker) => line.includes(marker))

describe('the MCP agent guide is a glossary, not a recipe (owner, 15 Oct)', () => {
  test('no line is a mandate, but the contract lines named here', () => {
    const mandates = lines.filter((line) => MANDATE.test(line) && !isContract(line))
    expect(mandates).toEqual([])
  })

  test('each contract line still says what must hold', () => {
    for (const marker of CONTRACT_LINES) {
      const line = lines.find((candidate) => candidate.includes(marker))
      expect(line).toBeDefined()
      expect(line).toMatch(MANDATE)
    }
  })

  test('no bullet opens with an order', () => {
    expect(lines.filter((line) => ORDER.test(line))).toEqual([])
  })

  test('what a request leaves open in form is design left to the agent', () => {
    expect(AGENT_GUIDE).toContain('design left to the agent')
  })

  test('the request is the constraint, and the sources of a scene stand side by side', () => {
    expect(AGENT_GUIDE).toContain('binds the work exactly')
    expect(AGENT_GUIDE).toContain('the size and number of storeys')
    const sources = AGENT_GUIDE.match(/has these sources, side by side:.*$/m)?.[0] ?? ''
    for (const tool of [
      'search_assets',
      'place_items',
      'furnish_room',
      'place_design',
      'validate_design',
      'add_object',
      'paint',
      'generate_material',
    ]) {
      expect(sources).toContain(`\`${tool}\``)
    }
    expect(sources).toContain('limited set that varies by server')
  })

  test('no source is ranked ahead of the others, and no line says when to stop', () => {
    expect(AGENT_GUIDE).not.toMatch(
      /\botherwise create\b|when catalog .{0,30}do not fit|catalog (first|before)|reply now|if the request is fulfilled/i,
    )
  })

  test('the editorUrl is stated as a fact about the output', () => {
    expect(AGENT_GUIDE).toContain('`editorUrl`')
    expect(AGENT_GUIDE).toMatch(/final response to the person is made of:.*`editorUrl`/)
  })
})
