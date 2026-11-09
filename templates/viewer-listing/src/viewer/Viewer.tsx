import { OrbitControls } from '@react-three/drei'
import { Canvas, useThree } from '@react-three/fiber'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  type DirectionalLight,
  NeutralToneMapping,
  type PerspectiveCamera,
  PMREMGenerator,
  Sphere,
  Vector3,
} from 'three'
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js'
import type { SceneGraph } from '../pascal'
import { Model, type ModelInfo } from './Model'
import type { RoomHover } from './semantics'

export type ViewerProps = {
  bytes: ArrayBuffer
  graph: SceneGraph
  levelId: string | null
  label: string
  onReady: (info: ModelInfo) => void
  onError: (error: unknown) => void
  onHover: (hover: (RoomHover & { x: number; y: number }) | null) => void
}

/** The 3D canvas: the baked model under neutral studio light. Swap this file to restyle. */
export function Viewer({ label, onReady, ...modelProps }: ViewerProps) {
  const [model, setModel] = useState<ModelInfo | null>(null)
  const handleReady = useCallback(
    (info: ModelInfo) => {
      setModel(info)
      onReady(info)
    },
    [onReady],
  )

  return (
    <Canvas
      aria-label={label}
      camera={{ fov: 40, position: [10, 8, 12] }}
      dpr={[1, 2]}
      frameloop="demand"
      gl={{ antialias: true }}
      shadows="percentage"
      onCreated={({ gl }) => {
        gl.toneMapping = NeutralToneMapping
      }}
    >
      <color args={['#eef0f4']} attach="background" />
      <StudioEnvironment />
      <Model {...modelProps} onReady={handleReady} />
      {model ? <Stage model={model} /> : null}
      <OrbitControls enableDamping makeDefault maxPolarAngle={Math.PI / 2 - 0.05} />
    </Canvas>
  )
}

/** Image-based light from three's built-in room: no HDR download, no CDN. */
function StudioEnvironment() {
  const gl = useThree((state) => state.gl)
  const scene = useThree((state) => state.scene)
  useEffect(() => {
    const pmrem = new PMREMGenerator(gl)
    const room = new RoomEnvironment()
    const texture = pmrem.fromScene(room, 0.04).texture
    scene.environment = texture
    scene.environmentIntensity = 0.7
    room.dispose()
    pmrem.dispose()
    return () => {
      scene.environment = null
      texture.dispose()
    }
  }, [gl, scene])
  return null
}

/** The key light's direction: high and behind-left of the default view, so shadows fall towards it. */
const SUN = new Vector3(-0.5, 1, -0.15).normalize()

/**
 * Frames the camera on the model and grounds it: one directional light casts a
 * soft shadow onto the site's own ground, or onto a shadow-only floor when the
 * scene has none.
 */
function Stage({ model }: { model: ModelInfo }) {
  const { bounds, ground } = model
  const camera = useThree((state) => state.camera) as PerspectiveCamera
  const controls = useThree((state) => state.controls) as unknown as {
    target: Vector3
    update: () => void
  } | null
  const invalidate = useThree((state) => state.invalidate)
  const light = useRef<DirectionalLight>(null)
  const sphere = useMemo(() => bounds.getBoundingSphere(new Sphere()), [bounds])
  const radius = Math.max(sphere.radius, 0.5)

  useEffect(() => {
    const distance = (radius / Math.sin((camera.fov * Math.PI) / 360)) * 0.9
    camera.position
      .copy(sphere.center)
      .addScaledVector(new Vector3(1, 0.75, 1.2).normalize(), distance)
    camera.near = distance / 100
    camera.far = distance * 10
    camera.updateProjectionMatrix()
    controls?.target.copy(sphere.center)
    controls?.update()
  }, [camera, controls, radius, sphere])

  useEffect(() => {
    const sun = light.current
    if (!sun) return
    sun.position.copy(sphere.center).addScaledVector(SUN, radius * 2)
    sun.target.position.copy(sphere.center)
    sun.target.updateMatrixWorld()
    const shadowCamera = sun.shadow.camera
    shadowCamera.left = shadowCamera.bottom = -radius
    shadowCamera.right = shadowCamera.top = radius
    shadowCamera.near = radius * 0.5
    shadowCamera.far = radius * 4
    shadowCamera.updateProjectionMatrix()
    invalidate()
  }, [invalidate, radius, sphere])

  const floorY = ground ?? bounds.min.y
  return (
    <>
      <directionalLight
        castShadow
        intensity={2}
        ref={light}
        shadow-bias={-0.0004}
        shadow-mapSize={[2048, 2048]}
        shadow-normalBias={0.03}
        shadow-radius={4}
      />
      {ground === null ? (
        <mesh
          position={[sphere.center.x, floorY, sphere.center.z]}
          receiveShadow
          rotation-x={-Math.PI / 2}
        >
          <planeGeometry args={[radius * 6, radius * 6]} />
          <shadowMaterial opacity={0.18} />
        </mesh>
      ) : null}
    </>
  )
}
