'use client'

import {
  type AnyNodeId,
  type CustomMeshNode,
  getCatalogMaterialById,
  parseMaterialRef,
  toSceneMaterialRef,
  useScene,
} from '@pascal-app/core'
import {
  ActionButton,
  ActionGroup,
  createEditorApi,
  MaterialPicker,
  PanelSection,
  PanelWrapper,
  SliderControl,
  triggerSFX,
  useInteractionScope,
} from '@pascal-app/editor'
import { useViewer } from '@pascal-app/viewer'
import { Move, Trash2 } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import useCustomMeshEditSession from './edit-session'
import {
  assignCustomMeshMaterial,
  customMeshMaterialSelection,
  removeUnusedCustomMeshMaterialSlots,
  selectCustomMeshFacesByMaterialSlot,
  unusedCustomMeshMaterialSlotIds,
} from './material-slots'
import { customMeshSlots } from './slots'

function materialRefLabel(
  ref: string | undefined,
  sceneMaterials: ReturnType<typeof useScene.getState>['materials'],
): string {
  const parsed = parseMaterialRef(ref)
  if (!parsed) return 'Default material'
  if (parsed.kind === 'scene')
    return sceneMaterials[parsed.id as keyof typeof sceneMaterials]?.name ?? ref ?? parsed.id
  return getCatalogMaterialById(parsed.id)?.label ?? ref ?? parsed.id
}

export default function CustomMeshPanel() {
  const selectedId = useViewer((state) => state.selection.selectedIds[0])
  const setViewerSelection = useViewer((state) => state.setSelection)
  const node = useScene((state) => {
    if (!selectedId) return null
    const selected = state.nodes[selectedId as AnyNodeId]
    return selected?.type === 'custom-mesh' ? (selected as CustomMeshNode) : null
  })
  const nodeRef = useRef(node)
  nodeRef.current = node
  const sceneMaterials = useScene((state) => state.materials)
  const editing = useInteractionScope(
    (state) => state.scope.kind === 'mesh-editing' && state.scope.nodeId === selectedId,
  )
  const sessionNodeId = useCustomMeshEditSession((state) => state.nodeId)
  const selection = useCustomMeshEditSession((state) => state.selection)
  const activeMaterialSlotId = useCustomMeshEditSession((state) => state.activeMaterialSlotId)
  const [pendingMaterialRef, setPendingMaterialRef] = useState<string | null>(null)

  const activeFaceSlotId = useMemo(() => {
    if (!(node && sessionNodeId === node.id && selection.mode === 'face')) return null
    return node.topology.faces.find((face) => face.id === selection.activeId)?.materialSlot ?? null
  }, [node, selection.activeId, selection.mode, sessionNodeId])
  const nodeId = node?.id ?? null
  const activeFaceId =
    sessionNodeId === nodeId && selection.mode === 'face' ? selection.activeId : null
  const syncedActiveFaceRef = useRef<string | null>(null)

  useEffect(() => {
    if (!(nodeId && activeFaceId && activeFaceSlotId)) return
    const syncKey = `${nodeId}:${activeFaceId}:${activeFaceSlotId}`
    if (syncedActiveFaceRef.current === syncKey) return
    syncedActiveFaceRef.current = syncKey
    useCustomMeshEditSession.getState().setActiveMaterialSlot(nodeId, activeFaceSlotId)
    setPendingMaterialRef(null)
  }, [activeFaceId, activeFaceSlotId, nodeId])

  const close = useCallback(() => {
    setViewerSelection({ selectedIds: [] })
  }, [setViewerSelection])

  const move = useCallback(() => {
    const current = nodeRef.current
    if (!current) return
    triggerSFX('sfx:item-pick')
    createEditorApi().engageMove(current)
    setViewerSelection({ selectedIds: [] })
  }, [setViewerSelection])

  const updatePositionX = useCallback((value: number) => {
    const current = nodeRef.current
    if (!current) return
    useScene.getState().updateNode(current.id, {
      position: [value, current.position[1], current.position[2]],
    })
  }, [])

  const updatePositionY = useCallback((value: number) => {
    const current = nodeRef.current
    if (!current) return
    useScene.getState().updateNode(current.id, {
      position: [current.position[0], value, current.position[2]],
    })
  }, [])

  const updatePositionZ = useCallback((value: number) => {
    const current = nodeRef.current
    if (!current) return
    useScene.getState().updateNode(current.id, {
      position: [current.position[0], current.position[1], value],
    })
  }, [])

  if (!node) return null

  const selectedFaceIds =
    editing && sessionNodeId === node.id && selection.mode === 'face' ? selection.ids : []
  const materialSelection = customMeshMaterialSelection(
    node.topology,
    selectedFaceIds,
    selection.activeId,
  )
  const slotDeclarations = customMeshSlots(node)
  const activeSlotId =
    sessionNodeId === node.id ? activeMaterialSlotId : materialSelection.activeSlotId
  const activeSlotRef = activeSlotId ? node.slots?.[activeSlotId] : undefined
  const chosenMaterialRef = pendingMaterialRef ?? activeSlotRef
  const canOperateOnFaces = editing && selection.mode === 'face'
  const unusedSlotIds = unusedCustomMeshMaterialSlotIds(node.topology, node.slots)

  const chooseSlot = (slotId: string) => {
    useCustomMeshEditSession.getState().setActiveMaterialSlot(node.id, slotId)
    setPendingMaterialRef(null)
  }

  const assignMaterial = () => {
    const assignment = pendingMaterialRef
      ? { kind: 'material' as const, materialRef: pendingMaterialRef }
      : activeSlotId
        ? { kind: 'slot' as const, slotId: activeSlotId }
        : null
    if (!assignment) return
    const result = assignCustomMeshMaterial(node.topology, node.slots, selectedFaceIds, assignment)
    if (!result.changed) return
    useScene.getState().updateNode(node.id, {
      topology: result.topology,
      slots: result.slots,
    })
    useCustomMeshEditSession.getState().setActiveMaterialSlot(node.id, result.slotId)
    setPendingMaterialRef(null)
    triggerSFX('sfx:menu-click')
  }

  const filterSelection = (operation: 'select' | 'deselect') => {
    if (!(canOperateOnFaces && activeSlotId)) return
    const ids = selectCustomMeshFacesByMaterialSlot(
      node.topology,
      selection.ids,
      activeSlotId,
      operation,
    )
    const activeId = ids.includes(selection.activeId ?? '')
      ? selection.activeId
      : (ids.at(-1) ?? null)
    useCustomMeshEditSession.getState().setSelection(node.id, {
      mode: 'face',
      ids,
      activeId,
    })
  }

  const removeUnusedSlots = () => {
    if (editing) return
    const result = removeUnusedCustomMeshMaterialSlots(node.topology, node.slots)
    if (!result.changed) return
    useScene.getState().updateNode(node.id, { slots: result.slots })
    triggerSFX('sfx:menu-click')
  }

  const selectionLabel = !editing
    ? 'Enter Edit Mode to assign faces'
    : selection.mode !== 'face'
      ? 'Switch to Face Select (3)'
      : materialSelection.kind === 'empty'
        ? 'No faces selected'
        : materialSelection.kind === 'mixed'
          ? `${selectedFaceIds.length} faces · Mixed materials`
          : `${selectedFaceIds.length} ${selectedFaceIds.length === 1 ? 'face' : 'faces'} · ${materialRefLabel(node.slots?.[materialSelection.slotId], sceneMaterials)}`

  return (
    <PanelWrapper
      icon="/icons/cube.webp"
      onClose={close}
      title={node.name || 'Custom Mesh'}
      width={340}
    >
      <PanelSection title="Position">
        {(
          [
            { axis: 0, label: 'X', onChange: updatePositionX },
            { axis: 1, label: 'Y', onChange: updatePositionY },
            { axis: 2, label: 'Z', onChange: updatePositionZ },
          ] as const
        ).map(({ axis, label, onChange }) => (
          <SliderControl
            key={label}
            label={label}
            max={node.position[axis] + 2}
            min={node.position[axis] - 2}
            onChange={onChange}
            precision={2}
            step={0.01}
            unit="m"
            value={node.position[axis]}
          />
        ))}
      </PanelSection>

      <PanelSection title="Face Materials">
        <div className="rounded-md border border-border/50 bg-background/40 px-2.5 py-2 text-muted-foreground text-xs">
          {selectionLabel}
        </div>

        <div className="mt-1 grid grid-cols-1 gap-1.5">
          {slotDeclarations.map((slot) => {
            const ref = node.slots?.[slot.slotId]
            const active = !pendingMaterialRef && activeSlotId === slot.slotId
            return (
              <button
                className={`flex items-center gap-2 rounded-lg border px-2.5 py-2 text-left text-xs transition-colors ${
                  active
                    ? 'border-primary bg-primary/10 text-foreground'
                    : 'border-border/50 bg-[#2C2C2E] text-muted-foreground hover:bg-[#3e3e3e] hover:text-foreground'
                }`}
                aria-label={`${slot.label}: ${materialRefLabel(ref, sceneMaterials)}`}
                aria-pressed={active}
                disabled={!canOperateOnFaces}
                key={slot.slotId}
                onClick={() => chooseSlot(slot.slotId)}
                type="button"
              >
                <span className="h-5 w-5 shrink-0 rounded border border-border/60 bg-muted" />
                <span className="min-w-0 flex-1 truncate">{slot.label}</span>
                <span className="max-w-36 truncate text-[10px] opacity-70">
                  {materialRefLabel(ref, sceneMaterials)}
                </span>
              </button>
            )
          })}
        </div>

        {Object.keys(sceneMaterials).length > 0 ? (
          <div className="mt-2">
            <div className="mb-1.5 font-medium text-[10px] text-muted-foreground uppercase tracking-wider">
              Scene materials
            </div>
            <div className="grid grid-cols-2 gap-1.5">
              {Object.entries(sceneMaterials).map(([id, sceneMaterial]) => {
                const ref = toSceneMaterialRef(id)
                return (
                  <button
                    className={`flex min-w-0 items-center gap-2 rounded-lg border px-2 py-1.5 text-left text-xs transition-colors ${
                      pendingMaterialRef === ref
                        ? 'border-primary bg-primary/10 text-foreground'
                        : 'border-border/50 bg-[#2C2C2E] text-muted-foreground hover:bg-[#3e3e3e] hover:text-foreground'
                    }`}
                    aria-label={`Use scene material ${sceneMaterial.name}`}
                    aria-pressed={pendingMaterialRef === ref}
                    disabled={!canOperateOnFaces}
                    key={id}
                    onClick={() => setPendingMaterialRef(ref)}
                    type="button"
                  >
                    <span
                      className="h-5 w-5 shrink-0 rounded border border-border/60"
                      style={{
                        backgroundColor: sceneMaterial.material.properties?.color ?? '#fff',
                      }}
                    />
                    <span className="truncate">{sceneMaterial.name}</span>
                  </button>
                )
              })}
            </div>
          </div>
        ) : null}

        <div className="mt-2 grid grid-cols-3 gap-1.5">
          <ActionButton
            disabled={!canOperateOnFaces || !activeSlotId}
            label="Select"
            onClick={() => filterSelection('select')}
          />
          <ActionButton
            disabled={!canOperateOnFaces || !activeSlotId}
            label="Deselect"
            onClick={() => filterSelection('deselect')}
          />
          <ActionButton
            className="border-primary/50 bg-primary/15"
            disabled={
              !canOperateOnFaces ||
              selectedFaceIds.length === 0 ||
              (!chosenMaterialRef && !activeSlotId)
            }
            label="Assign"
            onClick={assignMaterial}
          />
        </div>

        <div className="mt-1.5">
          <ActionButton
            disabled={editing || unusedSlotIds.length === 0}
            label={
              unusedSlotIds.length === 0
                ? 'No unused slots'
                : `Remove unused slots (${unusedSlotIds.length})`
            }
            onClick={removeUnusedSlots}
          />
        </div>
      </PanelSection>

      <PanelSection defaultExpanded={false} title="Material Library">
        <div className="h-72 min-h-0">
          <MaterialPicker
            disabled={!canOperateOnFaces}
            onSelectMaterialPreset={setPendingMaterialRef}
            selectedMaterialPreset={pendingMaterialRef ?? activeSlotRef}
          />
        </div>
      </PanelSection>

      <PanelSection title="Actions">
        <ActionGroup>
          <ActionButton icon={<Move className="h-4 w-4" />} label="Move" onClick={move} />
          <ActionButton
            className="border-red-500/40 text-red-200 hover:bg-red-500/15"
            icon={<Trash2 className="h-4 w-4" />}
            label="Delete"
            onClick={() => {
              useScene.getState().deleteNode(node.id)
              setViewerSelection({ selectedIds: [] })
            }}
          />
        </ActionGroup>
      </PanelSection>
    </PanelWrapper>
  )
}
