'use client'

import {
  type AnyNodeId,
  useLiveNodeOverrides,
  useScene,
  type WallFaceRegion,
} from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import { Trash2 } from 'lucide-react'
import { useMemo } from 'react'
import { removeWallRegion } from '../../../lib/paint-regions'
import { sfxEmitter } from '../../../lib/sfx-bus'
import { cn } from '../../../lib/utils'
import {
  wallRegionCapNotice,
  wallRegionFaceLabels,
  wallRegionRows,
} from '../../../lib/wall-region-list'
import { useWallRegionSelection } from '../../../store/use-wall-region-handles-selection'
import { PanelSection } from '../controls/panel-section'

const ROW_ACTION_CLASS =
  'flex h-6 w-6 shrink-0 cursor-pointer items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-black/5 hover:text-foreground dark:hover:bg-white/10'

/** The wall panel's "Paint regions" section: one row per region, select or delete. */
export function WallPaintRegionList({ wallId }: { wallId: string }) {
  const nodes = useScene((state) => state.nodes)
  const materials = useScene((state) => state.materials)
  const unit = useViewer((state) => state.unit)
  const active = useWallRegionSelection((state) => state.active)
  const setActive = useWallRegionSelection((state) => state.setActive)
  // A handle drag previews through a live override; list the live bounds.
  const liveRegions = useLiveNodeOverrides(
    (state) =>
      state.overrides.get(wallId as AnyNodeId)?.faceRegions as WallFaceRegion[] | undefined,
  )
  const sceneWall = nodes[wallId as AnyNodeId]
  const wall = sceneWall?.type === 'wall' ? sceneWall : null
  const faceLabels = useMemo(() => wallRegionFaceLabels(nodes, wallId), [nodes, wallId])

  if (!wall) return null
  const faceRegions = liveRegions ?? wall.faceRegions
  if (!faceRegions?.length) return null
  const rows = wallRegionRows({ faceRegions }, faceLabels, materials, unit)
  const capNotice = wallRegionCapNotice({ faceRegions }, faceLabels)

  return (
    // Focus inside this list still lets Delete target the active region.
    <div className="contents" data-wall-region-list={wallId}>
      <PanelSection title="Paint regions">
        <div className="flex flex-col gap-1">
          {rows.map((row) => {
            const isActive = active?.wallId === wallId && active.regionId === row.id
            return (
              <div
                className={cn(
                  'flex h-9 items-center gap-2 rounded-md px-1 transition-colors',
                  isActive ? 'bg-accent' : 'hover:bg-accent/50',
                )}
                data-wall-region-row={row.id}
                key={row.id}
              >
                <button
                  aria-pressed={isActive}
                  className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 text-left"
                  onClick={() => setActive({ wallId, regionId: row.id })}
                  type="button"
                >
                  <span
                    aria-hidden="true"
                    className="h-4 w-4 shrink-0 rounded-sm border border-border/50 bg-center bg-cover"
                    style={{
                      backgroundColor: row.finish.color,
                      backgroundImage: row.finish.imageUrl
                        ? `url(${row.finish.imageUrl})`
                        : undefined,
                    }}
                  />
                  <span className="flex min-w-0 flex-col leading-tight">
                    <span className="truncate text-sm">{row.finish.name}</span>
                    <span className="truncate text-[11px] text-muted-foreground">
                      {row.faceLabel} · {row.boundsText}
                    </span>
                  </span>
                </button>
                <button
                  aria-label="Delete region"
                  className={ROW_ACTION_CLASS}
                  onClick={() => {
                    if (isActive) setActive(null)
                    if (removeWallRegion(wallId, row.id)) sfxEmitter.emit('sfx:structure-delete')
                  }}
                  title="Delete region"
                  type="button"
                >
                  <Trash2 className="h-3 w-3" />
                </button>
              </div>
            )
          })}
          {capNotice && (
            <div className="px-1 text-[11px] text-muted-foreground">{capNotice}</div>
          )}
        </div>
      </PanelSection>
    </div>
  )
}
