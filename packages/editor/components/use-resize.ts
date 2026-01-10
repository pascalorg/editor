import { useEffect, useRef, useState } from 'react'

interface UseResizeOptions {
  minWidth?: number
  maxWidth?: number
  onWidthChange?: (width: number) => void
}

interface UseResizeReturn {
  isResizing: boolean
  sidebarRef: React.RefObject<HTMLDivElement | null>
  startResizing: () => void
}

export function useResize(options: UseResizeOptions = {}): UseResizeReturn {
  const { minWidth = 200, maxWidth = 600, onWidthChange } = options

  const [isResizing, setIsResizing] = useState(false)
  const sidebarRef = useRef<HTMLDivElement>(null)

  // Handle mouse move during resize
  useEffect(() => {
    if (!isResizing) return

    const handleWidth = 8
    const sidebarLeftGap = 10
    const handleMouseMove = (e: MouseEvent) => {
      const newWidth = Math.max(minWidth, Math.min(maxWidth, e.clientX + sidebarLeftGap + handleWidth / 2))
      onWidthChange?.(newWidth)
    }

    const handleMouseUp = () => {
      setIsResizing(false)
    }

    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mouseup', handleMouseUp)

    return () => {
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
    }
  }, [isResizing, minWidth, maxWidth, onWidthChange])

  const startResizing = () => setIsResizing(true)


  return {
    isResizing,
    sidebarRef,
    startResizing,
  }
}
