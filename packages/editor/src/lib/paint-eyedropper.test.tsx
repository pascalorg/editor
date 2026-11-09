import { expect, test } from 'bun:test'
import {
  type AnyNode,
  nodeRegistry,
  registerNode,
  SlabNode,
  useScene,
  WallNode,
} from '@pascal-app/core'
import { useNodeEvents, useViewer } from '@pascal-app/viewer'
import { _roots, act, events } from '@react-three/fiber'
import type { OrthographicCamera } from 'three'
import { z } from 'zod'
import { SelectionManager, useEditor } from '../index'
import { withSelectionHarness } from '../test-utils/selection-harness'
import { resetPaintMode, usePaintRegionMode } from './paint-region-mode'

const picked = { materialPreset: 'library:wall-red', sourceTarget: 'wall' } as const

function Surface({ node }: { node: AnyNode }) {
  const wall = node.type === 'wall'
  return (
    <mesh
      {...useNodeEvents(node, node.type)}
      name={node.id}
      position={wall ? [0, 1.5, 0] : [0, 0, 0]}
      rotation={wall ? [0, 0, 0] : [-Math.PI / 2, 0, 0]}
    >
      <planeGeometry args={wall ? [20, 3] : [20, 20]} />
      <meshBasicMaterial />
    </mesh>
  )
}

for (const activation of ['icon', 'Alt'] as const) {
  test(`${activation} eyedrop consumes the front wall click; only the next click paints the slab behind`, async () => {
    const restoreRegistry = nodeRegistry._snapshot()
    const previousPaint = usePaintRegionMode.getState()
    const previousDocument = globalThis.document
    const previousCancel = globalThis.cancelAnimationFrame
    globalThis.cancelAnimationFrame = () => {}
    globalThis.document = { body: { style: { cursor: '' } } } as unknown as Document
    nodeRegistry._reset()
    const writes: string[] = []
    try {
      for (const kind of ['wall', 'slab']) {
        registerNode({
          kind,
          schemaVersion: 1,
          schema: z.object({ type: z.literal(kind) }) as never,
          category: 'structure',
          defaults: () => ({}),
          capabilities: {
            slots: () => [{ slotId: 'default', label: 'Surface' }],
            paint: {
              resolveRole: () => 'default',
              getEffectiveMaterial: () => ({
                material: undefined,
                materialPreset: picked.materialPreset,
              }),
              buildPatch: ({ materialPreset }) => ({ materialPreset }) as Partial<AnyNode>,
              commit: ({ node, materialPreset }) => {
                writes.push(node.id)
                useScene.getState().updateNode(node.id, { materialPreset } as Partial<AnyNode>)
              },
              applyPreview: () => () => {},
            },
          },
        })
      }
      await withSelectionHarness(async ({ canvas, render }) => {
        const wall = WallNode.parse({ id: 'wall_front', start: [-10, 0], end: [10, 0] })
        const slab = SlabNode.parse({
          id: 'slab_behind',
          polygon: [
            [-10, -10],
            [10, -10],
            [10, 10],
            [-10, 10],
          ],
        })
        useScene.setState({ nodes: { [wall.id]: wall, [slab.id]: slab }, readOnly: false })
        useViewer.getState().resetSelection()
        useViewer.setState({ cameraDragging: false, inputDragging: false })
        resetPaintMode()
        useEditor.getState().armMaterialPaint(undefined, activation === 'icon' ? 'pick' : 'surface')
        await render(
          <>
            <SelectionManager />
            <Surface node={wall} />
            <Surface node={slab} />
          </>,
        )
        if (activation === 'Alt') {
          await act(async () => {
            window.dispatchEvent(Object.assign(new Event('keydown'), { key: 'Alt', repeat: false }))
          })
        }
        expect(usePaintRegionMode.getState().mode).toBe('pick')
        const store = _roots.get(canvas)!.store
        const state = store.getState()
        const camera = state.camera as OrthographicCamera
        Object.assign(camera, { left: -5, right: 5, top: 5, bottom: -5 })
        camera.position.set(0, 5, 10)
        camera.up.set(0, 1, 0)
        camera.lookAt(0, 1, 0)
        camera.updateProjectionMatrix()
        camera.updateMatrixWorld(true)
        state.setEvents(events(store))
        state.scene.updateMatrixWorld(true)
        const send = async (type: 'onPointerMove' | 'onPointerDown' | 'onPointerUp') => {
          await act(async () => {
            store.getState().events.handlers![type]({
              offsetX: 500,
              offsetY: 500,
              clientX: 500,
              clientY: 500,
              button: 0,
              pointerId: 1,
              target: canvas,
              type,
            } as unknown as PointerEvent)
          })
        }
        // Hover first: sampling synchronously replays this event when it returns to paint.
        await send('onPointerMove')
        expect(useViewer.getState().hoveredId).toBe(wall.id)
        const hits = state.raycaster.intersectObjects(state.internal.interaction, true)
        expect([...new Set(hits.map((hit) => hit.object.name))]).toEqual([wall.id, slab.id])
        const before = useScene.getState().nodes
        await send('onPointerDown')
        await send('onPointerUp')
        expect(useEditor.getState().activePaintMaterial).toEqual(picked)
        expect(usePaintRegionMode.getState().mode).toBe('surface')
        expect(writes).toEqual([])
        expect(useScene.getState().nodes).toBe(before)
        if (activation === 'Alt') {
          await act(async () =>
            window.dispatchEvent(Object.assign(new Event('keyup'), { key: 'Alt' })),
          )
        }
        // Expose the slab at the same cursor, then prove the next gesture paints once.
        await render(
          <>
            <SelectionManager />
            <Surface node={slab} />
          </>,
        )
        state.scene.updateMatrixWorld(true)
        await send('onPointerMove')
        await send('onPointerDown')
        await send('onPointerUp')
        expect(writes).toEqual([slab.id])
        expect((useScene.getState().nodes[slab.id] as SlabNode).materialPreset).toBe(
          picked.materialPreset,
        )
      })
    } finally {
      restoreRegistry()
      usePaintRegionMode.setState(previousPaint)
      globalThis.document = previousDocument
      globalThis.cancelAnimationFrame = previousCancel
    }
  })
}
