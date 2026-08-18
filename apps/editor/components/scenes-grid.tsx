'use client'

import { Eye, History, Pencil, Share2, Trash2 } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import type { SceneMeta } from '@/components/scene-loader'
import { SceneBackupsDialog } from './scene-backups-dialog'
import { SceneDeleteDialog } from './scene-delete-dialog'
import { ScenePreviewDialog } from './scene-preview-dialog'
import { SceneRenameDialog } from './scene-rename-dialog'
import { SceneShareDialog } from './scene-share-dialog'

/**
 * The full scenes library grid — this is where the rich per-project management
 * lives (rename, delete, share, backups, preview), unlike the editor's rail,
 * which is a plain switcher. Rendered by the server-side `/scenes` page; a
 * successful action calls `router.refresh()` to re-fetch that server list.
 */

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleString()
  } catch {
    return iso
  }
}

type Dialog = {
  kind: 'rename' | 'delete' | 'share' | 'backups' | 'preview'
  scene: SceneMeta
}

const ICON_BTN =
  'rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground'

export function SceneGrid({
  scenes,
  currentUserId,
  isAdmin,
}: {
  scenes: SceneMeta[]
  currentUserId: string | null
  isAdmin: boolean
}) {
  const router = useRouter()
  const [dialog, setDialog] = useState<Dialog | null>(null)

  // Owner-or-admin manages (rename / delete / share / backups); preview reads
  // only the stored thumbnail, so it is open to anyone who can see the scene.
  const canManage = (scene: SceneMeta): boolean =>
    currentUserId != null && (scene.ownerId === currentUserId || isAdmin)

  return (
    <>
      <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {scenes.map((scene) => {
          const manage = canManage(scene)
          return (
            <li
              key={scene.id}
              className="flex flex-col rounded-xl border border-border/60 bg-background transition-colors hover:border-border"
            >
              <button
                className="group block rounded-t-xl p-4 text-left transition-colors hover:bg-accent/30"
                onClick={() => router.push(`/scene/${scene.id}`)}
                type="button"
              >
                <div className="flex aspect-video items-center justify-center overflow-hidden rounded-lg bg-accent/30">
                  {scene.thumbnailUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      alt={scene.name}
                      className="h-full w-full object-cover"
                      src={scene.thumbnailUrl}
                    />
                  ) : (
                    <span className="text-muted-foreground text-xs">No thumbnail</span>
                  )}
                </div>
                <div className="mt-3">
                  <h2 className="truncate font-semibold text-sm group-hover:text-foreground">
                    {scene.name}
                  </h2>
                  <div className="mt-1 flex items-center justify-between text-muted-foreground text-xs">
                    <span>{scene.nodeCount} nodes</span>
                    <time dateTime={scene.updatedAt}>{formatDate(scene.updatedAt)}</time>
                  </div>
                </div>
              </button>

              <div className="flex items-center gap-1 border-border/60 border-t px-3 py-2">
                {manage && (
                  <button
                    className="flex items-center gap-1 rounded-md px-1.5 py-1 text-muted-foreground text-xs transition-colors hover:bg-muted hover:text-foreground"
                    onClick={() => setDialog({ kind: 'backups', scene })}
                    type="button"
                  >
                    <History className="size-3.5" />
                    Yedekler
                  </button>
                )}
                <button
                  className="flex items-center gap-1 rounded-md px-1.5 py-1 text-muted-foreground text-xs transition-colors hover:bg-muted hover:text-foreground"
                  onClick={() => setDialog({ kind: 'preview', scene })}
                  type="button"
                >
                  <Eye className="size-3.5" />
                  Önizle
                </button>
                {manage && (
                  <div className="ml-auto flex items-center gap-0.5">
                    <button
                      aria-label="Yeniden adlandır"
                      className={ICON_BTN}
                      onClick={() => setDialog({ kind: 'rename', scene })}
                      title="Yeniden adlandır"
                      type="button"
                    >
                      <Pencil className="size-3.5" />
                    </button>
                    <button
                      aria-label="Paylaş"
                      className={ICON_BTN}
                      onClick={() => setDialog({ kind: 'share', scene })}
                      title="Paylaş"
                      type="button"
                    >
                      <Share2 className="size-3.5" />
                    </button>
                    <button
                      aria-label="Sil"
                      className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-destructive"
                      onClick={() => setDialog({ kind: 'delete', scene })}
                      title="Sil"
                      type="button"
                    >
                      <Trash2 className="size-3.5" />
                    </button>
                  </div>
                )}
              </div>
            </li>
          )
        })}
      </ul>

      {dialog?.kind === 'rename' && (
        <SceneRenameDialog
          onClose={() => setDialog(null)}
          onRenamed={() => router.refresh()}
          scene={dialog.scene}
        />
      )}
      {dialog?.kind === 'delete' && (
        <SceneDeleteDialog
          onClose={() => setDialog(null)}
          onDeleted={() => router.refresh()}
          scene={dialog.scene}
        />
      )}
      {dialog?.kind === 'share' && (
        <SceneShareDialog
          onClose={() => setDialog(null)}
          onSaved={() => router.refresh()}
          scene={dialog.scene}
        />
      )}
      {dialog?.kind === 'backups' && (
        <SceneBackupsDialog
          onClose={() => setDialog(null)}
          onRestored={() => router.refresh()}
          scene={dialog.scene}
        />
      )}
      {dialog?.kind === 'preview' && (
        <ScenePreviewDialog onClose={() => setDialog(null)} scene={dialog.scene} />
      )}
    </>
  )
}
