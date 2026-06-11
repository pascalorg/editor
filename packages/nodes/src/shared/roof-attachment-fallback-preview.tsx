'use client'

import { emitter, type GridEvent, type GutterEvent, type RoofEvent } from '@pascal-app/core'
import { DragBoundingBox } from '@pascal-app/editor'
import { useEffect, useRef, useState } from 'react'

const INVALID_PREVIEW_COLOR = 0xef_44_44
type ValidTarget = 'roof' | 'gutter'

export function RoofAttachmentFallbackPreview({
  activeBuildingId,
  lift = 0,
  size,
  validTarget = 'roof',
}: {
  activeBuildingId: string | null | undefined
  lift?: number
  size: [number, number, number]
  validTarget?: ValidTarget
}) {
  const [position, setPosition] = useState<[number, number, number] | null>(null)
  const lastValidTargetEventRef = useRef<unknown>(null)

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
    const onRoofHit = (event: RoofEvent) => trackValidHit(event.nativeEvent)
    const onGutterHit = (event: GutterEvent) => trackValidHit(event.nativeEvent)

    const onGridMove = (event: GridEvent) => {
      if (event.nativeEvent === lastValidTargetEventRef.current) return
      const [x, y, z] = event.localPosition
      setPosition([x, y + lift, z])
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

  return (
    <DragBoundingBox
      color={INVALID_PREVIEW_COLOR}
      nodeId="roof-attachment-fallback"
      position={position}
      size={size}
    />
  )
}
