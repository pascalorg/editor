'use client'

import { useState, useEffect } from 'react'
import { getFirstTeamId, createProject } from '../../dashboard/actions'

interface StepProjectProps {
  onNext: (data: { projectAction: 'blank' | 'skip'; projectId?: string }) => void
  onBack: () => void
  isPending: boolean
}

export function StepProject({ onNext, onBack, isPending }: StepProjectProps) {
  const [projectName, setProjectName] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [teamId, setTeamId] = useState<string | null>(null)
  const [teamLoading, setTeamLoading] = useState(true)

  // Fetch user's first team on mount (created in Step 3, or pre-existing)
  useEffect(() => {
    getFirstTeamId().then((id) => {
      setTeamId(id)
      setTeamLoading(false)
    })
  }, [])

  const handleCreate = async () => {
    if (!projectName.trim()) { setError('Enter a project name.'); return }
    if (!teamId) { setError('No team found. You can skip and create a project from the dashboard.'); return }
    setLoading(true)
    setError('')
    try {
      const result = await createProject(teamId, projectName.trim(), '')
      // createProject now returns { id: string } — pass it to onNext so
      // OnboardingFlow can redirect to /editor/[projectId] instead of /dashboard
      onNext({ projectAction: 'blank', projectId: result.id })
    } catch {
      setError('Failed to create project. Try again.')
      setLoading(false)
    }
  }

  return (
    <div>
      <h2 className="text-xl font-semibold text-white mb-1">Start your first project</h2>
      <p className="text-sm text-zinc-500 mb-6">
        {teamLoading ? 'Loading…' : teamId ? 'Name your first project or skip to explore the dashboard.' : 'Skip to explore the dashboard — you can create projects from there.'}
      </p>

      {teamId && (
        <input
          type="text"
          placeholder="My first project"
          value={projectName}
          onChange={(e) => setProjectName(e.target.value)}
          disabled={teamLoading || loading}
          className="w-full mb-4 px-4 py-2.5 rounded-xl bg-zinc-800 border border-zinc-700 text-white text-sm placeholder-zinc-500 focus:outline-none focus:border-indigo-500 disabled:opacity-40"
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
        {teamId && (
          <button
            type="button"
            onClick={handleCreate}
            disabled={!projectName.trim() || loading || isPending || teamLoading}
            className="flex-1 bg-indigo-500 hover:bg-indigo-400 disabled:opacity-40 disabled:cursor-not-allowed text-white font-medium py-2.5 rounded-xl text-sm transition-colors"
          >
            {loading || isPending ? 'Creating…' : 'Create project'}
          </button>
        )}
        <button
          type="button"
          onClick={() => onNext({ projectAction: 'skip' })}
          disabled={isPending || loading}
          className="flex-1 border border-zinc-800 hover:border-zinc-700 text-zinc-400 hover:text-zinc-300 font-medium py-2.5 rounded-xl text-sm transition-colors"
        >
          {isPending ? 'Going to dashboard…' : 'Skip'}
        </button>
      </div>
    </div>
  )
}
