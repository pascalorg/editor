'use client'

import { useFloorplanExport } from '../../lib/floorplan-export/use-floorplan-export'
import { Button } from '../ui/primitives/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '../ui/primitives/dropdown-menu'
import { Tooltip, TooltipContent, TooltipTrigger } from '../ui/primitives/tooltip'
import { Download, FileImage, FileText, Loader2 } from 'lucide-react'

export function FloorplanExportButton() {
  const { exportSvg, exportPdf, canExport, isExporting } = useFloorplanExport()

  if (!canExport) return null

  return (
    <DropdownMenu>
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <Button
              variant="outline"
              size="sm"
              className="h-7 gap-1.5 px-2.5 text-xs shadow-sm"
              disabled={isExporting}
            >
              {isExporting ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Download className="h-3.5 w-3.5" />
              )}
              Export
            </Button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent side="top">Export floor plan</TooltipContent>
      </Tooltip>

      <DropdownMenuContent align="end" className="w-44">
        <DropdownMenuLabel className="text-xs text-muted-foreground">
          Floor Plan Export
        </DropdownMenuLabel>
        <DropdownMenuSeparator />

        <DropdownMenuItem
          className="gap-2 text-sm"
          onSelect={exportSvg}
          disabled={isExporting}
        >
          <FileImage className="h-3.5 w-3.5 text-muted-foreground" />
          Export as SVG
        </DropdownMenuItem>

        <DropdownMenuItem
          className="gap-2 text-sm"
          onSelect={() => void exportPdf()}
          disabled={isExporting}
        >
          <FileText className="h-3.5 w-3.5 text-muted-foreground" />
          Export as PDF
          {isExporting && (
            <Loader2 className="ml-auto h-3 w-3 animate-spin" />
          )}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
