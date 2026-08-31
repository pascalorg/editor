'use client'

import { Icon } from '@iconify/react'
import type { IconRef } from '@pascal-app/core'
import { type ComponentType, lazy, Suspense } from 'react'

// `React.lazy` must be called once per loader so the resolved component keeps
// a stable identity across renders (otherwise every parent re-render remounts
// the icon). Cache by the loader function — same pattern as the plugin-panel
// component cache.
const lazyIconCache = new WeakMap<() => Promise<{ default: ComponentType }>, ComponentType>()

function resolveLazyIcon(module: () => Promise<{ default: ComponentType }>): ComponentType {
  const cached = lazyIconCache.get(module)
  if (cached) return cached
  const Lazy = lazy(module)
  lazyIconCache.set(module, Lazy)
  return Lazy
}

/**
 * Generic renderer for a registry {@link IconRef} — url / iconify / inline-svg
 * marks are sized by `size` (px); `component`-kind icons size themselves.
 * Shared by the quick-action menus; the icon rail and inspector keep their
 * own copies with bespoke wrappers for now.
 */
export function IconRefGlyph({ icon, size = 16 }: { icon: IconRef; size?: number }) {
  if (icon.kind === 'url') {
    return <img alt="" className="shrink-0 object-contain" height={size} src={icon.src} width={size} />
  }
  if (icon.kind === 'iconify') {
    return <Icon height={size} icon={icon.name} width={size} />
  }
  if (icon.kind === 'svg') {
    return (
      <svg height={size} viewBox={icon.viewBox} width={size}>
        <path d={icon.path} fill="currentColor" />
      </svg>
    )
  }
  const LazyIcon = resolveLazyIcon(icon.module)
  return (
    <Suspense fallback={null}>
      <LazyIcon />
    </Suspense>
  )
}
