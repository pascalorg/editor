import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from 'bun:test'
import {
  type AnyNodeDefinition,
  BaseNode,
  loadPlugin,
  nodeRegistry,
  nodeType,
  objectId,
  useScene,
} from '@pascal-app/core'
import type { ConstructionRevealLevel } from '@pascal-app/viewer'
import { renderToStaticMarkup } from 'react-dom/server'
import useConstructionReveal, {
  chooseConstructionLevel,
  FRAMING_KIND,
  resolveConstructionLevel,
} from '../../../../../store/use-construction-reveal'
import { AnimationSpeedSetting } from './animation-speed-setting'
import {
  ConstructionAnimationSetting,
  constructionLevelOptions,
  FRAMING_NEEDS_ARCHITECT,
} from './construction-animation-setting'

// The framing plugin carries the Framing level: without it in the project the choice is greyed out with the
// reason as its tip, and the level that plays is Full.

const framing = {
  kind: FRAMING_KIND,
  schemaVersion: 1,
  schema: BaseNode.extend({ id: objectId('framing'), type: nodeType(FRAMING_KIND) }),
  category: 'structure',
  defaults: () => ({}),
  capabilities: {},
  geometry: () => null,
} as unknown as AnyNodeDefinition

let restore: () => void = () => {}
beforeAll(async () => {
  restore = nodeRegistry._snapshot()
  nodeRegistry._reset()
  await loadPlugin({ id: 'fixture:framing', apiVersion: 1, nodes: [framing] })
})
afterAll(() => restore())

// A server render reads a store's initial state, so the state to draw is put there.
const sceneInitial = useScene.getInitialState() as { installedPlugins: string[] }
const revealInitial = useConstructionReveal.getInitialState() as {
  level: string
  chosen: boolean
  speed: number
}
const was = { plugins: sceneInitial.installedPlugins, ...revealInitial }

function project(options: { installed: boolean; level?: string; chosen?: boolean; speed?: number }) {
  sceneInitial.installedPlugins = options.installed ? ['fixture:framing'] : []
  revealInitial.level = options.level ?? 'full'
  revealInitial.chosen = options.chosen ?? false
  revealInitial.speed = options.speed ?? 1
}

beforeEach(() => project({ installed: false }))
afterEach(() => {
  sceneInitial.installedPlugins = was.plugins
  Object.assign(revealInitial, { level: was.level, chosen: was.chosen, speed: was.speed })
})

const optionOf = (markup: string, label: string) => {
  const match = new RegExp(`<button[^>]*>(?:(?!</button>).)*${label}(?:(?!</button>).)*</button>`).exec(
    markup,
  )
  return match?.[0] ?? ''
}

describe('the levels the control offers', () => {
  test('without the plugin, Framing is disabled and its tip says it needs the Architect plugin', () => {
    const framingOption = constructionLevelOptions(false).find((o) => o.value === 'framing')!
    expect(framingOption.disabled).toBe(true)
    expect(framingOption.title).toBe(FRAMING_NEEDS_ARCHITECT)
    expect(FRAMING_NEEDS_ARCHITECT).toBe('Framing needs the Architect plugin.')
    for (const option of constructionLevelOptions(false).filter((o) => o.value !== 'framing'))
      expect(option.disabled).toBe(false)
  })

  test('with the plugin, every level is on offer', () => {
    expect(constructionLevelOptions(true).every((option) => option.disabled === false)).toBe(true)
  })
})

describe('the construction animation control, drawn', () => {
  test('without the plugin: Framing is greyed out and Full is the level that plays', () => {
    project({ installed: false })
    const markup = renderToStaticMarkup(<ConstructionAnimationSetting />)
    expect(optionOf(markup, 'Framing')).toContain('aria-disabled="true"')
    expect(optionOf(markup, 'Full')).toContain('aria-pressed="true"')
    expect(optionOf(markup, 'Full')).not.toContain('aria-disabled')
  })

  test('with the plugin and no choice of the person’s own: Framing plays, nothing is greyed', () => {
    project({ installed: true })
    const markup = renderToStaticMarkup(<ConstructionAnimationSetting />)
    expect(optionOf(markup, 'Framing')).toContain('aria-pressed="true"')
    expect(markup).not.toContain('aria-disabled')
  })

  test('with the plugin and a choice of Full: Full is kept', () => {
    project({ installed: true, level: 'full', chosen: true })
    const markup = renderToStaticMarkup(<ConstructionAnimationSetting />)
    expect(optionOf(markup, 'Full')).toContain('aria-pressed="true"')
    expect(optionOf(markup, 'Framing')).toContain('aria-pressed="false"')
  })

  test('a saved choice of Framing falls back to Full while the plugin is gone, greyed out', () => {
    project({ installed: false, level: 'framing', chosen: true })
    const markup = renderToStaticMarkup(<ConstructionAnimationSetting />)
    expect(optionOf(markup, 'Full')).toContain('aria-pressed="true"')
    expect(optionOf(markup, 'Framing')).toContain('aria-disabled="true"')
    expect(optionOf(markup, 'Framing')).toContain('aria-pressed="false"')
  })
})

describe('clicking the level that plays', () => {
  // A saved Framing plays as Full while the plugin is gone; the control shows Full pressed, and a click on
  // the pressed option is still a click. It must not turn the kept Framing into a chosen Full.
  const click = (level: ConstructionRevealLevel, installed: boolean) =>
    chooseConstructionLevel(level, installed)

  beforeEach(() => useConstructionReveal.setState({ level: 'framing', chosen: true }))
  afterEach(() => useConstructionReveal.setState({ level: 'full', chosen: false }))

  test('the Full shown for a saved Framing keeps the Framing when it is clicked, and it plays again with the plugin', () => {
    click('full', false)
    expect(useConstructionReveal.getState()).toMatchObject({ level: 'framing', chosen: true })
    expect(resolveConstructionLevel(useConstructionReveal.getState(), true)).toBe('framing')
  })

  test('another level is a choice and replaces it', () => {
    click('simple', false)
    expect(useConstructionReveal.getState()).toMatchObject({ level: 'simple', chosen: true })
  })

  test('with no choice of the person’s own, a click on the level that plays is a choice of it', () => {
    useConstructionReveal.setState({ level: 'full', chosen: false })
    click('full', false)
    expect(useConstructionReveal.getState()).toMatchObject({ level: 'full', chosen: true })
  })
})

describe('the Pro badge', () => {
  // The plugin that draws the framing is a Pro one: the option carries the plugin manager's mark,
  // greyed out or not, and no other level does.
  test('Framing carries it, greyed out or on offer; the other levels do not', () => {
    for (const installed of [false, true]) {
      project({ installed })
      const markup = renderToStaticMarkup(<ConstructionAnimationSetting />)
      expect(optionOf(markup, 'Framing')).toMatch(/>Pro</)
      for (const label of ['Off', 'Simple', 'Full']) expect(optionOf(markup, label)).not.toMatch(/>Pro</)
    }
  })
})

describe('the animation speed control, drawn', () => {
  test('offers the five steps and shows the saved one', () => {
    project({ installed: true, speed: 1.5 })
    const markup = renderToStaticMarkup(<AnimationSpeedSetting />)
    for (const label of ['×0.5', '×0.75', '×1', '×1.5', '×2']) expect(markup).toContain(label)
    expect(optionOf(markup, '×1.5')).toContain('aria-pressed="true"')
    expect(optionOf(markup, '×0.5')).toContain('aria-pressed="false"')
  })
})
