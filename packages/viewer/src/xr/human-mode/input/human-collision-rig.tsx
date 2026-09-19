'use client'

import { useFrame, useThree } from '@react-three/fiber'
import { useXR } from '@react-three/xr'
import { type RefObject, useEffect, useRef } from 'react'
import { type Mesh, type Object3D, Quaternion, Vector3 } from 'three'
import { useXRPlayerMode, XR_PLAYER_MODES } from '../../mode-switching/store/player-mode'
import { resolveRoomScaleOriginCorrection } from '../lib/capsule-collision'
import { setActiveHumanColliders } from '../store/collision-store'

function collectColliders(root: Object3D) {
  const colliders: Mesh[] = []
  root.traverse((object) => {
    const mesh = object as Mesh
    if (
      mesh.isMesh &&
      mesh.visible &&
      mesh.geometry?.boundsTree &&
      mesh.userData.excludeFromBvh !== true
    ) {
      colliders.push(mesh)
    }
  })
  return colliders
}

export function HumanCollisionRig({ sceneRootRef }: { sceneRootRef: RefObject<Object3D | null> }) {
  const camera = useThree((state) => state.camera)
  const origin = useXR((state) => state.origin)
  const mode = useXRPlayerMode((state) => state.mode)
  const colliders = useRef<Mesh[]>([])
  const collected = useRef(false)
  const hasViewerPose = useRef(false)
  const previousLocalPosition = useRef(new Vector3())
  const currentLocalPosition = useRef(new Vector3())
  const currentWorldPosition = useRef(new Vector3())
  const previousWorldPosition = useRef(new Vector3())
  const physicalMovement = useRef(new Vector3())
  const originWorldRotation = useRef(new Quaternion())
  const originCorrection = useRef(new Vector3())

  useEffect(() => {
    if (mode !== XR_PLAYER_MODES.HUMAN) {
      colliders.current = []
      collected.current = false
      hasViewerPose.current = false
      setActiveHumanColliders([])
    }
  }, [mode])

  useFrame(() => {
    if (mode !== XR_PLAYER_MODES.HUMAN || !origin || !sceneRootRef.current) return
    if (!collected.current) {
      colliders.current = collectColliders(sceneRootRef.current)
      if (colliders.current.length > 0) {
        collected.current = true
        setActiveHumanColliders(colliders.current)
      }
    }

    camera.getWorldPosition(currentWorldPosition.current)
    currentLocalPosition.current.copy(currentWorldPosition.current)
    origin.worldToLocal(currentLocalPosition.current)
    if (!hasViewerPose.current) {
      previousLocalPosition.current.copy(currentLocalPosition.current)
      previousWorldPosition.current.copy(currentWorldPosition.current)
      hasViewerPose.current = true
      return
    }

    physicalMovement.current.copy(currentLocalPosition.current).sub(previousLocalPosition.current)
    origin.getWorldQuaternion(originWorldRotation.current)
    physicalMovement.current.applyQuaternion(originWorldRotation.current)
    previousWorldPosition.current.copy(currentWorldPosition.current).sub(physicalMovement.current)
    resolveRoomScaleOriginCorrection(
      colliders.current,
      previousWorldPosition.current,
      currentWorldPosition.current,
      originCorrection.current,
    )
    origin.position.add(originCorrection.current)
    previousLocalPosition.current.copy(currentLocalPosition.current)
  })

  useEffect(() => () => setActiveHumanColliders([]), [])
  return null
}
