import { type ThreeEvent, useFrame, useThree } from '@react-three/fiber'
import { useEffect, useMemo, useRef, useState } from 'react'
import {
  type AnimationAction,
  AnimationMixer,
  type Box3,
  LoopOnce,
  Mesh,
  type Object3D,
} from 'three'
import type { GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js'
import type { SceneGraph } from '../pascal'
import { createGltfLoader } from './loaders'
import {
  applyLevelVisibility,
  firstVisibleHit,
  focusBounds,
  groundHeight,
  indexScene,
  openableAt,
  type RoomHover,
  roomAt,
} from './semantics'

export type ModelInfo = {
  /** What the camera frames (the buildings). */
  bounds: Box3
  /** Height of the site's own ground, or null when the scene brings none. */
  ground: number | null
  hasOpenables: boolean
}

type ModelProps = {
  bytes: ArrayBuffer
  graph: SceneGraph
  levelId: string | null
  onReady: (info: ModelInfo) => void
  onError: (error: unknown) => void
  onHover: (hover: (RoomHover & { x: number; y: number }) | null) => void
}

export function Model({ bytes, graph, levelId, onReady, onError, onHover }: ModelProps) {
  const gl = useThree((state) => state.gl)
  const invalidate = useThree((state) => state.invalidate)
  const [gltf, setGltf] = useState<GLTF | null>(null)

  useEffect(() => {
    let cancelled = false
    const { loader, dispose } = createGltfLoader(gl)
    // Parse a copy: the downloaded bytes outlive this effect (StrictMode runs it twice in
    // development) and the loaders may hand buffers to workers.
    loader
      .parseAsync(bytes.slice(0), '')
      .then((result) => {
        if (cancelled) return
        castShadows(result.scene)
        setGltf(result)
      })
      .catch((error) => !cancelled && onError(error))
    return () => {
      cancelled = true
      dispose()
    }
  }, [bytes, gl, onError])

  const index = useMemo(
    () => (gltf ? indexScene(gltf.scene, graph, gltf.animations) : null),
    [gltf, graph],
  )
  const mixer = useMemo(() => (gltf ? new AnimationMixer(gltf.scene) : null), [gltf])
  const open = useRef(new Map<string, boolean>())
  const playing = useRef(new Set<AnimationAction>())

  useEffect(() => {
    if (!(gltf && index)) return
    const bounds = focusBounds(gltf.scene)
    onReady({
      bounds,
      ground: groundHeight(gltf.scene),
      hasOpenables: index.hasOpenables,
    })
  }, [gltf, index, onReady])

  useEffect(() => {
    if (!index) return
    applyLevelVisibility(index, levelId)
    invalidate()
  }, [index, levelId, invalidate])

  useEffect(
    () => () => {
      mixer?.stopAllAction()
    },
    [mixer],
  )

  // The canvas renders on demand; keep frames coming only while a clip moves.
  useFrame((_, delta) => {
    if (!mixer || playing.current.size === 0) return
    mixer.update(delta)
    for (const action of playing.current) if (!action.isRunning()) playing.current.delete(action)
    invalidate()
  })

  if (!(gltf && index && mixer)) return null

  const handleMove = (event: ThreeEvent<PointerEvent>) => {
    event.stopPropagation()
    const hit = firstVisibleHit(event.intersections)
    const room = hit ? roomAt(index, graph, hit) : null
    gl.domElement.style.cursor = hit && openableAt(index, hit) ? 'pointer' : ''
    onHover(room ? { ...room, x: event.clientX, y: event.clientY } : null)
  }

  const handleClick = (event: ThreeEvent<MouseEvent>) => {
    event.stopPropagation()
    if (event.delta > 4) return // an orbit drag, not a click
    const hit = firstVisibleHit(event.intersections)
    const target = hit && openableAt(index, hit)
    if (!target) return
    const willOpen = !open.current.get(target.id)
    open.current.set(target.id, willOpen)
    const action = mixer.clipAction(target.clip)
    action.setLoop(LoopOnce, 1)
    action.clampWhenFinished = true
    action.timeScale = willOpen ? 1 : -1
    action.paused = false
    action.play()
    playing.current.add(action)
    invalidate()
  }

  return (
    <primitive
      object={gltf.scene}
      onClick={handleClick}
      onPointerMove={handleMove}
      onPointerOut={() => {
        gl.domElement.style.cursor = ''
        onHover(null)
      }}
    />
  )
}

/** Every mesh receives the key light's shadow; all but glass cast one. */
function castShadows(root: Object3D) {
  root.traverse((object) => {
    if (!(object instanceof Mesh)) return
    object.castShadow = !(object.material as { transparent?: boolean }).transparent
    object.receiveShadow = true
  })
}
