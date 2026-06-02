'use client'

import { FileUp } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { createPortal } from 'react-dom'
import { ImportDxfTool } from '@/components/tools/ImportDxfTool'

export function ImportDxfButton() {
  const [open, setOpen] = useState(false)
  const router = useRouter()

  return (
    <>
      <button
        className="inline-flex items-center gap-1.5 rounded-md border border-border bg-accent px-3 py-1.5 font-medium text-sm hover:bg-accent/80"
        onClick={() => setOpen(true)}
        type="button"
      >
        <FileUp className="h-3.5 w-3.5" />
        导入 DXF
      </button>

      {open && createPortal(
        <div
          className="fixed inset-0 z-[9999] flex items-start justify-center overflow-y-auto bg-black/50 pt-16 pb-8 backdrop-blur-sm"
          onClick={(e) => { if (e.target === e.currentTarget) setOpen(false) }}
        >
          <ImportDxfTool
            onClose={() => setOpen(false)}
            onDone={({ buildingId }) => {
              setOpen(false)
              router.push(`/scene/${buildingId}`)
            }}
          />
        </div>,
        document.body,
      )}
    </>
  )
}
