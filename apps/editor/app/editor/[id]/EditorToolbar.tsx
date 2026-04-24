'use client'

import {
  ViewerToolbarLeft,
  ViewerToolbarRight,
} from '@pascal-app/editor'
import { useViewer } from '@pascal-app/viewer'
import { LayoutDashboard, Ruler } from 'lucide-react'
import { useRouter } from 'next/navigation'

function BackToDashboardButton() {
  const router = useRouter()

  return (
    <button
      onClick={() => router.push('/dashboard/projects')}
      title="Back to Dashboard"
      type="button"
      className="inline-flex h-8 items-center gap-1.5 rounded-xl border border-border bg-background/90 px-2.5 text-xs font-medium text-muted-foreground/80 shadow-2xl backdrop-blur-md transition-colors hover:bg-white/8 hover:text-foreground/90"
    >
      <LayoutDashboard className="h-3.5 w-3.5 shrink-0" />
      <span>Dashboard</span>
    </button>
  )
}

function UnitTogglePill() {
  const unit = useViewer((s: any) => s.unit)
  const setUnit = useViewer((s: any) => s.setUnit)

  const isMetric = unit === 'metric'

  return (
    <button
      onClick={() => setUnit(isMetric ? 'imperial' : 'metric')}
      title={isMetric ? 'Switch to Imperial (ft)' : 'Switch to Metric (m)'}
      type="button"
      className="inline-flex h-8 items-center gap-1.5 rounded-xl border border-border bg-background/90 px-2.5 shadow-2xl backdrop-blur-md transition-colors hover:bg-white/8"
    >
      <Ruler className="h-3.5 w-3.5 text-muted-foreground/80" />
      {/* Toggle pill */}
      <div className="flex items-center rounded-lg bg-white/5 p-0.5 text-[10px] font-semibold">
        <span
          className={`rounded-md px-1.5 py-0.5 transition-colors ${
            isMetric ? 'bg-indigo-500/80 text-white' : 'text-muted-foreground/60'
          }`}
        >
          m
        </span>
        <span
          className={`rounded-md px-1.5 py-0.5 transition-colors ${
            !isMetric ? 'bg-indigo-500/80 text-white' : 'text-muted-foreground/60'
          }`}
        >
          ft
        </span>
      </div>
    </button>
  )
}

export function EditorToolbarLeft() {
  return (
    <>
      <BackToDashboardButton />
      <ViewerToolbarLeft />
    </>
  )
}

export function EditorToolbarRight() {
  return (
    <>
      <UnitTogglePill />
      <ViewerToolbarRight />
    </>
  )
}
