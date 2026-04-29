'use client'

import { useState } from 'react'

const USE_CASES = [
  { id: 'personal', label: 'Personal projects', description: 'Solo work and experiments' },
  { id: 'team', label: 'Team collaboration', description: 'Work with colleagues' },
  { id: 'client', label: 'Client work', description: 'Deliver projects for clients' },
]

interface StepUseCaseProps {
  selected?: string
  onNext: (useCase: string) => void
  onBack: () => void
  isPending: boolean
}

export function StepUseCase({ selected, onNext, onBack, isPending }: StepUseCaseProps) {
  const [useCase, setUseCase] = useState(selected ?? '')

  return (
    <div>
      <h2 className="text-xl font-semibold text-white mb-1">How will you use Pascal?</h2>
      <p className="text-sm text-zinc-500 mb-6">We'll suggest relevant features for your workflow.</p>

      <div className="space-y-3 mb-8">
        {USE_CASES.map((u) => (
          <button
            key={u.id}
            type="button"
            onClick={() => setUseCase(u.id)}
            className={`w-full p-4 rounded-xl border text-left transition-all ${
              useCase === u.id
                ? 'border-indigo-500 bg-indigo-500/10 text-white'
                : 'border-zinc-800 bg-zinc-800/50 text-zinc-400 hover:border-zinc-700 hover:text-zinc-300'
            }`}
          >
            <div className="font-medium text-sm">{u.label}</div>
            <div className="text-xs mt-0.5 opacity-70">{u.description}</div>
          </button>
        ))}
      </div>

      <div className="flex gap-3">
        <button
          type="button"
          onClick={onBack}
          disabled={isPending}
          className="flex-1 border border-zinc-800 hover:border-zinc-700 text-zinc-400 hover:text-zinc-300 font-medium py-2.5 rounded-xl text-sm transition-colors"
        >
          Back
        </button>
        <button
          type="button"
          onClick={() => useCase && onNext(useCase)}
          disabled={!useCase || isPending}
          className="flex-1 bg-indigo-500 hover:bg-indigo-400 disabled:opacity-40 disabled:cursor-not-allowed text-white font-medium py-2.5 rounded-xl text-sm transition-colors"
        >
          {isPending ? 'Saving…' : 'Continue'}
        </button>
      </div>
    </div>
  )
}
