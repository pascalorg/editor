'use client'

import { useState } from 'react'

const ROLES = [
  { id: 'architect', label: 'Architect', description: 'Professional architectural design' },
  { id: 'designer', label: 'Interior Designer', description: 'Interior space planning' },
  { id: 'homeowner', label: 'Homeowner', description: 'Personal renovation projects' },
  { id: 'student', label: 'Student', description: 'Learning and academic work' },
]

interface StepRoleProps {
  selected?: string
  onNext: (role: string) => void
  isPending: boolean
}

export function StepRole({ selected, onNext, isPending }: StepRoleProps) {
  const [role, setRole] = useState(selected ?? '')

  return (
    <div>
      <h2 className="text-xl font-semibold text-white mb-1">What describes you best?</h2>
      <p className="text-sm text-zinc-500 mb-6">This helps us tailor your experience.</p>

      <div className="grid grid-cols-2 gap-3 mb-8">
        {ROLES.map((r) => (
          <button
            key={r.id}
            type="button"
            onClick={() => setRole(r.id)}
            className={`p-4 rounded-xl border text-left transition-all ${
              role === r.id
                ? 'border-indigo-500 bg-indigo-500/10 text-white'
                : 'border-zinc-800 bg-zinc-800/50 text-zinc-400 hover:border-zinc-700 hover:text-zinc-300'
            }`}
          >
            <div className="font-medium text-sm">{r.label}</div>
            <div className="text-xs mt-0.5 opacity-70">{r.description}</div>
          </button>
        ))}
      </div>

      <button
        type="button"
        onClick={() => role && onNext(role)}
        disabled={!role || isPending}
        className="w-full bg-indigo-500 hover:bg-indigo-400 disabled:opacity-40 disabled:cursor-not-allowed text-white font-medium py-2.5 rounded-xl text-sm transition-colors"
      >
        {isPending ? 'Saving…' : 'Continue'}
      </button>
    </div>
  )
}
