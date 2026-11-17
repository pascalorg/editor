import { expect, test } from 'bun:test'
import { Content, Root } from '@radix-ui/react-dropdown-menu'
import { Children, type ReactElement, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import useViewer from '../../store/use-viewer'
import { DaylightMenu } from './render-settings-menu'
import { useSkyPanel } from './sky-control'

test('the time menu preserves the existing order, with Dawn first', () => {
  function TimeEntries() {
    const timeMenu = Children.toArray(DaylightMenu({}).props.children)[0] as ReactElement<{
      children: ReactNode
    }>
    const content = Children.toArray(timeMenu.props.children)[1] as ReactElement<{
      children: [ReactNode, ReactNode]
    }>
    return content.props.children[0]
  }
  const panel = useSkyPanel.getState()
  try {
    useSkyPanel.setState({ hosts: 0 })
    const html = renderToStaticMarkup(
      <Root>
        <Content forceMount>
          <TimeEntries />
        </Content>
      </Root>,
    )
    const entries = [...html.matchAll(/role="menuitem"[^>]*>[\s\S]*?<span>([^<]*)<\/span>/g)].map(
      ([, name]) => name,
    )
    // Pins the time entry order before this change, with Dawn prepended.
    expect(entries).toEqual(['Dawn', 'Golden hour', 'Midday', 'Blue hour', 'Night'])
  } finally {
    useSkyPanel.setState(panel, true)
  }
})

test('an unknown time still falls back to Midday in the menu', () => {
  const viewer = useViewer.getState()
  const panel = useSkyPanel.getState()
  try {
    useViewer.setState({ timeOfDay: 'unknown' as never })
    useSkyPanel.setState({ hosts: 0 })
    const html = renderToStaticMarkup(
      <Root>
        <Content forceMount>
          <DaylightMenu />
        </Content>
      </Root>,
    )
    expect(html).toMatch(/>Time of day<\/span><span[^>]*>Midday<\/span>/)
  } finally {
    useViewer.setState(viewer, true)
    useSkyPanel.setState(panel, true)
  }
})
