// @ts-expect-error — bun:test is provided by the Bun runtime; viewer does not
// include Bun ambient types in its production declaration build.
import { beforeEach, describe, expect, test } from 'bun:test'
import { requestGodScaleReset, useGodScaleView } from './god-mode-view-store'

describe('God-scale reset requests', () => {
  beforeEach(() => useGodScaleView.setState({ resetRequest: 0 }))

  test('publishes every reset request', () => {
    requestGodScaleReset()
    requestGodScaleReset()

    expect(useGodScaleView.getState().resetRequest).toBe(2)
  })
})
