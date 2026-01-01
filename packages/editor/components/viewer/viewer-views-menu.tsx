'use client'

import { Video } from 'lucide-react'
import { useShallow } from 'zustand/shallow'
import { useEditor } from '@/hooks/use-editor'
import { cn } from '@/lib/utils'

interface ViewerViewsMenuProps {
  mounted: boolean
}

export function ViewerViewsMenu({ mounted }: ViewerViewsMenuProps) {
  const views = useEditor(useShallow((state) => state.scene.views || []))
  const applyView = useEditor((state) => state.applyView)

  if (!mounted) return null
  if (views.length === 0) return null

  return (
    <div className="mt-2 w-52 min-w-52">
      <div className="space-y-0.5 p-2">
        <div className="mb-2 px-2 text-xs font-medium text-white/50 uppercase tracking-wider">
          Views
        </div>
        
        {views.map((view) => (
          <div
            className={cn(
              'group flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 transition-all',
              'hover:bg-white/10',
            )}
            key={view.id}
            onClick={() => applyView(view.id)}
          >
            <Video className="h-3.5 w-3.5 shrink-0 text-blue-400" />
            <span className="flex-1 text-sm text-white">{view.name}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

