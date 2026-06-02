'use client'

import { Check, Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'

// ─── Stage config ─────────────────────────────────────────────────────────────

export type ImportStage = 'parsing' | 'analyzing' | 'merging' | 'building'

interface StageConfig {
  id: ImportStage
  label: string
  detail: string
}

const STAGES: StageConfig[] = [
  { id: 'parsing',   label: '解析中',   detail: '提取线条与几何特征' },
  { id: 'analyzing', label: '识别中',   detail: 'AI 分析图纸语义' },
  { id: 'merging',   label: '融合中',   detail: '合并几何与语义结果' },
  { id: 'building',  label: '生成场景', detail: '写入 Pascal 节点' },
]

const STAGE_INDEX: Record<ImportStage, number> = {
  parsing: 0, analyzing: 1, merging: 2, building: 3,
}

// ─── Component ────────────────────────────────────────────────────────────────

export interface ImportProgressProps {
  /** Currently active stage, or null when idle / complete. */
  stage: ImportStage | null
  /** Set to true once all stages finish — renders the bar fully filled. */
  done?: boolean
  className?: string
}

export function ImportProgress({ stage, done = false, className }: ImportProgressProps) {
  const currentIdx = stage !== null ? STAGE_INDEX[stage] : (done ? STAGES.length : -1)

  // Progress bar fills proportionally: each completed stage = 25%, active stage = partial
  const barPct = done
    ? 100
    : stage !== null
      ? currentIdx * 25 + 12 // halfway through the active segment
      : 0

  return (
    <div className={cn('flex flex-col gap-4', className)}>
      {/* ── Overall progress bar ─────────────────────────────────── */}
      <div className="relative h-1 overflow-hidden rounded-full bg-border/40">
        <div
          className="absolute inset-y-0 left-0 rounded-full bg-blue-500 transition-all duration-500 ease-out"
          style={{ width: `${barPct}%` }}
        />
      </div>

      {/* ── Stage list ────────────────────────────────────────────── */}
      <ol className="space-y-3">
        {STAGES.map((s, i) => {
          const isPast = i < currentIdx
          const isActive = !done && s.id === stage
          const isPending = !done && i > currentIdx

          return (
            <li
              className={cn(
                'flex items-start gap-3 transition-colors duration-200',
                isPending && 'opacity-35',
              )}
              key={s.id}
            >
              {/* Status icon */}
              <span
                className={cn(
                  'mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border text-[10px] font-semibold transition-colors',
                  isActive && 'border-blue-500 bg-blue-500/10 text-blue-400',
                  isPast && 'border-green-600/40 bg-green-500/10 text-green-500',
                  isPending && 'border-border/40 text-muted-foreground/40',
                  done && 'border-green-600/40 bg-green-500/10 text-green-500',
                )}
              >
                {isPast || done ? (
                  <Check className="h-3 w-3" strokeWidth={2.5} />
                ) : isActive ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  i + 1
                )}
              </span>

              {/* Label + detail */}
              <div className="min-w-0 flex-1">
                <p
                  className={cn(
                    'text-sm font-medium leading-tight',
                    isActive && 'text-foreground',
                    isPast && 'text-muted-foreground/70',
                    isPending && 'text-muted-foreground/40',
                    done && 'text-muted-foreground/70',
                  )}
                >
                  {s.label}
                  {isActive && <span className="text-muted-foreground/50">…</span>}
                </p>
                <p
                  className={cn(
                    'mt-0.5 text-xs',
                    isActive ? 'text-muted-foreground/60' : 'text-muted-foreground/30',
                  )}
                >
                  {s.detail}
                </p>
              </div>
            </li>
          )
        })}
      </ol>
    </div>
  )
}
