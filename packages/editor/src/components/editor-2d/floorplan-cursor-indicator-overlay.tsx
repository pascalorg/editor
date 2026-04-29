'use client'

import { Icon } from '@iconify/react'
import { memo, useMemo } from 'react'
import useEditor, { type FloorplanSelectionTool } from '../../store/use-editor'
import { furnishTools } from '../ui/action-menu/furnish-tools'
import { tools as structureTools } from '../ui/action-menu/structure-tools'

type SvgPoint = {
  x: number
  y: number
}

type FloorplanCursorIndicator =
  | {
      kind: 'asset'
      iconSrc: string
    }
  | {
      kind: 'icon'
      icon: string
    }

type FloorplanCursorIndicatorOverlayProps = {
  cursorPosition: SvgPoint | null
  cursorAnchorPosition: SvgPoint | null
  floorplanSelectionTool: FloorplanSelectionTool
  movingOpeningType: 'door' | 'window' | null
  isPanning: boolean
  cursorColor: string
  indicatorLineHeight?: number
  indicatorBadgeOffsetX?: number
  indicatorBadgeOffsetY?: number
}

export const FloorplanCursorIndicatorOverlay = memo(function FloorplanCursorIndicatorOverlay({
  cursorPosition,
  cursorAnchorPosition,
  floorplanSelectionTool,
  movingOpeningType,
  isPanning,
  cursorColor,
  indicatorLineHeight = 18,
  indicatorBadgeOffsetX = 14,
  indicatorBadgeOffsetY = 14,
}: FloorplanCursorIndicatorOverlayProps) {
  const mode = useEditor((state) => state.mode)
  const tool = useEditor((state) => state.tool)
  const structureLayer = useEditor((state) => state.structureLayer)
  const catalogCategory = useEditor((state) => state.catalogCategory)

  const activeFloorplanToolConfig = useMemo(() => {
    if (movingOpeningType) {
      return structureTools.find((entry) => entry.id === movingOpeningType) ?? null
    }

    if (mode !== 'build' || !tool) {
      return null
    }

    if (tool === 'item' && catalogCategory) {
      return furnishTools.find((entry) => entry.catalogCategory === catalogCategory) ?? null
    }

    return structureTools.find((entry) => entry.id === tool) ?? null
  }, [catalogCategory, mode, movingOpeningType, tool])

  const indicator = useMemo<FloorplanCursorIndicator | null>(() => {
    if (activeFloorplanToolConfig) {
      return { kind: 'asset', iconSrc: activeFloorplanToolConfig.iconSrc }
    }

    if (mode === 'select' && floorplanSelectionTool === 'marquee' && structureLayer !== 'zones') {
      return { kind: 'icon', icon: 'mdi:select-drag' }
    }

    if (mode === 'delete') {
      return { kind: 'icon', icon: 'mdi:trash-can-outline' }
    }

    return null
  }, [activeFloorplanToolConfig, floorplanSelectionTool, mode, structureLayer])

  const position = mode === 'delete' ? cursorPosition : cursorAnchorPosition

  if (!(indicator && position) || isPanning) {
    return null
  }

  return (
    <div
      aria-hidden="true"
      className="pointer-events-none absolute z-20"
      style={{ left: position.x, top: position.y }}
    >
      {mode === 'delete' ? (
        <div
          className="flex h-8 w-8 items-center justify-center rounded-xl border border-white/5 bg-zinc-900/95 shadow-[0_8px_16px_-4px_rgba(0,0,0,0.3),0_4px_8px_-4px_rgba(0,0,0,0.2)]"
          style={{
            boxShadow: `0 8px 16px -4px rgba(0,0,0,0.3), 0 4px 8px -4px rgba(0,0,0,0.2), 0 0 18px ${cursorColor}22`,
            transform: `translate(${indicatorBadgeOffsetX}px, ${indicatorBadgeOffsetY}px)`,
          }}
        >
          {indicator.kind === 'asset' ? (
            <img
              alt=""
              aria-hidden="true"
              className="h-5 w-5 object-contain drop-shadow-[0_2px_4px_rgba(0,0,0,0.5)]"
              src={indicator.iconSrc}
            />
          ) : (
            <Icon
              aria-hidden="true"
              className="drop-shadow-[0_2px_4px_rgba(0,0,0,0.5)]"
              color={cursorColor}
              height={18}
              icon={indicator.icon}
              width={18}
            />
          )}
        </div>
      ) : (
        <>
          <div
            className="absolute top-0 left-1/2 w-px -translate-x-1/2 -translate-y-full"
            style={{
              backgroundColor: cursorColor,
              boxShadow: `0 0 12px ${cursorColor}55`,
              height: indicatorLineHeight,
            }}
          />
          <div
            className="absolute top-0 left-1/2 flex h-8 w-8 items-center justify-center rounded-xl border border-white/5 bg-zinc-900/95 shadow-[0_8px_16px_-4px_rgba(0,0,0,0.3),0_4px_8px_-4px_rgba(0,0,0,0.2)]"
            style={{
              transform: `translate(-50%, calc(-100% - ${indicatorLineHeight}px))`,
            }}
          >
            {indicator.kind === 'asset' ? (
              <img
                alt=""
                aria-hidden="true"
                className="h-5 w-5 object-contain drop-shadow-[0_2px_4px_rgba(0,0,0,0.5)]"
                src={indicator.iconSrc}
              />
            ) : (
              <Icon
                aria-hidden="true"
                className="drop-shadow-[0_2px_4px_rgba(0,0,0,0.5)]"
                color="white"
                height={18}
                icon={indicator.icon}
                width={18}
              />
            )}
          </div>
        </>
      )}
    </div>
  )
})
