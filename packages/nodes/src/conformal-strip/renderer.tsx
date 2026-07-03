'use client'

import { type ConformalStripNode, useRegistry, useScene } from '@pascal-app/core'
import {
  createDefaultMaterial,
  createMaterial,
  createMaterialFromPresetRef,
} from '@pascal-app/viewer/materials'
import { useNodeEvents } from '@pascal-app/viewer/node-events'
import useViewer from '@pascal-app/viewer/store'
import { useLayoutEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value))
}

function smoothstep(value: number) {
  const t = clamp(value, 0, 1)
  return t * t * (3 - 2 * t)
}

function radiusScaleAtX(
  x: number,
  surfaceLength: number | undefined,
  endTaper: number | undefined,
) {
  if (!surfaceLength || surfaceLength <= 0) return 1
  const halfLength = surfaceLength / 2
  const taper = clamp(endTaper ?? 0.28, 0.001, 0.95)
  const edgeStart = 1 - taper
  const edgeRatio = clamp(Math.abs(x) / halfLength, 0, 1)
  return 1 - smoothstep((edgeRatio - edgeStart) / taper) * 0.72
}

function pointOnEllipsoidCylinder(
  y: number,
  radiusY: number,
  radiusZ: number,
  sideSign: number,
  thickness: number,
): [number, number] {
  const clampedY = clamp(y, -radiusY * 0.98, radiusY * 0.98)
  const normalizedY = clampedY / radiusY
  const surfaceZ = sideSign * radiusZ * Math.sqrt(Math.max(0, 1 - normalizedY * normalizedY))
  const normal = new THREE.Vector3(
    0,
    clampedY / (radiusY * radiusY),
    surfaceZ / (radiusZ * radiusZ),
  )
    .normalize()
    .multiplyScalar(thickness)
  return [clampedY + normal.y, surfaceZ + normal.z]
}

function buildConformalStripGeometry(node: ConformalStripNode) {
  const xStart = node.xStart ?? -0.5
  const xEnd = node.xEnd ?? 0.5
  const width = node.width ?? 0.04
  const radiusY = Math.max(0.001, node.surfaceRadiusY ?? 0.25)
  const radiusZ = Math.max(0.001, node.surfaceRadiusZ ?? 0.25)
  const sideSign = node.side === 'right' ? -1 : 1
  const xSegments = Math.max(1, Math.round(node.segments ?? 16))
  const ySegments = Math.max(1, Math.round(node.widthSegments ?? 2))
  const positions: number[] = []
  const normals: number[] = []
  const uvs: number[] = []
  const indices: number[] = []

  for (let ix = 0; ix <= xSegments; ix += 1) {
    const u = ix / xSegments
    const x = xStart + (xEnd - xStart) * u
    for (let iy = 0; iy <= ySegments; iy += 1) {
      const v = iy / ySegments
      const scaleAtX = radiusScaleAtX(x, node.surfaceLength, node.endTaper)
      const localRadiusY = radiusY * scaleAtX
      const localRadiusZ = radiusZ * scaleAtX
      const y = (node.verticalOffset ?? 0) * scaleAtX + (v - 0.5) * width
      const [surfaceY, surfaceZ] = pointOnEllipsoidCylinder(
        y,
        localRadiusY,
        localRadiusZ,
        sideSign,
        node.thickness ?? 0.003,
      )
      positions.push(x, surfaceY, surfaceZ)
      const normal = new THREE.Vector3(
        0,
        surfaceY / (localRadiusY * localRadiusY),
        surfaceZ / (localRadiusZ * localRadiusZ),
      ).normalize()
      normals.push(normal.x, normal.y, normal.z)
      uvs.push(u, v)
    }
  }

  const row = ySegments + 1
  for (let ix = 0; ix < xSegments; ix += 1) {
    for (let iy = 0; iy < ySegments; iy += 1) {
      const a = ix * row + iy
      const b = (ix + 1) * row + iy
      const c = (ix + 1) * row + iy + 1
      const d = ix * row + iy + 1
      if (sideSign > 0) indices.push(a, b, d, b, c, d)
      else indices.push(a, d, b, b, d, c)
    }
  }

  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3))
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2))
  geometry.setIndex(indices)
  geometry.computeBoundingSphere()
  return geometry
}

export const ConformalStripRenderer = ({ node }: { node: ConformalStripNode }) => {
  const ref = useRef<THREE.Group>(null!)

  useRegistry(node.id, 'conformal-strip', ref)

  useLayoutEffect(() => {
    useScene.getState().markDirty(node.id)
  }, [node.id])

  const handlers = useNodeEvents(node, 'conformal-strip')
  const shading = useViewer((state) => state.shading)

  const material = useMemo(() => {
    const presetMaterial = createMaterialFromPresetRef(node.materialPreset, shading)
    if (presetMaterial) return presetMaterial
    const mat = node.material
    if (!mat) return createDefaultMaterial('#0f8fb3', 1, shading, THREE.DoubleSide)
    const created = createMaterial(mat, shading)
    if ('side' in created) created.side = THREE.DoubleSide
    return created
  }, [
    node.materialPreset,
    node.material,
    node.material?.preset,
    node.material?.properties,
    node.material?.texture,
    shading,
  ])

  const geometry = useMemo(() => buildConformalStripGeometry(node), [node])

  return (
    <group
      position-x={node.position[0]}
      position-y={node.position[1]}
      position-z={node.position[2]}
      ref={ref}
      rotation={node.rotation}
      visible={node.visible}
      {...handlers}
    >
      <mesh
        castShadow
        geometry={geometry}
        material={material}
        name="conformal-strip-surface"
        receiveShadow
      />
    </group>
  )
}

export default ConformalStripRenderer
