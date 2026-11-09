'use client'

import { type AnyNodeId, type DuctSegmentNode, usePascalI18n, useScene } from '@pascal-app/core'
import { useMemo, useState } from 'react'
import RunHangerInspector from '../shared/run-hanger-inspector'
import { type DuctEditInput, editDuct } from './edit-operation'

export default function DuctEditInspector({ node }: { node: DuctSegmentNode }) {
  return (
    <>
      <DuctEditForm
        key={`${node.id}:${node.shape}:${node.diameter}:${node.width}:${node.height}:${JSON.stringify(node.path)}`}
        node={node}
      />
      <RunHangerInspector node={node} />
    </>
  )
}

function DuctEditForm({ node }: { node: DuctSegmentNode }) {
  const i18n = usePascalI18n()
  const nodes = useScene((state) => state.nodes)
  const [input, setInput] = useState<DuctEditInput>({
    nodeId: node.id,
    action: 'resize',
    scope: 'segment',
    alignment: 'center',
    shape: node.shape,
    diameter: node.diameter,
    width: node.width,
    height: node.height,
    from: 1,
    to: 2,
    offset: 1,
  })
  const [notice, setNotice] = useState('')
  const preview = useMemo(() => {
    try {
      return { outcome: editDuct(nodes, input, { activeLevelId: node.parentId }), error: '' }
    } catch (error) {
      return {
        outcome: null,
        error:
          error instanceof Error
            ? error.message
            : i18n._({
                id: 'node.ductSegment.editInspector.unableToPlanEdit',
                message: 'Unable to plan this edit.',
              }),
      }
    }
  }, [nodes, input, node.parentId, i18n])
  const update = (patch: Partial<DuctEditInput>) => {
    setInput((previous) => ({ ...previous, ...patch }))
    setNotice('')
  }
  const numberField = (
    key: 'diameter' | 'width' | 'height' | 'from' | 'to' | 'offset',
    label: string,
  ) => (
    <label className="flex items-center justify-between gap-2">
      {label}
      <input
        aria-label={label}
        type="number"
        step={input.action === 'offset' ? 0.05 : 1}
        className="w-20 rounded border bg-background p-1"
        value={Number.isFinite(input[key]) ? input[key] : ''}
        onChange={(event) => update({ [key]: event.target.valueAsNumber })}
      />
    </label>
  )
  const changes = preview.outcome?.changes
  const count = (changes?.update?.length ?? 0) + (changes?.create?.length ?? 0)
  const paths =
    input.action === 'offset' && changes
      ? [
          ...changes
            .update!.filter((entry) => entry.id === node.id)
            .map((entry) => (entry.data as DuctSegmentNode).path),
          ...changes.create!.flatMap((entry) =>
            entry.node.type === 'duct-segment' ? [entry.node.path] : [],
          ),
        ]
      : []
  const length = Math.hypot(...node.path[1]!.map((v, i) => v - node.path[0]![i]!))
  const elevation = Math.max(Math.abs(input.offset ?? 1), 0.1)
  const project = (point: number[]) => {
    const along =
      point.reduce(
        (sum, value, i) =>
          sum + (value - node.path[0]![i]!) * (node.path[1]![i]! - node.path[0]![i]!),
        0,
      ) / (length || 1)
    const baseline = (input.offset ?? 0) > 0 ? 90 : 26
    return `${16 + (along / (length || 1)) * 228},${baseline - ((point[1]! - node.path[0]![1]) / elevation) * 64}`
  }
  return (
    <section className="space-y-2 border-t pt-3 text-xs">
      <h3 className="text-sm font-medium">
        {i18n._({ id: 'node.ductSegment.editInspector.editDuctRoute', message: 'Edit duct route' })}
      </h3>
      <select
        aria-label={i18n._({ id: 'node.ductSegment.editInspector.ductEdit', message: 'Duct edit' })}
        className="w-full rounded border bg-background p-1"
        value={input.action}
        onChange={(event) => update({ action: event.target.value as DuctEditInput['action'] })}
      >
        <option value="resize">
          {i18n._({
            id: 'node.ductSegment.editInspector.resizeWithConnections',
            message: 'Resize with connections',
          })}
        </option>
        <option value="offset">
          {i18n._({
            id: 'node.ductSegment.editInspector.offsetAroundObstacle',
            message: 'Offset around obstacle',
          })}
        </option>
      </select>
      {input.action === 'resize' ? (
        <>
          <select
            aria-label={i18n._({
              id: 'node.ductSegment.editInspector.resizeScope',
              message: 'Resize scope',
            })}
            className="w-full rounded border bg-background p-1"
            value={input.scope}
            onChange={(event) => update({ scope: event.target.value as DuctEditInput['scope'] })}
          >
            <option value="segment">
              {i18n._({
                id: 'node.ductSegment.editInspector.thisSegment',
                message: 'This segment',
              })}
            </option>
            <option value="branch">
              {i18n._({
                id: 'node.ductSegment.editInspector.connectedSameSizeBranch',
                message: 'Connected same-size branch',
              })}
            </option>
          </select>
          <p className="text-muted-foreground">
            {i18n._({
              id: 'node.ductSegment.editInspector.branchStopsAtJunctionsSizeChanges',
              message:
                'Branch stops at junctions, size changes and equipment. Boundary collars stay fixed.',
            })}
          </p>
          <select
            aria-label={i18n._({
              id: 'node.ductSegment.editInspector.ductShape',
              message: 'Duct shape',
            })}
            className="w-full rounded border bg-background p-1"
            value={input.shape}
            onChange={(event) => update({ shape: event.target.value as DuctEditInput['shape'] })}
          >
            <option value="round">
              {i18n._({ id: 'node.ductSegment.editInspector.round', message: 'Round' })}
            </option>
            <option value="rect">
              {i18n._({ id: 'node.ductSegment.editInspector.rectangular', message: 'Rectangular' })}
            </option>
            <option value="oval">
              {i18n._({ id: 'node.ductSegment.editInspector.oval', message: 'Oval' })}
            </option>
          </select>
          {input.shape === 'round' ? (
            numberField(
              'diameter',
              i18n._({ id: 'node.ductSegment.editInspector.diameter', message: 'Diameter (in)' }),
            )
          ) : (
            <>
              {numberField(
                'width',
                i18n._({ id: 'node.ductSegment.editInspector.width', message: 'Width (in)' }),
              )}
              {numberField(
                'height',
                i18n._({ id: 'node.ductSegment.editInspector.height', message: 'Height (in)' }),
              )}
            </>
          )}
          <select
            aria-label={i18n._({
              id: 'node.ductSegment.editInspector.preserveDuctAlignment',
              message: 'Preserve duct alignment',
            })}
            className="w-full rounded border bg-background p-1"
            value={input.alignment}
            onChange={(event) =>
              update({ alignment: event.target.value as DuctEditInput['alignment'] })
            }
          >
            <option value="center">
              {i18n._({
                id: 'node.ductSegment.editInspector.keepCenterline',
                message: 'Keep centerline',
              })}
            </option>
            <option value="top">
              {i18n._({
                id: 'node.ductSegment.editInspector.keepTopFace',
                message: 'Keep top face',
              })}
            </option>
            <option value="bottom">
              {i18n._({
                id: 'node.ductSegment.editInspector.keepBottomFace',
                message: 'Keep bottom face',
              })}
            </option>
            <option value="left">
              {i18n._({
                id: 'node.ductSegment.editInspector.keepLeftFace',
                message: 'Keep left face',
              })}
            </option>
            <option value="right">
              {i18n._({
                id: 'node.ductSegment.editInspector.keepRightFace',
                message: 'Keep right face',
              })}
            </option>
          </select>
          <p className="text-muted-foreground">
            {i18n._({
              id: 'node.ductSegment.editInspector.faceAlignmentAppliesToFreeStraight',
              message:
                'Face alignment applies to free straight runs. Left and right follow the run’s section axes.',
            })}
          </p>
        </>
      ) : (
        <>
          {numberField(
            'from',
            i18n._({
              id: 'node.ductSegment.editInspector.firstBend',
              message: 'First bend from start (m)',
            }),
          )}
          {numberField(
            'to',
            i18n._({
              id: 'node.ductSegment.editInspector.lastBend',
              message: 'Last bend from start (m)',
            }),
          )}
          {numberField(
            'offset',
            i18n._({
              id: 'node.ductSegment.editInspector.verticalOffset',
              message: 'Vertical offset (m)',
            }),
          )}
          <p className="text-muted-foreground">
            {i18n._({
              id: 'node.ductSegment.editInspector.positiveMovesUpNegativeMovesDown',
              message:
                'Positive moves up; negative moves down. Four elbows preserve both endpoints. Check the obstacle’s clearance; this does not detect collisions.',
            })}
          </p>
        </>
      )}
      {paths.length > 0 && (
        <figure className="rounded border p-2">
          <svg
            viewBox="0 0 260 116"
            role="img"
            aria-label={i18n._({
              id: 'node.ductSegment.editInspector.offsetSideElevationPreview',
              message: 'Offset side elevation preview',
            })}
            className="w-full"
          >
            <title>
              {i18n._({
                id: 'node.ductSegment.editInspector.offsetSideElevationPreview',
                message: 'Offset side elevation preview',
              })}
            </title>
            <polyline
              points={node.path.map(project).join(' ')}
              fill="none"
              stroke="currentColor"
              opacity="0.3"
              strokeDasharray="4 4"
            />
            <polyline
              points={paths.flat().map(project).join(' ')}
              fill="none"
              stroke="#818cf8"
              strokeWidth="3"
            />
          </svg>
          <figcaption className="text-muted-foreground">
            {i18n._({
              id: 'node.ductSegment.editInspector.sideElevationDashedLineIsThe',
              message: 'Side elevation · dashed line is the original route',
            })}
          </figcaption>
        </figure>
      )}
      <p role="status" className={preview.error ? 'text-amber-600' : 'text-muted-foreground'}>
        {preview.error ||
          i18n._({
            id: 'node.ductSegment.editInspector.partsSummary',
            message:
              '{affected, plural, one {# existing part affected} other {# existing parts affected}} · {created, plural, one {# new part} other {# new parts}}',
            values: {
              affected: changes?.update?.length ?? 0,
              created: changes?.create?.length ?? 0,
            },
          })}
      </p>
      <button
        type="button"
        disabled={!count || !!preview.error}
        className="w-full rounded border px-2 py-1 disabled:opacity-40"
        onClick={() => {
          try {
            const outcome = editDuct(useScene.getState().nodes, input, {
              activeLevelId: node.parentId,
            })
            const plan = outcome.changes
            if (plan)
              useScene.getState().applyNodeChanges({
                create: plan.create?.map((entry) => ({
                  ...entry,
                  parentId: entry.parentId as AnyNodeId | undefined,
                })),
                update: plan.update?.map((entry) => ({ ...entry, id: entry.id as AnyNodeId })),
              })
            setNotice(String(outcome.result.message))
          } catch (error) {
            setNotice(
              error instanceof Error
                ? error.message
                : i18n._({
                    id: 'node.ductSegment.editInspector.unableToApplyEdit',
                    message: 'Unable to apply edit.',
                  }),
            )
          }
        }}
      >
        {input.action === 'resize'
          ? i18n._({ id: 'node.ductSegment.editInspector.applyResize', message: 'Apply resize' })
          : i18n._({ id: 'node.ductSegment.editInspector.applyOffset', message: 'Apply offset' })}
      </button>
      {notice && <p role="status">{notice}</p>}
    </section>
  )
}
