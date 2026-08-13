'use client'

import Image from 'next/image'
import { cn } from '@/lib/utils'
import { PlusIcon } from './icons'

export type RailTab = 'scene' | 'build' | 'items' | 'settings'

export const RAIL_TABS: { id: RailTab; label: string; icon: string }[] = [
  { id: 'scene', label: 'Sahne', icon: 'scene' },
  { id: 'build', label: 'Yapı', icon: 'build' },
  { id: 'items', label: 'Objeler', icon: 'couch' },
  { id: 'settings', label: 'Ayarlar', icon: 'settings' },
]

export interface IconRailProps {
  activeTab: RailTab
  onSelect: (tab: RailTab) => void
}

export function IconRail({ activeTab, onSelect }: IconRailProps) {
  return (
    <nav className="flex h-full w-14 flex-shrink-0 flex-col items-center border-[var(--rule-strong)] border-r-2 bg-[var(--ground)]">
      {RAIL_TABS.map((tab) => {
        const isActive = tab.id === activeTab
        return (
          <button
            aria-current={isActive ? 'page' : undefined}
            className={cn(
              'flex h-14 w-14 items-center justify-center border-[var(--rule)] border-b',
              isActive
                ? 'bg-[var(--surface)] shadow-[inset_3px_0_0_var(--ink)]'
                : 'hover:bg-[var(--surface)]',
            )}
            key={tab.id}
            onClick={() => onSelect(tab.id)}
            title={tab.label}
            type="button"
          >
            <Image
              alt={tab.label}
              className={cn('h-7 w-7 object-contain', !isActive && 'opacity-55 grayscale')}
              height={28}
              src={`/icons/${tab.icon}.webp`}
              width={28}
            />
          </button>
        )
      })}

      <div className="flex-1" />

      <button
        className="flex h-14 w-14 items-center justify-center border-[var(--rule)] border-t text-[var(--muted)] hover:bg-[var(--surface)] hover:text-[var(--ink)]"
        title="Yeni ekle"
        type="button"
      >
        <PlusIcon size={18} />
      </button>
    </nav>
  )
}
