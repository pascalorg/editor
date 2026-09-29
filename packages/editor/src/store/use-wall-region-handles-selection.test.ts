import { afterAll, beforeEach, describe, expect, test } from 'bun:test'
import { type AnyNodeId, useScene, WallNode } from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import useInteractionScope from './use-interaction-scope'
import {
  handleWallRegionDeleteKey,
  installWallRegionSceneSync,
  resolveActiveWallRegion,
  syncWallRegionSelection,
  useWallRegionSelection,
} from './use-wall-region-handles-selection'

type RafFn = (callback: (time: number) => void) => number
;(globalThis as { requestAnimationFrame?: RafFn }).requestAnimationFrame ??= (callback) => {
  callback(0)
  return 0
}
;(globalThis as { cancelAnimationFrame?: (id: number) => void }).cancelAnimationFrame ??= () => {}

const WALL_ID = 'wall_region-selection' as AnyNodeId
const OTHER_WALL_ID = 'wall_region-selection-other' as AnyNodeId

function keyEvent(key: string, target: unknown = null) {
  const calls = { prevented: 0, stopped: 0 }
  return {
    calls,
    event: {
      key,
      target: target as EventTarget | null,
      preventDefault: () => {
        calls.prevented += 1
      },
      stopPropagation: () => {
        calls.stopped += 1
      },
    },
  }
}

// The bun env has no DOM: just enough of `document` and elements for the focus check.
const originalDocument = (globalThis as { document?: unknown }).document
const body = { tagName: 'BODY', closest: () => null }
;(globalThis as { document?: unknown }).document = { body, documentElement: { tagName: 'HTML' } }

function element(tagName: string, ancestors: string[] = []) {
  return {
    tagName,
    closest: (selector: string) => (ancestors.includes(selector) ? {} : null),
  }
}

const uninstallSceneSync = installWallRegionSceneSync()

const wall = () => useScene.getState().nodes[WALL_ID] as WallNode | undefined

describe('active wall region', () => {
  beforeEach(() => {
    useScene.setState({ nodes: {}, rootNodeIds: [], dirtyNodes: new Set() } as never)
    for (const id of [WALL_ID, OTHER_WALL_ID]) {
      useScene.getState().createNode(
        WallNode.parse({
          id,
          start: [0, 0],
          end: [4, 0],
          faceRegions: [
            { id: 'r1', face: 'a', v1: 0.9, finish: 'library:paint-white' },
            { id: 'r2', face: 'b', u0: 1, finish: 'library:paint-white' },
          ],
        }),
      )
    }
    useScene.temporal.getState().clear()
    useScene.temporal.getState().resume()
    useViewer.getState().setSelection({ selectedIds: [WALL_ID] })
    useWallRegionSelection.setState({ active: null, stale: null })
    useInteractionScope.getState().end()
  })

  afterAll(() => {
    uninstallSceneSync()
    useWallRegionSelection.setState({ active: null, stale: null })
    useInteractionScope.getState().end()
    useViewer.getState().setSelection({ selectedIds: [] })
    ;(globalThis as { document?: unknown }).document = originalDocument
  })

  test('Delete removes only the active region, as one undo step', () => {
    useWallRegionSelection.getState().setActive({ wallId: WALL_ID, regionId: 'r2' })
    const { event, calls } = keyEvent('Delete')
    expect(handleWallRegionDeleteKey(event)).toBe(true)
    expect(calls).toEqual({ prevented: 1, stopped: 1 })
    expect(wall()).toBeDefined()
    expect(wall()!.faceRegions!.map((region) => region.id)).toEqual(['r1'])
    expect(useWallRegionSelection.getState().active).toBeNull()
    expect(useScene.temporal.getState().pastStates).toHaveLength(1)
    useScene.temporal.getState().undo()
    expect(wall()!.faceRegions!.map((region) => region.id)).toEqual(['r1', 'r2'])
  })

  test('Backspace works too; the last region clears the field', () => {
    useWallRegionSelection.getState().setActive({ wallId: WALL_ID, regionId: 'r1' })
    expect(handleWallRegionDeleteKey(keyEvent('Backspace').event)).toBe(true)
    useWallRegionSelection.getState().setActive({ wallId: WALL_ID, regionId: 'r2' })
    expect(handleWallRegionDeleteKey(keyEvent('Backspace').event)).toBe(true)
    expect(wall()!.faceRegions).toBeUndefined()
  })

  test('without an active region the key passes through to the wall delete', () => {
    const { event, calls } = keyEvent('Delete')
    expect(handleWallRegionDeleteKey(event)).toBe(false)
    expect(calls).toEqual({ prevented: 0, stopped: 0 })
    expect(wall()!.faceRegions).toHaveLength(2)
  })

  test('typing in a field and other keys are left alone', () => {
    useWallRegionSelection.getState().setActive({ wallId: WALL_ID, regionId: 'r1' })
    const input = { closest: (selector: string) => (selector.includes('input') ? {} : null) }
    expect(handleWallRegionDeleteKey(keyEvent('Backspace', input).event)).toBe(false)
    expect(handleWallRegionDeleteKey(keyEvent('Escape').event)).toBe(false)
    expect(wall()!.faceRegions).toHaveLength(2)
  })

  test('an active region on a wall that is no longer selected is ignored and cleared', () => {
    useWallRegionSelection.getState().setActive({ wallId: WALL_ID, regionId: 'r1' })
    useViewer.getState().setSelection({ selectedIds: [OTHER_WALL_ID] })
    expect(resolveActiveWallRegion()).toBeNull()
    expect(handleWallRegionDeleteKey(keyEvent('Delete').event)).toBe(false)
    syncWallRegionSelection([OTHER_WALL_ID])
    expect(useWallRegionSelection.getState().active).toBeNull()
    const other = useScene.getState().nodes[OTHER_WALL_ID] as WallNode
    expect(other.faceRegions).toHaveLength(2)
  })

  test('a selection that still holds just the wall keeps the active region', () => {
    useWallRegionSelection.getState().setActive({ wallId: WALL_ID, regionId: 'r1' })
    syncWallRegionSelection([WALL_ID])
    expect(useWallRegionSelection.getState().active).toEqual({ wallId: WALL_ID, regionId: 'r1' })
    syncWallRegionSelection([WALL_ID, OTHER_WALL_ID])
    expect(useWallRegionSelection.getState().active).toBeNull()
  })

  test('focus on the body or the canvas acts on the region', () => {
    useWallRegionSelection.getState().setActive({ wallId: WALL_ID, regionId: 'r1' })
    expect(handleWallRegionDeleteKey(keyEvent('Delete', body).event)).toBe(true)
    useWallRegionSelection.getState().setActive({ wallId: WALL_ID, regionId: 'r2' })
    expect(handleWallRegionDeleteKey(keyEvent('Delete', element('CANVAS')).event)).toBe(true)
    expect(wall()!.faceRegions).toBeUndefined()
  })

  test('focus on a toolbar button leaves the key alone', () => {
    useWallRegionSelection.getState().setActive({ wallId: WALL_ID, regionId: 'r1' })
    const { event, calls } = keyEvent('Delete', element('BUTTON'))
    expect(handleWallRegionDeleteKey(event)).toBe(false)
    expect(calls).toEqual({ prevented: 0, stopped: 0 })
    expect(wall()!.faceRegions).toHaveLength(2)
  })

  test('focus inside the wall region list acts on the region', () => {
    useWallRegionSelection.getState().setActive({ wallId: WALL_ID, regionId: 'r1' })
    const row = element('BUTTON', ['[data-wall-region-list]'])
    expect(handleWallRegionDeleteKey(keyEvent('Delete', row).event)).toBe(true)
    expect(wall()!.faceRegions!.map((region) => region.id)).toEqual(['r2'])
  })

  test('mid-gesture the key is swallowed: nothing deleted, the wall stays', () => {
    useWallRegionSelection.getState().setActive({ wallId: WALL_ID, regionId: 'r1' })
    useInteractionScope
      .getState()
      .begin({ kind: 'handle-drag', nodeId: WALL_ID, handle: 'paint-region-bound' })
    const { event, calls } = keyEvent('Delete')
    expect(handleWallRegionDeleteKey(event)).toBe(true)
    expect(calls).toEqual({ prevented: 1, stopped: 1 })
    expect(wall()!.faceRegions).toHaveLength(2)
    expect(useWallRegionSelection.getState().active).toEqual({ wallId: WALL_ID, regionId: 'r1' })
  })

  test('mid-gesture without an active region the key passes through', () => {
    useInteractionScope
      .getState()
      .begin({ kind: 'handle-drag', nodeId: WALL_ID, handle: 'paint-region-bound' })
    expect(handleWallRegionDeleteKey(keyEvent('Delete').event)).toBe(false)
  })

  test('a region that vanished under the user swallows the next Delete once', () => {
    useWallRegionSelection.getState().setActive({ wallId: WALL_ID, regionId: 'r1' })
    const regions = wall()!.faceRegions!.filter((region) => region.id !== 'r1')
    useScene.getState().updateNode(WALL_ID, { faceRegions: regions })
    expect(useWallRegionSelection.getState().active).toBeNull()
    expect(useWallRegionSelection.getState().stale).toEqual({ wallId: WALL_ID, regionId: 'r1' })

    const { event, calls } = keyEvent('Delete')
    expect(handleWallRegionDeleteKey(event)).toBe(true)
    expect(calls).toEqual({ prevented: 1, stopped: 1 })
    expect(wall()).toBeDefined()
    expect(wall()!.faceRegions!.map((region) => region.id)).toEqual(['r2'])
    expect(useWallRegionSelection.getState().stale).toBeNull()
    expect(handleWallRegionDeleteKey(keyEvent('Delete').event)).toBe(false)
  })

  test('removing the active region with Delete does not leave it stale', () => {
    useWallRegionSelection.getState().setActive({ wallId: WALL_ID, regionId: 'r1' })
    expect(handleWallRegionDeleteKey(keyEvent('Delete').event)).toBe(true)
    expect(useWallRegionSelection.getState().stale).toBeNull()
    expect(handleWallRegionDeleteKey(keyEvent('Delete').event)).toBe(false)
  })

  test('a selection change clears the stale region, so Delete falls through', () => {
    useWallRegionSelection.getState().setActive({ wallId: WALL_ID, regionId: 'r1' })
    const regions = wall()!.faceRegions!.filter((region) => region.id !== 'r1')
    useScene.getState().updateNode(WALL_ID, { faceRegions: regions })
    expect(useWallRegionSelection.getState().stale).not.toBeNull()

    useViewer.getState().setSelection({ selectedIds: [OTHER_WALL_ID] })
    syncWallRegionSelection([OTHER_WALL_ID])
    useViewer.getState().setSelection({ selectedIds: [WALL_ID] })
    syncWallRegionSelection([WALL_ID])
    expect(useWallRegionSelection.getState().stale).toBeNull()
    const { event, calls } = keyEvent('Delete')
    expect(handleWallRegionDeleteKey(event)).toBe(false)
    expect(calls).toEqual({ prevented: 0, stopped: 0 })
  })
})
