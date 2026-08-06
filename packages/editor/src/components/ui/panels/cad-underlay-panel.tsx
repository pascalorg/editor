'use client'

import { type AnyNodeId, type CadUnderlayNode, useScene } from '@pascal-app/core'
import { Eye, EyeOff, Lock, RotateCcw, Ruler, Trash2, Unlock } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useCadUnderlayRevision } from '../../../hooks/use-cad-underlay-revision'
import {
  calibrationProblemMessage,
  computeCalibration,
  revertCalibration,
  validateCalibration,
} from '../../../lib/cad-calibration'
import { formatExtent, suggestUnits } from '../../../lib/cad-import'
import { getCadUnderlay, getCadUnderlayError } from '../../../lib/cad-underlay-cache'
import { cn } from '../../../lib/utils'
import { ActionButton, ActionGroup } from '../controls/action-button'
import { MetricControl } from '../controls/metric-control'
import { PanelSection } from '../controls/panel-section'
import { SliderControl } from '../controls/slider-control'
import { PanelWrapper } from './panel-wrapper'

type Props = {
  node: CadUnderlayNode
  onClose: () => void
}

export function CadUnderlayPanel({ node, onClose }: Props) {
  const updateNode = useScene((s) => s.updateNode)
  const deleteNode = useScene((s) => s.deleteNode)
  const [measured, setMeasured] = useState(0)
  const [actual, setActual] = useState(0)

  useCadUnderlayRevision()
  const loaded = getCadUnderlay(node.url)
  const loadError = getCadUnderlayError(node.url)

  const layers = useMemo(() => {
    if (!loaded) return []
    return loaded.underlay.layers
      .map((layer, index) => ({
        name: layer.name,
        count: loaded.countByLayer[index] ?? 0,
        // The node only records deviations from the drawing's own state, so
        // the effective answer is an override when there is one and the file's
        // word otherwise.
        visible: node.layers[layer.name]?.visible ?? layer.visible,
      }))
      .filter((layer) => layer.count > 0)
      .sort((a, b) => b.count - a.count)
  }, [loaded, node.layers])

  const totalSegments = loaded?.underlay.segmentLayers.length ?? 0
  const visibleSegments = layers.reduce((sum, l) => sum + (l.visible ? l.count : 0), 0)

  const update = (updates: Partial<CadUnderlayNode>) => {
    updateNode(node.id as AnyNodeId, updates)
  }

  const toggleLayer = (name: string, visible: boolean) => {
    update({ layers: { ...node.layers, [name]: { ...node.layers[name], visible: !visible } } })
  }

  // The same picker the import dialog offers, so a unit chosen wrongly at
  // import — or declared wrongly by the file — is one click to fix rather than
  // a re-import.
  const unitOptions = useMemo(() => (loaded ? suggestUnits(loaded.underlay) : []), [loaded])

  const calibrationProblem = validateCalibration({
    measuredMeters: measured,
    actualMeters: actual,
  })

  const extent = loaded
    ? {
        width: (loaded.underlay.contentBounds.maxX - loaded.underlay.contentBounds.minX) * node.scale,
        height:
          (loaded.underlay.contentBounds.maxY - loaded.underlay.contentBounds.minY) * node.scale,
      }
    : null

  return (
    <PanelWrapper onClose={onClose} title={node.name || 'CAD Underlay'} width={300}>
      <PanelSection title="Drawing">
        <ActionGroup>
          <ActionButton
            icon={
              node.visible === false ? (
                <EyeOff className="h-3.5 w-3.5" />
              ) : (
                <Eye className="h-3.5 w-3.5" />
              )
            }
            label={node.visible === false ? 'Show' : 'Hide'}
            onClick={() => update({ visible: node.visible === false })}
          />
          <ActionButton
            icon={
              node.locked ? <Lock className="h-3.5 w-3.5" /> : <Unlock className="h-3.5 w-3.5" />
            }
            label={node.locked ? 'Unlock' : 'Lock'}
            onClick={() => update({ locked: !node.locked })}
          />
          <ActionButton
            className="text-destructive hover:bg-destructive/10"
            icon={<Trash2 className="h-3.5 w-3.5" />}
            label="Delete"
            onClick={() => {
              deleteNode(node.id as AnyNodeId)
              onClose()
            }}
          />
        </ActionGroup>

        {node.locked ? (
          <p className="px-0.5 text-muted-foreground text-xs leading-snug">
            Locked: the drawing is reference only and never catches the pointer. Unlock to move it
            — useful when the file holds several sheets and you want a different one over the
            origin.
          </p>
        ) : (
          <p className="px-0.5 text-amber-700 text-xs leading-snug dark:text-amber-400">
            Unlocked. Lock it again once positioned so it stops interfering with drawing.
          </p>
        )}

        {loadError && (
          <div className="rounded-md border border-destructive/30 bg-destructive/10 px-2 py-1.5 text-destructive text-xs">
            {loadError.message}
          </div>
        )}

        <SliderControl
          label="Opacity"
          max={100}
          min={0}
          onChange={(value) => update({ opacity: value })}
          step={1}
          value={node.opacity}
        />

        {extent && (
          <div className="space-y-1 px-0.5 text-muted-foreground text-xs">
            <div className="flex justify-between">
              <span>Size</span>
              <span className="tabular-nums">
                {extent.width.toFixed(1)} × {extent.height.toFixed(1)} m
              </span>
            </div>
            <div className="flex justify-between">
              <span>Lines</span>
              <span className="tabular-nums">
                {visibleSegments.toLocaleString()} / {totalSegments.toLocaleString()}
              </span>
            </div>
          </div>
        )}
      </PanelSection>

      <PanelSection defaultExpanded={false} title="Scale">
        {unitOptions.length > 0 && (
          <>
            <p className="px-0.5 text-muted-foreground text-xs leading-snug">
              If the drawing came in at the wrong size, its unit is usually why — a plan drawn in
              centimetres and saved as millimetres arrives ten times too big.
            </p>
            <div className="grid grid-cols-1 gap-0.5">
              {unitOptions.map((option) => (
                <button
                  className={cn(
                    'flex items-center justify-between rounded px-2 py-1 text-left text-xs transition-colors',
                    Math.abs(option.metersPerUnit - node.scale) < 1e-12
                      ? 'bg-accent text-accent-foreground'
                      : 'hover:bg-accent/40',
                  )}
                  key={option.label}
                  onClick={() => update({ scale: option.metersPerUnit })}
                  type="button"
                >
                  <span>{option.label}</span>
                  <span className="text-muted-foreground tabular-nums">
                    {formatExtent(option.widthMeters)} × {formatExtent(option.heightMeters)}
                  </span>
                </button>
              ))}
            </div>
          </>
        )}

        <p className="px-0.5 text-muted-foreground text-xs leading-snug">
          For anything a unit change cannot fix, measure a known dimension with the measurement
          tool — it snaps to the underlay — then enter what it should be.
        </p>

        <MetricControl
          label="Measured"
          min={0}
          onChange={setMeasured}
          precision={3}
          step={0.01}
          unit="m"
          value={measured}
        />
        <MetricControl
          label="Should be"
          min={0}
          onChange={setActual}
          precision={3}
          step={0.01}
          unit="m"
          value={actual}
        />

        {calibrationProblem && measured > 0 && actual > 0 && (
          <div className="rounded-md border border-amber-500/35 bg-amber-500/10 px-2 py-1.5 text-amber-700 text-xs dark:text-amber-300">
            {calibrationProblemMessage(calibrationProblem)}
          </div>
        )}

        <ActionGroup>
          <ActionButton
            disabled={calibrationProblem !== null}
            icon={<Ruler className="h-3.5 w-3.5" />}
            label="Apply"
            onClick={() => {
              const result = computeCalibration({
                currentScale: node.scale,
                measuredMeters: measured,
                actualMeters: actual,
              })
              if (!result) return
              update({ scale: result.scale, calibration: result.calibration })
              setMeasured(0)
              setActual(0)
            }}
          />
          {node.calibration && (
            <ActionButton
              icon={<RotateCcw className="h-3.5 w-3.5" />}
              label="Revert"
              onClick={() =>
                update({ scale: revertCalibration(node.calibration!), calibration: null })
              }
            />
          )}
        </ActionGroup>

        {node.calibration && (
          <p className="px-0.5 text-muted-foreground text-xs leading-snug">
            Calibrated: {node.calibration.measuredMeters.toFixed(3)} m read as{' '}
            {node.calibration.actualMeters.toFixed(3)} m.
          </p>
        )}
      </PanelSection>

      {layers.length > 0 && (
        <PanelSection title={`Layers (${layers.length})`}>
          <div className="max-h-72 overflow-y-auto">
            {layers.map((layer) => (
              <button
                className="flex w-full items-center gap-2 rounded px-1 py-1 text-left hover:bg-accent/30"
                key={layer.name}
                onClick={() => toggleLayer(layer.name, layer.visible)}
                type="button"
              >
                {layer.visible ? (
                  <Eye className="h-3 w-3 shrink-0" />
                ) : (
                  <EyeOff className="h-3 w-3 shrink-0 text-muted-foreground" />
                )}
                <span
                  className={cn(
                    'flex-1 truncate text-xs',
                    !layer.visible && 'text-muted-foreground line-through',
                  )}
                >
                  {layer.name}
                </span>
                <span className="shrink-0 text-[10px] text-muted-foreground tabular-nums">
                  {layer.count.toLocaleString()}
                </span>
              </button>
            ))}
          </div>
        </PanelSection>
      )}
    </PanelWrapper>
  )
}
