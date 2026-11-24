import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test'
import {
  BuildingNode,
  LevelNode,
  type PointAskSubmit,
  registerPointAskHandler,
  sceneRegistry,
  useScene,
  WallNode,
  ZoneNode,
} from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import { cameraPoseStore } from '@pascal-app/viewer/ui'
import { BoxGeometry, Mesh, MeshBasicMaterial, PerspectiveCamera, Raycaster } from 'three'
import {
  type EditorFloorplanContext,
  type FloorplanHit,
  getEditorFloorplanContext,
  setEditorFloorplanContext,
} from '../../components/editor/floorplan-context-bridge'
import {
  getEditorThreeContext,
  setEditorThreeContext,
} from '../../components/editor/three-context-bridge'
import useEditor from '../../store/use-editor'
import { usePointAsk } from '../../store/use-point-ask'
import { sceneLayout } from '../../store/view-layout'
import {
  freeViewportIn,
  preferredPointViewport,
  projectWorldIn,
  stageRect,
  viewportRect,
} from './projector'
import { canPoint, closeBubble, sendBubble, startPointAskSession } from './session'

const building = BuildingNode.parse({ id: 'building_modes' })
const level = LevelNode.parse({ id: 'level_modes', parentId: building.id })
const wall = WallNode.parse({
  id: 'wall_modes',
  parentId: level.id,
  start: [-4, 0],
  end: [4, 0],
  height: 3,
  thickness: 0.2,
})
const zone = ZoneNode.parse({
  id: 'zone_modes',
  name: 'Kitchen',
  parentId: level.id,
  polygon: [
    [-4, -3],
    [4, -3],
    [4, 3],
    [-4, 3],
  ],
})
building.children = [level.id]
level.children = [wall.id, zone.id]

const initialScene = useScene.getState()
const initialViewer = useViewer.getState()
const initialPoint = usePointAsk.getState()
const initialEditor = useEditor.getState()
const initialThree = getEditorThreeContext()
const initialFloorplan = getEditorFloorplanContext()
const initialWallObject = sceneRegistry.nodes.get(wall.id)
const initialPose = cameraPoseStore.getState().pose

const globalNames = [
  'window',
  'document',
  'HTMLElement',
  'Node',
  'requestAnimationFrame',
  'cancelAnimationFrame',
] as const
const initialGlobals = new Map(
  globalNames.map((name) => [name, Object.getOwnPropertyDescriptor(globalThis, name)]),
)

class MockNode {}
class MockHTMLElement extends MockNode {
  isContentEditable = false
  tagName = 'DIV'
}

const wallMesh = new Mesh(new BoxGeometry(8, 3, 0.2), new MeshBasicMaterial())
wallMesh.position.set(0, 1.5, 0)
wallMesh.updateMatrixWorld(true)

let windowTarget: EventTarget
let stopSession = () => {}
let unregisterHandler = () => {}
let received: PointAskSubmit[] = []

function makeCanvas(rect: { left: number; top: number; width: number; height: number }) {
  return {
    style: { cursor: '' },
    getBoundingClientRect: () => ({
      ...rect,
      right: rect.left + rect.width,
      bottom: rect.top + rect.height,
    }),
  } as unknown as HTMLCanvasElement
}

function makeFloorplanFixture(
  rect: { left: number; top: number; width: number; height: number },
  options: {
    hitForWorld?: (wx: number, wz: number) => FloorplanHit | null
    spacePan?: () => boolean
    captureDataUrl?: string
  } = {},
) {
  const scale = 50
  const centerX = rect.left + rect.width / 2
  const centerY = rect.top + rect.height / 2
  const childNode = Object.assign(new MockNode(), { id: 'svg-child' }) as unknown as SVGElement
  const svgElement = {
    style: { cursor: '' },
    contains: (candidate: unknown) => candidate === childNode,
  } as unknown as SVGSVGElement

  const screenToWorld = (clientX: number, clientY: number): [number, number, number] => [
    (clientX - centerX) / scale,
    0,
    (clientY - centerY) / scale,
  ]

  const captureSpy = spyOn(
    {
      capture: async (
        _screenRect: Parameters<EditorFloorplanContext['captureCrop']>[0],
        _opts?: Parameters<EditorFloorplanContext['captureCrop']>[1],
      ) => ({
        dataUrl: options.captureDataUrl ?? 'data:image/jpeg;base64,PLAN2D',
        width: 400,
        height: 300,
      }),
    },
    'capture',
  )

  const context: EditorFloorplanContext = {
    svgElement,
    sceneElement: null,
    getRect: () =>
      ({
        ...rect,
        right: rect.left + rect.width,
        bottom: rect.top + rect.height,
      }) as DOMRect,
    projectWorld: (point) => ({
      x: centerX + point[0] * scale,
      y: centerY + point[2] * scale,
      ok: true,
    }),
    screenToWorld,
    cameraRay: (clientX, clientY) => {
      const world = screenToWorld(clientX, clientY)
      return { origin: [world[0], world[1] + 50, world[2]], direction: [0, -1, 0] }
    },
    getCamera: () => ({
      position: [0.05, 25, 0.05],
      target: [0, 0, 0],
      fov: 50,
      aspect: rect.width / rect.height,
      projection: 'orthographic',
      viewWidth: rect.width / scale,
    }),
    pickAtScreenPoint: (clientX, clientY) => {
      const [wx, , wz] = screenToWorld(clientX, clientY)
      if (options.hitForWorld) return options.hitForWorld(wx, wz)
      if (Math.abs(wx) <= 4 && Math.abs(wz) <= 0.4) {
        return {
          nodeId: wall.id,
          roomZoneId: zone.id,
          point: [wx, 0, wz],
          normal: [0, 1, 0],
          planPoint: [wx, wz],
        }
      }
      if (Math.abs(wx) <= 4 && Math.abs(wz) <= 3) {
        return {
          nodeId: null,
          roomZoneId: zone.id,
          point: [wx, 0, wz],
          normal: [0, 1, 0],
          planPoint: [wx, wz],
        }
      }
      return {
        nodeId: null,
        roomZoneId: null,
        point: [wx, 0, wz],
        normal: [0, 1, 0],
        planPoint: [wx, wz],
      }
    },
    getLevelY: () => 0,
    isSpacePanPressed: () => options.spacePan?.() ?? false,
    captureCrop: (screenRect, cropOptions) => captureSpy(screenRect, cropOptions),
  }

  return { context, svgElement, childNode, captureSpy }
}

function dispatchPointer(
  type: 'pointerdown' | 'pointermove' | 'pointerup',
  target: EventTarget | unknown,
  clientX: number,
  clientY: number,
  extra: { button?: number; shiftKey?: boolean } = {},
) {
  let prevented = false
  let stopped = false
  const event = new Event(type, { cancelable: true })
  const props: Record<string, unknown> = {
    target,
    button: extra.button ?? 0,
    pointerType: 'mouse',
    clientX,
    clientY,
    shiftKey: extra.shiftKey ?? false,
    altKey: false,
    timeStamp: 100,
    preventDefault() {
      prevented = true
    },
    stopImmediatePropagation() {
      stopped = true
    },
  }
  for (const [k, v] of Object.entries(props)) {
    Object.defineProperty(event, k, { configurable: true, value: v })
  }
  windowTarget.dispatchEvent(event)
  return { prevented, stopped }
}

function dispatchKey(
  type: 'keydown' | 'keyup',
  key: string,
  extra: { timeStamp?: number; target?: unknown } = {},
) {
  let prevented = false
  let stopped = false
  const event = new Event(type, { cancelable: true })
  const props: Record<string, unknown> = {
    key,
    target: extra.target ?? null,
    metaKey: false,
    ctrlKey: false,
    altKey: false,
    shiftKey: false,
    repeat: false,
    timeStamp: extra.timeStamp ?? 200,
    preventDefault() {
      prevented = true
    },
    stopImmediatePropagation() {
      stopped = true
    },
  }
  for (const [k, v] of Object.entries(props)) {
    Object.defineProperty(event, k, { configurable: true, value: v })
  }
  windowTarget.dispatchEvent(event)
  return { prevented, stopped }
}

beforeEach(() => {
  received = []
  windowTarget = new EventTarget()
  const docTarget = Object.assign(new EventTarget(), {
    querySelector: () => null,
    activeElement: null,
  })
  Object.assign(windowTarget, { innerWidth: 1440, innerHeight: 900 })
  Object.defineProperties(globalThis, {
    window: { configurable: true, value: windowTarget, writable: true },
    document: { configurable: true, value: docTarget, writable: true },
    HTMLElement: { configurable: true, value: MockHTMLElement, writable: true },
    Node: { configurable: true, value: MockNode, writable: true },
    requestAnimationFrame: { configurable: true, value: () => 0, writable: true },
    cancelAnimationFrame: { configurable: true, value: () => {}, writable: true },
  })
  useScene.setState({
    nodes: {
      [building.id]: building,
      [level.id]: level,
      [wall.id]: wall,
      [zone.id]: zone,
    },
    rootNodeIds: [building.id],
    dirtyNodes: new Set(),
  })
  useViewer.setState({
    selection: {
      buildingId: building.id,
      levelId: level.id,
      zoneId: null,
      selectedIds: [],
    },
    hoveredId: null,
    pointedIds: [],
    unit: 'metric',
  })
  useEditor.setState({
    ...initialEditor,
    workspaceMode: 'edit',
    isPreviewMode: false,
    isCaptureMode: false,
    isFirstPersonMode: false,
    viewLayouts: { ...initialEditor.viewLayouts, edit: sceneLayout('3d') },
  })
  usePointAsk.setState({
    ...initialPoint,
    active: false,
    latched: false,
    bubble: null,
    cardFor: null,
  })
  sceneRegistry.nodes.set(wall.id, wallMesh)
  unregisterHandler = registerPointAskHandler(async (submit) => {
    received.push(submit)
    return { ok: true }
  })
})

afterEach(() => {
  closeBubble('dismiss')
  stopSession()
  stopSession = () => {}
  unregisterHandler()
  unregisterHandler = () => {}
  setEditorThreeContext(initialThree)
  setEditorFloorplanContext(initialFloorplan)
  cameraPoseStore.setState({ pose: initialPose })
  if (initialWallObject) sceneRegistry.nodes.set(wall.id, initialWallObject)
  else sceneRegistry.nodes.delete(wall.id)
  useScene.setState(initialScene, true)
  useViewer.setState(initialViewer, true)
  useEditor.setState(initialEditor, true)
  usePointAsk.setState(initialPoint, true)
  for (const name of globalNames) {
    const desc = initialGlobals.get(name)
    if (desc) Object.defineProperty(globalThis, name, desc)
    else delete (globalThis as Record<string, unknown>)[name]
  }
})

describe('point-ask 2D floorplan mode (DGS-142)', () => {
  test('canPoint is true in 2D-only view without ThreeContext and click opens orthographic 2D bubble', async () => {
    setEditorThreeContext(null)
    useEditor.setState({
      viewLayouts: { ...useEditor.getState().viewLayouts, edit: sceneLayout('2d') },
    })
    const { context, childNode, captureSpy } = makeFloorplanFixture({
      left: 0,
      top: 0,
      width: 800,
      height: 600,
    })
    setEditorFloorplanContext(context)
    expect(canPoint()).toBe(true)
    expect(preferredPointViewport()).toBe('2d')

    stopSession = startPointAskSession({ freeClick: true, enrichedRegions: false })
    usePointAsk.setState({ active: true, latched: true })

    // Click over the wall on 2D plan: room-first rule picks the bounding room (Kitchen).
    const downResult = dispatchPointer('pointerdown', childNode, 400, 300)
    expect(downResult.prevented).toBe(true)
    expect(downResult.stopped).toBe(true)
    dispatchPointer('pointerup', childNode, 400, 300)

    const bubble = usePointAsk.getState().bubble
    expect(bubble).not.toBeNull()
    expect(bubble?.viewport).toBe('2d')
    expect(bubble?.targets[0]?.id).toBe(zone.id)
    expect(bubble?.camera?.projection).toBe('orthographic')
    expect(bubble?.camera?.viewWidth).toBeCloseTo(16, 4)
    expect(captureSpy).toHaveBeenCalledTimes(1)

    await sendBubble('Add a door along this wall', { x: 400, y: 300, width: 10, height: 10 })
    expect(received).toHaveLength(1)
    expect(received[0]?.context.viewport).toBe('2d')
    expect(received[0]?.context.camera.projection).toBe('orthographic')
    expect(received[0]?.context.image?.dataUrl).toBe('data:image/jpeg;base64,PLAN2D')
  })

  test('freeClick places a free-point bubble outside nodes and Space+pan is not intercepted', () => {
    setEditorThreeContext(null)
    useEditor.setState({
      viewLayouts: { ...useEditor.getState().viewLayouts, edit: sceneLayout('2d') },
    })
    let spacePanning = false
    const { context, svgElement } = makeFloorplanFixture(
      { left: 0, top: 0, width: 800, height: 600 },
      { spacePan: () => spacePanning },
    )
    setEditorFloorplanContext(context)

    stopSession = startPointAskSession({ freeClick: true, enrichedRegions: false })
    usePointAsk.setState({ active: true, latched: true })

    spacePanning = true
    const panPress = dispatchPointer('pointerdown', svgElement, 400, 300)
    expect(panPress.prevented).toBe(false)
    expect(panPress.stopped).toBe(false)
    dispatchPointer('pointerup', svgElement, 400, 300)
    expect(usePointAsk.getState().bubble).toBeNull()

    spacePanning = false
    // Click well outside [-4..4, -3..3] (e.g. x=6, z=5 -> px=(700, 550)).
    dispatchPointer('pointerdown', svgElement, 700, 550)
    dispatchPointer('pointerup', svgElement, 700, 550)

    const freeBubble = usePointAsk.getState().bubble
    expect(freeBubble).not.toBeNull()
    expect(freeBubble?.viewport).toBe('2d')
    expect(freeBubble?.targets).toEqual([])
    expect(freeBubble?.anchor[0]).toBeCloseTo(6, 4)
    expect(freeBubble?.anchor[1]).toBe(0)
    expect(freeBubble?.anchor[2]).toBeCloseTo(5, 4)
  })

  test('region drag on 2D floorplan builds world footprint and ranks intersecting elements', () => {
    setEditorThreeContext(null)
    useEditor.setState({
      viewLayouts: { ...useEditor.getState().viewLayouts, edit: sceneLayout('2d') },
    })
    const { context, svgElement, captureSpy } = makeFloorplanFixture({
      left: 0,
      top: 0,
      width: 800,
      height: 600,
    })
    setEditorFloorplanContext(context)

    stopSession = startPointAskSession({ freeClick: false, enrichedRegions: true })
    usePointAsk.setState({ active: true, latched: true })

    dispatchPointer('pointerdown', svgElement, 300, 220)
    dispatchPointer('pointermove', svgElement, 500, 380)
    dispatchPointer('pointerup', svgElement, 500, 380)

    const bubble = usePointAsk.getState().bubble
    expect(bubble?.gesture).toBe('region')
    expect(bubble?.viewport).toBe('2d')
    expect(bubble?.area?.ids).toContain(zone.id)
    expect(bubble?.area?.ids).toContain(wall.id)
    expect(bubble?.footprint?.corners).toHaveLength(4)
    expect(bubble?.footprint?.corners[0]?.[1]).toBeCloseTo(0, 5)
    // Drag aborts the initial hover pre-crop and takes one SVG capture for the region rect.
    expect(captureSpy).toHaveBeenCalledTimes(2)
    expect(captureSpy.mock.calls[0]?.[1]?.signal?.aborted).toBe(true)
    expect(captureSpy.mock.calls[1]?.[0]).toEqual({ x0: 300, y0: 220, x1: 500, y1: 380 })
    expect(captureSpy.mock.calls[1]?.[1]?.pad).toBe(0)
  })
})

describe('point-ask Split 2D+3D mode (DGS-142)', () => {
  test('projects worlds independently in 2D and 3D panes and routes pointer surface per pane', () => {
    useEditor.setState({
      viewLayouts: { ...useEditor.getState().viewLayouts, edit: sceneLayout('split') },
    })
    const camera = new PerspectiveCamera(60, 4 / 3, 0.1, 100)
    camera.position.set(0, 1.5, 6)
    camera.lookAt(0, 1.5, 0)
    camera.updateMatrixWorld(true)
    const canvas = makeCanvas({ left: 0, top: 0, width: 700, height: 600 })
    setEditorThreeContext({ camera, raycaster: new Raycaster(), domElement: canvas })

    const { context, svgElement } = makeFloorplanFixture({
      left: 720,
      top: 0,
      width: 700,
      height: 600,
    })
    setEditorFloorplanContext(context)

    expect(viewportRect('3d')?.left).toBe(0)
    expect(viewportRect('2d')?.left).toBe(720)
    expect(stageRect()?.right).toBe(1420)
    expect(freeViewportIn('2d')?.x0).toBeGreaterThanOrEqual(720)

    const p2 = projectWorldIn([2, 0, 1], '2d')
    const p3 = projectWorldIn([2, 0, 1], '3d')
    expect(p2.ok).toBe(true)
    expect(p3.ok).toBe(true)
    expect(p2.x).toBeGreaterThan(720)
    expect(p3.x).toBeLessThan(700)

    stopSession = startPointAskSession({ freeClick: true, enrichedRegions: false })
    usePointAsk.setState({ active: true, latched: true })

    dispatchPointer('pointerdown', svgElement, 1070, 300)
    dispatchPointer('pointerup', svgElement, 1070, 300)
    expect(usePointAsk.getState().bubble?.viewport).toBe('2d')

    closeBubble('dismiss')
    dispatchPointer('pointerdown', canvas, 350, 300)
    dispatchPointer('pointerup', canvas, 350, 300)
    expect(usePointAsk.getState().bubble?.viewport).toBe('3d')
  })
})

describe('point-ask Walkthrough mode (DGS-141)', () => {
  test('C latches Comment mode, captures live first-person camera pose, and Escape unwinds with propagation stopped', async () => {
    const camera = new PerspectiveCamera(60, 800 / 600, 0.1, 100)
    camera.position.set(1, 1.65, 4)
    camera.lookAt(1, 1.65, 0)
    camera.updateMatrixWorld(true)
    const canvas = makeCanvas({ left: 0, top: 0, width: 800, height: 600 })
    setEditorThreeContext({ camera, raycaster: new Raycaster(), domElement: canvas })
    setEditorFloorplanContext(null)

    // Seed a stale orbit camera pose that must be ignored during Walkthrough.
    cameraPoseStore.setState({
      pose: {
        position: [50, 50, 50],
        target: [40, 40, 40],
        fov: 50,
        projection: 'perspective',
      },
    })
    useEditor.setState({
      isFirstPersonMode: true,
      viewLayouts: { ...useEditor.getState().viewLayouts, edit: sceneLayout('3d') },
    })

    expect(canPoint()).toBe(true)
    stopSession = startPointAskSession({ freeClick: true, enrichedRegions: false })

    // In Walkthrough, pressing C latches immediately without waiting for tap release.
    const cPress = dispatchKey('keydown', 'c')
    expect(cPress.prevented).toBe(true)
    expect(cPress.stopped).toBe(true)
    expect(usePointAsk.getState().active).toBe(true)
    expect(usePointAsk.getState().latched).toBe(true)

    // Center click hits the wall in front of the walkthrough eye.
    dispatchPointer('pointerdown', canvas, 400, 300)
    dispatchPointer('pointerup', canvas, 400, 300)
    const bubble = usePointAsk.getState().bubble
    expect(bubble).not.toBeNull()
    expect(bubble?.viewport).toBe('3d')
    expect(bubble?.camera?.position).toEqual([1, 1.65, 4])
    expect(bubble?.camera?.target[2]).toBeLessThan(4)

    await sendBubble('Wall defect in walkthrough', { x: 400, y: 300, width: 10, height: 10 })
    expect(received).toHaveLength(1)
    expect(received[0]?.context.viewport).toBeUndefined()

    dispatchPointer('pointerdown', canvas, 400, 300)
    dispatchPointer('pointerup', canvas, 400, 300)
    expect(usePointAsk.getState().bubble).not.toBeNull()

    // Seed an open card, then verify Escape unwinds card -> bubble -> leave mode, stopping propagation.
    usePointAsk.setState({ cardFor: 'ask_fake' })
    const escCard = dispatchKey('keydown', 'Escape')
    expect(escCard.stopped).toBe(true)
    expect(usePointAsk.getState().cardFor).toBeNull()
    expect(usePointAsk.getState().bubble).not.toBeNull()

    const escBubble = dispatchKey('keydown', 'Escape')
    expect(escBubble.stopped).toBe(true)
    expect(usePointAsk.getState().bubble).toBeNull()
    expect(usePointAsk.getState().active).toBe(true)

    const escMode = dispatchKey('keydown', 'Escape')
    expect(escMode.stopped).toBe(true)
    expect(usePointAsk.getState().active).toBe(false)
  })

  test('Preview-mode Walkthrough and Drone allow C commenting across levels, while non-walkthrough Preview disables it', () => {
    const upperLevel = LevelNode.parse({ id: 'level_upper', parentId: building.id, level: 1 })
    const upperWall = WallNode.parse({
      id: 'wall_upper',
      parentId: upperLevel.id,
      start: [-4, 0],
      end: [4, 0],
      height: 3,
      thickness: 0.2,
    })
    upperLevel.children = [upperWall.id]
    const upperMesh = new Mesh(new BoxGeometry(8, 3, 0.2), new MeshBasicMaterial())
    upperMesh.position.set(0, 4.5, 0)
    upperMesh.updateMatrixWorld(true)
    sceneRegistry.nodes.set(upperWall.id, upperMesh)

    try {
      useScene.setState({
        nodes: {
          ...useScene.getState().nodes,
          [building.id]: { ...building, children: [level.id, upperLevel.id] },
          [upperLevel.id]: upperLevel,
          [upperWall.id]: upperWall,
        },
      })
      const camera = new PerspectiveCamera(60, 800 / 600, 0.1, 100)
      camera.position.set(0, 4.5, 5)
      camera.lookAt(0, 4.5, 0)
      camera.updateMatrixWorld(true)
      const canvas = makeCanvas({ left: 0, top: 0, width: 800, height: 600 })
      setEditorThreeContext({ camera, raycaster: new Raycaster(), domElement: canvas })
      setEditorFloorplanContext(null)

      // Plain Preview (not in Walkthrough or Drone) keeps Comment disabled.
      useEditor.setState({
        isPreviewMode: true,
        isFirstPersonMode: false,
        firstPersonMovementMode: 'walk',
      })
      expect(canPoint()).toBe(false)

      // Preview Walkthrough enables Comment via C.
      useEditor.setState({
        isPreviewMode: true,
        isFirstPersonMode: true,
        firstPersonMovementMode: 'walk',
      })
      expect(canPoint()).toBe(true)
      stopSession = startPointAskSession({ freeClick: true, enrichedRegions: false })
      const walkPress = dispatchKey('keydown', 'c')
      expect(walkPress.prevented).toBe(true)
      expect(usePointAsk.getState().active).toBe(true)
      expect(usePointAsk.getState().latched).toBe(true)

      // Leaving first-person back to Preview Orbit exits Comment mode automatically.
      useEditor.setState({ isFirstPersonMode: false })
      expect(usePointAsk.getState().active).toBe(false)

      // Preview Drone enables Comment and picks upper-floor walls even when selection.levelId is level 0.
      useEditor.setState({
        isPreviewMode: true,
        isFirstPersonMode: true,
        firstPersonMovementMode: 'drone',
      })
      expect(canPoint()).toBe(true)
      const dronePress = dispatchKey('keydown', 'c')
      expect(dronePress.prevented).toBe(true)
      expect(usePointAsk.getState().active).toBe(true)

      dispatchPointer('pointerdown', canvas, 400, 300)
      dispatchPointer('pointerup', canvas, 400, 300)
      const bubble = usePointAsk.getState().bubble
      expect(bubble).not.toBeNull()
      expect(bubble?.targets[0]?.id).toBe(upperWall.id)
      expect(bubble?.camera?.position).toEqual([0, 4.5, 5])
    } finally {
      sceneRegistry.nodes.delete(upperWall.id)
    }
  })
})
