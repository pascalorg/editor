'use client'

import { Icon } from '@iconify/react'
import { useState } from 'react'
import { t } from '../../../i18n'
import { cn } from '../../../lib/utils'
import { ActionButton } from './action-button'

type PrimitiveShape = {
  id: string
  label: string
  iconifyIcon: string
}

// Common parametric shapes shown in the 散件 expansion row. Iconify (mdi)
// icons are loaded by the same provider already used by the toolbar.
export const PRIMITIVE_SHAPES: PrimitiveShape[] = [
  { id: 'box', label: '立方�?, iconifyIcon: 'mdi:cube-outline' },
  { id: 'cylinder', label: '圆柱', iconifyIcon: 'mdi:cylinder' },
  { id: 'cone', label: '圆锥', iconifyIcon: 'mdi:cone' },
  { id: 'sphere', label: '球体', iconifyIcon: 'mdi:sphere' },
  { id: 'capsule', label: '胶囊', iconifyIcon: 'mdi:pill' },
  { id: 'torus', label: '圆环', iconifyIcon: 'mdi:torus' },
  { id: 'pyramid', label: '棱锥', iconifyIcon: 'mdi:pyramid' },
]

export type PrimitiveToolsProps = {
  onSelectShape?: (shape: PrimitiveShape) => void
}

/**
 * 散件 (Primitive) shape row �?rendered inside <ActionMenu>'s expanding
 * panel, mirroring the layout and visual states of <StructureTools />.
 */
export function PrimitiveTools({ onSelectShape }: PrimitiveToolsProps) {
  const [activeShapeId, setActiveShapeId] = useState<string | null>(null)

  return (
    <div className="flex items-center gap-1.5 px-1">
      {PRIMITIVE_SHAPES.map((shape) => {
        const isActive = activeShapeId === shape.id
        const label = t(`actionMenu.primitiveShapes.${shape.id}`, shape.label)

        return (
          <ActionButton
            className={cn(
              'rounded-lg duration-300 hover:text-[#a684ff]',
              isActive
                ? 'z-10 scale-110 bg-black/40 hover:bg-black/40 text-[#a684ff]'
                : 'scale-95 bg-transparent opacity-60 grayscale hover:bg-black/20 hover:opacity-100 hover:grayscale-0',
            )}
            key={shape.id}
            label={label}
            onClick={() => {
              setActiveShapeId(shape.id)
              onSelectShape?.(shape)
            }}
            size="icon"
            variant="ghost"
          >
            <Icon className="size-6" color="currentColor" icon={shape.iconifyIcon} />
          </ActionButton>
        )
      })}
    </div>
  )
}
