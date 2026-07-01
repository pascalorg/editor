import { describe, expect, test } from 'bun:test'
import { mcpErrorMessage } from './mcp'

describe('MCP errors', () => {
  test('extracts textual tool failure details', () => {
    expect(
      mcpErrorMessage({
        isError: true,
        content: [{ type: 'text', text: 'save_failed: database unavailable' }],
      }),
    ).toBe('save_failed: database unavailable')
  })

  test('falls back when a server omits error details', () => {
    expect(mcpErrorMessage({ isError: true })).toBe('unknown error')
  })
})
