'use client'

import {
  Activity,
  Database,
  Layers,
  Map,
  Network,
  Wrench,
  type LucideIcon,
} from 'lucide-react'
import type { CanvasLens } from '../../../store/use-editor'
import useEditor from '../../../store/use-editor'
import { cn } from '../../../lib/utils'

type LensDefinition = {
  id: CanvasLens
  label: string
  shortLabel: string
  icon: LucideIcon
}

const LENSES: readonly LensDefinition[] = [
  {
    id: 'layout',
    label: 'Layout Lens',
    shortLabel: 'Layout',
    icon: Map,
  },
  {
    id: 'process',
    label: 'Process Lens',
    shortLabel: 'Process',
    icon: Network,
  },
  {
    id: 'equipment',
    label: 'Equipment Lens',
    shortLabel: 'Equipment',
    icon: Activity,
  },
  {
    id: 'data',
    label: 'Data Lens',
    shortLabel: 'Data',
    icon: Database,
  },
  {
    id: 'maintenance',
    label: 'Maintenance Lens',
    shortLabel: 'Maintain',
    icon: Wrench,
  },
  {
    id: 'elevation',
    label: 'Elevation Lens',
    shortLabel: 'Elevation',
    icon: Layers,
  },
]

export function CanvasLensToolbar() {
  const canvasLens = useEditor((state) => state.canvasLens)
  const setCanvasLens = useEditor((state) => state.setCanvasLens)
  const activeLens = LENSES.find((lens) => lens.id === canvasLens) ?? LENSES[0]!

  return (
    <div
      className="flex min-w-0 items-center justify-center gap-1 px-2 py-1.5"
      data-testid="canvas-lens-toolbar"
    >
      <div className="mr-1 hidden min-w-24 flex-col leading-tight md:flex">
        <span className="font-medium text-[11px] text-foreground">{activeLens.label}</span>
      </div>
      <div className="flex items-center gap-1 rounded-xl bg-white/5 p-1">
        {LENSES.map((lens) => {
          const Icon = lens.icon
          const active = lens.id === canvasLens
          return (
            <button
              aria-pressed={active}
              className={cn(
                'group relative flex h-8 min-w-8 items-center justify-center gap-1 rounded-lg px-2 text-[11px] transition-colors',
                active
                  ? 'bg-primary/80 text-primary-foreground shadow-sm'
                  : 'text-muted-foreground hover:bg-white/10 hover:text-foreground',
              )}
              data-testid={`canvas-lens-${lens.id}`}
              key={lens.id}
              onClick={() => setCanvasLens(lens.id)}
              title={lens.label}
              type="button"
            >
              <Icon className="h-3.5 w-3.5" />
              <span className="hidden lg:inline">{lens.shortLabel}</span>
            </button>
          )
        })}
      </div>
    </div>
  )
}
