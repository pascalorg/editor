import { expect, test } from 'bun:test'
import { Content, Root } from '@radix-ui/react-dropdown-menu'
import { renderToStaticMarkup } from 'react-dom/server'
import useViewer from '../../store/use-viewer'
import { DaylightMenu } from './render-settings-menu'
import { useSkyPanel } from './sky-control'

test('the time menu preserves main’s existing order, with Dawn first', async () => {
  const source = await Bun.file(new URL('./render-settings-menu.tsx', import.meta.url)).text()
  const main = Bun.spawnSync([
    'git',
    'show',
    'origin/main:packages/viewer/src/ui/components/render-settings-menu.tsx',
  ])
  expect(main.exitCode).toBe(0)
  const ids = (text: string) =>
    [
      ...text
        .slice(text.indexOf('function timeOptions'), text.indexOf('function weatherOptions'))
        .matchAll(/id: '(\w+)'/g),
    ].map(([, id]) => id)
  expect(ids(main.stdout.toString())).toEqual(['golden', 'midday', 'blue', 'night'])
  expect(ids(source)).toEqual(['dawn', ...ids(main.stdout.toString())])
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
