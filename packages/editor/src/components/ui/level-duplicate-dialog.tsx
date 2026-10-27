'use client'

import type { LevelNode, MessageDescriptor } from '@pascal-app/core'
import { useEffect, useState } from 'react'
import type { LevelDuplicatePreset } from '@pascal-app/core/building'
import { useLocale, usePascalI18n } from '@pascal-app/core'
import { localizedLevelName } from '../../i18n/level-name'
import { cn } from '../../lib/utils'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from './primitives/dialog'

const DUPLICATE_PRESETS: Array<{
  id: LevelDuplicatePreset
  label: MessageDescriptor
  description: MessageDescriptor
}> = [
  {
    id: 'everything',
    label: /* i18n */ { id: 'editor.levelDuplicateDialog.everything', message: 'Everything' },
    description: /* i18n */ { id: 'editor.levelDuplicateDialog.structureMaterialsFurnitureAndReferences', message: 'Structure, materials, furniture, and references.' },
  },
  {
    id: 'structure',
    label: /* i18n */ { id: 'editor.levelDuplicateDialog.structureOnly', message: 'Structure only' },
    description: /* i18n */ { id: 'editor.levelDuplicateDialog.wallsSlabsRoofsStairsWindowsAnd', message: 'Walls, slabs, roofs, stairs, windows, and doors without finishes.' },
  },
  {
    id: 'structure-materials',
    label: /* i18n */ { id: 'editor.levelDuplicateDialog.structureMaterials', message: 'Structure + materials' },
    description: /* i18n */ { id: 'editor.levelDuplicateDialog.structureWithTheCurrentMaterialAnd', message: 'Structure with the current material and finish assignments.' },
  },
  {
    id: 'structure-furniture',
    label: /* i18n */ { id: 'editor.levelDuplicateDialog.structureFurniture', message: 'Structure + furniture' },
    description: /* i18n */ { id: 'editor.levelDuplicateDialog.structureFinishesAndPlacedItemsWithout', message: 'Structure, finishes, and placed items, without guide references.' },
  },
]

export function LevelDuplicateDialog({
  open,
  level,
  onConfirm,
  onOpenChange,
}: {
  open: boolean
  level: LevelNode | null
  onConfirm: (preset: LevelDuplicatePreset) => void
  onOpenChange: (open: boolean) => void
}) {
  const i18n = usePascalI18n()
  const locale = useLocale()
  const [preset, setPreset] = useState<LevelDuplicatePreset>('everything')

  useEffect(() => {
    if (open) {
      setPreset('everything')
    }
  }, [open])

  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent className="sm:max-w-md" showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>{i18n._({ id: 'editor.levelDuplicateDialog.duplicateLevel', message: 'Duplicate Level' })}</DialogTitle>
          <DialogDescription>
            {level
              ? i18n._({
                  id: 'editor.levelDuplicateDialog.chooseWhatToCopyFromLevel',
                  message: 'Choose what to copy from {levelName}.',
                  values: { levelName: localizedLevelName(level, i18n, locale) },
                })
              : i18n._({
                  id: 'editor.levelDuplicateDialog.chooseWhatToCopyFromThisLevel',
                  message: 'Choose what to copy from this level.',
                })}
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-2">
          {DUPLICATE_PRESETS.map((option) => (
            <button
              className={cn(
                'cursor-pointer rounded-xl border px-3 py-3 text-left transition-colors',
                preset === option.id
                  ? 'border-primary bg-primary/10 text-foreground'
                  : 'border-border bg-background hover:bg-accent/40',
              )}
              key={option.id}
              onClick={() => setPreset(option.id)}
              type="button"
            >
              <div className="font-medium text-sm">{i18n._(option.label)}</div>
              <div className="mt-1 text-muted-foreground text-xs">{i18n._(option.description)}</div>
            </button>
          ))}
        </div>

        <DialogFooter>
          <button
            className="cursor-pointer rounded-md px-4 py-2 text-muted-foreground text-sm transition-colors hover:bg-accent"
            onClick={() => onOpenChange(false)}
            type="button"
          >
            {i18n._({ id: 'editor.levelDuplicateDialog.cancel', message: 'Cancel' })}
          </button>
          <button
            className="cursor-pointer rounded-md bg-primary px-4 py-2 text-primary-foreground text-sm transition-opacity hover:opacity-90"
            onClick={() => onConfirm(preset)}
            type="button"
          >
            {i18n._({ id: 'editor.levelDuplicateDialog.duplicate', message: 'Duplicate' })}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
