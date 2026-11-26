'use client'

import type { CaptureStreamPacket } from '@pascal-app/core/capture'
import { useLoader } from '@react-three/fiber'
import { useMemo } from 'react'
import { OVERLAY_LAYER } from '../../lib/layers'
import { SCAN_POINT_CLOUD_NAME } from '../../lib/scan-points'
import { rewriteLoopbackAssetUrl } from '../asset-url'
import { firstPoints, type PointCloudData, PointCloudPlyLoader } from './point-cloud-ply'
import { POINT_DISC_SIZE, PointDiscCloud } from './point-disc-cloud'

export type { PointCloudData }

export function CapturePointCloudLayer({
  artifactUrl,
  inline,
  maxPoints = 250_000,
  packets = [],
  pointSize = POINT_DISC_SIZE,
}: {
  artifactUrl?: string
  inline?: unknown
  maxPoints?: number
  packets?: readonly CaptureStreamPacket[]
  /** Each point's diameter, in metres. */
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
  return artifactUrl ? (
    <PlyPointCloud maxPoints={maxPoints} pointSize={pointSize} url={artifactUrl} />
  ) : null
}

function PlyPointCloud({
  maxPoints,
  pointSize,
  url,
}: {
  maxPoints: number
  pointSize: number
  url: string
}) {
  const source = useLoader(PointCloudPlyLoader, rewriteLoopbackAssetUrl(url))
  const data = useMemo(() => firstPoints(source, maxPoints), [maxPoints, source])
  return <PointCloudDataLayer data={data} pointSize={pointSize} />
}

function PointCloudDataLayer({ data, pointSize }: { data: PointCloudData; pointSize: number }) {
  if (data.positions.length === 0) return null
  return (
    <PointDiscCloud
      colors={data.colors}
      // As the phone streams it while scanning: flat colours over the image, untouched by the
      // scene's exposure, grade and bloom, which turned light points into a warm glowing haze.
      layer={OVERLAY_LAYER}
      name={SCAN_POINT_CLOUD_NAME}
      positions={data.positions}
      size={pointSize}
    />
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
