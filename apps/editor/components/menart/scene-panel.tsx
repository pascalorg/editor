'use client'

import Image from 'next/image'
import { useMemo, useState } from 'react'
import type { RailTab } from './icon-rail'
import { MoreIcon, PlusIcon, SearchIcon } from './icons'
import { OnboardingChecklist } from './onboarding-checklist'
import { MENART_LEVELS, MENART_PROJECT, searchTree } from './scene-data'
import { SceneTree } from './scene-tree'

const PANEL_TITLE: Record<RailTab, string> = {
  scene: 'Sahne ağacı',
  build: 'Yapı',
  items: 'Objeler',
  settings: 'Ayarlar',
}

/** Only the scene tab is drawn in `Menart 3D.dc.html`; the rest say so. */
const PANEL_PLACEHOLDER: Record<Exclude<RailTab, 'scene'>, string> = {
  build: 'Yapı araçları bu görünüme henüz bağlanmadı.',
  items: 'Obje kataloğu bu görünüme henüz bağlanmadı.',
  settings: 'Ayarlar bu görünüme henüz bağlanmadı.',
}

export interface ScenePanelProps {
  tab: RailTab
  expandedIds: Set<string>
  activeLevelId: string
  selectedId: string | null
  onToggle: (id: string) => void
  onSelect: (id: string, isLevel: boolean) => void
  onboardingVisible: boolean
  onDismissOnboarding: () => void
}

export function ScenePanel({
  tab,
  expandedIds,
  activeLevelId,
  selectedId,
  onToggle,
  onSelect,
  onboardingVisible,
  onDismissOnboarding,
}: ScenePanelProps) {
  const [query, setQuery] = useState('')
  const { nodes, expand } = useMemo(() => searchTree(MENART_LEVELS, query), [query])

  // A search hit deep in a collapsed branch has to be visible without the user
  // reopening its ancestors by hand, so matches force their parents open on top
  // of whatever the user has expanded manually.
  const visibleExpanded = useMemo(
    () => (expand.length > 0 ? new Set([...expandedIds, ...expand]) : expandedIds),
    [expandedIds, expand],
  )

  return (
    <aside className="flex h-full w-[304px] flex-shrink-0 flex-col border-[var(--rule-strong)] border-r-2 bg-[var(--ground)]">
      <div className="flex h-10 flex-shrink-0 items-center justify-between border-[var(--rule-strong)] border-b-2 px-3">
        <span className="mn-mono font-semibold text-[11px] text-[var(--muted)] uppercase tracking-[0.1em]">
          {PANEL_TITLE[tab]}
        </span>
        <div className="flex items-center gap-[2px] text-[var(--muted)]">
          <button
            className="flex h-[26px] w-[26px] items-center justify-center hover:bg-[var(--surface)] hover:text-[var(--ink)]"
            title="Ekle"
            type="button"
          >
            <PlusIcon size={15} />
          </button>
          <button
            className="flex h-[26px] w-[26px] items-center justify-center hover:bg-[var(--surface)] hover:text-[var(--ink)]"
            title="Daha fazla"
            type="button"
          >
            <MoreIcon size={15} />
          </button>
        </div>
      </div>

      {tab === 'scene' ? (
        <>
          <div className="flex h-9 flex-shrink-0 items-center gap-2 border-[var(--rule)] border-b px-3">
            <SearchIcon className="flex-shrink-0 text-[var(--faint)]" size={14} />
            <input
              className="mn-input text-[13px]"
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Ara — duvar, kat, oda"
              value={query}
            />
          </div>

          <div className="flex h-11 flex-shrink-0 items-center gap-2.5 border-[var(--rule-strong)] border-b-2 px-3">
            <Image
              alt=""
              className="h-[22px] w-[22px] object-contain"
              height={22}
              src={`/icons/${MENART_PROJECT.building.icon}.webp`}
              width={22}
            />
            <span className="min-w-0 flex-1 truncate font-semibold text-[14px]">
              {MENART_PROJECT.building.name}
            </span>
            <span className="mn-mono text-[11px] text-[var(--muted)]">
              {MENART_LEVELS.length} kat
            </span>
          </div>

          <div className="min-h-0 flex-1 overflow-auto">
            <SceneTree
              activeLevelId={activeLevelId}
              expandedIds={visibleExpanded}
              nodes={nodes}
              onSelect={onSelect}
              onToggle={onToggle}
              selectedId={selectedId}
            />
          </div>
        </>
      ) : (
        <div className="flex min-h-0 flex-1 items-center justify-center px-6 text-center">
          <p className="text-[13px] text-[var(--muted)]">{PANEL_PLACEHOLDER[tab]}</p>
        </div>
      )}

      {onboardingVisible && <OnboardingChecklist onDismiss={onDismissOnboarding} />}
    </aside>
  )
}
