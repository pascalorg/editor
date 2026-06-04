'use client'

import { useRouter } from 'next/navigation'
import { ImportDxfTool } from '@/components/tools/ImportDxfTool'

export default function ImportDxfPage() {
  const router = useRouter()

  const close = () => {
    if (window.parent && window.parent !== window) {
      window.parent.postMessage({ type: 'pascal:dxf-import-close' }, window.location.origin)
      return
    }
    router.push('/scenes')
  }

  return (
    <main
      className="flex min-h-screen items-start justify-center overflow-y-auto bg-black/50 px-4 pt-16 pb-8 backdrop-blur-sm"
      onClick={(event) => {
        if (event.target === event.currentTarget) close()
      }}
    >
        <ImportDxfTool
          onClose={close}
          onDone={({ buildingId }) => {
            const target = `/_pascal/scene/${buildingId}`
            if (window.parent && window.parent !== window) {
              window.parent.postMessage({ type: 'pascal:dxf-import-complete', target }, window.location.origin)
              return
            }
            router.push(target)
          }}
        />
    </main>
  )
}
