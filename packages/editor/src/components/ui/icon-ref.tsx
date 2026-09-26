'use client'

import { Icon } from '@iconify/react'
import type { IconRef } from '@pascal-app/core'
import { type ComponentType, lazy, Suspense } from 'react'
import { cn } from '../../lib/utils'

const SVG_DATA_URI = /^data:image\/svg\+xml[^,]*,/

/** Whether a `data:image/svg+xml` URI's markup paints with `currentColor`. */
function isCurrentColorSvg(src: string): boolean {
  const head = SVG_DATA_URI.exec(src)
  if (!head) return false
  const body = src.slice(head[0].length)
  try {
    const markup = head[0].includes(';base64') ? atob(body) : decodeURIComponent(body)
    return markup.includes('currentColor')
  } catch {
    return false
  }
}

/**
 * A `url`-kind icon. An SVG behind an `<img>` renders in its own document, so
 * `currentColor` in the markup resolves to black rather than the surrounding
 * text colour — a monochrome plugin glyph then disappears against the dark
 * sidebar. Such an SVG becomes a CSS mask over the text colour instead. Plugin
 * manifests are third-party, so the markup is never inlined into the page.
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
  const style = size === undefined ? undefined : { height: size, width: size }
  if (!isCurrentColorSvg(src)) return <img alt="" className={className} src={src} style={style} />
  const mask = `url("${src.replace(/["\\\n\r]/g, encodeURIComponent)}") center / contain no-repeat`
  return (
    <span
      aria-hidden
      className={cn('inline-block bg-current', className)}
      style={{ ...style, mask, WebkitMask: mask }}
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
