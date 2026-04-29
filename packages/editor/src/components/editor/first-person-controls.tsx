'use client'

import '../../three-types'
import { KeyboardControls } from '@react-three/drei'
import { sceneRegistry, useScene } from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import { useFrame, useThree } from '@react-three/fiber'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Euler, Vector3 } from 'three'
import useEditor from '../../store/use-editor'
import BVHEcctrl from './first-person/bvh-ecctrl'
import type { BVHEcctrlApi } from './first-person/bvh-ecctrl'
import {
  buildFirstPersonColliderWorldFromRegistry,
  deriveFirstPersonSpawn,
  FIRST_PERSON_SPAWN_EYE_HEIGHT,
  type FirstPersonColliderWorld,
  type FirstPersonSpawn,
} from './first-person/build-collider-world'

const CAMERA_EYE_OFFSET = 0.45
const LOOK_SENSITIVITY = 0.002
const CONTROLLER_CENTER_FROM_EYE = 0.85
const keyboardMap = [
  { name: 'forward', keys: ['ArrowUp', 'KeyW'] },
  { name: 'backward', keys: ['ArrowDown', 'KeyS'] },
  { name: 'leftward', keys: ['ArrowLeft', 'KeyA'] },
  { name: 'rightward', keys: ['ArrowRight', 'KeyD'] },
  { name: 'jump', keys: ['Space'] },
  { name: 'run', keys: ['ShiftLeft', 'ShiftRight'] },
]

const cameraOffset = new Vector3(0, CAMERA_EYE_OFFSET, 0)
const cameraEuler = new Euler(0, 0, 0, 'YXZ')
const spawnWorldPosition = new Vector3()
const spawnWorldEuler = new Euler(0, 0, 0, 'YXZ')

const resolvePlacedSpawnNode = (
  nodes: ReturnType<typeof useScene.getState>['nodes'],
  _levelId: string | null,
 ) => {
  const candidates = Object.values(nodes).filter((node) => node.type === 'spawn')
  if (candidates.length === 0) return null

  return [...candidates].sort((a, b) => a.id.localeCompare(b.id))[0] ?? null
}

export const FirstPersonControls = () => {
  const { camera, gl } = useThree()
  const selectedLevelId = useViewer((state) => state.selection.levelId)
  const placedSpawnNode = useScene((state) => resolvePlacedSpawnNode(state.nodes, selectedLevelId))
  const controllerRef = useRef<BVHEcctrlApi | null>(null)
  const yawRef = useRef(0)
  const pitchRef = useRef(0)
  const [world, setWorld] = useState<FirstPersonColliderWorld | null>(null)

  const placedSpawn = useMemo<FirstPersonSpawn | null>(() => {
    if (!(placedSpawnNode && placedSpawnNode.type === 'spawn')) return null

    const spawnObject = sceneRegistry.nodes.get(placedSpawnNode.id)
    if (spawnObject) {
      spawnObject.updateWorldMatrix(true, false)
      spawnObject.getWorldPosition(spawnWorldPosition)
      spawnWorldEuler.setFromRotationMatrix(spawnObject.matrixWorld, 'YXZ')

      return {
        position: [
          spawnWorldPosition.x,
          spawnWorldPosition.y + FIRST_PERSON_SPAWN_EYE_HEIGHT,
          spawnWorldPosition.z,
        ],
        yaw: spawnWorldEuler.y,
      }
    }

    return {
      position: [
        placedSpawnNode.position[0],
        placedSpawnNode.position[1] + FIRST_PERSON_SPAWN_EYE_HEIGHT,
        placedSpawnNode.position[2],
      ],
      yaw: placedSpawnNode.rotation,
    }
  }, [placedSpawnNode])

  useEffect(() => {
    const nextWorld = buildFirstPersonColliderWorldFromRegistry()
    if (!nextWorld) {
      setWorld(null)
      return
    }

    setWorld(nextWorld)

    return () => {
      nextWorld.dispose()
      setWorld(null)
    }
  }, [camera])

  useEffect(() => {
    if (!world) return
    yawRef.current = (placedSpawn ?? deriveFirstPersonSpawn(camera, world)).yaw
    pitchRef.current = 0
  }, [camera, placedSpawn, world])

  useEffect(() => {
    const canvas = gl.domElement
    const handleMouseMove = (e: MouseEvent) => {
      if (document.pointerLockElement !== canvas) return

      yawRef.current -= e.movementX * LOOK_SENSITIVITY
      pitchRef.current = Math.max(
        -(Math.PI / 2 - 0.05),
        Math.min(Math.PI / 2 - 0.05, pitchRef.current - e.movementY * LOOK_SENSITIVITY),
      )
    }

    const handleClick = (event: MouseEvent) => {
      const target = event.target
      if (!(target instanceof HTMLElement)) return
      if (!canvas.contains(target)) return
      if (document.pointerLockElement !== canvas) {
        canvas.requestPointerLock?.()
      }
    }

    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('click', handleClick)

    return () => {
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('click', handleClick)
      if (document.pointerLockElement === canvas) {
        document.exitPointerLock()
      }
    }
  }, [gl])

  useEffect(() => {
    const canvas = gl.domElement

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) {
        return
      }

      if (event.code === 'Escape') {
        event.preventDefault()
        event.stopPropagation()
        if (document.pointerLockElement === canvas) {
          document.exitPointerLock()
        }
        useEditor.getState().setFirstPersonMode(false)
      }
    }

    document.addEventListener('keydown', handleKeyDown, true)
    return () => {
      document.removeEventListener('keydown', handleKeyDown, true)
    }
  }, [gl])

  useFrame((_, delta) => {
    if (!controllerRef.current?.group) return

    const group = controllerRef.current.group
    group.rotation.y = 0
    camera.position.copy(group.position).add(cameraOffset)
    cameraEuler.set(pitchRef.current, yawRef.current, 0, 'YXZ')
    camera.quaternion.setFromEuler(cameraEuler)
    camera.updateMatrixWorld(true)
  })

  const controllerPosition = useMemo(() => {
    if (!world) return null
    const [x, y, z] = (placedSpawn ?? deriveFirstPersonSpawn(camera, world)).position
    return [x, y - CONTROLLER_CENTER_FROM_EYE, z] as const
  }, [camera, placedSpawn, world])

  const spawnYaw = useMemo(() => {
    if (!world) return 0
    return (placedSpawn ?? deriveFirstPersonSpawn(camera, world)).yaw
  }, [camera, placedSpawn, world])

  if (!world) {
    return null
  }

  return (
    <>
      {controllerPosition && (
        <KeyboardControls map={keyboardMap}>
          <BVHEcctrl
            ref={controllerRef}
            key={`${world.mesh.uuid}:${controllerPosition.join(':')}:${spawnYaw}`}
            colliderCapsuleArgs={[0.25, 0.8, 4, 8]}
            colliderMeshes={[world.mesh]}
            collisionCheckIteration={3}
            collisionPushBackDamping={0.1}
            collisionPushBackThreshold={0.001}
            debug={false}
            delay={0}
            fallGravityFactor={4}
            floatCheckType="BOTH"
            floatDampingC={36}
            floatHeight={0.5}
            floatPullBackHeight={0.35}
            floatSensorRadius={0.15}
            floatSpringK={1200}
            gravity={9.81}
            jumpVel={6}
            maxRunSpeed={5.5}
            maxSlope={1.2}
            maxWalkSpeed={4}
            position={controllerPosition}
            acceleration={26}
            airDragFactor={0.3}
            deceleration={30}
          />
        </KeyboardControls>
      )}
    </>
  )
}

/**
 * Overlay UI for first-person mode: crosshair, controls hint, exit button.
 * Rendered as a regular DOM overlay (not inside the Canvas).
 */
export const FirstPersonOverlay = ({ onExit }: { onExit: () => void }) => {
  const [isLocked, setIsLocked] = useState(false)
  const hasPlacedSpawn = useScene((state) =>
    Object.values(state.nodes).some((node) => node.type === 'spawn'),
  )

  useEffect(() => {
    const handlePointerLockChange = () => {
      setIsLocked(document.pointerLockElement != null)
    }

    handlePointerLockChange()
    document.addEventListener('pointerlockchange', handlePointerLockChange)
    return () => {
      document.removeEventListener('pointerlockchange', handlePointerLockChange)
    }
  }, [])

  const handleExit = useCallback(() => {
    if (document.pointerLockElement) {
      document.exitPointerLock()
    }
    onExit()
  }, [onExit])

  return (
    <>
      {isLocked && (
        <div className="pointer-events-none fixed inset-0 z-40 flex items-center justify-center">
          <div className="relative h-7 w-7">
            <div className="absolute top-1/2 left-1/2 h-px w-7 -translate-x-1/2 -translate-y-1/2 bg-white/60" />
            <div className="absolute top-1/2 left-1/2 h-7 w-px -translate-x-1/2 -translate-y-1/2 bg-white/60" />
          </div>
        </div>
      )}

      <div className="fixed top-4 right-4 z-50">
        <button
          className="pointer-events-auto flex items-center gap-2 rounded-xl border border-border/40 bg-background/90 px-4 py-2 font-medium text-foreground text-sm shadow-lg backdrop-blur-xl transition-colors hover:bg-background"
          onClick={handleExit}
          type="button"
        >
          <kbd className="rounded border border-border/50 bg-accent/50 px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
            ESC
          </kbd>
          Exit Street View
        </button>
      </div>

      {!hasPlacedSpawn && (
        <div className="fixed top-4 left-1/2 z-50 -translate-x-1/2">
          <div className="rounded-2xl border border-sky-300/35 bg-slate-950/88 px-4 py-2 text-center text-slate-100 text-sm shadow-lg backdrop-blur-xl">
            Place a Spawn Point from the Build tab to control where walkthrough starts.
          </div>
        </div>
      )}

      {isLocked && (
        <div className="pointer-events-none fixed top-1/2 right-6 z-40 -translate-y-1/2">
          <div className="flex min-w-[148px] flex-col gap-3 rounded-2xl border border-border/35 bg-background/80 px-4 py-4 shadow-lg backdrop-blur-xl">
            <ControlHint label="Move" keys={['W', 'A', 'S', 'D']} />
            <div className="h-px w-full bg-border/30" />
            <InlineControlHint label="Jump" keyLabel="Space" />
            <InlineControlHint label="Sprint" keyLabel="Shift" />
            <div className="h-px w-full bg-border/30" />
            <span className="text-center text-muted-foreground/60 text-xs">Click to look around</span>
          </div>
        </div>
      )}
    </>
  )
}

function ControlHint({ label, keys }: { label: string; keys: string[] }) {
  return (
    <div className="flex flex-col items-center gap-1.5 text-center">
      <span className="font-medium text-[10px] text-muted-foreground/60 tracking-[0.03em]">
        {label}
      </span>
      <div className="flex flex-wrap items-center justify-center gap-1">
        {keys.map((key) => (
          <kbd
            className="flex h-5 min-w-5 items-center justify-center rounded border border-border/50 bg-accent/40 px-1 font-mono text-[10px] text-foreground/80 leading-none"
            key={key}
          >
            {key}
          </kbd>
        ))}
      </div>
    </div>
  )
}

function InlineControlHint({ label, keyLabel }: { label: string; keyLabel: string }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="font-medium text-[10px] text-muted-foreground/60 tracking-[0.03em] uppercase">
        {label}
      </span>
      <kbd className="flex h-5 min-w-5 items-center justify-center rounded border border-border/50 bg-accent/40 px-1.5 font-mono text-[10px] text-foreground/80 leading-none">
        {keyLabel}
      </kbd>
    </div>
  )
}
