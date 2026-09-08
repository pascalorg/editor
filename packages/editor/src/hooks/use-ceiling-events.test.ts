import { expect, test } from 'bun:test'
import {
  type CeilingEvent,
  CeilingNode,
  emitter,
  LevelNode,
  sceneRegistry,
  useScene,
} from '@pascal-app/core'
import { hideFromScene, showInScene, useViewer } from '@pascal-app/viewer'
import { _roots, act, createRoot } from '@react-three/fiber'
import { createElement } from 'react'
import {
  Mesh,
  MeshBasicMaterial,
  PerspectiveCamera,
  PlaneGeometry,
  type WebGLRenderer,
} from 'three'
import useEditor from '../store/use-editor'
import { useCeilingEvents } from './use-ceiling-events'

test('ceiling-item placement keeps move and commit hits while an unhovered ceiling is batched', async () => {
  const previousViewer = useViewer.getState()
  const previousEditor = useEditor.getState()
  const previousScene = useScene.getState()
  const actGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
  const previousAct = actGlobal.IS_REACT_ACT_ENVIRONMENT
  actGlobal.IS_REACT_ACT_ENVIRONMENT = true
  const canvas = Object.assign(new EventTarget(), {
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 100, height: 100 }),
  }) as unknown as HTMLCanvasElement
  const root = createRoot(canvas)
  const camera = new PerspectiveCamera(60, 1, 0.1, 100)
  camera.position.set(0, 1, 5)
  camera.lookAt(0, 3, 0)
  camera.updateMatrixWorld()
  const level = LevelNode.parse({ id: 'level_ceiling_batch' })
  const ceiling = CeilingNode.parse({
    id: 'ceiling_placement_batch',
    parentId: level.id,
    polygon: [
      [-5, -5],
      [5, -5],
      [5, 5],
      [-5, 5],
    ],
  })
  const surface = new Mesh(new PlaneGeometry(10, 10).rotateX(-Math.PI / 2), new MeshBasicMaterial())
  surface.position.y = 3
  surface.updateMatrixWorld(true)
  const moves: CeilingEvent[] = []
  const clicks: CeilingEvent[] = []
  const onMove = (event: CeilingEvent) => moves.push(event)
  const onClick = (event: CeilingEvent) => clicks.push(event)
  emitter.on('ceiling:move', onMove)
  emitter.on('ceiling:click', onClick)
  function Placement() {
    useCeilingEvents()
    return null
  }
  const send = () => {
    for (const type of ['pointermove', 'click']) {
      canvas.dispatchEvent(Object.assign(new Event(type), { clientX: 55, clientY: 50, button: 0 }))
    }
  }
  try {
    sceneRegistry.nodes.set(ceiling.id, surface)
    sceneRegistry.byType.ceiling!.add(ceiling.id)
    useScene.setState({ nodes: { [level.id]: level, [ceiling.id]: ceiling } })
    useViewer.setState({
      hoveredId: null,
      cameraDragging: false,
      selection: { buildingId: null, levelId: level.id, zoneId: null, selectedIds: [] },
    })
    useEditor.setState({ selectedItem: { attachTo: 'ceiling' } as never })
    await root.configure({
      gl: {
        domElement: canvas,
        render() {},
        setSize() {},
        setPixelRatio() {},
      } as unknown as WebGLRenderer,
      camera,
      frameloop: 'never',
      dpr: 1,
      size: { width: 100, height: 100, top: 0, left: 0 },
    })
    await act(async () => {
      root.render(createElement(Placement))
    })
    send()
    hideFromScene(surface, 'batched')
    send()
    showInScene(surface, 'batched')
    send()
    expect(moves).toHaveLength(3)
    expect(clicks).toHaveLength(3)
    expect(moves[0]!.position[1]).toBeCloseTo(3)
    for (const hit of [...moves, ...clicks]) {
      expect(hit.node.id).toBe(ceiling.id)
      expect(hit.position).toEqual(moves[0]!.position)
      expect(hit.localPosition).toEqual(moves[0]!.localPosition)
    }
    expect(useViewer.getState().hoveredId).toBeNull()
  } finally {
    await act(async () => {
      root.render(null)
    })
    _roots.delete(canvas)
    emitter.off('ceiling:move', onMove)
    emitter.off('ceiling:click', onClick)
    sceneRegistry.nodes.delete(ceiling.id)
    sceneRegistry.byType.ceiling!.delete(ceiling.id)
    surface.geometry.dispose()
    surface.material.dispose()
    useScene.setState(previousScene)
    useEditor.setState(previousEditor)
    useViewer.setState(previousViewer)
    actGlobal.IS_REACT_ACT_ENVIRONMENT = previousAct
  }
})
