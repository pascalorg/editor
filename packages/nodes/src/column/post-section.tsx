'use client'

import {
  type AnyNode,
  type AnyNodeId,
  type ColumnNode,
  type ColumnPostBase,
  FRAMING_POST_BASE_LABELS,
  FRAMING_POST_MATERIAL_REF,
  FRAMING_POST_SIZES,
  type FramingPostSize,
  framingPostBasePatch,
  framingPostHeightLimit,
  framingPostSize,
  framingPostTopAt,
  usePascalI18n,
  useScene,
} from '@pascal-app/core'
import {
  formatLinearMeasurement,
  MetricControl,
  PanelSection,
  SegmentedControl,
} from '@pascal-app/editor'
import { useViewer } from '@pascal-app/viewer'
import { electedPostFoot } from './post-placement'

/** Sawn lumber for a post kept dry inside; a post's default is treated (`FRAMING_POST_MATERIAL_REF`). */
const UNTREATED_REF = 'library:wood-woodfine2'
const CUSTOM = 'custom'

/** The fields that make a post another square size, its base kept in proportion. */
export function framingPostSizePatch(post: ColumnNode, size: FramingPostSize): Partial<ColumnNode> {
  const side = FRAMING_POST_SIZES[size]
  return {
    width: side,
    depth: side,
    radius: side / 2,
    ...framingPostBasePatch(
      { width: side, depth: side, slots: post.slots },
      post.postBase ?? 'none',
    ),
  }
}

/** Where a post's top goes: the beam over it, else the ceiling plane, and its height to it from its foot. */
export function framingPostFit(
  nodes: Record<AnyNodeId, AnyNode>,
  post: ColumnNode,
  foot: number,
): { height: number; beamId: string | null } | null {
  if (!post.parentId) return null
  const { top, beamId } = framingPostTopAt(
    nodes,
    post.parentId,
    [post.position[0], post.position[2]],
    { baseElevation: foot, side: post.width },
  )
  return { height: top - foot, beamId }
}

/**
 * A framing post's settings in the column panel, in place of a column's styles: its size, its
 * base, its wood, its height with a fit to the beam over it, and the deck-post height check.
 */
export function FramingPostSection({
  node,
  onUpdate,
}: {
  node: ColumnNode
  onUpdate: (updates: Partial<ColumnNode>) => void
}) {
  const i18n = usePascalI18n()
  const unit = useViewer((state) => state.unit)
  const metricNotation = useViewer((state) => state.metricNotation)
  const nodes = useScene((state) => state.nodes)
  const size = framingPostSize(node) ?? CUSTOM
  const treated = (node.slots?.shaft ?? FRAMING_POST_MATERIAL_REF) === FRAMING_POST_MATERIAL_REF
  const limit = framingPostHeightLimit(node)
  const length = (meters: number) => formatLinearMeasurement(meters, unit, metricNotation)
  const fit =
    node.parentId !== null
      ? framingPostFit(nodes, node, electedPostFoot(nodes, node.parentId)(node))
      : null
  const fitBeam = fit?.beamId ? nodes[fit.beamId as AnyNodeId] : undefined

  return (
    <PanelSection title={i18n._({ id: 'node.column.postSection.post', message: 'Post' })}>
      <SegmentedControl
        onChange={(next: string) => {
          if (next !== CUSTOM) onUpdate(framingPostSizePatch(node, next as FramingPostSize))
        }}
        options={[
          ...(Object.keys(FRAMING_POST_SIZES) as FramingPostSize[]).map((value) => ({
            label: value,
            value,
          })),
          ...(size === CUSTOM
            ? [
                {
                  label: i18n._({ id: 'node.column.postSection.custom', message: 'Custom' }),
                  value: CUSTOM,
                },
              ]
            : []),
        ]}
        value={size}
      />
      <SegmentedControl
        onChange={(base: ColumnPostBase) => onUpdate(framingPostBasePatch(node, base))}
        options={(['none', 'post-base', 'pier'] as const).map((value) => ({
          label: FRAMING_POST_BASE_LABELS[value],
          value,
        }))}
        value={node.postBase ?? 'none'}
      />
      <SegmentedControl
        onChange={(wood: 'treated' | 'untreated') =>
          onUpdate({
            slots: {
              ...node.slots,
              shaft: wood === 'treated' ? FRAMING_POST_MATERIAL_REF : UNTREATED_REF,
            },
          })
        }
        options={[
          {
            label: i18n._({ id: 'node.column.postSection.treated', message: 'Treated' }),
            value: 'treated',
          },
          {
            label: i18n._({ id: 'node.column.postSection.untreated', message: 'Untreated' }),
            value: 'untreated',
          },
        ]}
        value={treated ? 'treated' : 'untreated'}
      />
      <MetricControl
        label={i18n._({ id: 'node.column.postSection.height', message: 'Height' })}
        min={0.3}
        onChange={(height) => onUpdate({ height })}
        precision={3}
        step={0.01}
        unit="m"
        value={node.height}
      />
      {fit && Math.abs(fit.height - node.height) > 0.001 && fit.height > 0.3 && (
        <button
          className="self-start rounded-full border border-border/50 px-3 py-1 text-muted-foreground text-xs hover:text-foreground"
          data-post-fit
          onClick={() => onUpdate({ height: fit.height })}
          type="button"
        >
          {fitBeam
            ? i18n._({
                id: 'node.column.postSection.fitToTheBeamOverIt',
                message: 'Fit to the beam over it ({height})',
                values: { height: length(fit.height) },
              })
            : i18n._({
                id: 'node.column.postSection.fitToTheCeilingPlane',
                message: 'Fit to the ceiling plane ({height})',
                values: { height: length(fit.height) },
              })}
        </button>
      )}
      {limit && (
        <p
          className="rounded-lg bg-accent/30 px-2.5 py-2 text-muted-foreground text-xs"
          role="status"
        >
          {i18n._({
            id: 'node.column.postSection.aSizeDeckPostStandsNo',
            message:
              'A {size} deck post stands no taller than {limit} (IRC Table R507.4, by species and the area it carries): check it, or use the next size up.',
            values: { size: limit.size, limit: length(limit.limit) },
          })}
        </p>
      )}
      <button
        className="self-start rounded-full border border-border/50 px-3 py-1 text-muted-foreground text-xs hover:text-foreground"
        onClick={() => onUpdate({ role: undefined, postBase: undefined })}
        title={i18n._({
          id: 'node.column.postSection.keepItsShapeAndStyleIt',
          message: 'Keep its shape and style it as a column',
        })}
        type="button"
      >
        {i18n._({ id: 'node.column.postSection.makeItAColumn', message: 'Make it a column' })}
      </button>
    </PanelSection>
  )
}
