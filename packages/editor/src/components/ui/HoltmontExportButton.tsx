'use client'

import { useScene } from '@pascal-app/core'
import { Upload } from 'lucide-react'
import { cn } from '../../lib/utils'
import { Tooltip, TooltipContent, TooltipTrigger } from './primitives/tooltip'

const TOOLBAR_BTN =
  'flex items-center justify-center w-8 text-muted-foreground/80 transition-colors hover:bg-white/8 hover:text-foreground/90'

export function HoltmontExportButton() {
  const handleExport = () => {
    if (typeof window === 'undefined' || window.parent === window.self) return
    const { nodes, rootNodeIds, collections } = useScene.getState()
    window.parent.postMessage(
      { type: 'HOLTMONT_3D_EXPORT', data: { nodes, rootNodeIds, collections } },
      '*',
    )
    console.log('[HoltmontBridge] HOLTMONT_3D_EXPORT sent:', {
      nodeCount: Object.keys(nodes).length,
      rootNodeIds,
    })
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button className={cn(TOOLBAR_BTN)} onClick={handleExport} type="button">
          <Upload className="h-3.5 w-3.5" />
        </button>
      </TooltipTrigger>
      <TooltipContent side="bottom">Guardar en Holtmont</TooltipContent>
    </Tooltip>
  )
}
