'use client'

import {
  CabinetModuleNode,
  type CabinetNode,
  createSceneApi,
  runAsSingleSceneHistoryStep,
  useScene,
} from '@pascal-app/core'
import { ActionButton, formatLinearMeasurement } from '@pascal-app/editor'
import { useViewer } from '@pascal-app/viewer'
import { useState } from 'react'
import { applyCabinetModuleInsertion, cabinetModuleForRunInsertion } from './insertion'
import { KitchenCollection } from './kitchen-collection'
import { type CabinetPresetId, cabinetPresetById } from './presets'
import { moduleMaxX, moduleMinX, planRunModuleInsertion, runWallConstraints } from './run-layout'
import {
  bumpCabinetRunLayoutRevision,
  cabinetModulesForRun,
  cornerPinnedEndsForRun,
  runModuleBaseY,
  syncCornerRunsFromRunSources,
} from './run-ops'
import { planCabinetPresetReflow } from './run-panel'
import { backAnchoredModuleZ } from './stack'

export function KitchenModuleActions({
  node,
  run,
  onReplace,
}: {
  node: CabinetModuleNode
  run: CabinetNode
  onReplace: (id: CabinetPresetId) => void
}) {
  const [action, setAction] = useState<'left' | 'right' | 'replace' | null>(null)
  const [presetId, setPresetId] = useState<CabinetPresetId | null>(null)
  const [error, setError] = useState<string | null>(null)
  const nodes = useScene((state) => state.nodes)
  const unit = useViewer((state) => state.unit)
  const notation = useViewer((state) => state.metricNotation)
  const format = (value: number) => formatLinearMeasurement(value, unit, notation)
  const modules = cabinetModulesForRun(run, nodes)
  const preset = presetId ? cabinetPresetById(presetId) : null
  const patch = preset?.createPatch(run)
  const module = patch
    ? cabinetModuleForRunInsertion(
        CabinetModuleNode.parse({
          ...patch,
          parentId: run.id,
          position: [
            action === 'left'
              ? moduleMinX(node) - (patch.width ?? 0.5) / 2
              : moduleMaxX(node) + (patch.width ?? 0.5) / 2,
            runModuleBaseY(run),
            backAnchoredModuleZ(node.position[2], node.depth, patch.depth ?? run.depth),
          ],
        }),
        run,
      )
    : null
  const insertion =
    module && action !== 'replace'
      ? planRunModuleInsertion({
          modules,
          insertion: module,
          wallConstraints: runWallConstraints(run, modules, nodes, { widthGrowth: module.width }),
          fillerIds: new Set(
            modules
              .filter((entry) => entry.moduleKind === 'corner-filler')
              .map((entry) => entry.id),
          ),
          preserveEnds: cornerPinnedEndsForRun(modules),
          anchorInsertionSide: action === 'left' ? 'right' : 'left',
        })
      : null
  const replacement =
    patch && action === 'replace'
      ? planCabinetPresetReflow({
          modules,
          parentRun: run,
          selected: node,
          patch,
          scene: useScene.getState(),
        })
      : null
  const planned = insertion?.ok ? [...insertion.modules, insertion.inserted] : replacement
  const fits = !!planned?.length
  const changes =
    planned?.filter((entry) => {
      const before = modules.find((existing) => existing.id === entry.id)
      return (
        before &&
        (Math.abs(before.width - entry.width) > 0.0001 ||
          Math.abs(before.position[0] - entry.position[0]) > 0.0001)
      )
    }) ?? []
  const reset = () => {
    setAction(null)
    setPresetId(null)
    setError(null)
  }
  const commit = () => {
    if (!(fits && presetId)) return
    const api = createSceneApi(useScene)
    try {
      runAsSingleSceneHistoryStep(useScene, () => {
        if (action === 'replace') onReplace(presetId)
        else if (module && insertion?.ok) {
          const id = applyCabinetModuleInsertion({ module, plan: insertion, run, sceneApi: api })
          if (!id)
            throw new Error('The kitchen changed. Select an item again to refresh the preview.')
          syncCornerRunsFromRunSources({ run: api.get<CabinetNode>(run.id) ?? run, sceneApi: api })
          bumpCabinetRunLayoutRevision(api, run)
          useViewer.getState().setSelection({ selectedIds: [id] })
        }
      })
      reset()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to update this kitchen.')
    }
  }
  const changedId = action === 'replace' ? node.id : module?.id
  return (
    <div className="space-y-3 px-1 pb-2">
      <div className="flex gap-2">
        <ActionButton
          label="Add beside"
          onClick={() => {
            setAction('right')
            setPresetId(null)
          }}
        />
        <ActionButton
          label="Replace with…"
          onClick={() => {
            setAction('replace')
            setPresetId(null)
          }}
        />
      </div>
      {action && (
        <div className="space-y-3 rounded-xl border border-border p-3">
          <div className="flex items-center justify-between gap-2 text-xs font-medium">
            <span>
              {action === 'replace' ? 'Replace selected item' : 'Add beside selected item'}
            </span>
            <button
              type="button"
              onClick={reset}
              className="min-h-8 shrink-0 rounded px-2 py-1.5 hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
            >
              Cancel
            </button>
          </div>
          {action !== 'replace' && (
            <div className="flex gap-2">
              {(['left', 'right'] as const).map((side) => (
                <button
                  key={side}
                  type="button"
                  aria-pressed={action === side}
                  onClick={() => setAction(side)}
                  className={`flex-1 rounded-lg border px-2 py-2 text-xs focus-visible:ring-2 focus-visible:ring-ring ${action === side ? 'border-primary bg-primary/10' : 'border-border'}`}
                >
                  {side === 'left' ? 'Left side' : 'Right side'}
                </button>
              ))}
            </div>
          )}
          <KitchenCollection
            activeId={presetId}
            includeWall={false}
            onSelect={(id) => {
              setPresetId(id)
              setError(null)
            }}
          />
          {preset && (
            <div role="status" className="space-y-2 border-t border-border pt-3 text-xs">
              <p className="font-medium">
                {preset.label} · {format(patch?.width ?? 0)}
              </p>
              {fits && planned ? (
                <>
                  <div
                    role="img"
                    aria-label="Kitchen run preview, highlighted item is the proposed change"
                    className="flex h-12 gap-0.5"
                  >
                    {[...planned]
                      .sort((a, b) => a.position[0] - b.position[0])
                      .map((entry) => (
                        <div
                          key={entry.id}
                          style={{ flex: entry.width }}
                          title={`${entry.id === changedId ? preset.label : (modules.find((existing) => existing.id === entry.id)?.name ?? 'Cabinet')}: ${format(entry.width)}`}
                          className={`min-w-0 rounded border ${entry.id === changedId ? 'border-primary bg-primary/30' : 'border-border bg-muted'}`}
                        />
                      ))}
                  </div>
                  <p>
                    {action === 'replace'
                      ? 'Replaces only the selected item.'
                      : `Inserts on the ${action} of the selected item.`}
                  </p>
                  {changes.map((entry) => {
                    const before = modules.find((existing) => existing.id === entry.id)!
                    return (
                      <p key={entry.id} className="text-muted-foreground">
                        {before.name || 'Cabinet'}:{' '}
                        {Math.abs(before.width - entry.width) > 0.0001
                          ? `${format(before.width)} → ${format(entry.width)}`
                          : `moves ${format(Math.abs(before.position[0] - entry.position[0]))}`}
                      </p>
                    )
                  })}
                  {action === 'replace' &&
                    patch?.cabinetType === 'tall' &&
                    node.children.length > 0 && (
                      <p className="text-muted-foreground">
                        An upper cabinet attached to this item will be removed to make room.
                      </p>
                    )}
                  <ActionButton
                    label={
                      action === 'replace' ? `Replace with ${preset.label}` : `Add ${preset.label}`
                    }
                    onClick={commit}
                  />
                </>
              ) : (
                <p>
                  This {format(patch?.width ?? 0)} item cannot fit within the current run and its
                  wall or corner limits. Move an end cabinet or free space, then try again.
                </p>
              )}
            </div>
          )}
          {error && (
            <p role="alert" className="text-xs text-destructive">
              {error}
            </p>
          )}
        </div>
      )}
    </div>
  )
}
