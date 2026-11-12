'use client'

import { usePascalI18n } from '@pascal-app/core'
import { LayoutGrid } from 'lucide-react'
import type { ReactNode } from 'react'
import { showSidebarPanel } from '../../../lib/sidebar-panel'
import { triggerSFX } from '../../../lib/sfx-bus'
import useEditor from '../../../store/use-editor'
import { PLUGINS_VIEW_ID } from '../../editor/views/use-editor-views'

export type PluginsMenuEntry = { id: string; label: string; icon?: ReactNode }

/**
 * The v2 side menu's Plugins panel: the project's plugins, each opening its own
 * panel in this column, and the directory to add more.
 */
export function PluginsMenuPanel({ plugins }: { plugins: readonly PluginsMenuEntry[] }) {
  const i18n = usePascalI18n()
  return (
    <div className="flex flex-col gap-0.5 p-2">
      {plugins.length === 0 ? (
        <p className="px-2 py-2 text-muted-foreground text-sm">
          {i18n._({
            id: 'editor.sidebar.pluginsMenu.empty',
            message: 'No plugins in this project yet.',
          })}
        </p>
      ) : (
        plugins.map((plugin) => (
          <button
            className="group flex h-10 w-full shrink-0 items-center gap-2 rounded-xl px-1.5 text-muted-foreground transition-colors hover:bg-sidebar-accent/50 hover:text-foreground"
            key={plugin.id}
            onClick={() => {
              triggerSFX('sfx:menu-click')
              showSidebarPanel(plugin.id)
            }}
            type="button"
          >
            <span className="flex size-7 shrink-0 items-center justify-center [&_img]:max-h-7 [&_img]:max-w-7">
              {plugin.icon ?? plugin.label.charAt(0)}
            </span>
            <span className="truncate font-medium text-sm">{plugin.label}</span>
          </button>
        ))
      )}
      <button
        className="mt-2 flex h-9 items-center justify-center gap-2 rounded-full border border-border/60 px-4 font-medium text-sm transition-colors hover:bg-sidebar-accent/50"
        onClick={() => {
          triggerSFX('sfx:menu-click')
          useEditor.getState().showView(PLUGINS_VIEW_ID)
        }}
        type="button"
      >
        <LayoutGrid aria-hidden className="size-4" />
        {i18n._({ id: 'editor.sidebar.pluginsMenu.browse', message: 'Browse plugins' })}
      </button>
    </div>
  )
}
