'use client'

import { usePascalI18n } from '@pascal-app/core'
import { ActionButton } from '@pascal-app/editor'
import { ArrowLeftRight } from 'lucide-react'
import type { DuctFittingNode } from './schema'

const WIDTH_MIN = 4
const WIDTH_MAX = 60
const HEIGHT_MIN = 3
const HEIGHT_MAX = 40

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}

export function DuctFittingSizeSwapEditor({
  node,
  onUpdate,
}: {
  node: DuctFittingNode
  onUpdate: (patch: Partial<DuctFittingNode>) => void
}) {
  const i18n = usePascalI18n()
  const nextWidth = clamp(node.height, WIDTH_MIN, WIDTH_MAX)
  const nextHeight = clamp(node.width, HEIGHT_MIN, HEIGHT_MAX)

  return (
    <div className="px-2">
      <ActionButton
        className="h-8 w-full flex-none"
        icon={<ArrowLeftRight className="h-3.5 w-3.5" />}
        label={i18n._({ id: 'node.ductFitting.inspectorEditors.swapWH', message: 'Swap W/H' })}
        onClick={() => onUpdate({ width: nextWidth, height: nextHeight })}
        title={i18n._({
          id: 'node.ductFitting.inspectorEditors.swapWidthAndHeight',
          message: 'Swap width and height',
        })}
        type="button"
      />
    </div>
  )
}
