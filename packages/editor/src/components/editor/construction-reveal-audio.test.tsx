import { expect, spyOn, test } from 'bun:test'
import {
  type AnyNode,
  type AnyNodeDefinition,
  BaseNode,
  LevelNode,
  nodeRegistry,
  objectId,
  registerNode,
  runAsSceneCommitAuthor,
  sceneRegistry,
  useScene,
} from '@pascal-app/core'
import {
  type RevealGroupEvent,
  startConstructionReveal,
  subscribeRevealEvents,
  useViewer,
} from '@pascal-app/viewer'
import { act, create } from '@react-three/test-renderer'
import { BoxGeometry, Mesh, MeshBasicMaterial } from 'three'
import { sfxEmitter } from '../../lib/sfx-bus'
import { ConstructionRevealAudio } from './construction-reveal-audio'

test('real reveal landings respect audio controls and the shared cue clock', async () => {
  const restore = nodeRegistry._snapshot()
  const savedScene = useScene.getState()
  const savedHistory = useScene.temporal.getState()
  const savedViewer = useViewer.getState()
  const savedObjects = new Map(sceneRegistry.nodes)
  const actDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'IS_REACT_ACT_ENVIRONMENT')
  const rafDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'requestAnimationFrame')
  const cancelDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'cancelAnimationFrame')
  Object.defineProperties(globalThis, {
    IS_REACT_ACT_ENVIRONMENT: { configurable: true, value: true },
    requestAnimationFrame: { configurable: true, value: () => 0 },
    cancelAnimationFrame: { configurable: true, value: () => {} },
  })
  let audioClock = 0
  const clock = spyOn(performance, 'now').mockImplementation(() => audioClock)
  const cues: string[] = []
  const observe = (name: string) => cues.push(name)
  sfxEmitter.on('*', observe)
  const events: RevealGroupEvent[] = []
  const stopObserve = subscribeRevealEvents((event) => {
    if (event.type === 'land') events.push(event)
  })
  let instant = false
  let time = 0
  let index = 0
  const meshes: Mesh[] = []
  const schema = BaseNode.extend({ id: objectId('audio-smoke') })
  for (const [kind, phase] of [
    ['audio:structure', 'structure'],
    ['audio:furnishing', 'furnishing'],
  ] as const) {
    registerNode({
      kind,
      schemaVersion: 1,
      schema,
      category: 'utility',
      defaults: () => ({}),
      capabilities: { reveal: { phase, style: 'scale' } },
    } as unknown as AnyNodeDefinition)
  }
  const level = LevelNode.parse({ id: 'level_audio_smoke' })
  useScene.setState({ nodes: { [level.id]: level }, rootNodeIds: [level.id], readOnly: false })
  useViewer.setState({ renderContext: 'editor', isExporting: false })
  useViewer
    .getState()
    .setSelection({ levelId: level.id, buildingId: null, selectedIds: [], zoneId: null })
  const driver = startConstructionReveal({
    reveals: (commit) => commit.author === 'agent',
    level: () => 'full',
    prefersReducedMotion: () => instant,
  })
  const renderer = await create(<ConstructionRevealAudio enabled={false} level="full" />)
  async function land(kind = 'audio:structure') {
    const id = `audio-smoke_${++index}`
    const node = { ...schema.parse({ id }), type: kind, parentId: level.id } as unknown as AnyNode
    const mesh = new Mesh(new BoxGeometry(1, 1, 1), new MeshBasicMaterial())
    meshes.push(mesh)
    sceneRegistry.nodes.set(node.id, mesh)
    const before = events.length
    await act(async () =>
      runAsSceneCommitAuthor('agent', () => useScene.getState().createNode(node, level.id)),
    )
    // A real CPU mesh supplies the renderer's ready handshake, not drawn pixels.
    useScene.getState().clearDirty(node.id)
    for (let frame = 0; frame < 150; frame++) {
      time += 20
      await act(async () => driver.tick(time, 20))
    }
    expect(events.length).toBeGreaterThan(before)
    expect(Boolean(events.at(-1)?.instant)).toBe(instant)
  }
  try {
    await land()
    expect(cues).toEqual([])
    await renderer.update(<ConstructionRevealAudio enabled={true} level="simple" />)
    await land()
    expect(cues).toEqual([])
    await renderer.update(<ConstructionRevealAudio enabled={true} level="off" />)
    await land()
    expect(cues).toEqual([])
    await renderer.update(<ConstructionRevealAudio enabled={true} level="full" />)
    await land()
    expect(cues).toEqual(['sfx:structure-build'])
    await renderer.update(<ConstructionRevealAudio enabled={false} level="full" />)
    await renderer.update(<ConstructionRevealAudio enabled={true} level="framing" />)
    audioClock = 249
    await land()
    expect(cues).toEqual(['sfx:structure-build'])
    audioClock = 250
    await land('audio:furnishing')
    expect(cues).toEqual(['sfx:structure-build', 'sfx:item-place'])
    audioClock = 1000
    instant = true
    await land()
    expect(cues).toHaveLength(2)
    await renderer.unmount()
    instant = false
    await land()
    expect(cues).toHaveLength(2)
  } finally {
    driver.stop()
    await renderer.unmount()
    stopObserve()
    sfxEmitter.off('*', observe)
    clock.mockRestore()
    restore()
    useScene.setState(savedScene, true)
    useScene.temporal.setState(savedHistory, true)
    useViewer.setState(savedViewer, true)
    sceneRegistry.nodes.clear()
    for (const [id, mesh] of savedObjects) sceneRegistry.nodes.set(id, mesh)
    for (const mesh of meshes) {
      mesh.geometry.dispose()
      ;(mesh.material as MeshBasicMaterial).dispose()
    }
    for (const [name, descriptor] of [
      ['IS_REACT_ACT_ENVIRONMENT', actDescriptor],
      ['requestAnimationFrame', rafDescriptor],
      ['cancelAnimationFrame', cancelDescriptor],
    ] as const) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor)
      else Reflect.deleteProperty(globalThis, name)
    }
  }
})
