import { beforeEach, expect, test } from 'bun:test'
import {
  clearSceneHistory,
  emitter,
  type GridEvent,
  RockNode,
  SiteNode,
  useLiveNodeOverrides,
  useScene,
} from '@pascal-app/core'
import { sceneLayout, useEditor, useInteractionScope } from '@pascal-app/editor'
import { useViewer } from '@pascal-app/viewer'
import { act } from '@react-three/test-renderer'
import { Vector3 } from 'three'
import { installMountedScene, mount, settle } from '../__tests__/harness'
import RockSelectionAffordance from './boundary-editor'
import { rockDefinition } from './definition'

// Dragging a corner of a rock's footprint by hand: the corner goes as far as the pointer went on
// the ground, from where it stood. A handle is held above the ground the pointer is measured on,
// so at the press the ground under the pointer can be metres behind the corner (a low camera, a
// slope); the corner must not be thrown there.
installMountedScene({ nodes: [rockDefinition] })

const polygon: [number, number][] = [
  [-2, -2],
  [2, -2],
  [2, 2],
  [-2, 2],
]

/** A 15 % slope rising along x: 0 m at x = -20, one sample per metre, 1 cm steps. */
function slope() {
  const side = 41
  const samples = new Int16Array(side * side)
  for (let row = 0; row < side; row++)
    for (let col = 0; col < side; col++) samples[row * side + col] = col * 15
  return {
    type: 'heightfield' as const,
    origin: [-20, -20] as [number, number],
    spacing: 1,
    cols: side,
    rows: side,
    step: 0.01,
    heights: Buffer.from(samples.buffer).toString('base64'),
  }
}

const GROUNDS = {
  // The Site's flat ground sits 5 cm under the datum.
  flat: { terrain: undefined, lowest: -0.05 },
  // Under the footprint the ground runs from 2.7 m (x = -2) to 3.3 m (x = 2).
  slope: { terrain: slope(), lowest: 2.7 },
}

let rock: RockNode
function seed(ground: keyof typeof GROUNDS) {
  const site = SiteNode.parse({ terrain: GROUNDS[ground].terrain })
  rock = RockNode.parse({ parentId: site.id, polygon, gen: 2 })
  useScene.setState({
    nodes: { [site.id]: { ...site, children: [rock.id] }, [rock.id]: rock },
    rootNodeIds: [site.id],
    dirtyNodes: new Set(),
    readOnly: false,
  })
  useScene.temporal.getState().resume()
  clearSceneHistory()
}

beforeEach(() => {
  useInteractionScope.getState().end()
  useLiveNodeOverrides.getState().clearAll()
  useEditor.setState({
    mode: 'select',
    tool: null,
    workspaceMode: 'edit',
    viewLayouts: { edit: sceneLayout('3d') },
    gridSnapStep: 0.5,
  })
  useEditor.getState().setSnappingMode('polygon', 'off')
  window.requestAnimationFrame = globalThis.requestAnimationFrame
  window.cancelAnimationFrame = globalThis.cancelAnimationFrame
})

const pointerOnGround = (x: number, z: number) =>
  act(async () => {
    emitter.emit('grid:move', {
      position: [x, 0, z],
      localPosition: [x, 0, z],
      nativeEvent: { altKey: true },
    } as GridEvent)
  })

for (const ground of ['flat', 'slope'] as const) {
  test(`on ${ground} ground a corner handle stands on the ground and follows a small pointer move by as much`, async () => {
    seed(ground)
    useViewer.getState().setSelection({ selectedIds: [rock.id] })
    const renderer = await mount(<RockSelectionAffordance node={rock} readOnly={false} />)
    await settle(renderer)
    const corner = renderer.scene
      .findAll((entry) => typeof entry.props.onPointerDown === 'function')
      .find((entry) => {
        const at = entry.instance.getWorldPosition(new Vector3())
        return Math.abs(at.x - 2) < 1e-6 && Math.abs(at.z - 2) < 1e-6
      })
    if (!corner) throw new Error('Missing the corner handle')
    // The handle is a short marker on the rock's ground, not a post from the world datum.
    const standsAt = corner.instance.getWorldPosition(new Vector3()).y
    expect(standsAt).toBeGreaterThan(GROUNDS[ground].lowest)
    expect(standsAt).toBeLessThan(GROUNDS[ground].lowest + 0.2)

    // The pointer rests on the handle; the ground under it lies 3.4 m behind the corner.
    await pointerOnGround(5, 3.5)
    await renderer.fireEvent(corner, 'pointerDown', {
      button: 0,
      pointerId: 1,
      point: new Vector3(2, standsAt, 2),
      nativeEvent: { button: 0, stopPropagation() {}, stopImmediatePropagation() {} },
      stopPropagation() {},
    })
    for (const [dx, dz] of [
      [0.05, 0],
      [0.1, 0.02],
      [0.4, -0.3],
    ] as const) {
      await pointerOnGround(5 + dx, 3.5 + dz)
      const moved = useLiveNodeOverrides.getState().get(rock.id)?.polygon?.[2]
      expect(moved?.[0]).toBeCloseTo(2 + dx, 9)
      expect(moved?.[1]).toBeCloseTo(2 + dz, 9)
    }
    // The other corners did not move.
    expect(useLiveNodeOverrides.getState().get(rock.id)?.polygon?.slice(0, 2)).toEqual(
      polygon.slice(0, 2),
    )
    await act(async () =>
      window.dispatchEvent(
        Object.assign(new Event('pointerup', { cancelable: true }), { pointerId: 1 }),
      ),
    )
    await settle(renderer)
    const saved = (useScene.getState().nodes[rock.id] as RockNode).polygon[2]
    expect(saved?.[0]).toBeCloseTo(2.4, 9)
    expect(saved?.[1]).toBeCloseTo(1.7, 9)
    expect(useScene.temporal.getState().pastStates).toHaveLength(1)
  })
}
