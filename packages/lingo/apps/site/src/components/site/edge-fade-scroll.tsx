'use client'

import { type ReactNode, useEffect, useRef, useState } from 'react'

import { cn } from '@/lib/utils'

interface EdgeFadeScrollProps {
  axis?: 'x' | 'y'
  children: ReactNode
  className?: string
}

export function EdgeFadeScroll({ children, className, axis = 'x' }: EdgeFadeScrollProps) {
  const ref = useRef<HTMLDivElement | null>(null)
  const [fade, setFade] = useState({
    before: false,
    after: false,
  })

  useEffect(() => {
    const element = ref.current
    if (!element) {
      return
    }
    const node = element

    function updateFade() {
      const maxScroll =
        axis === 'x' ? node.scrollWidth - node.clientWidth : node.scrollHeight - node.clientHeight
      const scroll = axis === 'x' ? node.scrollLeft : node.scrollTop
      const next = {
        before: scroll > 1,
        after: maxScroll > 1 && scroll < maxScroll - 1,
      }
      setFade((current) =>
        current.before === next.before && current.after === next.after ? current : next,
      )
    }

    updateFade()
    node.addEventListener('scroll', updateFade, { passive: true })
    const resizeObserver = new ResizeObserver(updateFade)
    resizeObserver.observe(node)
    if (node.firstElementChild) {
      resizeObserver.observe(node.firstElementChild)
    }
    const frame = window.requestAnimationFrame(updateFade)

    return () => {
      window.cancelAnimationFrame(frame)
      resizeObserver.disconnect()
      node.removeEventListener('scroll', updateFade)
    }
  }, [axis])

  return (
    <div
      className={cn(
        axis === 'x'
          ? 'edge-fade-scroll code-scroll w-full min-w-0 max-w-full overflow-x-hidden overscroll-x-none'
          : 'edge-fade-scroll-y code-scroll w-full min-w-0 max-w-full overflow-y-auto overscroll-contain',
        className,
      )}
      data-fade-b={axis === 'y' && fade.after ? '' : undefined}
      data-fade-l={axis === 'x' && fade.before ? '' : undefined}
      data-fade-r={axis === 'x' && fade.after ? '' : undefined}
      data-fade-t={axis === 'y' && fade.before ? '' : undefined}
      ref={ref}
    >
      {children}
    </div>
  )
}
