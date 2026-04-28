'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Download, Loader2, Check } from 'lucide-react'

export function CloneButton({ assetId, isAuthenticated }: { assetId: string; isAuthenticated: boolean }) {
  const router = useRouter()
  const [state, setState] = useState<'idle' | 'loading' | 'done'>('idle')

  async function handleClone() {
    if (!isAuthenticated) {
      router.push('/login')
      return
    }
    setState('loading')
    try {
      const res = await fetch('/api/marketplace/clone', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ assetId }),
      })
      if (!res.ok) throw new Error('Clone failed')
      const { projectId } = await res.json() as { projectId: string }
      setState('done')
      setTimeout(() => router.push(`/editor/${projectId}`), 800)
    } catch {
      setState('idle')
    }
  }

  return (
    <button
      onClick={handleClone}
      disabled={state !== 'idle'}
      className={`w-full flex items-center justify-center gap-2 py-2.5 px-4 rounded-xl font-semibold text-sm transition-all ${
        state === 'done'
          ? 'bg-emerald-500/15 border border-emerald-500/25 text-emerald-400'
          : 'bg-gradient-to-r from-indigo-500 to-violet-600 text-white hover:opacity-90 disabled:opacity-60 shadow-lg shadow-indigo-500/20'
      }`}
    >
      {state === 'loading' && <Loader2 className="w-4 h-4 animate-spin" />}
      {state === 'done' && <Check className="w-4 h-4" />}
      {state === 'idle' && <Download className="w-4 h-4" />}
      {state === 'done' ? 'Opening project…' : 'Clone to Drafts'}
    </button>
  )
}
