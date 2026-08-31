'use client'

import type { LevelNode } from '@pascal-app/core'
import { useEffect, useState } from 'react'
import type { LevelDuplicatePreset } from '../../lib/level-duplication'
import { getLevelDisplayName } from '@pascal-app/core'
import { cn } from '../../lib/utils'
import { messages, useLocale } from '../../lib/i18n'
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
  labelKey: string
  descKey: string
}> = [
  {
    id: 'everything',
    labelKey: 'levelDuplicate.everything',
    descKey: 'levelDuplicate.everythingDesc',
  },
  {
    id: 'structure',
    labelKey: 'levelDuplicate.structure',
    descKey: 'levelDuplicate.structureDesc',
  },
  {
    id: 'structure-materials',
    labelKey: 'levelDuplicate.structureMaterials',
    descKey: 'levelDuplicate.structureMaterialsDesc',
  },
  {
    id: 'structure-furniture',
    labelKey: 'levelDuplicate.structureFurniture',
    descKey: 'levelDuplicate.structureFurnitureDesc',
  },
]

function getLevelLabel(level: LevelNode | null, locale: string) {
  if (!level) return 'this level'
  return getLevelDisplayName(level, locale as 'en' | 'zh')
}

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
  const [preset, setPreset] = useState<LevelDuplicatePreset>('everything')
  const { locale } = useLocale()
  const t = (key: string, params?: Record<string, string | number>) => {
    const str = (messages[locale as 'en' | 'zh'] as Record<string, string>)[key] || key
    if (!params) return str
    return Object.entries(params).reduce(
      (s, [k, v]) => s.replace(new RegExp(`\\{${k}}`, 'g'), String(v)), str,
    )
  }

  useEffect(() => {
    if (open) {
      setPreset('everything')
    }
  }, [open])

  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent className="sm:max-w-md" showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>{t('levelDuplicate.duplicateLevel')}</DialogTitle>
          <DialogDescription>{t('levelDuplicate.chooseWhatToCopy', { level: getLevelLabel(level, locale) })}</DialogDescription>
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
              <div className="font-medium text-sm">{t(option.labelKey)}</div>
              <div className="mt-1 text-muted-foreground text-xs">{t(option.descKey)}</div>
            </button>
          ))}
        </div>

        <DialogFooter>
          <button
            className="cursor-pointer rounded-md px-4 py-2 text-muted-foreground text-sm transition-colors hover:bg-accent"
            onClick={() => onOpenChange(false)}
            type="button"
          >
            {t('levelDuplicate.cancel')}
          </button>
          <button
            className="cursor-pointer rounded-md bg-primary px-4 py-2 text-primary-foreground text-sm transition-opacity hover:opacity-90"
            onClick={() => onConfirm(preset)}
            type="button"
          >
            {t('levelDuplicate.duplicate')}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
