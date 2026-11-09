import { describe, expect, test } from 'bun:test'
import { useEditor } from '@pascal-app/editor'
import {
  findAccessoryPort,
  snapAccessoryPoint,
  subscribeAccessorySnapping,
} from './accessory-snapping'

describe('accessory snapping', () => {
  test('off disables port attraction and surface placement considers height', () => {
    const port = {
      nodeId: 'duct-segment_test' as const,
      id: 'end',
      position: [0, 2, 0] as [number, number, number],
      direction: [1, 0, 0] as [number, number, number],
    }
    expect(findAccessoryPort([0, 2, 0], [port], false, true)).toBeNull()
    expect(findAccessoryPort([0, 0, 0], [port], true, true)).toBeNull()
    expect(findAccessoryPort([0, 1.8, 0], [port], true, true)).toBe(port)
    expect(findAccessoryPort([0, 0, 0], [port], true, false)).toBe(port)
  })

  test('off preserves the cursor and spacing changes affect grid placement', () => {
    const point: [number, number, number] = [0.36, 1.83, 0.14]
    expect(snapAccessoryPoint(point, 0)).toEqual(point)
    expect(snapAccessoryPoint(point, 0.5)).toEqual([0.5, 1.83, 0])
    expect(snapAccessoryPoint(point, 0.1)[0]).toBeCloseTo(0.4)
  })

  test('wall and ceiling snapping stays on the picked face', () => {
    expect(snapAccessoryPoint([0.36, 1.83, 0.14], 0.5, [0, 0, 1])).toEqual([0.5, 2, 0.14])
    expect(snapAccessoryPoint([0.36, 2.83, 0.14], 0.5, [0, 1, 0])).toEqual([0.5, 2.83, 0])
    const point: [number, number, number] = [0.36, 1.83, 0.14]
    const snapped = snapAccessoryPoint(point, 0.5, [1, 0, 1])
    expect(snapped[0] + snapped[2]).toBeCloseTo(point[0] + point[2])
  })

  test('settings changes refresh the stationary preview and cleanup stops refreshes', () => {
    const original = useEditor.getState()
    let refreshes = 0
    const unsubscribe = subscribeAccessorySnapping(() => {
      refreshes++
    })
    try {
      useEditor.setState({ gridSnapStep: original.gridSnapStep === 0.1 ? 0.5 : 0.1 })
      useEditor.setState({
        snappingModeByContext: { ...original.snappingModeByContext, item: 'off' },
      })
      expect(refreshes).toBe(2)
      unsubscribe()
      useEditor.setState({ gridSnapStep: original.gridSnapStep })
      expect(refreshes).toBe(2)
    } finally {
      unsubscribe()
      useEditor.setState({
        gridSnapStep: original.gridSnapStep,
        snappingModeByContext: original.snappingModeByContext,
      })
    }
  })
})
