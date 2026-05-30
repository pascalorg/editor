'use client'

import {
  type AnyNodeId,
  DownspoutNode,
  type DownspoutNode as DownspoutNodeType,
  type GutterNode,
  type RoofSegmentNode,
  useScene,
} from '@pascal-app/core'
import {
  ActionButton,
  ActionGroup,
  PanelSection,
  triggerSFX,
} from '@pascal-app/editor'
import { useViewer } from '@pascal-app/viewer'
import { useShallow } from 'zustand/react/shallow'
import { computeEaveY } from './eave-snap'
import { resolveGutterOutletPlacement } from './outlet-lookup'

/**
 * Downspouts subsection rendered at the bottom of the gutter
 * inspector. Same shape as the roof inspector's gutter / vent lists:
 * one button per existing downspout that selects it (showing its own
 * inspector), and an "Add Downspout" button below that immediately
 * creates a new one parented to the same roof segment.
 *
 * Each Add click adds ANOTHER downspout to the list — multiple
 * downspouts per gutter is allowed (real residential gutters
 * sometimes split a long run between two downspouts). The Add button
 * stays disabled when the gutter has no outlet, since the downspout
 * has nowhere to attach.
 */
export default function DownspoutsPanel() {
  const selectedId = useViewer((s) => s.selection.selectedIds[0]) as AnyNodeId | undefined
  const setSelection = useViewer((s) => s.setSelection)

  const gutter = useScene((s) =>
    selectedId ? (s.nodes[selectedId] as GutterNode | undefined) : undefined,
  )

  const downspouts = useScene(
    useShallow((s) => {
      if (!selectedId) return [] as DownspoutNodeType[]
      const out: DownspoutNodeType[] = []
      for (const n of Object.values(s.nodes)) {
        if (n?.type === 'downspout' && n.gutterId === selectedId) {
          out.push(n as DownspoutNodeType)
        }
      }
      return out
    }),
  )

  if (!gutter || gutter.type !== 'gutter') return null

  const outletEnabled = (gutter.outletSide ?? 'none') !== 'none'

  const handleSelectDownspout = (id: AnyNodeId) => {
    setSelection({ selectedIds: [id] })
  }

  const handleAddDownspout = () => {
    if (!outletEnabled) return
    const segmentId = gutter.roofSegmentId as AnyNodeId | undefined
    if (!segmentId) return
    const segment = useScene.getState().nodes[segmentId] as RoofSegmentNode | undefined
    if (!segment) return
    const outlet = resolveGutterOutletPlacement(gutter)
    if (!outlet) return

    // Default length: drop from outlet (at eaveY − size in segment
    // frame) down to segment Y = 0. Matches the placement tool's
    // default so click-to-add and click-on-gutter land the same drop.
    const dropLength = Math.max(0.1, computeEaveY(segment) + outlet.y)

    const downspout = DownspoutNode.parse({
      ...{
        name: 'Downspout',
        gutterId: gutter.id,
        length: dropLength,
        diameter: outlet.bore * 2,
      },
    })
    const state = useScene.getState()
    state.createNode(downspout, segmentId)
    state.dirtyNodes.add(segmentId)
    setSelection({ selectedIds: [downspout.id] })
    triggerSFX('sfx:item-place')
  }

  return (
    <PanelSection title="Downspouts">
      <div className="flex flex-col gap-1">
        {downspouts.map((d, i) => (
          <button
            className="flex items-center justify-between rounded-lg border border-border/50 bg-[#2C2C2E] px-3 py-2 text-foreground text-sm transition-colors hover:bg-[#3e3e3e]"
            key={d.id}
            onClick={() => handleSelectDownspout(d.id as AnyNodeId)}
            type="button"
          >
            <span className="truncate">{d.name || `Downspout ${i + 1}`}</span>
            <span className="text-muted-foreground text-xs">downspout</span>
          </button>
        ))}
        <ActionGroup>
          <ActionButton
            className={outletEnabled ? '' : 'opacity-40 pointer-events-none'}
            label="Add Downspout"
            onClick={handleAddDownspout}
          />
        </ActionGroup>
        {!outletEnabled && (
          <p className="text-muted-foreground text-xs px-1">
            Turn the Outlet on to add a downspout.
          </p>
        )}
      </div>
    </PanelSection>
  )
}

