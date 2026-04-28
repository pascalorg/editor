'use client'

import { X } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import Image from 'next/image'
import { type ReactNode, useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import useEditor from '../../../store/use-editor'

interface MobilePanelSheetProps {
  open: boolean
  onClose: () => void
  icon?: string
  title: string
  children: ReactNode
}

const HEIGHT_VH = 50
const DRAG_CLOSE_THRESHOLD_PX = 120

export function MobilePanelSheet({ open, onClose, icon, title, children }: MobilePanelSheetProps) {
  const [mounted, setMounted] = useState(false)
  const setMobilePanelSheetHeight = useEditor((s) => s.setMobilePanelSheetHeight)

  useEffect(() => {
    setMounted(true)
  }, [])

  // Publish the sheet's pixel height to the shared store so the mobile layout
  // can shrink the viewer container and preview edits live. 0 means closed.
  // Tracks visualViewport so the value follows the on-screen keyboard on iOS.
  useEffect(() => {
    if (!open) {
      setMobilePanelSheetHeight(0)
      return
    }
    const compute = () => {
      const vh = window.visualViewport?.height ?? window.innerHeight
      setMobilePanelSheetHeight(Math.round((vh * HEIGHT_VH) / 100))
    }
    compute()
    const vv = window.visualViewport
    vv?.addEventListener('resize', compute)
    window.addEventListener('resize', compute)
    return () => {
      vv?.removeEventListener('resize', compute)
      window.removeEventListener('resize', compute)
      setMobilePanelSheetHeight(0)
    }
  }, [open, setMobilePanelSheetHeight])

  if (!mounted) return null

  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div
          animate={{ y: 0 }}
          className="dark fixed right-0 bottom-0 left-0 z-[60] flex flex-col overflow-hidden rounded-t-2xl bg-sidebar text-sidebar-foreground shadow-[0_-8px_24px_rgba(0,0,0,0.24)]"
          drag="y"
          dragConstraints={{ top: 0, bottom: 0 }}
          dragElastic={{ top: 0, bottom: 0.4 }}
          exit={{ y: '100%' }}
          initial={{ y: '100%' }}
          onDragEnd={(_, info) => {
            if (info.offset.y > DRAG_CLOSE_THRESHOLD_PX) onClose()
          }}
          style={{ height: `${HEIGHT_VH}dvh` }}
          transition={{ type: 'spring', stiffness: 320, damping: 32, mass: 0.8 }}
        >
          <div className="flex h-6 shrink-0 cursor-grab touch-none items-center justify-center active:cursor-grabbing">
            <div className="h-1 w-10 rounded-full bg-muted-foreground/40" />
          </div>

          <div className="flex shrink-0 items-center justify-between border-border/50 border-b px-3 pt-1 pb-3">
            <div className="flex min-w-0 items-center gap-2">
              {icon && (
                <Image
                  alt=""
                  className="shrink-0 object-contain"
                  height={18}
                  src={icon}
                  width={18}
                />
              )}
              <h2 className="truncate font-semibold text-foreground text-sm tracking-tight">
                {title}
              </h2>
            </div>
            <button
              aria-label="Close"
              className="flex h-8 w-8 items-center justify-center rounded-md bg-[#2C2C2E] text-muted-foreground transition-colors hover:bg-[#3e3e3e] hover:text-foreground"
              onClick={onClose}
              type="button"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <div className="no-scrollbar flex min-h-0 flex-1 flex-col overflow-y-auto">
            {children}
          </div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  )
}
