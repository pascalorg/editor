'use client'

import type { SceneMeta } from '@/components/scene-loader'
import { SceneModal } from './scene-modal'

export function ScenePreviewDialog({ scene, onClose }: { scene: SceneMeta; onClose: () => void }) {
  return (
    <SceneModal className="max-w-md" onClose={onClose} title={scene.name}>
      {scene.thumbnailUrl ? (
        <img
          alt={scene.name}
          className="mx-auto max-h-[60vh] w-full rounded-lg object-contain"
          src={scene.thumbnailUrl}
        />
      ) : (
        <p className="py-8 text-center text-muted-foreground text-sm leading-relaxed">
          Önizleme henüz oluşmadı — projeyi kaydedince oluşturulur.
        </p>
      )}
    </SceneModal>
  )
}
