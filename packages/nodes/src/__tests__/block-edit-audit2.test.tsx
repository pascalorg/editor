import { beforeEach, expect, spyOn, test } from 'bun:test'
import {
  type AnyNodeId,
  BlockNode,
  type BlockTopology,
  BuildingNode,
  createBoxBlockTopology,
  createSceneApi,
  getEffectiveNode,
  ItemNode,
  LevelNode,
  runAsSingleSceneHistoryStep,
  SiteNode,
  useLiveNodeOverrides,
  useScene,
} from '@pascal-app/core'
import { ProceduralItemNode } from '@pascal-app/core/procedural-items'
import { meshEditScope, useEditor, useInteractionScope } from '@pascal-app/editor'
import { useViewer } from '@pascal-app/viewer'
import { useThree } from '@react-three/fiber'
import { act, create } from '@react-three/test-renderer'
import { useMemo } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { type Camera, type Mesh, type MeshBasicMaterial, Ray, Vector3 } from 'three'
import useBlockEditSession from '../block/edit-session'
import { BLOCK_SUPPORT_REFUSAL } from '../block/hosted-edit'
import BlockSelectionAffordance from '../block/selection'
import { blockGizmoDimensions } from '../block/toolbar-state'
import {
  boxAsset as asset,
  GeometrySystem,
  ItemSystem,
  installMountedScene,
  LevelScene,
  boxRecipe as recipe,
  settle,
} from './harness'

const site = SiteNode.parse({})
const building = BuildingNode.parse({ parentId: site.id })
const level = LevelNode.parse({ parentId: building.id })
installMountedScene({
  html: (props) => <group userData={{ ui: renderToStaticMarkup(props.children) }} />,
})
beforeEach(() => {
  useBlockEditSession.setState({
    nodeId: null,
    lastOperation: null,
    selection: { mode: 'face', ids: [], activeId: null },
  })
})

const services = () => ({
  sceneApi: createSceneApi(useScene),
  readOnly: false,
  historyApi: {
    depth: () => useScene.temporal.getState().pastStates.length,
    replaceLatest: (depth: number, replace: () => boolean) => {
      if (depth !== useScene.temporal.getState().pastStates.length) return false
      let ok = false
      runAsSingleSceneHistoryStep(useScene, () => {
        useScene.temporal.getState().undo()
        ok = replace()
        if (!ok) useScene.temporal.getState().redo()
      })
      return ok
    },
  },
})
let api: ReturnType<typeof services>
const interactionApi = { beginInputDrag: () => () => {}, clearSelection() {} }
let viewCamera: Camera
function Scene({ id, editing = true }: { id: AnyNodeId; editing?: boolean }) {
  const host = useScene((s) => s.nodes[id])!
  const { camera, gl } = useThree()
  viewCamera = camera
  useMemo(() => {
    camera.position.set(4, 5, 6)
    camera.lookAt(0, 1, 0)
    camera.updateMatrixWorld()
    gl.domElement.getBoundingClientRect = () =>
      ({ left: 0, top: 0, width: 1000, height: 1000 }) as DOMRect
  }, [camera, gl])
  return (
    <>
      <LevelScene level={level} />
      {editing && <BlockSelectionAffordance {...api} node={host} interactionApi={interactionApi} />}
      <GeometrySystem />
      <ItemSystem />
    </>
  )
}
function seed(
  kind: 'catalog' | 'generated' | 'none' = 'catalog',
  x = 0.5,
  topology = createBoxBlockTopology(2, 1.5, 2),
) {
  const host = BlockNode.parse({ parentId: level.id, topology })
  const child =
    kind === 'generated'
      ? ProceduralItemNode.parse({ parentId: host.id, recipe, position: [x, 1.5, 0] })
      : ItemNode.parse({
          parentId: host.id,
          asset,
          blockFaceId: 'f-top',
          position: [x, 0, 0],
          rotation: [Math.PI / 2, 0, 0],
        })
  const entries = [
    { ...site, children: [building.id] },
    { ...building, children: [level.id] },
    { ...level, children: [host.id] },
    { ...host, children: kind === 'none' ? [] : [child.id] },
    ...(kind === 'none' ? [] : [child]),
  ]
  useScene.setState({
    nodes: Object.fromEntries(entries.map((n) => [n.id, n])),
    rootNodeIds: [site.id],
    dirtyNodes: new Set(entries.map((n) => n.id)),
    readOnly: false,
    materials: {},
    collections: {},
    installedPlugins: [],
  })
  useScene.temporal.getState().resume()
  useScene.temporal.getState().clear()
  useEditor.setState({ mode: 'select', tool: null, viewLayouts: {} })
  useViewer.setState({
    textures: false,
    showZones: false,
    showMeasurements: false,
    selection: {
      buildingId: building.id,
      levelId: level.id,
      zoneId: null,
      selectedIds: [host.id],
    },
  })
  useBlockEditSession.getState().begin(host.id, { mode: 'face', ids: ['f-top'], activeId: 'f-top' })
  useInteractionScope.getState().begin(meshEditScope(host.id))
  api = services()
  return { host: useScene.getState().nodes[host.id] as BlockNode, child }
}
async function key(key: string, extra = {}) {
  await act(async () =>
    window.dispatchEvent(
      Object.assign(new Event('keydown', { cancelable: true }), { key, ...extra }),
    ),
  )
}
async function keys(input: string[]) {
  for (const k of input) await key(k)
}
const nodes = () => JSON.parse(JSON.stringify(useScene.getState().nodes))
function ui(renderer: Awaited<ReturnType<typeof create>>) {
  const text: string[] = []
  renderer.scene.instance.traverse((o) => {
    if (o.userData.ui) text.push(o.userData.ui)
  })
  return text.join(' ')
}

function client(point: Vector3) {
  const projected = point.clone().project(viewCamera)
  return { clientX: (projected.x + 1) * 500, clientY: (1 - projected.y) * 500 }
}
async function pointer(type: string, point?: Vector3) {
  await act(async () =>
    window.dispatchEvent(
      Object.assign(new Event(type, { cancelable: true }), {
        button: 0,
        altKey: true,
        ...(point ? client(point) : {}),
      }),
    ),
  )
}
async function beginDrag(
  renderer: Awaited<ReturnType<typeof create>>,
  operation: string,
  origin: Vector3,
) {
  const shape =
    operation === 'rotate'
      ? 'TorusGeometry'
      : operation === 'scale'
        ? 'SphereGeometry'
        : 'CylinderGeometry'
  const color = operation === 'rotate' ? '#2080ff' : '#ff2060'
  const handle = renderer.scene
    .findAll((n) => n.props.renderOrder === 1301)
    .find(
      (n) =>
        (n.instance as Mesh).geometry?.type === shape &&
        ((n.instance as Mesh).material as MeshBasicMaterial).color?.getHexString() ===
          color.slice(1),
    )!
  expect(handle).toBeDefined()
  const point = origin.clone().add(new Vector3(1, 0, 0))
  await renderer.fireEvent(handle, 'pointerDown', {
    point,
    ray: new Ray(viewCamera.position.clone(), point.clone().sub(viewCamera.position).normalize()),
    nativeEvent: { button: 0, altKey: true, ...client(point), stopImmediatePropagation() {} },
  })
}
function dragPoint(operation: string, value: number, origin: Vector3) {
  if (operation === 'rotate') {
    const radians = (value * Math.PI) / 180
    return origin.clone().add(new Vector3(Math.cos(radians), Math.sin(radians), 0))
  }
  const offset = operation === 'scale' ? (value - 1) * blockGizmoDimensions(2).length : value
  return origin.clone().add(new Vector3(1 + offset, 0, 0))
}
for (const operation of ['rotate', 'translate', 'scale'])
  for (const sequence of ['accepted then refused', 'refused first', 'refused then corrected'])
    test(`BlockEditor drag ${operation}: ${sequence}`, async () => {
      const { host } = seed('catalog')
      if (operation === 'translate')
        useBlockEditSession.getState().setSelection(host.id, {
          mode: 'face',
          ids: ['f-right'],
          activeId: 'f-right',
        })
      const renderer = await create(<Scene id={host.id} />)
      let writes = 0
      const unsubscribe = useScene.subscribe((next, prev) => {
        if (next.nodes !== prev.nodes) writes++
      })
      try {
        await settle(renderer)
        const before = nodes()
        writes = 0
        const origin = operation === 'translate' ? new Vector3(1, 0.75, 0) : new Vector3(0, 1.5, 0)
        await beginDrag(renderer, operation, origin)
        const acceptedValue = operation === 'rotate' ? 10 : operation === 'translate' ? -0.2 : 0.8
        const refusedValue = operation === 'rotate' ? 50 : operation === 'translate' ? -1.5 : 0.2
        let accepted: BlockTopology | null = null
        if (sequence !== 'refused first') {
          await pointer('pointermove', dragPoint(operation, acceptedValue, origin))
          await settle(renderer)
          expect(ui(renderer).includes(BLOCK_SUPPORT_REFUSAL)).toBe(false)
          accepted = getEffectiveNode(useScene.getState().nodes[host.id] as BlockNode).topology
          expect(accepted).not.toEqual(host.topology)
        }
        await pointer('pointermove', dragPoint(operation, refusedValue, origin))
        await settle(renderer)
        expect(ui(renderer).includes(BLOCK_SUPPORT_REFUSAL)).toBe(true)
        expect(writes).toBe(0)
        expect(nodes()).toEqual(before)
        expect(getEffectiveNode(useScene.getState().nodes[host.id] as BlockNode).topology).toEqual(
          accepted ?? host.topology,
        )
        if (sequence === 'refused then corrected') {
          await pointer('pointermove', dragPoint(operation, acceptedValue, origin))
          await settle(renderer)
          expect(ui(renderer).includes(BLOCK_SUPPORT_REFUSAL)).toBe(false)
        }
        await pointer('pointerup')
        await settle(renderer)
        expect(writes).toBe(accepted ? 1 : 0)
        expect((useScene.getState().nodes[host.id] as BlockNode).topology).toEqual(
          accepted ?? host.topology,
        )
        expect(useScene.temporal.getState().pastStates).toHaveLength(accepted ? 1 : 0)
        expect(useInteractionScope.getState().scope).toMatchObject({ phase: 'selecting' })
        expect(useLiveNodeOverrides.getState().overrides.size).toBe(0)
        expect(ui(renderer).includes(BLOCK_SUPPORT_REFUSAL)).toBe(false)
        if (accepted) {
          const label =
            operation === 'rotate' ? 'Angle' : operation === 'translate' ? 'X distance' : 'X scale'
          expect(ui(renderer)).toContain(`aria-label="${label}"`)
          expect(ui(renderer)).toContain(`value="${acceptedValue}"`)
        }
      } finally {
        unsubscribe()
        await renderer.unmount()
      }
    })

for (const entry of [
  { name: 'sign after .1', input: ['0', '.', '1', '-'], amount: 0.1 },
  { name: 'sign after .25', input: ['0', '.', '2', '5', '-'], amount: 0.25 },
  { name: 'negative without accepted value', input: ['-', '.', '1'], amount: null },
])
  test(`childless inset typed as ${entry.name}: the preview is what commits, as at most one undo step`, async () => {
    const { host } = seed('none')
    const renderer = await create(<Scene id={host.id} />)
    const write = spyOn(api.sceneApi, 'update'),
      batch = spyOn(api.sceneApi, 'applyChanges')
    try {
      await settle(renderer)
      write.mockClear()
      batch.mockClear()
      await keys(['i', ...entry.input])
      await settle(renderer)
      const preview = getEffectiveNode(useScene.getState().nodes[host.id] as BlockNode).topology
      if (entry.amount !== null) expect(preview).not.toEqual(host.topology)
      else expect(preview).toEqual(host.topology)
      expect(ui(renderer).includes(BLOCK_SUPPORT_REFUSAL)).toBe(false)
      await key('Enter')
      await settle(renderer)
      expect(useInteractionScope.getState().scope).toMatchObject({ phase: 'selecting' })
      expect((useScene.getState().nodes[host.id] as BlockNode).topology).toEqual(preview)
      if (entry.amount !== null)
        expect(useBlockEditSession.getState().lastOperation?.command).toMatchObject({
          type: 'inset-faces',
          amount: entry.amount,
        })
      else expect(useBlockEditSession.getState().lastOperation).toBeNull()
      expect(write).toHaveBeenCalledTimes(entry.amount === null ? 0 : 1)
      expect(batch).toHaveBeenCalledTimes(0)
      expect(useScene.temporal.getState().pastStates).toHaveLength(entry.amount === null ? 0 : 1)
      expect(useLiveNodeOverrides.getState().overrides.size).toBe(0)
    } finally {
      write.mockRestore()
      batch.mockRestore()
      await renderer.unmount()
    }
  })

for (const operation of ['rotate', 'translate', 'scale'])
  for (const finish of ['pointerup', 'pointercancel'])
    test(`childless drag ${operation} ending in ${finish}: preview writes nothing, release commits the preview or nothing`, async () => {
      const { host } = seed('none')
      if (operation === 'translate')
        useBlockEditSession.getState().setSelection(host.id, {
          mode: 'face',
          ids: ['f-right'],
          activeId: 'f-right',
        })
      const renderer = await create(<Scene id={host.id} />)
      const write = spyOn(api.sceneApi, 'update'),
        batch = spyOn(api.sceneApi, 'applyChanges')
      try {
        await settle(renderer)
        write.mockClear()
        batch.mockClear()
        const origin = operation === 'translate' ? new Vector3(1, 0.75, 0) : new Vector3(0, 1.5, 0)
        await beginDrag(renderer, operation, origin)
        for (const value of operation === 'rotate'
          ? [10, 50]
          : operation === 'translate'
            ? [-0.2, -1.5]
            : [0.8, 0.2]) {
          await pointer('pointermove', dragPoint(operation, value, origin))
          await settle(renderer)
        }
        const preview = getEffectiveNode(useScene.getState().nodes[host.id] as BlockNode).topology
        expect(write).toHaveBeenCalledTimes(0)
        await pointer(finish)
        await settle(renderer)
        expect(write).toHaveBeenCalledTimes(finish === 'pointerup' ? 1 : 0)
        expect(batch).toHaveBeenCalledTimes(0)
        expect(useScene.temporal.getState().pastStates).toHaveLength(finish === 'pointerup' ? 1 : 0)
        expect((useScene.getState().nodes[host.id] as BlockNode).topology).toEqual(
          finish === 'pointerup' ? preview : host.topology,
        )
        expect(useLiveNodeOverrides.getState().overrides.size).toBe(0)
        expect(useInteractionScope.getState().scope).toMatchObject({ phase: 'selecting' })
      } finally {
        write.mockRestore()
        batch.mockRestore()
        await renderer.unmount()
      }
    })

test('generated child: a refused first rotation tick releases without writes or stale feedback', async () => {
  const { host } = seed('generated')
  const renderer = await create(<Scene id={host.id} />)
  let writes = 0
  const unsubscribe = useScene.subscribe((next, prev) => {
    if (next.nodes !== prev.nodes) writes++
  })
  try {
    await settle(renderer)
    const before = nodes()
    writes = 0
    const origin = new Vector3(0, 1.5, 0)
    await beginDrag(renderer, 'rotate', origin)
    await pointer('pointermove', dragPoint('rotate', 10, origin))
    await settle(renderer)
    expect(ui(renderer).includes(BLOCK_SUPPORT_REFUSAL)).toBe(true)
    await pointer('pointerup')
    await settle(renderer)
    expect(nodes()).toEqual(before)
    expect(writes).toBe(0)
    expect(useScene.temporal.getState().pastStates).toHaveLength(0)
    expect(useInteractionScope.getState().scope).toMatchObject({ phase: 'selecting' })
    expect(useLiveNodeOverrides.getState().overrides.size).toBe(0)
    expect(ui(renderer).includes(BLOCK_SUPPORT_REFUSAL)).toBe(false)
  } finally {
    unsubscribe()
    await renderer.unmount()
  }
})
