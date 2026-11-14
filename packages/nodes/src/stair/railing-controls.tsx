'use client'
import { type AnyNodeId, type StairNode, usePascalI18n, useScene } from '@pascal-app/core'
import { MetricControl, SegmentedControl, ToggleControl } from '@pascal-app/editor'

const MODES = [
  { label: /* i18n */ { id: 'node.stair.railingControls.none', message: 'None' }, value: 'none' },
  { label: /* i18n */ { id: 'node.stair.railingControls.left', message: 'Left' }, value: 'left' },
  {
    label: /* i18n */ { id: 'node.stair.railingControls.right', message: 'Right' },
    value: 'right',
  },
  { label: /* i18n */ { id: 'node.stair.railingControls.both', message: 'Both' }, value: 'both' },
] as const
export function StairRailingControls({
  node,
  onChange,
}: {
  node: StairNode
  onChange: (patch: Partial<StairNode>) => void
}) {
  const i18n = usePascalI18n()
  const config = node.handrail
  return (
    <div className="space-y-3">
      <SegmentedControl
        value={
          node.railingStyle === 'glass' || node.railingStyle === 'metal'
            ? 'continuous'
            : (node.railingPath ?? 'original')
        }
        options={[
          {
            label: i18n._({
              id: 'node.stair.railingControls.originalLayout',
              message: 'Original layout',
            }),
            value: 'original',
          },
          {
            label: i18n._({ id: 'node.stair.railingControls.continuous', message: 'Continuous' }),
            value: 'continuous',
          },
        ]}
        onChange={(value) =>
          onChange({
            railingPath: value as StairNode['railingPath'],
            ...(value === 'original' &&
            (node.railingStyle === 'glass' || node.railingStyle === 'metal')
              ? { railingStyle: 'balusters' }
              : {}),
          })
        }
      />
      <ToggleControl
        label={i18n._({
          id: 'node.stair.railingControls.separateHandrail',
          message: 'Separate handrail',
        })}
        checked={!!config}
        onChange={(checked) =>
          onChange({
            handrail: checked
              ? { mode: 'both', height: 0.9, diameter: 0.045, offset: 0.06 }
              : undefined,
          })
        }
      />
      {config ? (
        <>
          <SegmentedControl
            value={config.mode}
            options={MODES.map((option) => ({ ...option, label: i18n._(option.label) }))}
            onChange={(value) =>
              onChange({ handrail: { ...config, mode: value as StairNode['railingMode'] } })
            }
          />
          {(['height', 'diameter', 'offset'] as const).map((key) => (
            <MetricControl
              key={key}
              label={
                key === 'height'
                  ? i18n._({
                      id: 'node.stair.railingControls.handrailHeight',
                      message: 'Handrail height',
                    })
                  : key === 'diameter'
                    ? i18n._({
                        id: 'node.stair.railingControls.handrailDiameter',
                        message: 'Handrail diameter',
                      })
                    : i18n._({
                        id: 'node.stair.railingControls.handrailInset',
                        message: 'Handrail inset',
                      })
              }
              value={config[key]}
              min={key === 'offset' ? 0 : 0.001}
              step={0.005}
              precision={3}
              unit="m"
              onChange={(value) => onChange({ handrail: { ...config, [key]: value } })}
            />
          ))}
          {(['bottom', 'top'] as const).map((end) => {
            const detail = config[end] ?? {
              extension: 0,
              return: 'none' as const,
              returnLength: 0.1,
            }
            const update = (patch: Partial<typeof detail>) =>
              onChange({ handrail: { ...config, [end]: { ...detail, ...patch } } })
            return (
              <div key={end} className="space-y-2">
                <MetricControl
                  label={
                    end === 'bottom'
                      ? i18n._({
                          id: 'node.stair.railingControls.bottomExtension',
                          message: 'Bottom sloped extension',
                        })
                      : i18n._({
                          id: 'node.stair.railingControls.topExtension',
                          message: 'Top horizontal extension',
                        })
                  }
                  value={detail.extension}
                  min={0}
                  step={0.05}
                  precision={3}
                  unit="m"
                  onChange={(extension) => update({ extension })}
                />
                <SegmentedControl
                  value={detail.return}
                  options={[
                    {
                      label: i18n._({
                        id: 'node.stair.railingControls.noReturn',
                        message: 'No return',
                      }),
                      value: 'none',
                    },
                    {
                      label: i18n._({
                        id: 'node.stair.railingControls.wallFacing',
                        message: 'Wall-facing',
                      }),
                      value: 'wall',
                    },
                    {
                      label: i18n._({
                        id: 'node.stair.railingControls.postFacing',
                        message: 'Post-facing',
                      }),
                      value: 'post',
                    },
                    {
                      label: i18n._({ id: 'node.stair.railingControls.floor', message: 'Floor' }),
                      value: 'floor',
                    },
                  ]}
                  onChange={(value) => update({ return: value as typeof detail.return })}
                />
                {detail.return === 'wall' || detail.return === 'post' ? (
                  <>
                    <MetricControl
                      label={i18n._({
                        id: 'node.stair.railingControls.returnLength',
                        message: 'Return length',
                      })}
                      value={detail.returnLength}
                      min={0}
                      step={0.01}
                      precision={3}
                      unit="m"
                      onChange={(returnLength) => update({ returnLength })}
                    />
                    <p className="text-xs text-muted-foreground">
                      {i18n._({
                        id: 'node.stair.railingControls.setTheLengthToReachThe',
                        message: 'Set the length to reach the wall or post.',
                      })}
                    </p>
                  </>
                ) : null}
              </div>
            )
          })}
        </>
      ) : null}
    </div>
  )
}
export function StairRailingField({ node }: { node: StairNode }) {
  return (
    <StairRailingControls
      node={node}
      onChange={(patch) => useScene.getState().updateNode(node.id as AnyNodeId, patch)}
    />
  )
}
