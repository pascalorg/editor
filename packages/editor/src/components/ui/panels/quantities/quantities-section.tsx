'use client'

import { type AnyNodeId, useScene } from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import { Download, Sigma } from 'lucide-react'
import { useMemo } from 'react'
import { LocalizedContent } from '../../../../lib/i18n'
import { downloadQuantityCsv, formatQuantity, takeoffForSubtree } from '../../../../lib/quantities'

/**
 * Live quantity takeoff for the active level.
 *
 * Recomputes whenever the scene changes, which is the point — a takeoff that
 * only exists at export time cannot inform a design decision. The work is a
 * subtree walk plus each kind's own arithmetic, so it stays cheap enough to run
 * on edit; if a scene ever outgrows that, `dirtyNodes` is the incremental hook.
 */
export function QuantitiesSection() {
  const levelId = useViewer((state) => state.selection.levelId)
  const unit = useViewer((state) => state.unit)
  const metricNotation = useViewer((state) => state.metricNotation)
  // The whole point is liveness, so subscribe to the node map itself.
  const nodes = useScene((state) => state.nodes)

  const takeoff = useMemo(
    () => (levelId ? takeoffForSubtree(levelId as AnyNodeId) : null),
    // `nodes` is the change signal; `takeoffForSubtree` reads the store itself.
    [levelId, nodes],
  )

  const hasRows = (takeoff?.sections.length ?? 0) > 0

  return (
    <LocalizedContent>
      <div className="flex flex-col border-border/40 border-b">
      <div className="flex items-center gap-1.5 px-3 pt-3 pb-1.5">
        <Sigma className="h-3.5 w-3.5 text-muted-foreground" />
        <span className="font-semibold text-muted-foreground text-xs tracking-tight">
          Quantities
        </span>
        <button
          aria-label="Export quantities as CSV"
          className="ml-auto shrink-0 rounded p-0.5 text-muted-foreground/70 transition-colors hover:bg-white/10 hover:text-foreground disabled:opacity-30"
          disabled={!(takeoff && hasRows)}
          onClick={() => takeoff && downloadQuantityCsv(takeoff)}
          title="Export CSV"
          type="button"
        >
          <Download className="h-3.5 w-3.5" />
        </button>
      </div>

      {!levelId ? (
        <p className="px-3 pb-2.5 text-[11px] text-muted-foreground/60">
          Select a level to measure it.
        </p>
      ) : !hasRows ? (
        <p className="px-3 pb-2.5 text-[11px] text-muted-foreground/60">
          Nothing to measure on this level yet.
        </p>
      ) : (
        <div className="flex flex-col pb-2">
          {takeoff?.sections.map((section) => (
            <div className="flex flex-col" key={section.kind}>
              <div className="flex items-baseline gap-1.5 px-3 pt-1.5 pb-0.5">
                <span className="font-medium text-[11px] text-foreground">{section.label}</span>
                <span className="text-[10px] text-muted-foreground/50 tabular-nums">
                  {section.lines[0]?.nodeCount ?? 0}
                </span>
              </div>
              {section.lines.map((line) => (
                <div
                  className="flex items-baseline gap-2 px-3 py-0.5 text-[11px]"
                  key={`${line.key}-${line.group ?? ''}`}
                >
                  <span className="min-w-0 flex-1 truncate text-muted-foreground">
                    {line.group ? `${line.group} · ${line.label}` : line.label}
                  </span>
                  <span className="shrink-0 text-foreground tabular-nums">
                    {formatQuantity(line.value, line.unit, unit, metricNotation)}
                  </span>
                </div>
              ))}
            </div>
          ))}
        </div>
      )}
      </div>
    </LocalizedContent>
  )
}
