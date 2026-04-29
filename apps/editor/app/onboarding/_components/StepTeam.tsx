'use client'

import { useState } from 'react'
import { createWorkspace, saveProgress } from '../actions'
import type { Selections } from './OnboardingFlow'

type TeamAction = 'create' | 'join' | 'skip'

interface StepTeamProps {
  selected?: string
  onNext: (data: { teamAction: TeamAction; teamId?: string }) => void
  onBack: () => void
  isPending: boolean
  currentSelections: Selections
}

export function StepTeam({ selected, onNext, onBack, isPending, currentSelections }: StepTeamProps) {
  const [action, setAction] = useState<TeamAction>((selected as TeamAction) ?? 'skip')
  const [orgName, setOrgName] = useState('')
  const [inviteUrl, setInviteUrl] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const handleNext = async () => {
    setError('')
    if (action === 'create') {
      if (!orgName.trim()) { setError('Enter a team name.'); return }
      setLoading(true)
      const result = await createWorkspace(orgName.trim())
      setLoading(false)
      if (!result.success) { setError(result.error ?? 'Failed to create team.'); return }
      onNext({ teamAction: 'create' })
    } else if (action === 'join') {
      // Extract token from URL or treat input as raw token
      const tokenMatch = inviteUrl.match(/\/invite\/([^/?#]+)/)
      const token = tokenMatch ? tokenMatch[1] : inviteUrl.trim()
      if (!token) { setError('Paste your invite link or token.'); return }
      setLoading(true)
      // Save progress BEFORE redirect so user returns to Step 4, not Step 3
      // The invite route (/invite/[token]) will redirect back to /onboarding,
      // and the saved currentStep=3 + teamAction='join' means they land at Step 3->4 transition.
      // Save step 3 (the completed step index) so onboarding page restores to step 3 (= next step = 4th UI step).
      await saveProgress(3, { ...(currentSelections as Record<string, string>), teamAction: 'join' })
      setLoading(false)
      window.location.href = `/invite/${token}`
    } else {
      onNext({ teamAction: 'skip' })
    }
  }

  return (
    <div>
      <h2 className="text-xl font-semibold text-white mb-1">Set up your team</h2>
      <p className="text-sm text-zinc-500 mb-6">Create a new team, join one with an invite link, or skip for now.</p>

      <div className="space-y-3 mb-4">
        {(['create', 'join', 'skip'] as const).map((opt) => (
          <button
            key={opt}
            type="button"
            onClick={() => { setAction(opt); setError('') }}
            className={`w-full p-4 rounded-xl border text-left transition-all ${
              action === opt
                ? 'border-indigo-500 bg-indigo-500/10 text-white'
                : 'border-zinc-800 bg-zinc-800/50 text-zinc-400 hover:border-zinc-700 hover:text-zinc-300'
            }`}
          >
            <div className="font-medium text-sm">
              {opt === 'create' ? 'Create a new team' : opt === 'join' ? 'Join with invite link' : 'Skip for now'}
            </div>
          </button>
        ))}
      </div>

      {action === 'create' && (
        <input
          type="text"
          placeholder="Team name"
          value={orgName}
          onChange={(e) => setOrgName(e.target.value)}
          className="w-full mb-4 px-4 py-2.5 rounded-xl bg-zinc-800 border border-zinc-700 text-white text-sm placeholder-zinc-500 focus:outline-none focus:border-indigo-500"
        />
      )}

      {action === 'join' && (
        <input
          type="text"
          placeholder="Paste invite link or token"
          value={inviteUrl}
          onChange={(e) => setInviteUrl(e.target.value)}
          className="w-full mb-4 px-4 py-2.5 rounded-xl bg-zinc-800 border border-zinc-700 text-white text-sm placeholder-zinc-500 focus:outline-none focus:border-indigo-500"
        />
      )}

      {error && <p className="text-red-400 text-xs mb-3">{error}</p>}

      <div className="flex gap-3">
        <button
          type="button"
          onClick={onBack}
          disabled={isPending || loading}
          className="flex-1 border border-zinc-800 hover:border-zinc-700 text-zinc-400 hover:text-zinc-300 font-medium py-2.5 rounded-xl text-sm transition-colors"
        >
          Back
        </button>
        <button
          type="button"
          onClick={handleNext}
          disabled={isPending || loading}
          className="flex-1 bg-indigo-500 hover:bg-indigo-400 disabled:opacity-40 disabled:cursor-not-allowed text-white font-medium py-2.5 rounded-xl text-sm transition-colors"
        >
          {loading || isPending ? 'Saving…' : action === 'skip' ? 'Skip' : 'Continue'}
        </button>
      </div>
    </div>
  )
}
