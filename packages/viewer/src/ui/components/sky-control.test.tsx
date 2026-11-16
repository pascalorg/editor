import { expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { SkyPanel } from './sky-control'

test('time cards keep labels and 11:45 AM on one line with the original 71.5px vertical budget', () => {
  const html = renderToStaticMarkup(
    <SkyPanel
      sky={{
        minutes: 705,
        clock: 705,
        phase: 'midday',
        activePreset: 'midday',
        presets: { dawn: 360, midday: 705, golden: 1020, blue: 1140, night: 1320 },
        events: { sunrise: 360, sunset: 1080 },
        skyLive: false,
        weather: 'fair',
        source: 'site',
      }}
    />,
  )
  const row = html.slice(html.indexOf('class="grid'), html.indexOf('Follow the clock'))
  expect(row).toContain('grid-cols-5 gap-1')
  const cards = [...row.matchAll(/<button\b[\s\S]*?<\/button>/g)].map(([card]) => card)
  expect(cards).toHaveLength(5)
  for (const card of cards) {
    expect(card).toContain('px-0.5')
    expect(card).toContain('py-2')
    expect(card).toContain('whitespace-nowrap text-[10px] leading-[15px]')
    expect(card).toContain('whitespace-nowrap font-mono text-[10px] leading-[16.5px]')
  }
  // 2 border + 16 padding + 18 icon/margin + 4 gaps + 15 label + 16.5 detail.
})

test('the rising golden phase is named Dawn in the panel badge', () => {
  const html = renderToStaticMarkup(
    <SkyPanel
      sky={{
        minutes: 360,
        clock: 360,
        phase: 'dawn',
        activePreset: 'dawn',
        presets: { dawn: 360, midday: 720, golden: 1020, blue: 1140, night: 1320 },
        events: { sunrise: 360, sunset: 1080 },
        skyLive: false,
        weather: 'fair',
        source: 'site',
      }}
    />,
  )
  expect(html).toMatch(/rounded-full bg-muted[^>]*>Dawn<\/span>/)
})

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
