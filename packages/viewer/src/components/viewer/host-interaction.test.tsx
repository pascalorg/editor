import { afterEach, beforeEach, expect, test } from 'bun:test'
import { DoorNode, nodeRegistry, sceneRegistry, useInteractive, useScene } from '@pascal-app/core'
import { context, useStore } from '@react-three/fiber'
import { act, create } from '@react-three/test-renderer'
import { Suspense } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { Object3D, Vector3 } from 'three'
import {
  type GlbPickEvent,
  GlbScene,
  InteractiveSystem,
  SelectionCallout,
  type SelectionCalloutProps,
  useViewer,
} from '../../index'
import { trackPointerGestures } from '../../lib/pointer-gesture'
import { GlbSelectionCallout } from './glb-selection-callout'

let previous: ReturnType<typeof useViewer.getState>
let graph: ReturnType<typeof useScene.getState>
let interactive: ReturnType<typeof useInteractive.getState>
let restore: () => void
let win: EventTarget
let doc: EventTarget & { body: { style: Record<string, string> }; hidden: boolean }
let canvas: HTMLElement

beforeEach(() => {
  previous = useViewer.getState()
  graph = useScene.getState()
  interactive = useInteractive.getState()
  const keys = [
    'document',
    'window',
    'requestAnimationFrame',
    'cancelAnimationFrame',
    'ProgressEvent',
    'DOMRect',
  ] as const
  const descriptors = keys.map(
    (key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)] as const,
  )
  win = Object.assign(new EventTarget(), { location: { search: '' } })
  doc = Object.assign(new EventTarget(), {
    defaultView: win,
    body: { style: {} },
    hidden: false,
    querySelector: () => null,
  })
  canvas = { ownerDocument: doc, contains: () => true } as unknown as HTMLElement
  Object.assign(globalThis, {
    document: doc,
    window: win,
    requestAnimationFrame: () => 0,
    cancelAnimationFrame: () => {},
    ProgressEvent: class extends Event {},
    DOMRect: class {
      constructor(
        public x = 0,
        public y = 0,
        public width = 0,
        public height = 0,
      ) {}
    },
  })
  useViewer.setState({
    walkthroughMode: false,
    sectionEnabled: false,
    xrayFamily: null,
    hoveredId: null,
    selection: { ...previous.selection, levelId: null, selectedIds: [] },
    outliner: { ...previous.outliner, selectedObjects: [], hoveredObjects: [] },
  })
  restore = () => {
    useViewer.setState(previous, true)
    useScene.setState(graph, true)
    useInteractive.setState(interactive, true)
    for (const [key, descriptor] of descriptors) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor)
      else Reflect.deleteProperty(globalThis, key)
    }
  }
})
afterEach(() => restore())

function gesture(travel: number, duration = 100, secondPointer = false) {
  const send = (type: string, x: number, timestamp: number, id = 1) => {
    const event = new Event(type)
    for (const [key, value] of Object.entries({
      clientX: x,
      clientY: 0,
      button: 0,
      pointerId: id,
      isPrimary: id === 1,
      timeStamp: timestamp,
    }))
      Object.defineProperty(event, key, { value })
    win.dispatchEvent(event)
  }
  send('pointerdown', 0, 0)
  if (secondPointer) send('pointerdown', 0, 0, 2)
  send('pointermove', travel, 50)
  send('pointerup', travel, duration)
  if (secondPointer) send('pointerup', 0, duration, 2)
}

function bakedUrl() {
  const data = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 1, 0, 0, 0, 0, 0, 1])
  const gltf = {
    asset: { version: '2.0' },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [
      {
        name: 'door_contract',
        mesh: 0,
        extras: {
          pascalId: 'door_contract',
          kind: 'door',
          label: 'Front door',
          openable: true,
          clips: ['door_contract: open'],
        },
      },
    ],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }],
    buffers: [
      {
        byteLength: data.byteLength,
        uri: `data:application/octet-stream;base64,${Buffer.from(data.buffer).toString('base64')}`,
      },
    ],
    bufferViews: [
      { buffer: 0, byteLength: 36 },
      { buffer: 0, byteOffset: 36, byteLength: 8 },
      { buffer: 0, byteOffset: 44, byteLength: 24 },
    ],
    accessors: [
      {
        bufferView: 0,
        componentType: 5126,
        count: 3,
        type: 'VEC3',
        min: [0, 0, 0],
        max: [1, 1, 0],
      },
      { bufferView: 1, componentType: 5126, count: 2, type: 'SCALAR', min: [0], max: [1] },
      { bufferView: 2, componentType: 5126, count: 2, type: 'VEC3' },
    ],
    animations: [
      {
        name: 'door_contract: open',
        channels: [{ sampler: 0, target: { node: 0, path: 'translation' } }],
        samplers: [{ input: 1, output: 2 }],
      },
    ],
  }
  return `data:model/gltf+json;base64,${Buffer.from(JSON.stringify(gltf)).toString('base64')}`
}
const url = bakedUrl()
const flush = async () => {
  await act(async () => {
    await new Promise<void>((resolve) => setImmediate(resolve))
  })
}

test('baked picks carry accepted world hit data and share tap gating with empty-space clicks', async () => {
  const picks: GlbPickEvent[] = []
  const renderer = await create(
    <Suspense fallback={null}>
      <GlbScene url={url} onPick={(event) => picks.push(event)} renderCallout={() => null} />
    </Suspense>,
  )
  let stop = () => {}
  try {
    await flush()
    const target = renderer.scene.find((node) => typeof node.props.onClick === 'function')
    const object = renderer.scene.instance.getObjectByName('door_contract')!
    const event = {
      stopPropagation() {},
      intersections: [
        { object, point: new Vector3(1, 2, 3), face: { normal: new Vector3(0, 0, 1) } },
      ],
      nativeEvent: { clientX: 10, clientY: 20, pointerType: 'touch' },
    }
    await renderer.fireEvent(target, 'pointerMove', event)
    expect(picks[0]).toMatchObject({
      type: 'hover',
      worldPosition: [1, 2, 3],
      normal: [0, 0, 1],
      hitObject: object,
      clientX: 10,
      clientY: 20,
      pointerType: 'touch',
    })
    await renderer.fireEvent(target, 'click', event) // Legacy click requires no tracked down.
    expect(picks.at(-1)?.type).toBe('click')
    stop = trackPointerGestures(canvas, { maxDurationMs: 500 })
    for (const [travel, duration, multi, accepted] of [
      [3, 100, false, true],
      [12, 100, false, false],
      [0, 501, false, false],
      [0, 100, true, false],
    ] as const) {
      gesture(travel, duration, multi)
      let count = picks.length
      await renderer.fireEvent(target, 'click', event)
      expect(picks.length - count).toBe(accepted ? 1 : 0)
      if (accepted)
        expect(picks.at(-1)).toMatchObject({ worldPosition: [1, 2, 3], hitObject: object })
      count = picks.length
      await renderer.fireEvent(target, 'pointerMissed', { button: 0 })
      expect(picks.length - count).toBe(accepted ? 1 : 0)
      if (accepted) expect(picks.at(-1)?.pick).toBeNull()
    }
  } finally {
    stop()
    await renderer.unmount()
  }
})

test('baked default synchronizes outlines; opting out preserves host arrays through frames and unmount', async () => {
  for (const outlineSync of [undefined, false]) {
    const renderer = await create(
      <Suspense fallback={null}>
        <GlbScene url={url} outlineSync={outlineSync} renderCallout={() => null} />
      </Suspense>,
    )
    await flush()
    const selected = new Object3D()
    const hovered = new Object3D()
    const outliner = useViewer.getState().outliner
    const selectedArray = outliner.selectedObjects
    const hoveredArray = outliner.hoveredObjects
    selectedArray.push(selected)
    hoveredArray.push(hovered)
    await act(async () =>
      useViewer.setState({
        selection: { ...useViewer.getState().selection, selectedIds: ['door_contract'] },
      }),
    )
    await renderer.advanceFrames(1, 0.016)
    expect(outliner.selectedObjects).toBe(selectedArray)
    expect(outliner.hoveredObjects).toBe(hoveredArray)
    if (outlineSync === false) {
      expect(selectedArray).toEqual([selected])
      expect(hoveredArray).toEqual([hovered])
    } else {
      expect(selectedArray[0]?.name).toBe('door_contract')
      expect(hoveredArray).toEqual([])
    }
    await renderer.unmount()
    expect(selectedArray).toEqual(outlineSync === false ? [selected] : [])
    expect(hoveredArray).toEqual(outlineSync === false ? [hovered] : [])
    selectedArray.length = 0
    hoveredArray.length = 0
    useViewer.getState().setSelection({ selectedIds: [] })
  }
})

test('baked custom callouts retain clip actions and dismiss; returning null renders nothing', async () => {
  let props: SelectionCalloutProps | undefined
  const renderer = await create(
    <Suspense fallback={null}>
      <GlbScene
        url={url}
        renderCallout={(value) => {
          props = value
          return null
        }}
      />
    </Suspense>,
  )
  try {
    await flush()
    await act(async () => useViewer.getState().setSelection({ selectedIds: ['door_contract'] }))
    expect(props).toMatchObject({
      title: 'Front door',
      actions: [{ kind: 'toggle', key: 'open', on: false }],
    })
    const action = props!.actions[0]!
    if (action.kind !== 'toggle') throw new Error('Expected opening action')
    await act(async () => {
      action.toggle()
    })
    expect(props!.actions[0]).toMatchObject({ on: true })
    await renderer.advanceFrames(1, 0.25)
    expect(props!.object.position.z).toBeGreaterThan(0)
    expect(renderer.scene.findAll((node) => node.props.name === 'host-callout')).toHaveLength(0)
    await act(async () => props!.onDismiss())
    expect(useViewer.getState().selection.selectedIds).toEqual([])
  } finally {
    await renderer.unmount()
  }
})

test('live custom callouts carry actions, current object and dismiss', async () => {
  const restoreRegistry = nodeRegistry._snapshot()
  nodeRegistry._register({
    kind: 'door',
    schemaVersion: 1,
    capabilities: {
      mechanism: {
        icon: 'door',
        has: () => true,
        isOn: (node: { id: string }, state: ReturnType<typeof useInteractive.getState>) =>
          Boolean(state.mechanisms[node.id]),
        set: (node: { id: string }, on: boolean) =>
          useInteractive.getState().setMechanism(node.id as never, on),
      },
    },
  } as never)
  const node = DoorNode.parse({ id: 'door_live_contract', name: 'Live door' })
  const object = new Object3D()
  sceneRegistry.nodes.set(node.id, object)
  useScene.setState({ nodes: { [node.id]: node } })
  useViewer.getState().setSelection({ selectedIds: [node.id] })
  let props: SelectionCalloutProps | undefined
  const renderer = await create(
    <InteractiveSystem
      renderCallout={(value) => {
        props = value
        return <group name="host-callout" />
      }}
    />,
  )
  try {
    await act(async () => {
      await renderer.advanceFrames(1, 0.016)
    })
    expect(props).toMatchObject({
      object,
      title: 'Live door',
      actions: [{ kind: 'toggle', on: false }],
    })
    expect(renderer.scene.findAll((value) => value.props.name === 'host-callout')).toHaveLength(1)
    const action = props!.actions[0]!
    if (action.kind !== 'toggle') throw new Error('Expected opening action')
    await act(async () => {
      action.toggle()
    })
    expect(props!.actions[0]).toMatchObject({ on: true })
    await act(async () => props!.onDismiss())
    expect(useViewer.getState().selection.selectedIds).toEqual([])
  } finally {
    await renderer.unmount()
    sceneRegistry.nodes.delete(node.id)
    restoreRegistry()
  }
})

// Server rendering runs the real default renderer without mounting its DOM portal.
test('baked default callout is identical to explicitly rendering SelectionCallout with host props', async () => {
  let store: ReturnType<typeof useStore> | undefined
  function Store() {
    store = useStore()
    return null
  }
  const renderer = await create(<Store />)
  const fiberInitial = store!.getInitialState()
  const fiberPrevious = { ...fiberInitial }
  Object.assign(fiberInitial, store!.getState())
  const initial = useViewer.getInitialState()
  const initialSelection = initial.selection
  const initialWalkthrough = initial.walkthroughMode
  const initialFamily = initial.xrayFamily
  Object.assign(doc, { createElement: () => ({ style: {} }) })
  try {
    const object = new Object3D()
    object.userData = { kind: 'door', label: 'Front door' }
    const identity = new Map([['door_contract', object]])
    const render = (custom: boolean, hide = false) =>
      renderToStaticMarkup(
        <context.Provider value={store!}>
          <GlbSelectionCallout
            identity={identity}
            items={undefined}
            sceneNodes={undefined}
            loopMechanisms={new Map()}
            isOpen={() => false}
            toggleOpen={() => {}}
            {...(custom || hide
              ? {
                  renderCallout: (props: SelectionCalloutProps) =>
                    hide ? null : <SelectionCallout {...props} />,
                }
              : {})}
          />
        </context.Provider>,
      )
    initial.selection = { ...initial.selection, selectedIds: ['door_contract'] }
    initial.walkthroughMode = false
    initial.xrayFamily = null
    expect(render(false)).toBe(render(true))
    expect(render(false)).not.toBe(render(false, true))
  } finally {
    Object.assign(fiberInitial, fiberPrevious)
    initial.selection = initialSelection
    initial.walkthroughMode = initialWalkthrough
    initial.xrayFamily = initialFamily
    await renderer.unmount()
  }
})

test('camera controls apply host limits and smoothing and restore host bindings after Space', async () => {
  const { ViewerCameraControls } = await import('../../ui/index')
  let store: ReturnType<typeof useStore> | undefined
  function Store() {
    store = useStore()
    Object.assign(store.getState().gl.domElement, {
      ownerDocument: doc,
      style: {},
      setAttribute() {},
      removeAttribute() {},
      getBoundingClientRect: () => ({ x: 0, y: 0, width: 1280, height: 800 }),
    })
    return null
  }
  const bindings = { left: 'rotate', middle: 'dolly', right: 'pan' } as const
  const props = {
    glbActive: true,
    mouseButtons: bindings,
    smoothTime: 0.4,
    limits: { minDistance: 1, maxDistance: 300, minPolarAngle: 0.1, maxPolarAngle: Math.PI - 0.01 },
  }
  const renderer = await create(
    <>
      <Store />
      <ViewerCameraControls {...props} />
    </>,
  )
  try {
    const controls = store!.getState()
      .controls! as unknown as import('@react-three/drei').CameraControlsImpl
    const { CameraControlsImpl } = await import('@react-three/drei')
    const { ACTION } = CameraControlsImpl
    expect(controls).toMatchObject({
      smoothTime: 0.4,
      minDistance: 1,
      maxDistance: 300,
      minPolarAngle: 0.1,
      maxPolarAngle: Math.PI - 0.01,
    })
    expect(controls.mouseButtons).toMatchObject({
      left: ACTION.ROTATE,
      middle: ACTION.DOLLY,
      right: ACTION.SCREEN_PAN,
    })
    const space = (type: string) => {
      const event = new Event(type)
      Object.defineProperty(event, 'code', { value: 'Space' })
      doc.dispatchEvent(event)
    }
    space('keydown')
    expect(controls.mouseButtons.left).toBe(ACTION.SCREEN_PAN)
    await renderer.update(
      <>
        <Store />
        <ViewerCameraControls {...props} mouseButtons={{ ...bindings }} />
      </>,
    )
    expect(controls.mouseButtons.left).toBe(ACTION.SCREEN_PAN)
    space('keyup')
    expect(controls.mouseButtons.left).toBe(ACTION.ROTATE)
    await renderer.update(
      <>
        <Store />
        <ViewerCameraControls glbActive />
      </>,
    )
    expect(controls).toMatchObject({
      smoothTime: 0.25,
      minDistance: 5,
      maxDistance: 100,
      minPolarAngle: 0,
      maxPolarAngle: Math.PI / 2 - 0.1,
    })
    expect(controls.mouseButtons.left).toBe(ACTION.NONE)
  } finally {
    await renderer.unmount()
  }
})
