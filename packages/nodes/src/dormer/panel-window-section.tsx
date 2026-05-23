'use client'

import type { DormerNode } from '@pascal-app/core'
import { PanelSection, SegmentedControl, SliderControl, ToggleControl } from '@pascal-app/editor'
import { useState } from 'react'

type WindowShape = DormerNode['windowShape']
type WindowRadiusMode = 'all' | 'individual'

function maxSharedRadius(width: number, height: number): number {
  return Math.max(0, Math.min(width / 2, height / 2))
}

/**
 * The Window tab of the dormer inspector: Hung Wall, Opening, Shape
 * (with rounded/arch sub-controls), Frame, Grid, Sill. Owns local UI
 * state for the "All vs Individual" corner-radius view mode — derived
 * from tuple uniformity by default.
 */
export function DormerWindowSection({
  node,
  previewProp,
  commitProp,
  handleUpdate,
}: {
  node: DormerNode
  previewProp: (updates: Partial<DormerNode>) => void
  commitProp: (updates: Partial<DormerNode>) => void
  handleUpdate: (updates: Partial<DormerNode>) => void
}) {
  const [radiusViewMode, setRadiusViewMode] = useState<WindowRadiusMode>('all')

  const windowShape: WindowShape = node.windowShape
  const windowCornerRadii: [number, number, number, number] = [...node.windowCornerRadii]
  const windowArchHeight = node.windowArchHeight
  const maxRadius = Math.max(0.01, maxSharedRadius(node.windowWidth, node.windowHeight))

  const tupleIsUniform =
    windowCornerRadii[0] === windowCornerRadii[1] &&
    windowCornerRadii[1] === windowCornerRadii[2] &&
    windowCornerRadii[2] === windowCornerRadii[3]
  const sharedRadius = windowCornerRadii[0]

  const setCornerRadius = (index: number, value: number, commit: boolean) => {
    const next = [...windowCornerRadii] as [number, number, number, number]
    next[index] = value
    if (commit) commitProp({ windowCornerRadii: next })
    else previewProp({ windowCornerRadii: next })
  }

  const setAllCornerRadii = (value: number, commit: boolean) => {
    const next: [number, number, number, number] = [value, value, value, value]
    if (commit) commitProp({ windowCornerRadii: next })
    else previewProp({ windowCornerRadii: next })
  }

  return (
    <>
      <PanelSection title="Hung Wall">
        <SliderControl
          label="Height"
          max={6}
          min={0.2}
          onChange={(v) => previewProp({ wallSkirtHeight: v })}
          onCommit={(v) => commitProp({ wallSkirtHeight: v })}
          precision={2}
          restoreOnCommit={false}
          step={0.05}
          unit="m"
          value={Math.round(node.wallSkirtHeight * 100) / 100}
        />
      </PanelSection>

      <PanelSection title="Opening">
        <SliderControl
          label="Width"
          max={Math.max(0.5, node.width - 0.1)}
          min={0.2}
          onChange={(v) => previewProp({ windowWidth: v })}
          onCommit={(v) => commitProp({ windowWidth: v })}
          precision={2}
          restoreOnCommit={false}
          step={0.05}
          unit="m"
          value={Math.round(node.windowWidth * 100) / 100}
        />
        <SliderControl
          label="Height"
          max={Math.max(0.2, node.wallSkirtHeight - 0.1)}
          min={0.2}
          onChange={(v) => previewProp({ windowHeight: v })}
          onCommit={(v) => commitProp({ windowHeight: v })}
          precision={2}
          restoreOnCommit={false}
          step={0.05}
          unit="m"
          value={Math.round(node.windowHeight * 100) / 100}
        />
        <SliderControl
          label="Offset X"
          max={1}
          min={-1}
          onChange={(v) => previewProp({ windowOffsetX: v })}
          onCommit={(v) => commitProp({ windowOffsetX: v })}
          precision={2}
          restoreOnCommit={false}
          step={0.05}
          unit="m"
          value={Math.round(node.windowOffsetX * 100) / 100}
        />
        <SliderControl
          label="Offset Y"
          max={2}
          min={0}
          onChange={(v) => previewProp({ windowOffsetY: v })}
          onCommit={(v) => commitProp({ windowOffsetY: v })}
          precision={2}
          restoreOnCommit={false}
          step={0.05}
          unit="m"
          value={Math.round(node.windowOffsetY * 100) / 100}
        />
      </PanelSection>

      <PanelSection title="Shape">
        <SegmentedControl
          onChange={(v) =>
            handleUpdate({
              windowShape: v as WindowShape,
              ...(v === 'rounded'
                ? {
                    windowCornerRadii: windowCornerRadii.map((r) => Math.min(r, maxRadius)) as [
                      number,
                      number,
                      number,
                      number,
                    ],
                  }
                : {}),
            })
          }
          options={[
            { value: 'rectangle', label: 'Rect' },
            { value: 'rounded', label: 'Rounded' },
            { value: 'arch', label: 'Arch' },
          ]}
          value={windowShape}
        />
        {windowShape === 'rounded' && (
          <div className="mt-2 flex flex-col gap-1">
            <SegmentedControl
              onChange={(v) => setRadiusViewMode(v as WindowRadiusMode)}
              options={[
                { value: 'all', label: 'All' },
                { value: 'individual', label: 'Individual' },
              ]}
              value={tupleIsUniform ? radiusViewMode : 'individual'}
            />
            {tupleIsUniform && radiusViewMode === 'all' ? (
              <SliderControl
                label="Corner Radius"
                max={maxRadius}
                min={0}
                onChange={(v) => setAllCornerRadii(v, false)}
                onCommit={(v) => setAllCornerRadii(v, true)}
                precision={2}
                restoreOnCommit={false}
                step={0.01}
                unit="m"
                value={Math.round(sharedRadius * 100) / 100}
              />
            ) : (
              (
                [
                  ['Top Left', 0],
                  ['Top Right', 1],
                  ['Bottom Right', 2],
                  ['Bottom Left', 3],
                ] as const
              ).map(([label, index]) => (
                <SliderControl
                  key={label}
                  label={label}
                  max={maxRadius}
                  min={0}
                  onChange={(v) => setCornerRadius(index, v, false)}
                  onCommit={(v) => setCornerRadius(index, v, true)}
                  precision={2}
                  restoreOnCommit={false}
                  step={0.01}
                  unit="m"
                  value={Math.round((windowCornerRadii[index] ?? 0) * 100) / 100}
                />
              ))
            )}
          </div>
        )}
        {windowShape === 'arch' && (
          <SliderControl
            label="Arch Height"
            max={Math.max(0.1, node.windowHeight)}
            min={0.1}
            onChange={(v) => previewProp({ windowArchHeight: v })}
            onCommit={(v) => commitProp({ windowArchHeight: v })}
            precision={2}
            restoreOnCommit={false}
            step={0.05}
            unit="m"
            value={Math.round(windowArchHeight * 100) / 100}
          />
        )}
      </PanelSection>

      <PanelSection title="Frame">
        <SliderControl
          label="Thickness"
          max={0.15}
          min={0.01}
          onChange={(v) => previewProp({ windowFrameThickness: v })}
          onCommit={(v) => commitProp({ windowFrameThickness: v })}
          precision={3}
          restoreOnCommit={false}
          step={0.005}
          unit="m"
          value={Math.round(node.windowFrameThickness * 1000) / 1000}
        />
        <SliderControl
          label="Depth"
          max={0.15}
          min={0.02}
          onChange={(v) => previewProp({ windowFrameDepth: v })}
          onCommit={(v) => commitProp({ windowFrameDepth: v })}
          precision={3}
          restoreOnCommit={false}
          step={0.005}
          unit="m"
          value={Math.round(node.windowFrameDepth * 1000) / 1000}
        />
        <SliderControl
          label="Divider"
          max={0.06}
          min={0}
          onChange={(v) => previewProp({ windowDividerThickness: v })}
          onCommit={(v) => commitProp({ windowDividerThickness: v })}
          precision={3}
          restoreOnCommit={false}
          step={0.002}
          unit="m"
          value={Math.round(node.windowDividerThickness * 1000) / 1000}
        />
      </PanelSection>

      <PanelSection title="Grid">
        <SliderControl
          label="Columns"
          max={8}
          min={1}
          onChange={(v) => previewProp({ windowColumns: Math.max(1, Math.min(8, Math.round(v))) })}
          onCommit={(v) => commitProp({ windowColumns: Math.max(1, Math.min(8, Math.round(v))) })}
          precision={0}
          restoreOnCommit={false}
          step={1}
          value={node.windowColumns}
        />
        <SliderControl
          label="Rows"
          max={8}
          min={1}
          onChange={(v) => previewProp({ windowRows: Math.max(1, Math.min(8, Math.round(v))) })}
          onCommit={(v) => commitProp({ windowRows: Math.max(1, Math.min(8, Math.round(v))) })}
          precision={0}
          restoreOnCommit={false}
          step={1}
          value={node.windowRows}
        />
      </PanelSection>

      <PanelSection title="Sill">
        <ToggleControl
          checked={node.windowSill}
          label="Enable Sill"
          onChange={(checked) => handleUpdate({ windowSill: checked })}
        />
        {node.windowSill && (
          <div className="mt-1 flex flex-col gap-1">
            <SliderControl
              label="Depth"
              max={0.3}
              min={0.02}
              onChange={(v) => previewProp({ windowSillDepth: v })}
              onCommit={(v) => commitProp({ windowSillDepth: v })}
              precision={3}
              restoreOnCommit={false}
              step={0.01}
              unit="m"
              value={Math.round(node.windowSillDepth * 1000) / 1000}
            />
            <SliderControl
              label="Thickness"
              max={0.1}
              min={0.01}
              onChange={(v) => previewProp({ windowSillThickness: v })}
              onCommit={(v) => commitProp({ windowSillThickness: v })}
              precision={3}
              restoreOnCommit={false}
              step={0.005}
              unit="m"
              value={Math.round(node.windowSillThickness * 1000) / 1000}
            />
          </div>
        )}
      </PanelSection>
    </>
  )
}
