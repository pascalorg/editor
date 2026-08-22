import * as THREE from 'three'

export type MetricUv = readonly [number, number]

type Point3 = readonly [number, number, number] | number[]

/** Return cumulative metre distances along a sampled open or closed profile. */
export function cumulativeProfileDistances(points: readonly Point3[]): number[] {
  const distances = [0]
  for (let index = 1; index < points.length; index += 1) {
    const previous = points[index - 1]!
    const current = points[index]!
    distances.push(
      distances[index - 1]! +
        Math.hypot(
          current[0]! - previous[0]!,
          current[1]! - previous[1]!,
          current[2]! - previous[2]!,
        ),
    )
  }
  return distances
}

/** Project a flat polygon into metre-scaled UV coordinates without shearing trapezoids. */
export function planarMetricUvs(
  points: readonly Point3[],
  normal: Point3,
  uOffset = 0,
  vOffset = 0,
): MetricUv[] {
  const origin = points[0]!
  const uTarget = points[1]!
  const ux = uTarget[0]! - origin[0]!
  const uy = uTarget[1]! - origin[1]!
  const uz = uTarget[2]! - origin[2]!
  const uLength = Math.hypot(ux, uy, uz) || 1
  const unitU = [ux / uLength, uy / uLength, uz / uLength]
  const normalLength = Math.hypot(normal[0]!, normal[1]!, normal[2]!) || 1
  const unitNormal = [
    normal[0]! / normalLength,
    normal[1]! / normalLength,
    normal[2]! / normalLength,
  ]
  const unitV = [
    unitNormal[1]! * unitU[2]! - unitNormal[2]! * unitU[1]!,
    unitNormal[2]! * unitU[0]! - unitNormal[0]! * unitU[2]!,
    unitNormal[0]! * unitU[1]! - unitNormal[1]! * unitU[0]!,
  ]

  return points.map((point) => {
    const x = point[0]! - origin[0]!
    const y = point[1]! - origin[1]!
    const z = point[2]! - origin[2]!
    return [
      uOffset + x * unitU[0]! + y * unitU[1]! + z * unitU[2]!,
      vOffset + x * unitV[0]! + y * unitV[1]! + z * unitV[2]!,
    ] as const
  })
}

/** Reuse the authored unwrap for AO and light maps, which read texture channel 2. */
export function copyUvToSecondaryChannel(geometry: THREE.BufferGeometry): void {
  const uv = geometry.getAttribute('uv')
  if (uv) geometry.setAttribute('uv2', uv.clone())
}

/** Apply metre-scaled planar UVs to a non-indexed, axis-aligned primitive. */
export function applyPlanarWorldUvs(geometry: THREE.BufferGeometry): void {
  const position = geometry.getAttribute('position')
  const normal = geometry.getAttribute('normal')
  const uvs = new Float32Array(position.count * 2)

  for (let triangle = 0; triangle < position.count; triangle += 3) {
    const nx = Math.abs(normal.getX(triangle))
    const ny = Math.abs(normal.getY(triangle))
    const nz = Math.abs(normal.getZ(triangle))
    for (let corner = 0; corner < 3; corner += 1) {
      const index = triangle + corner
      const x = position.getX(index)
      const y = position.getY(index)
      const z = position.getZ(index)
      if (ny >= nx && ny >= nz) {
        uvs[index * 2] = x
        uvs[index * 2 + 1] = z
      } else if (nx >= nz) {
        uvs[index * 2] = z
        uvs[index * 2 + 1] = y
      } else {
        uvs[index * 2] = x
        uvs[index * 2 + 1] = y
      }
    }
  }

  geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2))
}

/** Scale cylinder/cone side UVs by circumference and height; caps use XZ metres. */
export function applyCylinderWorldUvs(
  geometry: THREE.BufferGeometry,
  radius: number,
  height: number,
): void {
  const position = geometry.getAttribute('position')
  const normal = geometry.getAttribute('normal')
  const sourceUv = geometry.getAttribute('uv')
  const uvs = new Float32Array(position.count * 2)
  const circumference = Math.PI * 2 * radius

  for (let index = 0; index < position.count; index += 1) {
    if (Math.abs(normal.getY(index)) < 0.5) {
      uvs[index * 2] = sourceUv.getX(index) * circumference
      uvs[index * 2 + 1] = (sourceUv.getY(index) - 0.5) * height
    } else {
      uvs[index * 2] = position.getX(index)
      uvs[index * 2 + 1] = position.getZ(index)
    }
  }

  geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2))
}

/** Scale a sphere's equirectangular UVs to its circumference and pole distance. */
export function applySphereWorldUvs(geometry: THREE.BufferGeometry, radius: number): void {
  const sourceUv = geometry.getAttribute('uv')
  const uvs = new Float32Array(sourceUv.count * 2)
  for (let index = 0; index < sourceUv.count; index += 1) {
    uvs[index * 2] = sourceUv.getX(index) * Math.PI * 2 * radius
    uvs[index * 2 + 1] = sourceUv.getY(index) * Math.PI * radius
  }
  geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2))
}
