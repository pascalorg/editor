'use client'

import { SurfaceMeshPayloadSchema } from '@pascal-app/capture-protocol'
import { useEffect, useMemo } from 'react'
import { BufferGeometry, DoubleSide, Float32BufferAttribute, Uint16BufferAttribute } from 'three'

export type SurfaceMeshData = {
  colors: Float32Array
  indices: Uint16Array
  positions: Float32Array
}

export function CaptureSurfaceMeshLayer({ inline }: { inline: unknown }) {
  const data = useMemo(() => buildSurfaceMeshData(inline), [inline])
  const geometry = useMemo(() => {
    if (!data) return null
    const next = new BufferGeometry()
    next.setAttribute('position', new Float32BufferAttribute(data.positions, 3))
    next.setAttribute('color', new Float32BufferAttribute(data.colors, 3))
    next.setIndex(new Uint16BufferAttribute(data.indices, 1))
    next.computeVertexNormals()
    next.computeBoundingSphere()
    return next
  }, [data])
  useEffect(() => () => geometry?.dispose(), [geometry])
  if (!geometry) return null

  return (
    <mesh frustumCulled={false} geometry={geometry}>
      <meshStandardMaterial metalness={0} roughness={0.9} side={DoubleSide} vertexColors />
    </mesh>
  )
}

export function buildSurfaceMeshData(value: unknown): SurfaceMeshData | null {
  const parsed = SurfaceMeshPayloadSchema.safeParse(value)
  if (!parsed.success) return null
  const payload = parsed.data
  const positionBytes = decodeBase64(payload.positions)
  const colorBytes = decodeBase64(payload.colors)
  const indexBytes = decodeBase64(payload.indices)
  if (
    positionBytes.byteLength !== payload.vertexCount * 3 * 2 ||
    colorBytes.byteLength !== payload.vertexCount * 3 ||
    indexBytes.byteLength !== payload.faceCount * 3 * 2
  ) {
    return null
  }

  const positions = new Float32Array(payload.vertexCount * 3)
  const colors = new Float32Array(payload.vertexCount * 3)
  const indices = new Uint16Array(payload.faceCount * 3)
  const positionView = new DataView(
    positionBytes.buffer,
    positionBytes.byteOffset,
    positionBytes.byteLength,
  )
  const indexView = new DataView(indexBytes.buffer, indexBytes.byteOffset, indexBytes.byteLength)
  for (let index = 0; index < payload.vertexCount; index += 1) {
    for (let axis = 0; axis < 3; axis += 1) {
      const offset = index * 3 + axis
      const minimum = payload.boundsMin[axis] ?? 0
      const maximum = payload.boundsMax[axis] ?? minimum
      const quantized = positionView.getUint16(offset * 2, true)
      positions[offset] = minimum + (quantized / 65_535) * (maximum - minimum)
      colors[offset] = (colorBytes[offset] ?? 0) / 255
    }
  }
  for (let index = 0; index < indices.length; index += 1) {
    const vertexIndex = indexView.getUint16(index * 2, true)
    if (vertexIndex >= payload.vertexCount) return null
    indices[index] = vertexIndex
  }
  return { colors, indices, positions }
}

function decodeBase64(value: string): Uint8Array {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
  const clean = value.replace(/\s/g, '')
  const padding = clean.endsWith('==') ? 2 : clean.endsWith('=') ? 1 : 0
  const outputLength = Math.floor((clean.length * 3) / 4) - padding
  const output = new Uint8Array(Math.max(0, outputLength))
  let outputIndex = 0
  for (let index = 0; index < clean.length; index += 4) {
    const a = alphabet.indexOf(clean[index] ?? '')
    const b = alphabet.indexOf(clean[index + 1] ?? '')
    const c = clean[index + 2] === '=' ? 0 : alphabet.indexOf(clean[index + 2] ?? '')
    const d = clean[index + 3] === '=' ? 0 : alphabet.indexOf(clean[index + 3] ?? '')
    if (a < 0 || b < 0 || c < 0 || d < 0) return new Uint8Array()
    const bits = (a << 18) | (b << 12) | (c << 6) | d
    if (outputIndex < output.length) output[outputIndex++] = (bits >> 16) & 0xff
    if (outputIndex < output.length) output[outputIndex++] = (bits >> 8) & 0xff
    if (outputIndex < output.length) output[outputIndex++] = bits & 0xff
  }
  return output
}
