import { describe, expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { AgentActivity, type AgentActivityState } from './agent-activity'

const activity: AgentActivityState = {
  runId: 'run-123',
  status: 'running',
  task: { category: 'furnish', label: 'Placing living-room furniture', target: 'Ground floor' },
  completedSteps: 12,
  inFlight: false,
}

function render(overrides: Partial<AgentActivityState> = {}, pending = false) {
  return renderToStaticMarkup(
    <AgentActivity
      activity={{ ...activity, ...overrides }}
      onPause={() => {}}
      onResume={() => {}}
      onStop={() => {}}
      pending={pending}
    />,
  )
}

function button(markup: string, label: string) {
  return [...markup.matchAll(/<button\b[^>]*>[\s\S]*?<\/button>/g)].find((match) =>
    match[0].includes(`>${label}</button>`),
  )?.[0]
}

describe('AgentActivity', () => {
  test('shows the actual task and completed count without a fabricated total', () => {
    const markup = render()
    expect(markup).toContain('Placing living-room furniture')
    expect(markup).toContain('12 steps completed')
    expect(markup).toContain('Ground floor')
    expect(markup).toContain('aria-live="polite"')
    expect(markup).not.toContain('role="progressbar"')
    expect(button(markup, 'Pause and edit')).toBeDefined()
    expect(button(markup, 'Stop')).toBeDefined()
    expect(button(markup, 'Resume')).toBeUndefined()
  })

  test('does not offer human control while pause awaits acknowledgement', () => {
    const markup = render({ status: 'pausing', inFlight: true })
    expect(markup).toContain('Pausing after the current change')
    expect(markup).toContain('Editing stays locked')
    expect(markup).not.toContain('You’re in control')
    expect(button(markup, 'Pause and edit')).toContain('disabled=""')
    expect(button(markup, 'Stop')).not.toContain('disabled=""')
    expect(button(markup, 'Resume')).toBeUndefined()
  })

  test('offers resume only after the host confirms paused and settled', () => {
    const markup = render({ status: 'paused' })
    expect(markup).toContain('Paused · You’re in control')
    expect(markup).toContain('Resume will check the updated scene')
    expect(button(markup, 'Resume')).not.toContain('disabled=""')
    expect(button(markup, 'Pause and edit')).toBeUndefined()
  })

  test('fails closed when a settled status contradicts an in-flight write', () => {
    for (const status of ['paused', 'stopped', 'completed'] as const) {
      const markup = render({ status, inFlight: true })
      expect(markup).toContain('Waiting for the current change to settle')
      expect(markup).toContain('Editing stays locked')
      expect(markup).not.toContain('You’re in control')
      expect(markup).not.toContain('Stopped · Changes kept')
      if (status === 'paused') expect(button(markup, 'Resume')).toContain('disabled=""')
    }
  })

  test('keeps stop and completion truthful and does not offer terminal controls', () => {
    const stopping = render({ status: 'stopping', inFlight: true })
    expect(stopping).toContain('Stopping after the current change')
    expect(stopping).toContain('Editing stays locked')
    const stopped = render({ status: 'stopped' })
    expect(stopped).toContain('Stopped · Changes kept')
    for (const markup of [
      stopping,
      stopped,
      render({ status: 'completed' }),
      render({ status: 'failed' }),
    ]) {
      expect(button(markup, 'Pause and edit')).toBeUndefined()
      expect(button(markup, 'Resume')).toBeUndefined()
      expect(button(markup, 'Stop')).toBeUndefined()
    }
  })

  test('keeps failure locked and escapes host-provided text', () => {
    const markup = render({ status: 'failed', error: '<script>alert("x")</script>' })
    expect(markup).toContain('Editing stays locked until the scene is reconciled.')
    expect(markup).toContain('&lt;script&gt;')
    expect(markup).not.toContain('<script>')
  })

  test('pending host requests disable available actions', () => {
    const running = render({}, true)
    expect(button(running, 'Pause and edit')).toContain('disabled=""')
    expect(button(running, 'Stop')).toContain('disabled=""')
    expect(button(render({ status: 'paused' }, true), 'Resume')).toContain('disabled=""')
    const resuming = render({ status: 'resuming' })
    expect(resuming).toContain('Checking your changes')
    expect(button(resuming, 'Resume')).toBeUndefined()
    expect(button(resuming, 'Stop')).toBeDefined()
  })
})
