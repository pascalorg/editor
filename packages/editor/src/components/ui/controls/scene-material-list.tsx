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
import { useTranslations } from '../../../lib/i18n'
import useEditor from '../../../store/use-editor'
import { Button } from '../primitives/button'
import { Input } from '../primitives/input'
import { Tooltip, TooltipContent, TooltipTrigger } from '../primitives/tooltip'
import { MaterialPropertiesEditor } from './material-properties-editor'

type SlotRecord = Record<string, string | undefined>

function getSlotRecord(node: unknown): SlotRecord | null {
  if (!node || typeof node !== 'object' || !('slots' in node)) return null
  const slots = (node as { slots?: unknown }).slots
  if (!slots || typeof slots !== 'object' || Array.isArray(slots)) return null
  return slots as SlotRecord
}

export function SceneMaterialList({ autoEditId }: { autoEditId?: SceneMaterialId | null }) {
  const materials = useScene((state) => state.materials)
  const nodes = useScene((state) => state.nodes)
  const addSceneMaterial = useScene((state) => state.addSceneMaterial)
  const updateSceneMaterial = useScene((state) => state.updateSceneMaterial)
  const removeSceneMaterial = useScene((state) => state.removeSceneMaterial)
  const activePaintTarget = useEditor((state) => state.activePaintTarget)
  const activePaintRef = useEditor((state) => state.activePaintMaterial?.materialPreset)
  const armMaterialPaint = useEditor((state) => state.armMaterialPaint)

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
          autoEdit={autoEditId === id}
          id={id}
          isActive={activePaintRef === toSceneMaterialRef(id)}
          key={id}
          removeSceneMaterial={removeSceneMaterial}
          sceneMaterial={sceneMaterial}
          armMaterialPaint={armMaterialPaint}
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
  autoEdit,
  isActive,
  addSceneMaterial,
  updateSceneMaterial,
  removeSceneMaterial,
  armMaterialPaint,
}: {
  id: SceneMaterialId
  sceneMaterial: SceneMaterial
  usageCount: number
  activePaintTarget: ReturnType<typeof useEditor.getState>['activePaintTarget']
  autoEdit: boolean
  isActive: boolean
  addSceneMaterial: ReturnType<typeof useScene.getState>['addSceneMaterial']
  updateSceneMaterial: ReturnType<typeof useScene.getState>['updateSceneMaterial']
  removeSceneMaterial: ReturnType<typeof useScene.getState>['removeSceneMaterial']
  armMaterialPaint: ReturnType<typeof useEditor.getState>['armMaterialPaint']
}) {
  const t = useTranslations()
  // A freshly-created material (via "+ Custom") mounts with its editor open.
  const [isEditingMaterial, setIsEditingMaterial] = useState(autoEdit)
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
      name: t('paint.material.copySuffix', { name: sceneMaterial.name }),
      material: structuredClone(sceneMaterial.material) as MaterialSchema,
    })
  }

  return (
    <div
      className={`rounded-md border border-border/60 bg-background/40 p-2 ${
        isActive ? 'ring-1 ring-primary ring-inset' : ''
      }`}
      data-testid={`scene-material-row-${id}`}
    >
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
          {usageCount === 1
            ? t('paint.material.usedByOne')
            : t('paint.material.usedByOther', { count: usageCount })}
        </span>
        <div className="flex items-center gap-1">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                aria-label={t('paint.material.paintWith')}
                onClick={() =>
                  armMaterialPaint({
                    materialPreset: toSceneMaterialRef(id),
                    sourceTarget: activePaintTarget,
                  })
                }
                size="icon-sm"
                type="button"
                variant="outline"
              >
                <Paintbrush />
              </Button>
            </TooltipTrigger>
            <TooltipContent>{t('paint.material.paintWith')}</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                aria-label={t('common.edit')}
                aria-pressed={isEditingMaterial}
                onClick={() => setIsEditingMaterial((value) => !value)}
                size="icon-sm"
                type="button"
                variant={isEditingMaterial ? 'default' : 'outline'}
              >
                <Pencil />
              </Button>
            </TooltipTrigger>
            <TooltipContent>{t('common.edit')}</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                aria-label={t('common.duplicate')}
                onClick={duplicateMaterial}
                size="icon-sm"
                type="button"
                variant="outline"
              >
                <Copy />
              </Button>
            </TooltipTrigger>
            <TooltipContent>{t('common.duplicate')}</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                aria-label={t('common.delete')}
                onClick={() => removeSceneMaterial(id)}
                size="icon-sm"
                type="button"
                variant="outline"
              >
                <Trash2 />
              </Button>
            </TooltipTrigger>
            <TooltipContent>{t('common.delete')}</TooltipContent>
          </Tooltip>
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
