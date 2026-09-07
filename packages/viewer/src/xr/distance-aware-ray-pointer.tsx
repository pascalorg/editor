'use client'

import { createPortal, useFrame, useThree } from '@react-three/fiber'
import {
  type DefaultXRInputSourceRayPointerOptions,
  usePointerXRInputSourceEvents,
  useRayPointer,
  useXRInputSourceStateContext,
  XRSpace,
} from '@react-three/xr'
import { useEffect, useMemo, useRef } from 'react'
import { type Layers, type Mesh, type Object3D, Quaternion, RingGeometry, Vector3 } from 'three'
import { BATCHED_LAYER, OVERLAY_LAYER, ZONE_LAYER } from '../lib/layers'
import {
  POINTER_CURSOR_INNER_RADIUS,
  POINTER_CURSOR_OUTER_RADIUS,
  resolvePointerCursorSize,
} from './pointer-cursor'
import { PointerRingMaterial } from './pointer-ring-material'

const NEAR_RAY_HIDE_DISTANCE = 0.2
const Z_AXIS = new Vector3(0, 0, 1)
const ignoreRaycast = () => null

type RayIntersectorWithLayers = {
  raycaster?: { layers: Layers }
}

export function DistanceAwareRayPointer({
  options,
}: {
  options: DefaultXRInputSourceRayPointerOptions
}) {
  const state = useXRInputSourceStateContext()
  const space = useRef(null)
  const rayModel = useRef<Mesh>(null)
  const cursorModel = useRef<Mesh>(null)
  const scene = useThree((current) => current.scene)
  const cursorMaterial = useMemo(() => new PointerRingMaterial(), [])
  const cursorGeometry = useMemo(
    () => new RingGeometry(POINTER_CURSOR_INNER_RADIUS, POINTER_CURSOR_OUTER_RADIUS, 32),
    [],
  )
  const normalQuaternion = useRef(new Quaternion())
  const objectQuaternion = useRef(new Quaternion())
  const cursorOffset = useRef(new Vector3())
  const pointer = useRayPointer(space, state, { ...options, makeDefault: true })
  const rayModelOptions = typeof options.rayModel === 'object' ? options.rayModel : undefined
  const cursorModelOptions =
    typeof options.cursorModel === 'object' ? options.cursorModel : undefined

  usePointerXRInputSourceEvents(pointer, state.inputSource, 'select', state.events)
  useEffect(() => () => cursorMaterial.dispose(), [cursorMaterial])
  useEffect(() => () => cursorGeometry.dispose(), [cursorGeometry])
  useEffect(() => {
    const layers = (pointer.intersector as unknown as RayIntersectorWithLayers).raycaster?.layers
    if (!layers) return
    const mask = layers.mask
    layers.enable(BATCHED_LAYER)
    layers.enable(OVERLAY_LAYER)
    layers.enable(ZONE_LAYER)
    return () => {
      layers.mask = mask
    }
  }, [pointer])

  useFrame(() => {
    const intersection = pointer.getIntersection()
    const distance = intersection?.distance
    if (
      !intersection ||
      distance == null ||
      !pointer.getEnabled() ||
      (intersection.object as Object3D & { isVoidObject?: boolean }).isVoidObject === true
    ) {
      if (rayModel.current) rayModel.current.visible = false
      if (cursorModel.current) cursorModel.current.visible = false
      return
    }

    if (rayModel.current) {
      rayModel.current.visible = distance >= NEAR_RAY_HIDE_DISTANCE
      const rayLength = Math.min(rayModelOptions?.maxLength ?? distance, distance)
      rayModel.current.position.z = -rayLength / 2
      const raySize = rayModelOptions?.size ?? 0.005
      rayModel.current.scale.set(raySize, raySize, rayLength)
    }

    if (!cursorModel.current) return
    cursorModel.current.visible = true
    cursorModel.current.position.copy(intersection.pointOnFace)
    const normal = intersection.normal ?? intersection.face?.normal
    if (normal) {
      normalQuaternion.current.setFromUnitVectors(Z_AXIS, normal)
      intersection.object.getWorldQuaternion(objectQuaternion.current)
      cursorModel.current.quaternion
        .copy(objectQuaternion.current)
        .multiply(normalQuaternion.current)
      cursorOffset.current
        .set(0, 0, cursorModelOptions?.cursorOffset ?? 0.008)
        .applyQuaternion(cursorModel.current.quaternion)
      cursorModel.current.position.add(cursorOffset.current)
    }
    cursorModel.current.scale.setScalar(resolvePointerCursorSize(distance))
    cursorModel.current.updateMatrix()

    if (cursorModelOptions) {
      const color =
        typeof cursorModelOptions.color === 'function'
          ? cursorModelOptions.color(pointer)
          : cursorModelOptions.color
      if (Array.isArray(color)) cursorMaterial.color.set(...color)
      else cursorMaterial.color.set(color ?? 'white')
      cursorMaterial.opacity =
        typeof cursorModelOptions.opacity === 'function'
          ? cursorModelOptions.opacity(pointer)
          : (cursorModelOptions.opacity ?? 0.4)
    }
  })

  const rayColor =
    typeof rayModelOptions?.color === 'function'
      ? rayModelOptions.color(pointer)
      : (rayModelOptions?.color ?? 'white')

  return (
    <XRSpace ref={space} space="target-ray-space">
      {options.rayModel !== false && (
        <mesh
          layers={OVERLAY_LAYER}
          position-z={-0.5}
          raycast={ignoreRaycast}
          ref={rayModel}
          renderOrder={1001}
        >
          <boxGeometry />
          <meshBasicMaterial
            color={rayColor}
            depthWrite={false}
            opacity={0.4}
            toneMapped={false}
            transparent
          />
        </mesh>
      )}
      {createPortal(
        <mesh
          frustumCulled={false}
          layers={OVERLAY_LAYER}
          name="xr-distance-ring-cursor"
          raycast={ignoreRaycast}
          ref={cursorModel}
          renderOrder={1002}
        >
          <primitive attach="geometry" object={cursorGeometry} />
          <primitive attach="material" object={cursorMaterial} />
        </mesh>,
        scene,
      )}
    </XRSpace>
  )
}
