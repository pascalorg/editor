'use client'

import {
  type AnyNode,
  type AnyNodeId,
  type BoxVentNode,
  type ChimneyNode,
  type DormerNode,
  type GutterNode,
  getLevelDisplayName,
  isRoofOnStoreyWalls,
  type LevelNode,
  planRoofsOffStorey,
  type RidgeVentNode,
  type RoofNode,
  type RoofSegmentNode,
  roofLevelAbove,
  type SkylightNode,
  type SolarPanelNode,
  type TurbineVentNode,
  useScene,
} from '@pascal-app/core'
import {
  ActionButton,
  ActionGroup,
  duplicateNodeAndPickUp,
  formatLinearMeasurement,
  PanelSection,
  PanelWrapper,
  parametricNodeUpdates,
  SegmentedControl,
  SliderControl,
  triggerSFX,
  useEditor,
} from '@pascal-app/editor'
import { useViewer } from '@pascal-app/viewer'
import { Copy, Move, Plus, Trash2 } from 'lucide-react'
import { useCallback, useState } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { RoofGlazingPanel } from '../roof/glazing-panel'
import { commitSeatedRoofEdit } from './roof-level-target'

export default function RoofPanel() {
  const [ventType, setVentType] = useState<'box-vent' | 'ridge-vent' | 'turbine-vent'>('box-vent')
  const selectedId = useViewer((s) => s.selection.selectedIds[0])
  const unit = useViewer((s) => s.unit)
  const metricNotation = useViewer((s) => s.metricNotation)
  const setSelection = useViewer((s) => s.setSelection)
  const setMovingNode = useEditor((s) => s.setMovingNode)

  const node = useScene((s) =>
    selectedId ? (s.nodes[selectedId as AnyNode['id']] as RoofNode | undefined) : undefined,
  )
  // Shallow selector — only re-renders when the segment list content changes.
  const segments = useScene(
    useShallow((s) => {
      if (!node) return []
      return (node.children ?? [])
        .map((childId) => s.nodes[childId as AnyNodeId] as RoofSegmentNode | undefined)
        .filter((n): n is RoofSegmentNode => n?.type === 'roof-segment')
    }),
  )

  // Flatten roof accessories hosted by any segment of this roof. Each
  // selector re-runs only when the relevant child list changes.
  const segmentIdSet = useScene(
    useShallow((s) => {
      if (!node) return new Set<string>()
      return new Set((node.children ?? []) as string[])
    }),
  )

  const chimneys = useScene(
    useShallow((s) => {
      if (segmentIdSet.size === 0) return []
      const out: ChimneyNode[] = []
      for (const n of Object.values(s.nodes)) {
        if (n?.type === 'chimney' && n.roofSegmentId && segmentIdSet.has(n.roofSegmentId)) {
          out.push(n as ChimneyNode)
        }
      }
      return out
    }),
  )

  const skylights = useScene(
    useShallow((s) => {
      if (segmentIdSet.size === 0) return []
      const out: SkylightNode[] = []
      for (const n of Object.values(s.nodes)) {
        if (n?.type === 'skylight' && n.roofSegmentId && segmentIdSet.has(n.roofSegmentId)) {
          out.push(n as SkylightNode)
        }
      }
      return out
    }),
  )

  const solarPanels = useScene(
    useShallow((s) => {
      if (segmentIdSet.size === 0) return []
      const out: SolarPanelNode[] = []
      for (const n of Object.values(s.nodes)) {
        if (n?.type === 'solar-panel' && n.roofSegmentId && segmentIdSet.has(n.roofSegmentId)) {
          out.push(n as SolarPanelNode)
        }
      }
      return out
    }),
  )

  const dormers = useScene(
    useShallow((s) => {
      if (segmentIdSet.size === 0) return []
      const out: DormerNode[] = []
      for (const n of Object.values(s.nodes)) {
        if (n?.type === 'dormer' && n.roofSegmentId && segmentIdSet.has(n.roofSegmentId)) {
          out.push(n as DormerNode)
        }
      }
      return out
    }),
  )

  const gutters = useScene(
    useShallow((s) => {
      if (segmentIdSet.size === 0) return []
      const out: GutterNode[] = []
      for (const n of Object.values(s.nodes)) {
        if (n?.type === 'gutter' && n.roofSegmentId && segmentIdSet.has(n.roofSegmentId)) {
          out.push(n as GutterNode)
        }
      }
      return out
    }),
  )

  // Box vents and ridge vents share the "Vents" UI group — same list,
  // type shown as the right-side label, and an `Add Vent` button with
  // a Box/Ridge segmented picker.
  const vents = useScene(
    useShallow((s) => {
      if (segmentIdSet.size === 0) return []
      const out: (BoxVentNode | RidgeVentNode | TurbineVentNode)[] = []
      for (const n of Object.values(s.nodes)) {
        if (
          (n?.type === 'box-vent' || n?.type === 'ridge-vent' || n?.type === 'turbine-vent') &&
          n.roofSegmentId &&
          segmentIdSet.has(n.roofSegmentId)
        ) {
          out.push(n as BoxVentNode | RidgeVentNode | TurbineVentNode)
        }
      }
      return out
    }),
  )

  // A roof on the walls of the storey holding it (the agents' and the editor's roofs before the
  // roof level) hides that storey's plan in solo and exploded views: offer to move it where it goes.
  const levelMove = useScene(
    useShallow((s) => {
      if (!node || !isRoofOnStoreyWalls(s.nodes, node.id)) return null
      const level = s.nodes[node.parentId as AnyNodeId] as LevelNode
      const above = roofLevelAbove(s.nodes, level.id)
      return {
        storey: getLevelDisplayName(level),
        label:
          above.kind === 'roof'
            ? 'Move to the roof level'
            : `Move to ${getLevelDisplayName(above.level)}`,
        roofs: level.children.filter((id) => isRoofOnStoreyWalls(s.nodes, id)).length,
      }
    }),
  )

  const handleMoveOffStorey = useCallback(() => {
    if (!node?.parentId) return
    const move = planRoofsOffStorey(useScene.getState().nodes, node.parentId)
    if (!move) return
    triggerSFX('sfx:item-place')
    useScene.getState().applyNodeChanges({
      create: move.changes.create.map((op) => ({
        node: op.node,
        parentId: op.parentId as AnyNodeId | undefined,
      })),
      update: move.changes.update.map(({ id, data }) => ({ id: id as AnyNodeId, data })),
    })
    // The storey in view hides the levels above it: the selection follows the roof up.
    setSelection({ levelId: move.plan.levelId as LevelNode['id'], selectedIds: [node.id] })
  }, [node, setSelection])

  const handleSelectElement = useCallback(
    (id: string) => {
      setSelection({ selectedIds: [id as AnyNode['id']] })
    },
    [setSelection],
  )

  const handleUpdate = useCallback(
    (updates: Partial<RoofNode>) => {
      if (!selectedId) return
      // Moved or turned onto the walls that carry it, it goes to the level above them.
      commitSeatedRoofEdit(
        parametricNodeUpdates(selectedId as AnyNode['id'], updates),
        selectedId as AnyNode['id'],
      )
    },
    [selectedId],
  )

  const handleClose = useCallback(() => {
    setSelection({ selectedIds: [] })
  }, [setSelection])

  const handleAddSegment = useCallback(() => {
    if (!node) return
    triggerSFX('sfx:item-pick')
    const editor = useEditor.getState()
    editor.setTool('roof')
    if (editor.mode !== 'build') editor.setMode('build')
  }, [node])

  const handleSelectSegment = useCallback(
    (segmentId: string) => {
      setSelection({ selectedIds: [segmentId as AnyNode['id']] })
    },
    [setSelection],
  )

  const handleDuplicate = useCallback(() => {
    if (node) duplicateNodeAndPickUp(node)
  }, [node])

  const handleMove = useCallback(() => {
    if (node) {
      triggerSFX('sfx:item-pick')
      setMovingNode(node)
      setSelection({ selectedIds: [] })
    }
  }, [node, setMovingNode, setSelection])

  const handleDelete = useCallback(() => {
    if (!(selectedId && node)) return
    triggerSFX('sfx:item-delete')
    const parentId = node.parentId
    useScene.getState().deleteNode(selectedId as AnyNodeId)
    if (parentId) {
      useScene.getState().dirtyNodes.add(parentId as AnyNodeId)
    }
    setSelection({ selectedIds: [] })
  }, [selectedId, node, setSelection])

  // Each "Add" button activates the kind's registered placement tool
  // via `setTool(kind)`. The tool listens for `roof:*` events and
  // commits a new node parented to whichever segment the user clicks.
  // Same code path as the top palette — see `tool-manager.tsx:28`'s
  // `nodeRegistry.get(tool)?.tool` dispatch.
  const activateTool = useCallback(
    (
      kind:
        | 'box-vent'
        | 'ridge-vent'
        | 'turbine-vent'
        | 'cupola'
        | 'eyebrow-vent'
        | 'chimney'
        | 'solar-panel'
        | 'skylight'
        | 'dormer'
        | 'gutter'
        | 'downspout',
    ) => {
      triggerSFX('sfx:item-pick')
      useEditor.getState().setTool(kind)
      if (useEditor.getState().mode !== 'build') {
        useEditor.getState().setMode('build')
      }
    },
    [],
  )

  if (!(node && node.type === 'roof' && selectedId)) return null

  return (
    <PanelWrapper
      icon="/icons/roof.webp"
      onClose={handleClose}
      title={node.name || 'Roof'}
      width={300}
    >
      <RoofGlazingPanel segments={segments} />
      {levelMove && (
        <PanelSection title="Level">
          <div className="flex flex-col gap-2 px-1 pb-1">
            <p className="text-muted-foreground text-xs">
              On {levelMove.storey} with its walls, so it hides that floor's plan in solo and
              exploded views.
              {levelMove.roofs > 1 && ` The floor's ${levelMove.roofs} roofs move together.`}
            </p>
            <button
              className="w-full rounded-full bg-foreground/[0.08] px-3 py-2 font-medium text-foreground text-xs transition-colors hover:bg-foreground/[0.14]"
              onClick={handleMoveOffStorey}
              type="button"
            >
              {levelMove.label}
            </button>
          </div>
        </PanelSection>
      )}

      <PanelSection title="Segments">
        <div className="flex flex-col gap-1">
          {segments.map((seg, i) => (
            <button
              className="flex items-center justify-between rounded-lg border border-border/50 bg-black/4 dark:bg-[#2C2C2E] px-3 py-2 text-foreground text-sm transition-colors hover:bg-black/8 dark:hover:bg-[#3e3e3e]"
              key={seg.id}
              onClick={() => handleSelectSegment(seg.id)}
              type="button"
            >
              <span className="truncate">{seg.name || `Segment ${i + 1}`}</span>
              <span className="text-muted-foreground text-xs capitalize">{seg.roofType}</span>
            </button>
          ))}
        </div>
        <ActionGroup>
          <ActionButton
            icon={<Plus className="h-3.5 w-3.5" />}
            label="Draw Segment"
            onClick={handleAddSegment}
          />
        </ActionGroup>
      </PanelSection>

      <PanelSection title="Position">
        <SliderControl
          label="X"
          onChange={(v) => {
            const pos = [...node.position] as [number, number, number]
            pos[0] = v
            handleUpdate({ position: pos })
          }}
          precision={2}
          step={0.05}
          unit="m"
          value={node.position[0]}
        />
        {node.support?.kind !== 'roof' && (
          <SegmentedControl
            onChange={(mode) =>
              handleUpdate({ support: { kind: mode === 'walls' ? 'walls' : 'level' } })
            }
            options={[
              { label: 'Follows walls', value: 'walls' },
              { label: 'Custom', value: 'custom' },
            ]}
            value={node.support?.kind === 'walls' ? 'walls' : 'custom'}
          />
        )}
        {node.support?.kind === 'walls' ? (
          <div className="px-1 text-[11px] text-muted-foreground">
            Currently {formatLinearMeasurement(node.position[1], unit, metricNotation)}
          </div>
        ) : (
          <SliderControl
            label="Y"
            onChange={(v) => {
              const pos = [...node.position] as [number, number, number]
              pos[1] = v
              const current = useScene.getState().nodes[node.id]
              handleUpdate({
                position: pos,
                ...(current?.type === 'roof' &&
                current.support?.kind === 'walls' &&
                Math.abs(v - current.position[1]) > 1e-4
                  ? { support: { kind: 'level' as const } }
                  : {}),
              })
            }}
            precision={2}
            step={0.05}
            unit="m"
            value={node.position[1]}
          />
        )}
        <SliderControl
          label="Z"
          onChange={(v) => {
            const pos = [...node.position] as [number, number, number]
            pos[2] = v
            handleUpdate({ position: pos })
          }}
          precision={2}
          step={0.05}
          unit="m"
          value={node.position[2]}
        />
        <SliderControl
          label="Rotation"
          max={180}
          min={-180}
          onChange={(degrees) => {
            handleUpdate({ rotation: (degrees * Math.PI) / 180 })
          }}
          precision={0}
          step={1}
          unit="°"
          value={Math.round((node.rotation * 180) / Math.PI)}
        />
        <div className="flex gap-1.5 px-1 pt-2 pb-1">
          <ActionButton
            label="-45°"
            onClick={() => {
              triggerSFX('sfx:item-rotate')
              handleUpdate({ rotation: node.rotation - Math.PI / 4 })
            }}
          />
          <ActionButton
            label="+45°"
            onClick={() => {
              triggerSFX('sfx:item-rotate')
              handleUpdate({ rotation: node.rotation + Math.PI / 4 })
            }}
          />
        </div>
      </PanelSection>

      <PanelSection title="Elements">
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1">
            {chimneys.map((chimney, i) => (
              <button
                className="flex items-center justify-between rounded-lg border border-border/50 bg-black/4 dark:bg-[#2C2C2E] px-3 py-2 text-foreground text-sm transition-colors hover:bg-black/8 dark:hover:bg-[#3e3e3e]"
                key={chimney.id}
                onClick={() => handleSelectElement(chimney.id)}
                type="button"
              >
                <span className="truncate">{chimney.name || `Chimney ${i + 1}`}</span>
                <span className="text-muted-foreground text-xs">chimney</span>
              </button>
            ))}
            <ActionGroup>
              <ActionButton
                icon={<Plus className="h-3.5 w-3.5" />}
                label="Add Chimney"
                onClick={() => activateTool('chimney')}
              />
            </ActionGroup>
          </div>

          <div className="flex flex-col gap-1">
            {dormers.map((dormer, i) => (
              <button
                className="flex items-center justify-between rounded-lg border border-border/50 bg-black/4 dark:bg-[#2C2C2E] px-3 py-2 text-foreground text-sm transition-colors hover:bg-black/8 dark:hover:bg-[#3e3e3e]"
                key={dormer.id}
                onClick={() => handleSelectElement(dormer.id)}
                type="button"
              >
                <span className="truncate">{dormer.name || `Dormer ${i + 1}`}</span>
                <span className="text-muted-foreground text-xs">dormer</span>
              </button>
            ))}
            <ActionGroup>
              <ActionButton
                icon={<Plus className="h-3.5 w-3.5" />}
                label="Add Dormer"
                onClick={() => activateTool('dormer')}
              />
            </ActionGroup>
          </div>

          <div className="flex flex-col gap-1">
            {skylights.map((skylight, i) => (
              <button
                className="flex items-center justify-between rounded-lg border border-border/50 bg-black/4 dark:bg-[#2C2C2E] px-3 py-2 text-foreground text-sm transition-colors hover:bg-black/8 dark:hover:bg-[#3e3e3e]"
                key={skylight.id}
                onClick={() => handleSelectElement(skylight.id)}
                type="button"
              >
                <span className="truncate">{skylight.name || `Skylight ${i + 1}`}</span>
                <span className="text-muted-foreground text-xs">skylight</span>
              </button>
            ))}
            <ActionGroup>
              <ActionButton
                icon={<Plus className="h-3.5 w-3.5" />}
                label="Add Skylight"
                onClick={() => activateTool('skylight')}
              />
            </ActionGroup>
          </div>

          <div className="flex flex-col gap-1">
            {solarPanels.map((panel, i) => (
              <button
                className="flex items-center justify-between rounded-lg border border-border/50 bg-black/4 dark:bg-[#2C2C2E] px-3 py-2 text-foreground text-sm transition-colors hover:bg-black/8 dark:hover:bg-[#3e3e3e]"
                key={panel.id}
                onClick={() => handleSelectElement(panel.id)}
                type="button"
              >
                <span className="truncate">{panel.name || `Solar Panel ${i + 1}`}</span>
                <span className="text-muted-foreground text-xs">solar panel</span>
              </button>
            ))}
            <ActionGroup>
              <ActionButton
                icon={<Plus className="h-3.5 w-3.5" />}
                label="Add Solar Panel"
                onClick={() => activateTool('solar-panel')}
              />
            </ActionGroup>
          </div>

          <div className="flex flex-col gap-1">
            {vents.map((vent, i) => (
              <button
                className="flex items-center justify-between rounded-lg border border-border/50 bg-black/4 dark:bg-[#2C2C2E] px-3 py-2 text-foreground text-sm transition-colors hover:bg-black/8 dark:hover:bg-[#3e3e3e]"
                key={vent.id}
                onClick={() => handleSelectElement(vent.id)}
                type="button"
              >
                <span className="truncate">
                  {vent.name ||
                    (vent.type === 'box-vent'
                      ? `Box Vent ${i + 1}`
                      : vent.type === 'ridge-vent'
                        ? `Ridge Vent ${i + 1}`
                        : `Turbine Vent ${i + 1}`)}
                </span>
                <span className="text-muted-foreground text-xs">
                  {vent.type === 'box-vent'
                    ? 'box vent'
                    : vent.type === 'ridge-vent'
                      ? 'ridge vent'
                      : 'turbine vent'}
                </span>
              </button>
            ))}
            <SegmentedControl<'box-vent' | 'ridge-vent' | 'turbine-vent'>
              onChange={setVentType}
              options={[
                { label: 'Box', value: 'box-vent' },
                { label: 'Ridge', value: 'ridge-vent' },
                { label: 'Turbine', value: 'turbine-vent' },
              ]}
              value={ventType}
            />
            <ActionGroup>
              <ActionButton
                icon={<Plus className="h-3.5 w-3.5" />}
                label="Add Vent"
                onClick={() => activateTool(ventType)}
              />
            </ActionGroup>
          </div>

          <div className="flex flex-col gap-1">
            <ActionGroup>
              <ActionButton
                icon={<Plus className="h-3.5 w-3.5" />}
                label="Add Cupola"
                onClick={() => activateTool('cupola')}
              />
            </ActionGroup>
          </div>

          <div className="flex flex-col gap-1">
            <ActionGroup>
              <ActionButton
                icon={<Plus className="h-3.5 w-3.5" />}
                label="Add Eyebrow Vent"
                onClick={() => activateTool('eyebrow-vent')}
              />
            </ActionGroup>
          </div>

          <div className="flex flex-col gap-1">
            {gutters.map((gutter, i) => (
              <button
                className="flex items-center justify-between rounded-lg border border-border/50 bg-black/4 dark:bg-[#2C2C2E] px-3 py-2 text-foreground text-sm transition-colors hover:bg-black/8 dark:hover:bg-[#3e3e3e]"
                key={gutter.id}
                onClick={() => handleSelectElement(gutter.id)}
                type="button"
              >
                <span className="truncate">{gutter.name || `Gutter ${i + 1}`}</span>
                <span className="text-muted-foreground text-xs">gutter</span>
              </button>
            ))}
            <ActionGroup>
              <ActionButton
                icon={<Plus className="h-3.5 w-3.5" />}
                label="Add Gutter"
                onClick={() => activateTool('gutter')}
              />
            </ActionGroup>
          </div>
        </div>
      </PanelSection>

      <PanelSection title="Actions">
        <ActionGroup>
          <ActionButton icon={<Move className="h-3.5 w-3.5" />} label="Move" onClick={handleMove} />
          <ActionButton
            icon={<Copy className="h-3.5 w-3.5" />}
            label="Duplicate"
            onClick={handleDuplicate}
          />
          <ActionButton
            className="hover:bg-red-500/20"
            icon={<Trash2 className="h-3.5 w-3.5 text-red-600 dark:text-red-400" />}
            label="Delete"
            onClick={handleDelete}
          />
        </ActionGroup>
      </PanelSection>
    </PanelWrapper>
  )
}
