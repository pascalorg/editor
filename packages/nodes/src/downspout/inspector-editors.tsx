'use client'

import {
  type AnyNodeId,
  type DownspoutNode,
  type GutterNode,
  type GutterOutlet,
  useLiveNodeOverrides,
  useScene,
  usesAutomaticDownspoutLength,
} from '@pascal-app/core'
import { SegmentedControl, SliderControl } from '@pascal-app/editor'

/**
 * Position-along-the-eave editor for a downspout. The downspout's spot
 * is owned by its outlet on the host gutter (`gutter.outlets[].offset`),
 * not by the downspout itself — so this slider reads + writes that
 * outlet on the gutter rather than patching the downspout.
 *
 * Mesh-first commit (same shape as the in-world handle drags):
 *  - `onChange` (live, every drag tick) publishes the new outlets to the
 *    gutter's `useLiveNodeOverrides`. The gutter renderer rebuilds its
 *    mesh from that override and the downspout renderer re-reads its
 *    outlet — both move immediately, with NO write to the scene store /
 *    history. The slider also reads the override back so its number
 *    tracks during the drag.
 *  - `onCommit` (on release) writes the final outlets to the store once
 *    (the single undoable change — `SliderControl` resumes history
 *    first) and drops the override so the renderers read the store again.
 *
 * Wired via `parametrics.fields[].kind: 'custom'`; hidden when the
 * downspout isn't linked to an outlet.
 */
export function DownspoutPositionEditor({ node }: { node: DownspoutNode }) {
  const gutter = useScene((s) =>
    node.gutterId ? (s.nodes[node.gutterId as AnyNodeId] as GutterNode | undefined) : undefined,
  )
  // Live override on the gutter, so the readout tracks the in-flight drag.
  const override = useLiveNodeOverrides((s) =>
    node.gutterId
      ? (s.get(node.gutterId as AnyNodeId) as Partial<GutterNode> | undefined)
      : undefined,
  )

  if (gutter?.type !== 'gutter') return null
  const storeOutlets = gutter.outlets ?? []
  const effectiveOutlets = (override?.outlets as GutterOutlet[] | undefined) ?? storeOutlets
  const outlet = effectiveOutlets.find((o) => o.id === node.outletId)
  if (!outlet) return null

  // Usable half-span — keep the outlet a hair inside each end so the
  // collar never lands on a cap. The geometry clamps too; this just
  // keeps the slider honest.
  const bound = Math.max(0.05, Math.max(0.05, gutter.length) / 2 - 0.1)
  const gutterId = gutter.id as AnyNodeId

  // Set the dragged outlet's offset on a copy of the STORE outlets (the
  // canonical base — the slider hands an absolute value each tick).
  const withOffset = (offset: number): GutterOutlet[] =>
    storeOutlets.map((o) => (o.id === node.outletId ? { ...o, offset } : o))

  const handleChange = (offset: number) => {
    // Mesh-first: publish to the gutter override, no store write.
    useLiveNodeOverrides.getState().set(gutterId, { outlets: withOffset(offset) })
  }

  const handleCommit = (offset: number) => {
    // Commit once to the store, then drop the override.
    const state = useScene.getState()
    const outlets = withOffset(offset).map((entry) =>
      entry.id === node.outletId ? { ...entry, generatedBy: undefined } : entry,
    )
    const metadata =
      node.metadata && typeof node.metadata === 'object' && !Array.isArray(node.metadata)
        ? { ...node.metadata }
        : {}
    delete metadata.generatedBy
    state.updateNodes([
      { id: gutterId, data: { outlets } },
      { id: node.id as AnyNodeId, data: { metadata: metadata as DownspoutNode['metadata'] } },
    ])
    useLiveNodeOverrides.getState().clear(gutterId)
    state.markDirty(gutterId)
  }

  return (
    <SliderControl
      label="Position"
      max={bound}
      min={-bound}
      onChange={handleChange}
      onCommit={handleCommit}
      precision={2}
      // onChange only touches the override, so there's nothing in the
      // store to restore on release — skip the restore-then-reapply dance.
      restoreOnCommit={false}
      step={0.05}
      unit="m"
      value={Math.max(-bound, Math.min(bound, outlet.offset ?? 0))}
    />
  )
}

export function DownspoutLengthModeEditor({
  node,
  onUpdate,
}: {
  node: DownspoutNode
  onUpdate: (patch: Partial<DownspoutNode>) => void
}) {
  return (
    <div className="space-y-2">
      <p className="text-xs text-muted-foreground">Length mode</p>
      <SegmentedControl
        value={usesAutomaticDownspoutLength(node) ? 'to-ground' : 'manual'}
        options={[
          { label: 'To ground', value: 'to-ground' },
          { label: 'Manual', value: 'manual' },
        ]}
        onChange={(value) =>
          onUpdate({ lengthMode: value === 'to-ground' ? 'to-ground' : 'manual' })
        }
      />
    </div>
  )
}

export function DownspoutShapeEditor({
  node,
  onUpdate,
}: {
  node: DownspoutNode
  onUpdate: (patch: Partial<DownspoutNode>) => void
}) {
  return (
    <div className="space-y-2">
      <button
        type="button"
        aria-pressed={node.shape === 'auto'}
        className="w-full rounded-lg border p-2 text-xs"
        onClick={() => onUpdate({ shape: 'auto' })}
      >
        Match gutter profile
      </button>
      <div className="grid grid-cols-2 gap-2">
        {(['round', 'rect'] as const).map((shape) => (
          <button
            type="button"
            key={shape}
            aria-pressed={node.shape === shape}
            onClick={() => onUpdate({ shape })}
            className={`rounded-lg border p-2 text-xs ${node.shape === shape ? 'border-primary bg-primary/10' : 'border-border hover:bg-muted'}`}
          >
            <img
              src={`/icons/downspout/${shape}.webp`}
              alt=""
              className="mx-auto h-16 w-16 object-contain"
            />
            {shape === 'round' ? 'Round' : 'Rectangular'}
          </button>
        ))}
      </div>
    </div>
  )
}

export function DownspoutTerminalEditor({
  node,
  onUpdate,
}: {
  node: DownspoutNode
  onUpdate: (patch: Partial<DownspoutNode>) => void
}) {
  return (
    <div className="grid grid-cols-3 gap-2">
      {(['splash', 'kickout', 'straight'] as const).map((terminal) => (
        <button
          type="button"
          key={terminal}
          aria-pressed={node.terminal === terminal}
          onClick={() => onUpdate({ terminal })}
          className={`rounded-lg border p-2 text-xs ${node.terminal === terminal ? 'border-primary bg-primary/10' : 'border-border hover:bg-muted'}`}
        >
          <img
            src={`/icons/downspout/${terminal}.webp`}
            alt=""
            className="mx-auto h-16 w-16 object-contain"
          />
          {terminal === 'splash' ? 'Splash block' : terminal === 'kickout' ? 'Kickout' : 'Straight'}
        </button>
      ))}
    </div>
  )
}
