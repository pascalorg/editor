'use client'

import {
  generateSceneMaterialId,
  type MaterialSchema,
  type SceneMaterial,
  type SceneMaterialId,
  toSceneMaterialRef,
  useScene,
} from '@pascal-app/core'
import { Copy, Paintbrush, Pencil, Trash2 } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import useEditor from '../../../store/use-editor'
import { Button } from '../primitives/button'
import { Input } from '../primitives/input'
import { MaterialPropertiesEditor } from './material-properties-editor'

type SlotRecord = Record<string, string | undefined>

function getSlotRecord(node: unknown): SlotRecord | null {
  if (!node || typeof node !== 'object' || !('slots' in node)) return null
  const slots = (node as { slots?: unknown }).slots
  if (!slots || typeof slots !== 'object' || Array.isArray(slots)) return null
  return slots as SlotRecord
}

export function SceneMaterialList() {
  const materials = useScene((state) => state.materials)
  const nodes = useScene((state) => state.nodes)
  const addSceneMaterial = useScene((state) => state.addSceneMaterial)
  const updateSceneMaterial = useScene((state) => state.updateSceneMaterial)
  const removeSceneMaterial = useScene((state) => state.removeSceneMaterial)
  const activePaintTarget = useEditor((state) => state.activePaintTarget)
  const setActivePaintMaterial = useEditor((state) => state.setActivePaintMaterial)

  const materialEntries = useMemo(
    () => Object.entries(materials) as [SceneMaterialId, SceneMaterial][],
    [materials],
  )

  const usageCounts = useMemo(() => {
    const counts = new Map<SceneMaterialId, number>()
    const refToId = new Map<string, SceneMaterialId>()

    for (const [id] of materialEntries) {
      counts.set(id, 0)
      refToId.set(toSceneMaterialRef(id), id)
    }

    for (const node of Object.values(nodes)) {
      const slots = getSlotRecord(node)
      if (!slots) continue

      for (const value of Object.values(slots)) {
        if (typeof value !== 'string') continue
        const materialId = refToId.get(value)
        if (!materialId) continue
        counts.set(materialId, (counts.get(materialId) ?? 0) + 1)
      }
    }

    return counts
  }, [materialEntries, nodes])

  return (
    <div className="space-y-2">
      {materialEntries.map(([id, sceneMaterial]) => (
        <SceneMaterialRow
          addSceneMaterial={addSceneMaterial}
          activePaintTarget={activePaintTarget}
          id={id}
          key={id}
          removeSceneMaterial={removeSceneMaterial}
          sceneMaterial={sceneMaterial}
          setActivePaintMaterial={setActivePaintMaterial}
          updateSceneMaterial={updateSceneMaterial}
          usageCount={usageCounts.get(id) ?? 0}
        />
      ))}
    </div>
  )
}

function SceneMaterialRow({
  id,
  sceneMaterial,
  usageCount,
  activePaintTarget,
  addSceneMaterial,
  updateSceneMaterial,
  removeSceneMaterial,
  setActivePaintMaterial,
}: {
  id: SceneMaterialId
  sceneMaterial: SceneMaterial
  usageCount: number
  activePaintTarget: ReturnType<typeof useEditor.getState>['activePaintTarget']
  addSceneMaterial: ReturnType<typeof useScene.getState>['addSceneMaterial']
  updateSceneMaterial: ReturnType<typeof useScene.getState>['updateSceneMaterial']
  removeSceneMaterial: ReturnType<typeof useScene.getState>['removeSceneMaterial']
  setActivePaintMaterial: ReturnType<typeof useEditor.getState>['setActivePaintMaterial']
}) {
  const [isEditingMaterial, setIsEditingMaterial] = useState(false)
  const [draftName, setDraftName] = useState(sceneMaterial.name)
  const swatchColor = sceneMaterial.material.properties?.color ?? '#ffffff'

  useEffect(() => {
    setDraftName(sceneMaterial.name)
  }, [sceneMaterial.name])

  const commitName = () => {
    const nextName = draftName.trim()
    if (!nextName) {
      setDraftName(sceneMaterial.name)
      return
    }
    if (nextName !== sceneMaterial.name) {
      updateSceneMaterial(id, { name: nextName })
    }
  }

  const duplicateMaterial = () => {
    addSceneMaterial({
      id: generateSceneMaterialId(),
      name: `${sceneMaterial.name} copy`,
      material: structuredClone(sceneMaterial.material) as MaterialSchema,
    })
  }

  return (
    <div className="rounded-md border border-border/60 bg-background/40 p-2">
      <div className="flex items-center gap-2">
        <span
          className="h-8 w-8 shrink-0 rounded-md border border-border/70"
          style={{ backgroundColor: swatchColor }}
        />
        <Input
          className="h-8 px-2 text-sm"
          onBlur={commitName}
          onChange={(e) => setDraftName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.currentTarget.blur()
            }
            if (e.key === 'Escape') {
              setDraftName(sceneMaterial.name)
              e.currentTarget.blur()
            }
          }}
          value={draftName}
        />
      </div>

      <div className="mt-2 flex items-center justify-between gap-2">
        <span className="text-muted-foreground text-xs">
          Used by {usageCount} {usageCount === 1 ? 'part' : 'parts'}
        </span>
        <div className="flex items-center gap-1">
          <Button
            aria-label="Paint with"
            onClick={() =>
              setActivePaintMaterial({
                material: sceneMaterial.material,
                sourceTarget: activePaintTarget,
              })
            }
            size="icon-sm"
            title="Paint with"
            type="button"
            variant="outline"
          >
            <Paintbrush />
          </Button>
          <Button
            aria-label="Edit"
            aria-pressed={isEditingMaterial}
            onClick={() => setIsEditingMaterial((value) => !value)}
            size="icon-sm"
            title="Edit"
            type="button"
            variant={isEditingMaterial ? 'default' : 'outline'}
          >
            <Pencil />
          </Button>
          <Button
            aria-label="Duplicate"
            onClick={duplicateMaterial}
            size="icon-sm"
            title="Duplicate"
            type="button"
            variant="outline"
          >
            <Copy />
          </Button>
          <Button
            aria-label="Delete"
            onClick={() => removeSceneMaterial(id)}
            size="icon-sm"
            title="Delete"
            type="button"
            variant="outline"
          >
            <Trash2 />
          </Button>
        </div>
      </div>

      {isEditingMaterial ? (
        <div className="mt-3 border-border/60 border-t pt-3">
          <MaterialPropertiesEditor
            onChange={(material) => updateSceneMaterial(id, { material })}
            value={sceneMaterial.material}
          />
        </div>
      ) : null}
    </div>
  )
}
