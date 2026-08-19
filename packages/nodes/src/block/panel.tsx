'use client'

import {
  type AnyNodeId,
  type BlockNode,
  getCatalogMaterialById,
  parseMaterialRef,
  useScene,
} from '@pascal-app/core'
import {
  ActionButton,
  ActionGroup,
  createEditorApi,
  PanelSection,
  PanelWrapper,
  SliderControl,
  triggerSFX,
  useInteractionScope,
} from '@pascal-app/editor'
import { useViewer } from '@pascal-app/viewer'
import { Check, Move, Plus, Trash2 } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef } from 'react'
import useBlockEditSession from './edit-session'
import {
  assignBlockMaterial,
  BLOCK_BODY_SLOT_ID,
  blockMaterialSelection,
  collectReusableBlockMaterialRefs,
  createBlockMaterialSlot,
  removeBlockMaterialSlot,
  renameBlockMaterialSlot,
  selectBlockFacesByMaterialSlot,
  setBlockMaterialSlot,
} from './material-slots'
import { blockSlots } from './slots'

const REUSABLE_MATERIAL_REF_SEPARATOR = '\u001f'
const SLOT_TRAILING_ACTION_CLASS =
  'm-2 ml-0 flex w-8 shrink-0 items-center justify-center rounded-md'
const SLOT_DISABLED_ACTION_CLASS =
  'disabled:cursor-not-allowed disabled:opacity-45 disabled:hover:bg-[#2C2C2E] disabled:active:bg-[#2C2C2E]'

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

function materialRefPreview(
  ref: string | undefined,
  sceneMaterials: ReturnType<typeof useScene.getState>['materials'],
): { color: string; imageUrl?: string } {
  const parsed = parseMaterialRef(ref)
  if (!parsed) return { color: '#71717a' }
  if (parsed.kind === 'scene') {
    const material = sceneMaterials[parsed.id as keyof typeof sceneMaterials]?.material
    return {
      color: material?.properties?.color ?? '#71717a',
      imageUrl: material?.texture?.url,
    }
  }
  const catalogMaterial = getCatalogMaterialById(parsed.id)
  return {
    color:
      catalogMaterial?.previewColor ?? catalogMaterial?.preset.mapProperties.color ?? '#71717a',
    imageUrl: catalogMaterial?.previewThumbnailUrl,
  }
}

export default function BlockPanel() {
  const selectedId = useViewer((state) => state.selection.selectedIds[0])
  const setViewerSelection = useViewer((state) => state.setSelection)
  const node = useScene((state) => {
    if (!selectedId) return null
    const selected = state.nodes[selectedId as AnyNodeId]
    return selected?.type === 'block' ? (selected as BlockNode) : null
  })
  const nodeRef = useRef(node)
  nodeRef.current = node
  const sceneMaterials = useScene((state) => state.materials)
  const reusableMaterialRefsKey = useScene((state) =>
    collectReusableBlockMaterialRefs(Object.values(state.nodes), Object.keys(state.materials)).join(
      REUSABLE_MATERIAL_REF_SEPARATOR,
    ),
  )
  const reusableMaterialRefs = reusableMaterialRefsKey
    ? reusableMaterialRefsKey.split(REUSABLE_MATERIAL_REF_SEPARATOR)
    : []
  const readOnly = useScene((state) => state.readOnly)
  const editing = useInteractionScope(
    (state) => state.scope.kind === 'mesh-editing' && state.scope.nodeId === selectedId,
  )
  const sessionNodeId = useBlockEditSession((state) => state.nodeId)
  const selection = useBlockEditSession((state) => state.selection)
  const activeMaterialSlotId = useBlockEditSession((state) => state.activeMaterialSlotId)

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
    useBlockEditSession.getState().setActiveMaterialSlot(nodeId, activeFaceSlotId)
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
  const materialSelection = blockMaterialSelection(
    node.topology,
    selectedFaceIds,
    selection.activeId,
  )
  const slotDeclarations = blockSlots(node)
  const activeSlotId =
    (sessionNodeId === node.id ? activeMaterialSlotId : materialSelection.activeSlotId) ??
    BLOCK_BODY_SLOT_ID
  const activeSlotRef = activeSlotId ? node.slots?.[activeSlotId] : undefined
  const canOperateOnFaces = editing && selection.mode === 'face'
  const slotEditTitle = !editing
    ? 'Enter Edit Mode to use slot actions'
    : readOnly
      ? 'Scene is read-only'
      : undefined
  const faceCountBySlot = new Map<string, number>()
  for (const face of node.topology.faces) {
    faceCountBySlot.set(face.materialSlot, (faceCountBySlot.get(face.materialSlot) ?? 0) + 1)
  }

  const chooseSlot = (slotId: string) => {
    useBlockEditSession.getState().setActiveMaterialSlot(node.id, slotId)
  }

  const chooseReusableMaterial = (materialRef: string) => {
    if (!(activeSlotId && materialRef)) return
    const result = setBlockMaterialSlot(node.slots, activeSlotId, materialRef)
    if (result.changed) {
      useScene.getState().updateNode(node.id, {
        slots: result.slots,
      })
      triggerSFX('sfx:menu-click')
    }
  }

  const addMaterialSlot = () => {
    const result = createBlockMaterialSlot(node.topology, node.slots, node.slotNames)
    useScene.getState().updateNode(node.id, { slotNames: result.slotNames })
    useBlockEditSession.getState().setActiveMaterialSlot(node.id, result.slotId)
    triggerSFX('sfx:menu-click')
  }

  const renameMaterialSlot = (slotId: string, name: string) => {
    const slotNames = renameBlockMaterialSlot(
      node.topology,
      node.slots,
      node.slotNames,
      slotId,
      name,
    )
    if (slotNames === node.slotNames) return
    useScene.getState().updateNode(node.id, { slotNames })
  }

  const reusableMaterialLabel = (ref: string) => {
    const parsed = parseMaterialRef(ref)
    if (!parsed) return ref
    return parsed.kind === 'scene'
      ? (sceneMaterials[parsed.id as keyof typeof sceneMaterials]?.name ?? ref)
      : (getCatalogMaterialById(parsed.id)?.label ?? ref)
  }

  const assignMaterial = () => {
    if (!activeSlotId) return
    const result = assignBlockMaterial(
      node.topology,
      node.slots,
      selectedFaceIds,
      {
        kind: 'slot',
        slotId: activeSlotId,
      },
      node.slotNames,
    )
    if (!result.changed) return
    useScene.getState().updateNode(node.id, {
      topology: result.topology,
      slots: result.slots,
    })
    useBlockEditSession.getState().setActiveMaterialSlot(node.id, result.slotId)
    triggerSFX('sfx:menu-click')
  }

  const filterSelection = (operation: 'select' | 'deselect') => {
    if (!(canOperateOnFaces && activeSlotId)) return
    const ids = selectBlockFacesByMaterialSlot(
      node.topology,
      selection.ids,
      activeSlotId,
      operation,
    )
    const activeId = ids.includes(selection.activeId ?? '')
      ? selection.activeId
      : (ids.at(-1) ?? null)
    useBlockEditSession.getState().setSelection(node.id, {
      mode: 'face',
      ids,
      activeId,
    })
  }

  const removeMaterialSlot = (slotId: string) => {
    const result = removeBlockMaterialSlot(node.topology, node.slots, slotId, node.slotNames)
    if (!result.changed) return
    useScene.getState().updateNode(node.id, {
      topology: result.topology,
      slots: result.slots,
      slotNames: result.slotNames,
    })
    useBlockEditSession.getState().setActiveMaterialSlot(node.id, result.fallbackSlotId)
    triggerSFX('sfx:menu-click')
  }

  const selectionLabel = !editing
    ? 'Enter Edit Mode to assign faces'
    : selection.mode !== 'face'
      ? 'Switch to Face Select (3)'
      : materialSelection.kind === 'empty'
        ? 'No faces selected'
        : materialSelection.kind === 'mixed'
          ? `${selectedFaceIds.length} faces · Mixed slots`
          : `${selectedFaceIds.length} ${selectedFaceIds.length === 1 ? 'face' : 'faces'} · ${slotDeclarations.find((slot) => slot.slotId === materialSelection.slotId)?.label ?? materialSelection.slotId}`

  return (
    <PanelWrapper icon="/icons/cube.webp" onClose={close} title={node.name || 'Block'} width={340}>
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

      <PanelSection title="Slots">
        <div className="rounded-md border border-border/50 bg-background/40 px-2.5 py-2 text-muted-foreground text-xs">
          {selectionLabel}
        </div>

        <div className="mt-2 flex justify-end">
          <ActionButton
            className={SLOT_DISABLED_ACTION_CLASS}
            disabled={!editing || readOnly}
            icon={<Plus className="h-3.5 w-3.5" />}
            label="Add slot"
            onClick={addMaterialSlot}
            title={slotEditTitle}
          />
        </div>

        <div className="mt-2 max-h-44 overflow-y-auto rounded-lg border border-border/60 bg-[#252527]">
          {slotDeclarations.map((slot, index) => {
            const ref = node.slots?.[slot.slotId]
            const active = activeSlotId === slot.slotId
            const preview = materialRefPreview(ref, sceneMaterials)
            const faceCount = faceCountBySlot.get(slot.slotId) ?? 0
            const materialLabel = materialRefLabel(ref, sceneMaterials)
            return (
              <div
                className={`group flex min-h-11 items-stretch border-border/50 ${
                  index > 0 ? 'border-t' : ''
                } ${active ? 'bg-primary/15' : 'hover:bg-white/[0.035]'}`}
                key={slot.slotId}
              >
                <button
                  className="flex w-12 shrink-0 items-center justify-center disabled:cursor-default"
                  aria-label={`${slot.label}: ${materialLabel}`}
                  aria-pressed={active}
                  disabled={!editing}
                  onClick={() => chooseSlot(slot.slotId)}
                  type="button"
                >
                  <span
                    className="h-7 w-7 shrink-0 rounded-md border border-white/10 bg-cover bg-center shadow-inner"
                    style={{
                      backgroundColor: preview.color,
                      backgroundImage: preview.imageUrl ? `url(${preview.imageUrl})` : undefined,
                    }}
                  />
                </button>

                <span className="flex min-w-0 flex-1 flex-col justify-center py-1.5">
                  <input
                    aria-label={`Rename ${slot.label} slot`}
                    className="h-5 min-w-0 rounded bg-transparent px-1 font-medium text-foreground text-xs outline-none focus:bg-background/70 focus:ring-1 focus:ring-primary/50 disabled:cursor-not-allowed"
                    defaultValue={slot.label}
                    disabled={!editing || readOnly}
                    key={`${slot.slotId}:${slot.label}`}
                    onBlur={(event) => {
                      if (!event.currentTarget.value.trim()) event.currentTarget.value = slot.label
                      renameMaterialSlot(slot.slotId, event.currentTarget.value)
                    }}
                    onFocus={() => {
                      if (editing) chooseSlot(slot.slotId)
                    }}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') event.currentTarget.blur()
                      if (event.key === 'Escape') {
                        event.currentTarget.value = slot.label
                        event.currentTarget.blur()
                      }
                    }}
                  />
                  <span className="truncate px-1 text-[10px] text-muted-foreground">
                    {materialLabel} · {faceCount} {faceCount === 1 ? 'face' : 'faces'}
                  </span>
                </span>

                {slot.slotId === BLOCK_BODY_SLOT_ID ? (
                  <span className={`${SLOT_TRAILING_ACTION_CLASS} text-primary`}>
                    {active ? <Check aria-hidden="true" className="h-4 w-4" /> : null}
                  </span>
                ) : (
                  <button
                    className={`${SLOT_TRAILING_ACTION_CLASS} text-muted-foreground transition-colors hover:bg-red-500/15 hover:text-red-300 focus-visible:bg-red-500/15 focus-visible:text-red-300 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-muted-foreground`}
                    aria-label={`Delete ${slot.label} slot`}
                    disabled={!editing || readOnly}
                    onClick={() => removeMaterialSlot(slot.slotId)}
                    title={slotEditTitle ?? 'Delete material slot and use Body on its faces'}
                    type="button"
                  >
                    <Trash2 aria-hidden="true" className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
            )
          })}
        </div>

        <div className="mt-2">
          <label
            className="mb-1 block font-medium text-[10px] text-muted-foreground uppercase tracking-wider"
            htmlFor={`block-reusable-material-${node.id}`}
          >
            Active slot material
          </label>
          <select
            className="h-9 w-full rounded-md border border-border/60 bg-[#2C2C2E] px-2.5 text-foreground text-xs focus:outline-none focus:ring-1 focus:ring-primary/50 disabled:cursor-not-allowed disabled:opacity-50"
            disabled={!editing || readOnly || !activeSlotId || reusableMaterialRefs.length === 0}
            id={`block-reusable-material-${node.id}`}
            onChange={(event) => chooseReusableMaterial(event.target.value)}
            title={slotEditTitle}
            value={
              activeSlotRef && reusableMaterialRefs.includes(activeSlotRef) ? activeSlotRef : ''
            }
          >
            <option value="">
              {reusableMaterialRefs.length === 0
                ? 'No reusable materials in this scene'
                : 'Choose a reusable material…'}
            </option>
            {reusableMaterialRefs.map((ref) => (
              <option key={ref} value={ref}>
                {reusableMaterialLabel(ref)}
              </option>
            ))}
          </select>
        </div>

        <div className="mt-2 grid grid-cols-3 gap-1.5">
          <ActionButton
            className={SLOT_DISABLED_ACTION_CLASS}
            disabled={!canOperateOnFaces || !activeSlotId}
            label="Select"
            onClick={() => filterSelection('select')}
            title={slotEditTitle}
          />
          <ActionButton
            className={SLOT_DISABLED_ACTION_CLASS}
            disabled={!canOperateOnFaces || !activeSlotId}
            label="Deselect"
            onClick={() => filterSelection('deselect')}
            title={slotEditTitle}
          />
          <ActionButton
            className={`border-primary/50 bg-primary/15 ${SLOT_DISABLED_ACTION_CLASS} disabled:hover:bg-primary/15 disabled:active:bg-primary/15`}
            disabled={!canOperateOnFaces || selectedFaceIds.length === 0 || !activeSlotId}
            label="Assign"
            onClick={assignMaterial}
            title={slotEditTitle}
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
