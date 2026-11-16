import { expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { SkyPanel } from './sky-control'

test('the five time presets occupy one intentional row in chronological order', () => {
  const html = renderToStaticMarkup(
    <SkyPanel
      sky={{
        minutes: 720,
        clock: 720,
        phase: 'midday',
        activePreset: 'midday',
        presets: { dawn: 360, midday: 720, golden: 1020, blue: 1140, night: 1320 },
        events: { sunrise: 360, sunset: 1080 },
        skyLive: false,
        weather: 'fair',
        source: 'site',
      }}
    />,
  )
  const presets = html.slice(html.indexOf('class="grid'), html.indexOf('Cloud cover'))
  expect(presets).toContain('grid-cols-5')
  const labels = ['Dawn', 'Midday', 'Golden hour', 'Blue hour', 'Night']
  const positions = labels.map((label) => presets.indexOf(`>${label}</span>`))
  expect(positions.every((position) => position >= 0)).toBe(true)
  expect(positions).toEqual([...positions].sort((a, b) => a - b))
})
