/**
 * Turning the pure `GuardBox` data from `baluster-guard.ts` into Three.js
 * geometry with metre-scale UVs (E-009): 1 UV unit = 1 m on every face, so a
 * finish tiles the same on a rail, a newel and a picket. Both the per-flight
 * guard (`renderer.tsx`) and the continuous guard (`continuous-railings.tsx`)
 * build their boxes through here, so there is one UV convention to maintain.
 */

import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import type { GuardBox } from './guard-path'

/** A box whose UVs run in metres (1 unit = 1 m) on each face. */
export function metricBox(length: number, height: number, depth: number) {
  const geometry = new THREE.BoxGeometry(length, height, depth)
  const position = geometry.getAttribute('position'),
    normal = geometry.getAttribute('normal'),
    uv = geometry.getAttribute('uv')
  for (let i = 0; i < position.count; i++) {
    const x = position.getX(i),
      y = position.getY(i),
      z = position.getZ(i)
    if (Math.abs(normal.getX(i)) > 0.5) uv.setXY(i, z, y)
    else if (Math.abs(normal.getY(i)) > 0.5) uv.setXY(i, x, z)
    else uv.setXY(i, x, y)
  }
  geometry.setAttribute('uv2', geometry.getAttribute('uv').clone())
  return geometry
}

/** A round guard member (a cable or its sleeve) as a metre-UV cylinder laid
 * along its direction: `size[0]` is the diameter, `size[2]` the length. UVs run
 * in metres — the circumference across, the length along — so a finish tiles
 * the same as on a rectangular bar. */
export function metricCylinder(diameter: number, length: number) {
  const radius = diameter / 2
  const geometry = new THREE.CylinderGeometry(radius, radius, length, 12)
  const position = geometry.getAttribute('position'),
    normal = geometry.getAttribute('normal'),
    uv = geometry.getAttribute('uv')
  for (let i = 0; i < uv.count; i++) {
    if (Math.abs(normal.getY(i)) > 0.5) uv.setXY(i, position.getX(i), position.getZ(i))
    else uv.setXY(i, uv.getX(i) * 2 * Math.PI * radius, uv.getY(i) * length)
  }
  geometry.setAttribute('uv2', uv.clone())
  return geometry
}

function roundGuardBoxGeometry(box: GuardBox) {
  const geometry = metricCylinder(box.size[0], box.size[2])
  const direction = new THREE.Vector3(...box.direction).normalize()
  geometry.applyQuaternion(
    new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction),
  )
  geometry.translate(box.center[0], box.center[1], box.center[2])
  return geometry
}

/** One oriented guard box as a metre-UV geometry, z laid along its direction. */
export function guardBoxGeometry(box: GuardBox) {
  if (box.round) return roundGuardBoxGeometry(box)
  const geometry = metricBox(box.size[0], box.size[1], box.size[2])
  const z = new THREE.Vector3(...box.direction).normalize()
  let x = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), z)
  if (x.lengthSq() < 1e-8) x.set(1, 0, 0)
  x = x.normalize()
  const y = new THREE.Vector3().crossVectors(z, x).normalize()
  geometry.applyMatrix4(new THREE.Matrix4().makeBasis(x, y, z))
  geometry.translate(box.center[0], box.center[1], box.center[2])
  return geometry
}

/** Merge a guard's boxes into one metre-UV geometry, or null when empty. */
export function mergeGuardBoxes(boxes: GuardBox[]): THREE.BufferGeometry | null {
  if (!boxes.length) return null
  const geometries = boxes.map(guardBoxGeometry)
  const merged = mergeGeometries(geometries, false)
  for (const geometry of geometries) geometry.dispose()
  return merged
}
