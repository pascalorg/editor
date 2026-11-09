import { beforeEach, describe, expect, test } from 'bun:test'
import useRoofPlacementMode from './roof-placement-mode'

describe('roof placement mode', () => {
  beforeEach(() => useRoofPlacementMode.setState({ mode: 'auto' }))

  test('cycles through auto, ground, and roof placement', () => {
    const state = useRoofPlacementMode.getState()
    state.cycleMode()
    expect(useRoofPlacementMode.getState().mode).toBe('ground')
    useRoofPlacementMode.getState().cycleMode()
    expect(useRoofPlacementMode.getState().mode).toBe('roof')
    useRoofPlacementMode.getState().cycleMode()
    expect(useRoofPlacementMode.getState().mode).toBe('auto')
  })
})
