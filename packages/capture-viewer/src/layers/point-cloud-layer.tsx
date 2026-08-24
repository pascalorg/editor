'use client'

import type { CaptureStreamPacket } from '@pascal-app/capture-protocol'
import { useLoader } from '@react-three/fiber'
import { useEffect, useMemo } from 'react'
import { BufferGeometry, Float32BufferAttribute } from 'three'
import { PLYLoader } from 'three/addons/loaders/PLYLoader.js'
import { rewriteLoopbackAssetUrl } from '../asset-url'

export type PointCloudData = {
  colors: Float32Array | null
  positions: Float32Array
}

export function CapturePointCloudLayer({
  artifactUrl,
  inline,
  maxPoints = 250_000,
  packets = [],
  pointSize = 0.012,
}: {
  artifactUrl?: string
  inline?: unknown
  maxPoints?: number
  packets?: readonly CaptureStreamPacket[]
  pointSize?: number
}) {
  const liveData = useMemo(() => buildPointCloudData(packets, maxPoints), [maxPoints, packets])
  const inlineData = useMemo(
    () => buildPointCloudPayloadData(inline, maxPoints),
    [inline, maxPoints],
  )
  if (liveData.positions.length > 0) {
    return <PointCloudDataLayer data={liveData} pointSize={pointSize} />
  }
  if (inlineData.positions.length > 0) {
    return <PointCloudDataLayer data={inlineData} pointSize={pointSize} />
  }
  return artifactUrl ? <PlyPointCloud pointSize={pointSize} url={artifactUrl} /> : null
}

function PlyPointCloud({ pointSize, url }: { pointSize: number; url: string }) {
  const source = useLoader(PLYLoader, rewriteLoopbackAssetUrl(url))
  const geometry = useMemo(() => source.clone(), [source])
  useEffect(() => () => geometry.dispose(), [geometry])

  return (
    <points frustumCulled={false} geometry={geometry}>
      <pointsMaterial
        color={geometry.getAttribute('color') ? undefined : '#8fb8d8'}
        size={pointSize}
        sizeAttenuation
        vertexColors={Boolean(geometry.getAttribute('color'))}
      />
    </points>
  )
}

function PointCloudDataLayer({ data, pointSize }: { data: PointCloudData; pointSize: number }) {
  const geometry = useMemo(() => {
    const next = new BufferGeometry()
    next.setAttribute('position', new Float32BufferAttribute(data.positions, 3))
    if (data.colors) next.setAttribute('color', new Float32BufferAttribute(data.colors, 3))
    next.computeBoundingSphere()
    return next
  }, [data])
  useEffect(() => () => geometry.dispose(), [geometry])

  return (
    <points frustumCulled={false} geometry={geometry}>
      <pointsMaterial
        color={data.colors ? undefined : '#8fb8d8'}
        size={pointSize}
        sizeAttenuation
        vertexColors={Boolean(data.colors)}
      />
    </points>
  )
}

export function buildPointCloudData(
  packets: readonly CaptureStreamPacket[],
  maxPoints: number,
): PointCloudData {
  const chunks: Array<{ colors: number[] | null; positions: number[] }> = []
  let pointCount = 0
  let allHaveColors = true

  for (let index = packets.length - 1; index >= 0 && pointCount < maxPoints; index -= 1) {
    const parsed = parsePointPayload(packets[index]?.payload)
    if (!parsed) continue
    const availablePoints = Math.floor(parsed.positions.length / 3)
    const keepPoints = Math.min(availablePoints, maxPoints - pointCount)
    if (keepPoints <= 0) continue
    const start = (availablePoints - keepPoints) * 3
    chunks.unshift({
      colors: parsed.colors?.slice(start) ?? null,
      positions: parsed.positions.slice(start),
    })
    pointCount += keepPoints
    allHaveColors &&= parsed.colors !== null
  }

  const positions = new Float32Array(pointCount * 3)
  const colors = allHaveColors && pointCount > 0 ? new Float32Array(pointCount * 3) : null
  let offset = 0
  for (const chunk of chunks) {
    positions.set(chunk.positions, offset)
    if (colors && chunk.colors) colors.set(normalizeColors(chunk.colors), offset)
    offset += chunk.positions.length
  }
  return { colors, positions }
}

export function buildPointCloudPayloadData(value: unknown, maxPoints: number): PointCloudData {
  const parsed = parsePointPayload(value)
  if (!parsed) return { colors: null, positions: new Float32Array() }

  const availablePoints = Math.floor(parsed.positions.length / 3)
  const keepPoints = Math.min(availablePoints, maxPoints)
  const start = (availablePoints - keepPoints) * 3
  const positions = new Float32Array(parsed.positions.slice(start))
  const colors = parsed.colors
    ? new Float32Array(normalizeColors(parsed.colors.slice(start)))
    : null
  return { colors, positions }
}

function parsePointPayload(
  value: unknown,
): { colors: number[] | null; positions: number[] } | null {
  if (!(value && typeof value === 'object')) return null
  const payload = value as { colors?: unknown; positions?: unknown }
  const positions = numericArray(payload.positions)
  if (!(positions && positions.length >= 3 && positions.length % 3 === 0)) return null
  const colors = numericArray(payload.colors)
  return {
    colors: colors && colors.length === positions.length ? colors : null,
    positions,
  }
}

function numericArray(value: unknown): number[] | null {
  if (Array.isArray(value) && value.every((entry) => Number.isFinite(entry))) return value
  if (ArrayBuffer.isView(value)) {
    const entries = Array.from(value as unknown as ArrayLike<number>)
    return entries.every(Number.isFinite) ? entries : null
  }
  return null
}

function normalizeColors(colors: number[]): number[] {
  const divisor = colors.some((value) => value > 1) ? 255 : 1
  return colors.map((value) => Math.min(1, Math.max(0, value / divisor)))
}
