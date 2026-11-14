import { spyOn } from 'bun:test'
import * as editor from '@pascal-app/editor'
import React, { type ReactElement, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

type ControlKind = 'FinishSwatch' | 'SegmentedControl' | 'SliderControl' | 'ToggleControl'
type ControlProps = Record<string, any>
export type PanelControl = { kind: ControlKind; section: string; props: ControlProps }

/**
 * Renders a kind's panel from the stores' current state (no DOM: a server render) and records,
 * for each control, the section it sits in and the props it got, so a test reads what a control
 * shows and calls its `onChange` as a click would. The panel chrome renders open.
 */
export function renderPanelControls(panel: ReactElement): PanelControl[] {
  const controls: PanelControl[] = []
  // The server renderer runs a section's children before the next section, so the last one seen
  // is the one a control sits in.
  let section = ''
  const spies = [
    spyOn(editor, 'PanelWrapper').mockImplementation((({ children }: { children: ReactNode }) => (
      <>{children}</>
    )) as never),
    spyOn(editor, 'PanelSection').mockImplementation((({
      title,
      children,
    }: {
      title: string
      children: ReactNode
    }) => {
      section = title
      return <>{children}</>
    }) as never),
    ...(['FinishSwatch', 'SegmentedControl', 'SliderControl', 'ToggleControl'] as const).map(
      (kind) =>
        spyOn(editor, kind).mockImplementation(((props: ControlProps) => {
          controls.push({ kind, section, props })
          return null
        }) as never),
    ),
  ]
  // A server render reads a store's startup state; read the current one instead.
  const useSyncExternalStore = React.useSyncExternalStore
  spies.push(
    spyOn(React, 'useSyncExternalStore').mockImplementation((subscribe, getSnapshot) =>
      useSyncExternalStore(subscribe, getSnapshot, getSnapshot),
    ),
  )
  try {
    renderToStaticMarkup(panel)
  } finally {
    for (const spy of spies) spy.mockRestore()
  }
  return controls
}

/** The one control of `kind` in `section` (and with `label`, when given); throws when not one. */
export function control(
  controls: PanelControl[],
  kind: ControlKind,
  section: string,
  label?: string,
): ControlProps {
  const found = controls.filter(
    (c) =>
      c.kind === kind && c.section === section && (label === undefined || c.props.label === label),
  )
  if (found.length !== 1) {
    throw new Error(`expected one ${kind} ${label ?? ''} in ${section}, found ${found.length}`)
  }
  return found[0]!.props
}

export function sections(controls: PanelControl[]): Set<string> {
  return new Set(controls.map((c) => c.section))
}
