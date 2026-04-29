'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Plus } from 'lucide-react'
import { createProject } from '../actions'

export function NewProjectCard() {
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [loading, setLoading] = useState(false)
  const router = useRouter()

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim()) return
    setLoading(true)
    try {
      const result = await createProject(name.trim())
      if (result?.id) router.push(`/editor/${result.id}`)
      else router.refresh()
    } finally {
      setLoading(false)
      setOpen(false)
      setName('')
    }
  }

  if (open) {
    return (
      <div className="rounded-2xl border border-indigo-500/30 bg-indigo-500/[0.05] p-5 flex flex-col justify-center min-h-[200px]">
        <p className="text-sm font-semibold text-white mb-3">New project</p>
        <form onSubmit={handleCreate} className="space-y-2">
          <input
            autoFocus
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Project name"
            className="w-full bg-white/[0.06] border border-white/[0.1] text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-indigo-500/50 placeholder:text-zinc-600"
          />
          <div className="flex gap-2">
            <button
              type="submit"
              disabled={loading || !name.trim()}
              className="flex-1 py-1.5 bg-indigo-500 hover:bg-indigo-400 disabled:opacity-40 text-white text-xs font-semibold rounded-lg transition-all"
            >
              {loading ? 'Creating…' : 'Create'}
            </button>
            <button
              type="button"
              onClick={() => { setOpen(false); setName('') }}
              className="px-3 py-1.5 text-zinc-500 hover:text-zinc-300 text-xs rounded-lg hover:bg-white/[0.04] transition-all"
            >
              Cancel
            </button>
          </div>
        </form>
      </div>
    )
  }

  return (
    <button
      onClick={() => setOpen(true)}
      className="rounded-2xl border border-dashed border-white/[0.1] hover:border-indigo-500/40 bg-transparent hover:bg-indigo-500/[0.03] transition-all flex flex-col items-center justify-center gap-3 min-h-[200px] group"
    >
      <div className="w-10 h-10 rounded-full border border-white/[0.12] group-hover:border-indigo-500/40 flex items-center justify-center transition-all">
        <Plus className="w-5 h-5 text-zinc-500 group-hover:text-indigo-400 transition-colors" />
      </div>
      <div className="text-center">
        <p className="text-[13px] font-medium text-zinc-500 group-hover:text-zinc-300 transition-colors">New project</p>
        <p className="text-[11px] text-zinc-700 mt-0.5">or import .ifc / .rvt / .skp</p>
      </div>
    </button>
  )
}
