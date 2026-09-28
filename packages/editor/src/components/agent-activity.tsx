'use client'

import { Check, ChevronDown, CircleAlert, LoaderCircle, Pause, Play, Square } from 'lucide-react'
import { Button } from './ui/primitives/button'

export type AgentActivityStatus =
  | 'running'
  | 'pausing'
  | 'paused'
  | 'resuming'
  | 'stopping'
  | 'stopped'
  | 'completed'
  | 'failed'

export type AgentActivityCategory = 'plan' | 'structure' | 'furnish' | 'finish' | 'check' | 'edit'

export interface AgentActivityState {
  runId: string
  status: AgentActivityStatus
  task: {
    category: AgentActivityCategory
    label: string
    target?: string
  }
  completedSteps: number
  inFlight: boolean
  error?: string
}

export interface AgentActivityProps {
  activity: AgentActivityState
  onPause: () => void
  onResume: () => void
  onStop: () => void
  pending?: boolean
}

const CATEGORY_LABELS: Record<AgentActivityCategory, string> = {
  plan: 'Plan',
  structure: 'Structure',
  furnish: 'Furnish',
  finish: 'Finish',
  check: 'Check',
  edit: 'Edit',
}

export function AgentActivity({
  activity,
  onPause,
  onResume,
  onStop,
  pending = false,
}: AgentActivityProps) {
  const { status, task, inFlight } = activity
  const awaitingSettlement =
    inFlight && (status === 'paused' || status === 'stopped' || status === 'completed')
  const working =
    awaitingSettlement ||
    status === 'running' ||
    status === 'pausing' ||
    status === 'resuming' ||
    status === 'stopping'
  const canStop =
    status === 'running' || status === 'pausing' || status === 'paused' || status === 'resuming'
  const completedLabel = `${activity.completedSteps} ${activity.completedSteps === 1 ? 'step' : 'steps'} completed`
  const statusLabels: Record<AgentActivityStatus, string> = {
    running: task.label,
    pausing: inFlight ? 'Pausing after the current change…' : 'Waiting for pause confirmation…',
    paused: 'Paused · You’re in control',
    resuming: 'Checking your changes…',
    stopping: inFlight ? 'Stopping after the current change…' : 'Waiting for stop confirmation…',
    stopped: 'Stopped · Changes kept',
    completed: 'Completed',
    failed: 'Needs attention',
  }
  const statusLabel = awaitingSettlement
    ? 'Waiting for the current change to settle…'
    : statusLabels[status]
  const controlMessage =
    status === 'failed'
      ? 'Editing stays locked until the scene is reconciled.'
      : awaitingSettlement
        ? 'Editing stays locked while a change is in progress.'
        : status === 'paused'
          ? 'Make your edits. Resume will check the updated scene before continuing.'
          : status === 'pausing' || status === 'stopping'
            ? 'Editing stays locked until the agent confirms it has stopped writing.'
            : status === 'resuming'
              ? 'Your changes are being checked before the next step.'
              : null
  const StatusIcon = working
    ? LoaderCircle
    : status === 'failed'
      ? CircleAlert
      : status === 'paused'
        ? Pause
        : status === 'stopped'
          ? Square
          : Check

  return (
    <section
      aria-label="AI activity"
      className="pointer-events-auto w-full min-w-0 max-w-md overflow-hidden rounded-xl border border-border/60 bg-background/95 text-foreground shadow-elevation-3 backdrop-blur-xl"
      data-agent-activity={status}
    >
      <div className="flex items-start gap-3 px-4 pt-3.5 pb-3">
        <div className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full border border-border/50 bg-muted/50">
          <StatusIcon
            aria-hidden="true"
            className={`size-4 ${working ? 'motion-safe:animate-spin' : status === 'failed' ? 'text-destructive' : 'text-foreground/80'}`}
          />
        </div>
        <div className="min-w-0 flex-1">
          <div className="mb-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-muted-foreground">
            <span className="font-medium">AI activity</span>
            <span aria-hidden="true">·</span>
            <span>{CATEGORY_LABELS[task.category]}</span>
          </div>
          <p
            aria-atomic="true"
            aria-live="polite"
            className="break-words font-medium text-sm leading-5"
            role="status"
          >
            {statusLabel}
          </p>
          {controlMessage && (
            <p className="mt-1.5 text-muted-foreground text-xs leading-5">{controlMessage}</p>
          )}
          {activity.error && (
            <p className="mt-2 max-h-24 overflow-y-auto whitespace-pre-wrap break-words text-destructive text-xs leading-5">
              {activity.error}
            </p>
          )}
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 px-4 pb-3">
        <span className="text-muted-foreground text-xs tabular-nums">{completedLabel}</span>
        {canStop && (
          <div className="ml-auto flex items-center gap-1.5">
            {(status === 'running' || status === 'pausing') && (
              <Button
                className="rounded-full"
                disabled={pending || status === 'pausing'}
                onClick={onPause}
                size="sm"
                type="button"
                variant="secondary"
              >
                <Pause aria-hidden="true" className="size-3.5" />
                Pause and edit
              </Button>
            )}
            {status === 'paused' && (
              <Button
                className="rounded-full"
                disabled={pending || awaitingSettlement}
                onClick={onResume}
                size="sm"
                type="button"
              >
                <Play aria-hidden="true" className="size-3.5" />
                Resume
              </Button>
            )}
            {canStop && (
              <Button
                className="rounded-full"
                disabled={pending}
                onClick={onStop}
                size="sm"
                type="button"
                variant="ghost"
              >
                <Square aria-hidden="true" className="size-3.5" />
                Stop
              </Button>
            )}
          </div>
        )}
      </div>

      <details className="group border-border/50 border-t">
        <summary className="flex cursor-pointer list-none items-center justify-between px-4 py-2 text-muted-foreground text-xs outline-none hover:bg-muted/40 focus-visible:bg-muted/60 [&::-webkit-details-marker]:hidden">
          Activity details
          <ChevronDown
            aria-hidden="true"
            className="size-3.5 transition-transform group-open:rotate-180 motion-reduce:transition-none"
          />
        </summary>
        <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-2 px-4 pt-1 pb-3 text-xs leading-5">
          <dt className="text-muted-foreground">Task</dt>
          <dd className="break-words">{task.label}</dd>
          {task.target && (
            <>
              <dt className="text-muted-foreground">Target</dt>
              <dd className="break-words">{task.target}</dd>
            </>
          )}
          <dt className="text-muted-foreground">Current change</dt>
          <dd>{inFlight ? 'In progress' : 'None in progress'}</dd>
          <dt className="text-muted-foreground">Run</dt>
          <dd className="break-all font-mono text-[11px]">{activity.runId}</dd>
        </dl>
      </details>
    </section>
  )
}
