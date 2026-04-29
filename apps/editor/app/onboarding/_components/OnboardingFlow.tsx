'use client'

import { useState, useTransition } from 'react'
import { useSession } from 'next-auth/react'
import { useRouter } from 'next/navigation'
import { saveProgress, completeOnboarding } from '../actions'
import { StepRole } from './StepRole'
import { StepUseCase } from './StepUseCase'
import { StepTeam } from './StepTeam'
import { StepProject } from './StepProject'

export type Selections = {
  role?: string
  useCase?: string
  teamAction?: 'create' | 'join' | 'skip'
  teamId?: string
  projectAction?: 'blank' | 'skip'
  projectId?: string
}

const TOTAL_STEPS = 4

const STEP_LABELS = ['Your role', 'Use case', 'Team', 'First project']

interface OnboardingFlowProps {
  initialStep: number
  initialSelections: Record<string, string>
}

export function OnboardingFlow({ initialStep, initialSelections }: OnboardingFlowProps) {
  const [step, setStep] = useState(Math.min(initialStep, TOTAL_STEPS - 1))
  const [selections, setSelections] = useState<Selections>(initialSelections as Selections)
  const [isPending, startTransition] = useTransition()
  const { update } = useSession()
  const router = useRouter()

  const handleNext = (newSelections: Partial<Selections>) => {
    const merged: Selections = { ...selections, ...newSelections }
    setSelections(merged)

    startTransition(async () => {
      const nextStep = step + 1

      if (nextStep >= TOTAL_STEPS) {
        // Final step — complete onboarding
        await saveProgress(nextStep, merged as Record<string, string>)
        await completeOnboarding()
        await update() // CRITICAL: refreshes JWT so middleware sees onboardingComplete=true
        // If a projectId was returned from createProject, open the editor; otherwise dashboard
        router.push(merged.projectId ? `/editor/${merged.projectId}` : '/dashboard')
      } else {
        await saveProgress(nextStep, merged as Record<string, string>)
        setStep(nextStep)
      }
    })
  }

  const handleBack = () => {
    setStep((s) => Math.max(0, s - 1))
  }

  return (
    <div className="w-full max-w-xl px-4">
      {/* Progress indicator */}
      <div className="flex items-center gap-2 mb-8">
        {STEP_LABELS.map((label, i) => (
          <div key={label} className="flex items-center gap-2">
            <div className={`flex items-center justify-center w-6 h-6 rounded-full text-xs font-medium transition-colors ${
              i < step
                ? 'bg-indigo-500 text-white'
                : i === step
                ? 'bg-indigo-500/20 border border-indigo-500 text-indigo-400'
                : 'bg-zinc-800 text-zinc-600'
            }`}>
              {i < step ? '✓' : i + 1}
            </div>
            <span className={`text-xs hidden sm:block ${i === step ? 'text-zinc-300' : 'text-zinc-600'}`}>
              {label}
            </span>
            {i < TOTAL_STEPS - 1 && <div className="w-6 h-px bg-zinc-800" />}
          </div>
        ))}
      </div>

      {/* Step content */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-8">
        {step === 0 && (
          <StepRole
            selected={selections.role}
            onNext={(role) => handleNext({ role })}
            isPending={isPending}
          />
        )}
        {step === 1 && (
          <StepUseCase
            selected={selections.useCase}
            onNext={(useCase) => handleNext({ useCase })}
            onBack={handleBack}
            isPending={isPending}
          />
        )}
        {step === 2 && (
          <StepTeam
            selected={selections.teamAction}
            onNext={(teamData) => handleNext(teamData)}
            onBack={handleBack}
            isPending={isPending}
            currentSelections={selections}
          />
        )}
        {step === 3 && (
          <StepProject
            onNext={(projectData) => handleNext(projectData)}
            onBack={handleBack}
            isPending={isPending}
          />
        )}
      </div>

      {/* Step counter */}
      <p className="text-center text-xs text-zinc-600 mt-4">
        Step {step + 1} of {TOTAL_STEPS}
      </p>
    </div>
  )
}
