'use client'

import {
  type AnyNodeId,
  emitter,
  type GridEvent,
  type GutterEvent,
  type RoofEvent,
  sceneRegistry,
} from '@pascal-app/core'
import { DragBoundingBox } from '@pascal-app/editor'
import { type ReactNode, useEffect, useRef, useState } from 'react'
import { Vector3 } from 'three'

const INVALID_PREVIEW_COLOR = 0xef_44_44
type ValidTarget = 'roof' | 'gutter'

export function RoofAttachmentFallbackPreview({
  activeBuildingId,
  ghost,
  isValidRoofTarget,
  lift = 0,
  onInvalidTarget,
  size,
  validTarget = 'roof',
}: {
  activeBuildingId: string | null | undefined
  ghost?: ReactNode
  isValidRoofTarget?: (event: RoofEvent) => boolean
  lift?: number
  onInvalidTarget?: () => void
  size?: [number, number, number]
  validTarget?: ValidTarget
}) {
  const [position, setPosition] = useState<[number, number, number] | null>(null)
  const lastValidTargetEventRef = useRef<unknown>(null)
  const localPointRef = useRef(new Vector3())
  const isValidRoofTargetRef = useRef(isValidRoofTarget)
  const onInvalidTargetRef = useRef(onInvalidTarget)
  isValidRoofTargetRef.current = isValidRoofTarget
  onInvalidTargetRef.current = onInvalidTarget

  useEffect(() => {
    if (!activeBuildingId) {
      setPosition(null)
      lastValidTargetEventRef.current = null
      return
    }

    const trackValidHit = (nativeEvent: unknown) => {
      lastValidTargetEventRef.current = nativeEvent
      setPosition(null)
    }
    const showInvalidAt = (x: number, y: number, z: number) => {
      setPosition([x, y + lift, z])
      onInvalidTargetRef.current?.()
    }
    const showInvalidAtWorld = (event: RoofEvent) => {
      const point = localPointRef.current.set(...event.position)
      const building = sceneRegistry.nodes.get(activeBuildingId as AnyNodeId)
      if (building) {
        building.updateWorldMatrix(true, false)
        building.worldToLocal(point)
      }
      showInvalidAt(point.x, 0, point.z)
    }
    const onRoofHit = (event: RoofEvent) => {
      if (isValidRoofTargetRef.current?.(event) === false) {
        showInvalidAtWorld(event)
        return
      }
      trackValidHit(event.nativeEvent)
    }
    const onGutterHit = (event: GutterEvent) => trackValidHit(event.nativeEvent)

    const onGridMove = (event: GridEvent) => {
      if (event.nativeEvent === lastValidTargetEventRef.current) return
      const [x, y, z] = event.localPosition
      showInvalidAt(x, y, z)
    }

    if (validTarget === 'roof') {
      emitter.on('roof:enter', onRoofHit)
      emitter.on('roof:move', onRoofHit)
    } else {
      emitter.on('gutter:enter', onGutterHit)
      emitter.on('gutter:move', onGutterHit)
    }
    emitter.on('grid:move', onGridMove)

    return () => {
      if (validTarget === 'roof') {
        emitter.off('roof:enter', onRoofHit)
        emitter.off('roof:move', onRoofHit)
      } else {
        emitter.off('gutter:enter', onGutterHit)
        emitter.off('gutter:move', onGutterHit)
      }
      emitter.off('grid:move', onGridMove)
    }
  }, [activeBuildingId, lift, validTarget])

  if (!(activeBuildingId && position)) return null

  // When ghost is provided, render the ghost instead of DragBoundingBox
  if (ghost) {
    return <group position={position}>{ghost}</group>
  }

  // Fallback to DragBoundingBox for callers not yet migrated
  if (!size) return null
  return (
    <DragBoundingBox
      color={INVALID_PREVIEW_COLOR}
      nodeId="roof-attachment-fallback"
      position={position}
      size={size}
    />
  )
}
