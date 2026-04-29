'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Building2, ArrowRight } from 'lucide-react'
import { createWorkspace } from '../../onboarding/actions'

export function CreateWorkspacePrompt() {
  const [name, setName] = useState('')
  const [error, setError] = useState('')
  const [isPending, startTransition] = useTransition()
  const router = useRouter()

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (name.trim().length < 2) {
      setError('Name must be at least 2 characters.')
      return
    }
    setError('')
    startTransition(async () => {
      const result = await createWorkspace(name.trim())
      if (result.success) {
        router.refresh()
      } else {
        setError(result.error ?? 'Could not create workspace. Try again.')
      }
    })
  }

  return (
    <div className="flex items-center justify-center min-h-screen p-4">
      <div className="w-full max-w-sm text-center">
        <div className="w-16 h-16 rounded-2xl bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center mx-auto mb-6">
          <Building2 className="w-8 h-8 text-indigo-400" />
        </div>
        <h2 className="text-xl font-bold text-white mb-2">Set up your workspace</h2>
        <p className="text-zinc-500 text-sm mb-8">
          Create a workspace to organize your projects and invite collaborators.
        </p>
        <form onSubmit={handleSubmit} className="space-y-3">
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Workspace name"
            className="w-full bg-white/[0.04] border border-white/[0.08] text-white rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:border-indigo-500/40 transition-all placeholder:text-zinc-600"
            autoFocus
          />
          {error && (
            <p className="text-red-400 text-xs text-left">{error}</p>
          )}
          <button
            type="submit"
            disabled={isPending || name.trim().length < 2}
            className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-indigo-500 hover:bg-indigo-400 disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-semibold rounded-xl transition-all"
          >
            {isPending ? (
              <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
            ) : (
              <>Create workspace <ArrowRight className="w-4 h-4" /></>
            )}
          </button>
        </form>
      </div>
    </div>
  )
}
