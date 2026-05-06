import {
  BoxGeometry,
  type BufferGeometry,
  CylinderGeometry,
  Float32BufferAttribute,
  SphereGeometry,
  TorusGeometry,
} from 'three'
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js'

const COLUMN_UV_SCALE = 1

function setUvAttributes(geometry: BufferGeometry, uvs: number[]) {
  geometry.setAttribute('uv', new Float32BufferAttribute(uvs, 2))
  geometry.setAttribute('uv2', new Float32BufferAttribute(uvs.slice(), 2))
  return geometry
}

function toUvReadyGeometry(geometry: BufferGeometry) {
  return geometry.index ? geometry.toNonIndexed() : geometry
}

function applyPlanarColumnUvs(geometry: BufferGeometry) {
  const mappedGeometry = toUvReadyGeometry(geometry)
  const positions = mappedGeometry.getAttribute('position')
  const normals = mappedGeometry.getAttribute('normal')
  const uvs: number[] = []

  for (let index = 0; index < positions.count; index += 1) {
    const x = positions.getX(index)
    const y = positions.getY(index)
    const z = positions.getZ(index)
    const normalX = normals ? Math.abs(normals.getX(index)) : 0
    const normalY = normals ? Math.abs(normals.getY(index)) : 1
    const normalZ = normals ? Math.abs(normals.getZ(index)) : 0

    if (normalY >= normalX && normalY >= normalZ) {
      uvs.push(x * COLUMN_UV_SCALE, z * COLUMN_UV_SCALE)
    } else if (normalX >= normalZ) {
      uvs.push(z * COLUMN_UV_SCALE, y * COLUMN_UV_SCALE)
    } else {
      uvs.push(x * COLUMN_UV_SCALE, y * COLUMN_UV_SCALE)
    }
  }

  return setUvAttributes(mappedGeometry, uvs)
}

function ellipseCircumference(radiusX: number, radiusZ: number) {
  const a = Math.max(0.001, Math.abs(radiusX))
  const b = Math.max(0.001, Math.abs(radiusZ))
  return Math.PI * (3 * (a + b) - Math.sqrt((3 * a + b) * (a + 3 * b)))
}

function applyCylindricalColumnUvs(
  geometry: BufferGeometry,
  sideCircumference: number,
  height: number,
) {
  const mappedGeometry = toUvReadyGeometry(geometry)
  const positions = mappedGeometry.getAttribute('position')
  const normals = mappedGeometry.getAttribute('normal')
  const defaultUvs = mappedGeometry.getAttribute('uv')
  const halfHeight = height / 2
  const uvs: number[] = []

  for (let index = 0; index < positions.count; index += 1) {
    const x = positions.getX(index)
    const y = positions.getY(index)
    const z = positions.getZ(index)
    const normalY = normals ? Math.abs(normals.getY(index)) : 0

    if (normalY > 0.65) {
      uvs.push(x * COLUMN_UV_SCALE, z * COLUMN_UV_SCALE)
    } else {
      const defaultU = defaultUvs ? defaultUvs.getX(index) : 0
      uvs.push(defaultU * sideCircumference * COLUMN_UV_SCALE, (y + halfHeight) * COLUMN_UV_SCALE)
    }
  }

  return setUvAttributes(mappedGeometry, uvs)
}

function applySphericalColumnUvs(geometry: BufferGeometry, radius: number) {
  const mappedGeometry = toUvReadyGeometry(geometry)
  const defaultUvs = mappedGeometry.getAttribute('uv')
  if (!defaultUvs) return mappedGeometry

  const uvs: number[] = []
  const circumference = Math.PI * 2 * radius
  const arcHeight = Math.PI * radius

  for (let index = 0; index < defaultUvs.count; index += 1) {
    uvs.push(
      defaultUvs.getX(index) * circumference * COLUMN_UV_SCALE,
      defaultUvs.getY(index) * arcHeight * COLUMN_UV_SCALE,
    )
  }

  return setUvAttributes(mappedGeometry, uvs)
}

function applyTorusColumnUvs(geometry: BufferGeometry, ringRadius: number, tubeRadius: number) {
  const mappedGeometry = toUvReadyGeometry(geometry)
  const defaultUvs = mappedGeometry.getAttribute('uv')
  if (!defaultUvs) return mappedGeometry

  const uvs: number[] = []
  const ringLength = Math.PI * 2 * Math.max(0.001, ringRadius)
  const tubeLength = Math.PI * 2 * Math.max(0.001, tubeRadius)

  for (let index = 0; index < defaultUvs.count; index += 1) {
    uvs.push(
      defaultUvs.getX(index) * ringLength * COLUMN_UV_SCALE,
      defaultUvs.getY(index) * tubeLength * COLUMN_UV_SCALE,
    )
  }

  return setUvAttributes(mappedGeometry, uvs)
}

export function createColumnBoxGeometry(
  width: number,
  height: number,
  depth: number,
  bevelRadius = 0,
) {
  const geometry =
    bevelRadius > 0.001
      ? new RoundedBoxGeometry(width, height, depth, 3, bevelRadius)
      : new BoxGeometry(width, height, depth)
  return applyPlanarColumnUvs(geometry)
}

export function createColumnCylinderGeometry({
  height,
  radiusBottom,
  radiusTop = radiusBottom,
  radiusX = 1,
  radiusZ = 1,
  segments = 32,
}: {
  height: number
  radiusBottom: number
  radiusTop?: number
  radiusX?: number
  radiusZ?: number
  segments?: number
}) {
  const geometry = new CylinderGeometry(radiusTop, radiusBottom, height, segments)
  geometry.scale(radiusX, 1, radiusZ)
  const sideRadius = Math.max(radiusTop, radiusBottom)
  return applyCylindricalColumnUvs(
    geometry,
    ellipseCircumference(sideRadius * radiusX, sideRadius * radiusZ),
    height,
  )
}

export function createColumnSphereGeometry(radius: number, widthSegments = 10, heightSegments = 8) {
  return applySphericalColumnUvs(new SphereGeometry(radius, widthSegments, heightSegments), radius)
}

export function createColumnTorusGeometry({
  arc = Math.PI * 2,
  radialSegments = 10,
  ringRadius,
  scaleX = ringRadius,
  scaleY = ringRadius,
  scaleZ = 1,
  tubeRadius,
  tubularSegments = 24,
}: {
  arc?: number
  radialSegments?: number
  ringRadius: number
  scaleX?: number
  scaleY?: number
  scaleZ?: number
  tubeRadius: number
  tubularSegments?: number
}) {
  const geometry = new TorusGeometry(1, 0.18, radialSegments, tubularSegments, arc)
  geometry.scale(scaleX, scaleY, scaleZ)
  return applyTorusColumnUvs(geometry, ringRadius, tubeRadius)
}
