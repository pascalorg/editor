'use client'

import Image from 'next/image'
import { cn } from '@/lib/utils'
import { ChevronIcon } from './icons'
import type { MenartNode } from './scene-data'

/** Indent per depth. Depth 2 also drops the disclosure column entirely. */
const ROW_PADDING = ['pr-3 pl-3', 'pr-3 pl-8', 'pr-3 pl-[52px]']

export interface SceneTreeProps {
  nodes: MenartNode[]
  expandedIds: Set<string>
  activeLevelId: string
  selectedId: string | null
  onToggle: (id: string) => void
  onSelect: (id: string, isLevel: boolean) => void
}

interface TreeRowProps extends Omit<SceneTreeProps, 'nodes'> {
  node: MenartNode
  depth: number
}

function TreeRow({
  node,
  depth,
  expandedIds,
  activeLevelId,
  selectedId,
  onToggle,
  onSelect,
}: TreeRowProps) {
  const isActiveLevel = depth === 0 && node.id === activeLevelId
  const isSelected = node.id === selectedId
  const isHighlighted = isActiveLevel || isSelected
  const hasChildren = Boolean(node.children?.length)
  const isExpanded = expandedIds.has(node.id)
  const select = () => onSelect(node.id, depth === 0)

  return (
    <>
      <div
        aria-expanded={hasChildren ? isExpanded : undefined}
        aria-selected={isSelected}
        className={cn(
          'flex h-[34px] items-center border-[var(--rule)] border-b text-[13px]',
          ROW_PADDING[Math.min(depth, 2)],
          isActiveLevel &&
            'bg-[var(--surface)] font-semibold text-[var(--ink)] shadow-[inset_3px_0_0_var(--ink)]',
          !isActiveLevel && isSelected && 'bg-[var(--surface)] text-[var(--ink)]',
          !isHighlighted && 'text-[var(--muted)] hover:bg-[var(--surface)] hover:text-[var(--ink)]',
        )}
        onClick={select}
        onKeyDown={(event) => {
          if (event.key !== 'Enter' && event.key !== ' ') return
          event.preventDefault()
          select()
        }}
        role="treeitem"
        tabIndex={0}
      >
        {depth < 2 &&
          (hasChildren ? (
            <button
              className="mr-2 flex h-4 w-4 flex-shrink-0 items-center justify-center"
              onClick={(event) => {
                event.stopPropagation()
                onToggle(node.id)
              }}
              tabIndex={-1}
              title={isExpanded ? 'Daralt' : 'Genişlet'}
              type="button"
            >
              <ChevronIcon
                className={cn('transition-transform', isExpanded && 'rotate-90')}
                size={12}
              />
            </button>
          ) : (
            <span className="mr-2 w-4 flex-shrink-0" />
          ))}

        <Image
          alt=""
          className={cn('mr-2 h-5 w-5 object-contain', !isHighlighted && 'opacity-55 grayscale')}
          height={20}
          src={`/icons/${node.icon}.webp`}
          width={20}
        />

        <span className={cn('min-w-0 flex-1 truncate', isSelected && 'font-semibold')}>
          {node.label}
        </span>

        <span
          className={cn(
            'mn-mono text-[11px]',
            isHighlighted ? 'text-[var(--muted)]' : 'text-[var(--faint)]',
          )}
        >
          {node.value}
        </span>
      </div>

      {hasChildren &&
        isExpanded &&
        node.children?.map((child) => (
          <TreeRow
            activeLevelId={activeLevelId}
            depth={depth + 1}
            expandedIds={expandedIds}
            key={child.id}
            node={child}
            onSelect={onSelect}
            onToggle={onToggle}
            selectedId={selectedId}
          />
        ))}
    </>
  )
}

export function SceneTree({ nodes, ...rowProps }: SceneTreeProps) {
  if (nodes.length === 0) {
    return <p className="px-3 py-4 text-[13px] text-[var(--muted)]">Eşleşen bir öğe bulunamadı.</p>
  }

  return (
    <div role="tree">
      {nodes.map((node) => (
        <TreeRow depth={0} key={node.id} node={node} {...rowProps} />
      ))}
    </div>
  )
}
