'use client'

import { usePascalI18n } from '@pascal-app/core'
import { PanelLeftClose } from 'lucide-react'
import type { ReactNode } from 'react'
import { triggerSFX } from './../../../lib/sfx-bus'
import { cn } from './../../../lib/utils'

export type SidebarTab = {
  id: string
  label: string
  mobileDefaultSnap?: number
  mobileIcon?: ReactNode
  /** Desktop icon shown in the side menu (v2 layout). */
  icon?: ReactNode
  /**
   * Menu entry that drives the stage instead of opening a tool panel:
   * activating it closes the panel (preserving its open state) and keeps the
   * entry highlighted regardless.
   */
  noPanel?: boolean
  /** Runs when the entry is picked — with `noPanel`, to put its surface on the stage. */
  onSelect?: () => void
  /**
   * For a `noPanel` entry whose surface can leave the stage on its own (a view
   * closed from the view bar): false once it has, and the menu goes back to
   * the panel that was open before it.
   */
  stageActive?: boolean
  /** Runs when the menu moves from this entry to another: a stage entry takes its surface down. */
  onDeselect?: () => void
  /** Heading the v2 side menu groups this entry under, e.g. "Tools". */
  section?: string
}

interface TabBarProps {
  tabs: SidebarTab[]
  activeTab: string
  onTabChange: (id: string) => void
}

export function TabBar({ tabs, activeTab, onTabChange }: TabBarProps) {
  return (
    <div className="flex h-10 shrink-0 items-center gap-0.5 border-border/50 border-b px-2">
      {tabs.map((tab) => {
        const isActive = activeTab === tab.id
        return (
          <button
            className={cn(
              'relative h-7 rounded-md px-3 font-medium text-sm transition-colors',
              isActive
                ? 'bg-sidebar-accent text-foreground'
                : 'text-muted-foreground hover:bg-sidebar-accent/50 hover:text-foreground',
            )}
            key={tab.id}
            onClick={() => {
              triggerSFX('sfx:menu-click')
              onTabChange(tab.id)
            }}
            onMouseEnter={() => triggerSFX('sfx:menu-hover')}
            type="button"
          >
            {tab.label}
          </button>
        )
      })}
    </div>
  )
}

interface SideMenuProps {
  tabs: SidebarTab[]
  /** Highlighted entry. While its panel is closed it stays lit only as a stage entry. */
  activeTab: string
  /** True when no tool panel is open. */
  collapsed: boolean
  /** Picking an entry: open its panel, or close the panel already open (see layout). */
  onTabClick: (id: string) => void
  /** Pinned under the entries, e.g. the host's recent chats. */
  footer?: ReactNode
  /** Hides the whole menu; a Menu button above the stage brings it back. */
  onHide: () => void
}

/**
 * The v2 layout's side menu: every tool by name, grouped under its section's
 * heading in the order the sections first appear. Entries without a section
 * lead, untitled.
 */
export function SideMenu({
  tabs,
  activeTab,
  collapsed,
  onTabClick,
  footer,
  onHide,
}: SideMenuProps) {
  const i18n = usePascalI18n()
  const hideLabel = i18n._({ id: 'editor.sidebar.sideMenu.hide', message: 'Hide menu' })
  const groups: { section?: string; tabs: SidebarTab[] }[] = []
  for (const tab of tabs) {
    const group = groups.find((g) => g.section === tab.section)
    if (group) group.tabs.push(tab)
    else groups.push({ section: tab.section, tabs: [tab] })
  }
  groups.sort((a, b) => Number(a.section !== undefined) - Number(b.section !== undefined))

  return (
    <nav
      className="flex h-full w-44 shrink-0 flex-col border-border/50 border-r"
      data-surface="icon-rail"
    >
      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-2 py-2">
        <button
          aria-label={hideLabel}
          className="flex h-8 w-full shrink-0 items-center gap-2 rounded-xl px-2.5 text-muted-foreground text-xs transition-colors hover:bg-sidebar-accent/50 hover:text-foreground"
          onClick={onHide}
          title={hideLabel}
          type="button"
        >
          <PanelLeftClose aria-hidden className="size-4" />
          {hideLabel}
        </button>
        {groups.map((group) => (
          <div className="flex flex-col gap-0.5" key={group.section ?? ''}>
            {group.section ? (
              <p className="px-2 pt-1 pb-1 font-medium text-[11px] text-muted-foreground/70">
                {group.section}
              </p>
            ) : null}
            {group.tabs.map((tab) => {
              const showActive = activeTab === tab.id && (!collapsed || tab.noPanel === true)
              return (
                <button
                  aria-label={tab.label}
                  aria-pressed={showActive}
                  className={cn(
                    'group flex h-9 w-full shrink-0 items-center gap-2 rounded-xl px-1.5 transition-colors duration-200 [&_img]:transition-[opacity,filter] [&_img]:duration-200',
                    showActive
                      ? 'bg-sidebar-accent text-foreground shadow-sm [&_img]:opacity-100 [&_img]:grayscale-0'
                      : 'text-muted-foreground hover:bg-sidebar-accent/50 hover:text-foreground [&_img]:opacity-60 [&_img]:grayscale hover:[&_img]:opacity-100 hover:[&_img]:grayscale-0',
                  )}
                  key={tab.id}
                  onClick={() => {
                    triggerSFX('sfx:menu-click')
                    onTabClick(tab.id)
                  }}
                  onMouseEnter={() => triggerSFX('sfx:menu-hover')}
                  type="button"
                >
                  <span className="flex size-7 shrink-0 items-center justify-center [&_img]:max-h-7 [&_img]:max-w-7">
                    {tab.icon ?? tab.label.charAt(0)}
                  </span>
                  <span className="truncate font-medium text-sm">{tab.label}</span>
                </button>
              )
            })}
          </div>
        ))}
      </div>
      {footer ? <div className="shrink-0 border-border/50 border-t px-2 py-2">{footer}</div> : null}
    </nav>
  )
}
