import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import {
  type CameraPose,
  type CollectionId,
  emitter,
  SectionPlaneNode,
  useScene,
} from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import { cameraPoseStore, publishCameraPose } from '../store/camera-pose-store'
import useEditor from '../store/use-editor'
import {
  applySavedView,
  captureSavedView,
  readSavedViewPresentation,
  updateSavedViewFromCurrentState,
} from './saved-views'

// Polyfills for bun:test (no DOM) — `updateNodes` schedules its dirty flush
// on an animation frame.
type RafFn = (cb: (t: number) => void) => number
;(globalThis as unknown as { requestAnimationFrame?: RafFn }).requestAnimationFrame ??= ((
  cb: (t: number) => void,
) => {
  cb(0)
  return 0
}) as RafFn
;(globalThis as unknown as { cancelAnimationFrame?: (id: number) => void }).cancelAnimationFrame ??=
  () => {}

const POSE: CameraPose = {
  position: [12, 8, 12],
  target: [0, 0, 0],
  projection: 'perspective',
}

function resetScene() {
  useScene.setState({
    nodes: {},
    rootNodeIds: [],
    collections: {},
    savedViews: {},
    readOnly: false,
  })
}

beforeEach(() => {
  resetScene()
  cameraPoseStore.setState({ pose: null })
  useViewer.setState({ levelMode: 'stacked', wallMode: 'up', sceneTheme: 'studio' })
  useEditor.setState({ viewMode: '3d' })
})

afterEach(() => {
  resetScene()
  cameraPoseStore.setState({ pose: null })
})

describe('captureSavedView', () => {
  test('refuses to capture before the camera has published a pose', () => {
    expect(captureSavedView('Entry')).toBeNull()
    expect(Object.keys(useScene.getState().savedViews)).toHaveLength(0)
  })

  test('snapshots camera and presentation state', () => {
    publishCameraPose(POSE)
    useViewer.setState({ levelMode: 'exploded', wallMode: 'cutaway', sceneTheme: 'noon' })
    useEditor.setState({ viewMode: 'split' })

    const id = captureSavedView('Entry')
    expect(id).not.toBeNull()
    if (!id) return

    const view = useScene.getState().savedViews[id]
    expect(view?.name).toBe('Entry')
    expect(view?.camera).toEqual(POSE)
    expect(readSavedViewPresentation(view!)).toMatchObject({
      viewMode: 'split',
      levelMode: 'exploded',
      wallMode: 'cutaway',
      sceneTheme: 'noon',
    })
  })

  test('copies the pose rather than aliasing the live one', () => {
    publishCameraPose({ ...POSE })
    const id = captureSavedView('Entry')
    if (!id) throw new Error('expected a view')

    publishCameraPose({ ...POSE, position: [99, 99, 99] })
    expect(useScene.getState().savedViews[id]?.camera.position).toEqual([12, 8, 12])
  })

  test('records the active section plane, and null when nothing is cutting', () => {
    publishCameraPose(POSE)
    const plane = SectionPlaneNode.parse({ active: true })
    useScene.setState({ nodes: { [plane.id]: plane } })

    const withCut = captureSavedView('Cut')
    expect(useScene.getState().savedViews[withCut!]?.sectionPlaneId).toBe(plane.id)

    useScene.setState({ nodes: { [plane.id]: { ...plane, active: false } } })
    const withoutCut = captureSavedView('No cut')
    expect(useScene.getState().savedViews[withoutCut!]?.sectionPlaneId).toBeNull()
  })

  test('resolves each collection’s implicit default into an explicit flag', () => {
    publishCameraPose(POSE)
    useScene.setState({
      collections: {
        ['collection_1' as CollectionId]: {
          id: 'collection_1' as CollectionId,
          name: 'Trees',
          nodeIds: [],
        },
      },
    })

    const id = captureSavedView('Entry')
    expect(useScene.getState().savedViews[id!]?.collectionStates).toEqual({
      collection_1: { visible: true, locked: false },
    })
  })

  test('appends in list order', () => {
    publishCameraPose(POSE)
    const first = captureSavedView('A')
    const second = captureSavedView('B')

    const views = useScene.getState().savedViews
    expect(views[first!]?.order).toBe(0)
    expect(views[second!]?.order).toBe(1)
  })
})

describe('applySavedView', () => {
  test('restores presentation state', () => {
    publishCameraPose(POSE)
    useViewer.setState({ levelMode: 'solo', wallMode: 'down', sceneTheme: 'noon' })
    useEditor.setState({ viewMode: '2d' })
    const id = captureSavedView('Saved')
    if (!id) throw new Error('expected a view')

    useViewer.setState({ levelMode: 'stacked', wallMode: 'up', sceneTheme: 'studio' })
    useEditor.setState({ viewMode: '3d' })

    expect(applySavedView(id)).toBe(true)
    expect(useViewer.getState()).toMatchObject({
      levelMode: 'solo',
      wallMode: 'down',
      sceneTheme: 'noon',
    })
    expect(useEditor.getState().viewMode).toBe('2d')
  })

  test('emits the camera pose so the controls can fly to it', () => {
    publishCameraPose(POSE)
    const id = captureSavedView('Saved')
    if (!id) throw new Error('expected a view')

    const applied: CameraPose[] = []
    const listener = (pose: CameraPose) => {
      applied.push(pose)
    }
    emitter.on('camera-controls:apply-pose', listener)
    applySavedView(id)
    emitter.off('camera-controls:apply-pose', listener)

    expect(applied).toEqual([POSE])
  })

  test('makes the recorded plane the only one cutting', () => {
    publishCameraPose(POSE)
    const first = SectionPlaneNode.parse({ active: true })
    const second = SectionPlaneNode.parse({ active: false })
    useScene.setState({ nodes: { [first.id]: first, [second.id]: second } })

    const id = captureSavedView('First cut')
    if (!id) throw new Error('expected a view')

    // Flip the cut the other way, then restore.
    useScene.setState({
      nodes: {
        [first.id]: { ...first, active: false },
        [second.id]: { ...second, active: true },
      },
    })
    applySavedView(id)

    const nodes = useScene.getState().nodes
    expect((nodes[first.id] as typeof first).active).toBe(true)
    expect((nodes[second.id] as typeof second).active).toBe(false)
  })

  test('restoring a view is one undo step, not one per collection', () => {
    publishCameraPose(POSE)
    const collections = {
      ['collection_1' as CollectionId]: {
        id: 'collection_1' as CollectionId,
        name: 'A',
        nodeIds: [],
        visible: true,
      },
      ['collection_2' as CollectionId]: {
        id: 'collection_2' as CollectionId,
        name: 'B',
        nodeIds: [],
        visible: true,
      },
    }
    useScene.setState({ collections })

    const id = captureSavedView('Both visible')
    if (!id) throw new Error('expected a view')

    useScene.setState({
      collections: {
        collection_1: { ...collections.collection_1, visible: false },
        collection_2: { ...collections.collection_2, visible: false },
      } as typeof collections,
    })

    const before = useScene.temporal.getState().pastStates.length
    applySavedView(id)
    const after = useScene.temporal.getState().pastStates.length

    expect(after - before).toBeLessThanOrEqual(1)
    expect(useScene.getState().collections.collection_1?.visible).toBe(true)
    expect(useScene.getState().collections.collection_2?.visible).toBe(true)
  })

  test('a view that predates section planes leaves the current cut alone', () => {
    const plane = SectionPlaneNode.parse({ active: true })
    useScene.setState({ nodes: { [plane.id]: plane } })
    const id = useScene.getState().createSavedView({ name: 'Legacy', camera: POSE })

    applySavedView(id)

    expect((useScene.getState().nodes[plane.id] as typeof plane).active).toBe(true)
  })

  test('returns false for an unknown view', () => {
    expect(applySavedView('saved-view_nope' as never)).toBe(false)
  })
})

describe('updateSavedViewFromCurrentState', () => {
  test('re-captures in place, keeping name and order', () => {
    publishCameraPose(POSE)
    const id = captureSavedView('Entry')
    if (!id) throw new Error('expected a view')

    publishCameraPose({ ...POSE, position: [1, 2, 3] })
    useViewer.setState({ wallMode: 'translucent' })

    expect(updateSavedViewFromCurrentState(id)).toBe(true)
    const view = useScene.getState().savedViews[id]
    expect(view?.name).toBe('Entry')
    expect(view?.order).toBe(0)
    expect(view?.camera.position).toEqual([1, 2, 3])
    expect(readSavedViewPresentation(view!).wallMode).toBe('translucent')
  })

  test('refuses when the view is gone', () => {
    publishCameraPose(POSE)
    expect(updateSavedViewFromCurrentState('saved-view_nope' as never)).toBe(false)
  })
})

describe('readSavedViewPresentation', () => {
  test('drops values it does not recognise rather than restoring nonsense', () => {
    const id = useScene.getState().createSavedView({
      name: 'Odd',
      camera: POSE,
      presentation: { viewMode: 'hologram', levelMode: 'exploded', wallMode: 42 },
    })

    const presentation = readSavedViewPresentation(useScene.getState().savedViews[id]!)
    expect(presentation.viewMode).toBeUndefined()
    expect(presentation.wallMode).toBeUndefined()
    expect(presentation.levelMode).toBe('exploded')
  })
})
