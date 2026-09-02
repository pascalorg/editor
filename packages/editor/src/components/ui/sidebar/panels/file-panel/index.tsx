'use client'

import Link from 'next/link'
import { FolderOpen, Plus } from 'lucide-react'
import { messages, useLocale } from '../../../../../lib/i18n'
import { Button } from '../../../../../components/ui/primitives/button'

export function FilePanel() {
  const { locale } = useLocale()
  const t = (key: string) => (messages[locale] as Record<string, string>)[key] || key

  return (
    <div className="flex h-full flex-col gap-6 overflow-y-auto p-3">
      <div className="space-y-2">
        <label className="font-medium text-muted-foreground text-xs uppercase">
          {t('editor.recent')}
        </label>
        <Button asChild className="w-full justify-start gap-2" variant="outline">
          <Link href="/scenes">
            <FolderOpen className="size-4" />
            {t('editor.openRecent')}
          </Link>
        </Button>
      </div>

      <div className="space-y-2">
        <label className="font-medium text-muted-foreground text-xs uppercase">
          {t('editor.create')}
        </label>
        <Button asChild className="w-full justify-start gap-2" variant="outline">
          <Link href="/scenes">
            <Plus className="size-4" />
            {t('editor.createNew')}
          </Link>
        </Button>
      </div>
    </div>
  )
}
