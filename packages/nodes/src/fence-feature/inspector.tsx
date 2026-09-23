'use client'
import {
  type AnyNodeId,
  canPlaceFenceFeature,
  FenceStyle,
  type FenceFeatureData,
  type FenceFeatureNode,
  fenceFeatureData,
  fenceWithFeatures,
  getFenceCenterlineLength,
  useScene,
} from '@pascal-app/core'
import { ActionButton, SliderControl, ToggleControl } from '@pascal-app/editor'
import { getFenceFeatureDimensions } from '@pascal-app/viewer'
import { useState } from 'react'
import { useShallow } from 'zustand/react/shallow'

export function FenceFeatureEditor({
  node: child,
  onUpdate,
}: {
  node: FenceFeatureNode
  onUpdate: (patch: Partial<FenceFeatureNode>) => void
}) {
  const [error, setError] = useState('')
  const parentId = child.parentId as AnyNodeId | undefined
  const parent = useScene((s) => (parentId ? s.nodes[parentId] : undefined))
  const siblings = useScene(
    useShallow((s) => {
      const fence = parentId ? s.nodes[parentId] : undefined
      return fence?.type === 'fence'
        ? (fence.children ?? []).map((id) => s.nodes[id as AnyNodeId]).filter(Boolean)
        : []
    }),
  )
  if (parent?.type !== 'fence') return <p>Fence unavailable.</p>
  const node = fenceWithFeatures(parent, siblings)
  const features = [fenceFeatureData(child)]
  const length = getFenceCenterlineLength(node)
  const update = (id: string, patch: Partial<Omit<FenceFeatureData, 'id' | 'kind'>>) => {
    const original = features.find((feature) => feature.id === id)
    if (!original) return
    const next = { ...original, ...patch }
    if (
      (patch.width !== undefined || patch.center !== undefined) &&
      !canPlaceFenceFeature(node, next)
    ) {
      setError('Keep the opening inside the fence and clear of other gates or passages.')
      return
    }
    setError('')
    onUpdate(patch)
  }
  return (
    <div className="space-y-2 text-xs">
      {error && (
        <p role="status" className="text-amber-500">
          {error}
        </p>
      )}
      {features.map((feature) => {
        const gate = feature.kind === 'gate'
        const { height, bottom } = getFenceFeatureDimensions(node, feature)
        const selects = [
          ...(gate
            ? [
                {
                  key: 'leafType',
                  label: 'Leaves',
                  value: feature.leafType ?? 'single',
                  options: [
                    ['single', 'Single gate'],
                    ['double', 'Double gate'],
                  ],
                },
                {
                  key: 'hinge',
                  label: 'Hinge side',
                  value: feature.hinge ?? 'left',
                  options: [
                    ['left', 'Left'],
                    ['right', 'Right'],
                  ],
                },
                {
                  key: 'swing',
                  label: 'Swing direction',
                  value: feature.swing ?? 'inward',
                  options: [
                    ['inward', 'Inward'],
                    ['outward', 'Outward'],
                  ],
                },
                {
                  key: 'brace',
                  label: 'Bracing',
                  value: feature.brace ?? 'none',
                  options: [
                    ['none', 'None'],
                    ['diagonal', 'Diagonal'],
                    ['cross', 'Cross'],
                  ],
                },
              ]
            : []),
        ]
        const numbers = [
          {
            key: 'center',
            label: 'Distance from start',
            value: feature.center,
            min: 0,
            max: length,
            step: 0.05,
            unit: 'm',
          },
          {
            key: 'width',
            label: 'Opening width',
            value: feature.width,
            min: 0.35,
            max: length,
            step: 0.05,
            unit: 'm',
          },
          {
            key: 'height',
            label: gate ? 'Gate height' : 'Post height',
            value: height,
            min: 0.3,
            max: 1000,
            step: 0.05,
            unit: 'm',
          },
          ...(gate
            ? [
                {
                  key: 'clearance',
                  label: 'Ground clearance',
                  value: bottom,
                  min: 0,
                  max: 1000,
                  step: 0.01,
                  unit: 'm',
                },
                {
                  key: 'openAngle',
                  label: 'Opening angle',
                  value: feature.openAngle ?? 0,
                  min: 0,
                  max: 170,
                  step: 1,
                  unit: '°',
                },
                {
                  key: 'thickness',
                  label: 'Leaf thickness',
                  value: feature.thickness ?? 0.06,
                  min: 0.02,
                  max: 0.3,
                  step: 0.005,
                  unit: 'm',
                },
                {
                  key: 'frameWidth',
                  label: 'Frame width',
                  value: feature.frameWidth ?? 0.055,
                  min: 0.025,
                  max: 0.2,
                  step: 0.005,
                  unit: 'm',
                },
                {
                  key: 'spacing',
                  label: 'Infill spacing',
                  value: feature.spacing ?? 0.15,
                  min: 0.04,
                  max: 1000,
                  step: 0.01,
                  unit: 'm',
                },
                {
                  key: 'boardWidth',
                  label: 'Board width',
                  value: feature.boardWidth ?? 0.055,
                  min: 0.02,
                  max: 0.3,
                  step: 0.005,
                  unit: 'm',
                },
                ...(feature.leafType === 'double'
                  ? [
                      {
                        key: 'leafSplit',
                        label: 'Left leaf proportion',
                        value: feature.leafSplit ?? 0.5,
                        min: 0.2,
                        max: 0.8,
                        step: 0.05,
                        unit: '',
                      },
                    ]
                  : []),
              ]
            : []),
        ]
        return (
          <div key={feature.id}>
            <div className="mt-2 space-y-2">
              <ToggleControl
                label="Match fence style"
                checked={feature.matchFenceStyle !== false}
                onChange={(checked) =>
                  update(feature.id, {
                    matchFenceStyle: checked,
                    ...(checked
                      ? { matchFenceHeight: true }
                      : { style: feature.style === 'match' ? 'picket' : feature.style }),
                  })
                }
              />
              <ToggleControl
                label="Match fence height"
                checked={feature.matchFenceHeight ?? feature.matchFenceStyle !== false}
                onChange={(checked) =>
                  update(feature.id, {
                    matchFenceHeight: checked,
                    height,
                    ...(gate ? { clearance: bottom } : {}),
                  })
                }
              />
              {gate && feature.matchFenceStyle === false && (
                <label className="flex min-h-9 items-center justify-between gap-3 text-xs text-muted-foreground">
                  Gate style
                  <select
                    className="h-8 min-w-0 max-w-40 rounded-lg border border-border/50 bg-[#2C2C2E] px-2 text-xs text-foreground outline-none transition-colors hover:bg-[#3e3e3e] focus-visible:ring-2 focus-visible:ring-ring"
                    value={feature.style && feature.style !== 'match' ? feature.style : 'picket'}
                    onChange={(event) => {
                      const style = FenceStyle.safeParse(event.currentTarget.value)
                      if (style.success) update(feature.id, { style: style.data })
                    }}
                  >
                    <option value="picket">Picket</option>
                    <option value="slat">Vertical slats</option>
                    <option value="horizontal">Horizontal boards</option>
                    <option value="privacy">Solid privacy</option>
                    <option value="rail">Open rails</option>
                  </select>
                </label>
              )}
              {selects
                .filter((field) => field.key !== 'hinge' || feature.leafType !== 'double')
                .map((field) => (
                  <label
                    key={field.key}
                    className="flex min-h-9 items-center justify-between gap-3 text-xs text-muted-foreground"
                  >
                    {field.label}
                    <select
                      className="h-8 min-w-0 max-w-40 rounded-lg border border-border/50 bg-[#2C2C2E] px-2 text-xs text-foreground outline-none transition-colors hover:bg-[#3e3e3e] focus-visible:ring-2 focus-visible:ring-ring"
                      value={field.value}
                      onChange={(event) => update(feature.id, { [field.key]: event.target.value })}
                    >
                      {field.options.map(([value, label]) => (
                        <option key={value} value={value}>
                          {label}
                        </option>
                      ))}
                    </select>
                  </label>
                ))}
              {numbers
                .filter(
                  (field) =>
                    feature.matchFenceStyle === false ||
                    !['thickness', 'frameWidth', 'spacing', 'boardWidth'].includes(field.key),
                )
                .map((field) => (
                  <SliderControl
                    key={field.key}
                    label={field.label}
                    value={field.value}
                    min={field.min}
                    max={field.max}
                    step={field.step}
                    precision={field.key === 'openAngle' ? 0 : 3}
                    unit={field.unit}
                    onChange={(value) =>
                      update(feature.id, {
                        [field.key]: value,
                        ...(['height', 'clearance'].includes(field.key)
                          ? {
                              matchFenceHeight: false,
                              ...(field.key === 'clearance'
                                ? { height }
                                : gate
                                  ? { clearance: bottom }
                                  : {}),
                            }
                          : {}),
                      })
                    }
                  />
                ))}
              <ToggleControl
                label="Jamb posts"
                checked={feature.showPosts !== false}
                onChange={(checked) => update(feature.id, { showPosts: checked })}
              />
              {gate && (
                <ToggleControl
                  label="Hinges and latch"
                  checked={feature.showHardware !== false}
                  onChange={(checked) => update(feature.id, { showHardware: checked })}
                />
              )}
              <ActionButton
                type="button"
                label={gate ? 'Remove gate' : 'Remove opening'}
                className="w-full text-destructive hover:text-destructive"
                onClick={() => useScene.getState().deleteNode(child.id)}
              />
            </div>
          </div>
        )
      })}
    </div>
  )
}
