'use client'

import { Icon } from '@iconify/react'
import type { IconRef } from '@pascal-app/core'
import { type ComponentType, lazy, Suspense } from 'react'
import { cn } from '../../lib/utils'

const SVG_DATA_URI = /^data:image\/svg\+xml[^,]*,/

/** The markup inside a `data:image/svg+xml` URI, or null for any other source. */
function svgDataUri(src: string): string | null {
  const head = SVG_DATA_URI.exec(src)
  if (!head) return null
  const body = src.slice(head[0].length)
  try {
    return head[0].includes(';base64') ? atob(body) : decodeURIComponent(body)
  } catch {
    return null
  }
}

/**
 * A `url`-kind icon. An SVG behind an `<img>` renders in its own document, so
 * `currentColor` in the markup resolves to black rather than the surrounding
 * text colour — a monochrome plugin glyph then disappears against the dark
 * sidebar. Inline a data-URI SVG instead so it inherits the theme's text
 * token; raster and file-URL icons stay an `<img>`.
 */
export function IconRefImage({
  className,
  size,
  src,
}: {
  className?: string
  size?: number
  src: string
}) {
  const markup = svgDataUri(src)
  const style = size === undefined ? undefined : { height: size, width: size }
  if (markup === null) return <img alt="" className={className} src={src} style={style} />
  return (
    <span
      aria-hidden
      className={cn('inline-flex items-center justify-center [&>svg]:h-full [&>svg]:w-full', className)}
      // Plugin-authored icon markup, not user content.
      dangerouslySetInnerHTML={{ __html: markup }}
      style={style}
    />
  )
}

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
    return <IconRefImage className="shrink-0" size={size} src={icon.src} />
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
