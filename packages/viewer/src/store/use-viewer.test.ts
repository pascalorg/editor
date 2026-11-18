// @ts-expect-error — bun:test is provided by the Bun runtime; viewer does not
// include Bun ambient types in its production declaration build.
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { useViewer } from '../index'
import { resolveDaylightSite } from '../lib/daylight/location'
import { groundVeiled, siteGroundShown } from './use-viewer'

const resetMeasurementPreferences = () => {
  useViewer.setState({
    externalSelectedIds: [],
    pointedIds: [],
    projectId: null,
    projectPreferences: {},
    showMeasurements: true,
    unit: 'metric',
    metricNotation: 'meters',
  })
}

beforeEach(resetMeasurementPreferences)
afterEach(resetMeasurementPreferences)

describe('measurement display preferences', () => {
  test('stores global visibility per project and defaults new projects to visible', () => {
    const viewer = useViewer.getState()
    viewer.setProjectId('project-a')
    viewer.setShowMeasurements(false)

    expect(useViewer.getState()).toMatchObject({
      projectId: 'project-a',
      showMeasurements: false,
      projectPreferences: {
        'project-a': { showMeasurements: false },
      },
    })

    useViewer.getState().setProjectId('project-b')
    expect(useViewer.getState().showMeasurements).toBe(true)

    useViewer.getState().setProjectId('project-a')
    expect(useViewer.getState().showMeasurements).toBe(false)
  })

  // Framing only hides the shell; carried into another project, that house opened invisible.
  test('another project opens with the whole house, not framing only', () => {
    useViewer.getState().setProjectId('project-a')
    useViewer.getState().setFramingOnly(true)
    useViewer.getState().setProjectId('project-b')
    expect(useViewer.getState().framingOnly).toBe(false)
  })

  // The frame in the finished house opens its floors and roofs: the view's, not the project's.
  test('another project opens with its floors and roofs closed, the frame not shown', () => {
    useViewer.getState().setProjectId('project-a')
    useViewer.getState().setFramingShown(true)
    expect(useViewer.getState().framingShown).toBe(true)
    useViewer.getState().setProjectId('project-b')
    expect(useViewer.getState().framingShown).toBe(false)
  })

  test('changes display units without changing measurement visibility preferences', () => {
    const viewer = useViewer.getState()
    viewer.setProjectId('project-a')
    viewer.setShowMeasurements(false)
    const preferences = useViewer.getState().projectPreferences

    useViewer.getState().setUnit('imperial')

    expect(useViewer.getState().unit).toBe('imperial')
    expect(useViewer.getState().projectPreferences).toEqual(preferences)
    expect(useViewer.getState().showMeasurements).toBe(false)
  })

  test('selects millimeters as a metric display notation', () => {
    useViewer.getState().setUnit('imperial')
    useViewer.getState().setMetricNotation('millimeters')

    expect(useViewer.getState()).toMatchObject({
      unit: 'metric',
      metricNotation: 'millimeters',
      unitExplicit: true,
    })
  })
})

describe('external selection highlights', () => {
  test('tracks host-owned highlights without changing the local selection', () => {
    const localSelection = useViewer.getState().selection

    useViewer.getState().setExternalSelectedIds(['wall_remote'])

    expect(useViewer.getState().externalSelectedIds).toEqual(['wall_remote'])
    expect(useViewer.getState().selection).toBe(localSelection)
  })
})

// Point and ask: a chat context chip hovered lights the elements it names. The slot is its own, so
// writing it never clobbers a teammate's highlight in `externalSelectedIds` nor the local selection.
describe('pointed highlights', () => {
  test('tracks the pointed elements without touching the external or local selection', () => {
    const localSelection = useViewer.getState().selection
    useViewer.getState().setExternalSelectedIds(['wall_remote'])

    useViewer.getState().setPointedIds(['zone_kitchen', 'wall_north'])

    expect(useViewer.getState().pointedIds).toEqual(['zone_kitchen', 'wall_north'])
    expect(useViewer.getState().externalSelectedIds).toEqual(['wall_remote'])
    expect(useViewer.getState().selection).toBe(localSelection)
  })

  test('the same ids again change nothing, so nothing re-renders', () => {
    useViewer.getState().setPointedIds(['zone_kitchen'])
    const before = useViewer.getState().pointedIds

    useViewer.getState().setPointedIds(['zone_kitchen'])

    expect(useViewer.getState().pointedIds).toBe(before)
  })

  test('null clears it, and clearing what is already clear changes nothing', () => {
    useViewer.getState().setPointedIds(['zone_kitchen'])
    useViewer.getState().setPointedIds(null)
    expect(useViewer.getState().pointedIds).toEqual([])

    const empty = useViewer.getState().pointedIds
    useViewer.getState().setPointedIds(null)
    useViewer.getState().setPointedIds([])
    expect(useViewer.getState().pointedIds).toBe(empty)
  })
})

describe('unit focus', () => {
  afterEach(() => useViewer.getState().setFocusedUnit(null))

  test('focuses one unit at a time and clears without touching the selection', () => {
    const selection = useViewer.getState().selection

    useViewer.getState().setFocusedUnit('unit_a' as never)
    expect(useViewer.getState().focusedUnitId).toBe('unit_a')

    useViewer.getState().setFocusedUnit('unit_b' as never)
    expect(useViewer.getState().focusedUnitId).toBe('unit_b')

    useViewer.getState().setFocusedUnit(null)
    expect(useViewer.getState().focusedUnitId).toBeNull()
    expect(useViewer.getState().selection).toBe(selection)
  })
})

describe('scene theme', () => {
  afterEach(() => useViewer.getState().setSceneTheme('studio'))

  test('a shown theme renders without replacing the saved one', () => {
    useViewer.getState().setSceneTheme('paper')
    useViewer.getState().showSceneTheme('night')

    expect(useViewer.getState().sceneTheme).toBe('night')
    expect(useViewer.getState().savedSceneTheme).toBe('paper')

    useViewer.getState().showSceneTheme(null)
    expect(useViewer.getState().sceneTheme).toBe('paper')
  })

  test('picking a theme while another is shown saves the pick', () => {
    useViewer.getState().showSceneTheme('night')
    useViewer.getState().setSceneTheme('sunset')
    useViewer.getState().showSceneTheme(null)

    expect(useViewer.getState().sceneTheme).toBe('sunset')
    expect(useViewer.getState().savedSceneTheme).toBe('sunset')
  })
})

describe('the ground over a level below grade', () => {
  const below = { belowGrade: true, groundMode: 'auto', gradeStanding: 'below-grade' } as const

  test('is veiled wholesale on Auto, not on Solid, not over a part-buried level', () => {
    expect(groundVeiled(below)).toBe(true)
    expect(groundVeiled({ ...below, groundMode: 'solid' })).toBe(false)
    expect(groundVeiled({ ...below, gradeStanding: 'partly-below-grade' })).toBe(false)
  })

  test('is solid in the walkthrough, whatever level the overview had shown', () => {
    expect(groundVeiled({ ...below, walkthroughMode: true })).toBe(false)
  })
})

describe('project rendering defaults', () => {
  const original = useViewer.getState()
  beforeEach(() => useViewer.setState(original, true))
  afterEach(() => useViewer.setState(original, true))
  const authored = {
    theme: 'studio',
    exposure: 0.94,
    shading: 'rendered' as const,
    edges: 'off' as const,
    lighting: {
      background: '#dce4e5',
      backgroundSky: null,
      ambient: { color: '#ffffff', intensity: 0 },
    },
    postprocessing: { ambientOcclusion: false, colorGrading: false },
  }

  test('project defaults survive context changes without becoming global user preferences', () => {
    const store = useViewer.getState()
    store.setSceneTheme('paper')
    store.setEdges('strong')
    store.setProjectId('look-a')
    store.setProjectPresentation(authored)
    store.setRenderContext('editor', 'solid')
    expect(useViewer.getState()).toMatchObject({
      sceneTheme: 'studio',
      shading: 'rendered',
      edges: 'off',
    })
    expect(useViewer.getState().sceneAppearance).toMatchObject({
      background: '#dce4e5',
      backgroundSky: null,
      toneMappingExposure: 0.94,
    })
    expect(useViewer.getState().lookDefaults).toMatchObject({ theme: 'paper', edges: 'strong' })
    expect(useViewer.getState().projectPreferences['look-a']?.look).toBeUndefined()
    store.setProjectId('look-b')
    // Edges are on or off (a saved 'strong' reads as on); Solid is retired into the quality tiers.
    expect(useViewer.getState()).toMatchObject({
      sceneTheme: 'paper',
      edges: 'soft',
      shading: 'rendered',
    })
  })

  test('local choices override only their project and survive switching away and back', () => {
    const store = useViewer.getState()
    store.setProjectId('look-a')
    store.setProjectPresentation(authored)
    store.setSceneTheme('night')
    store.setEdges('soft')
    store.setShading('solid')
    expect(useViewer.getState().sceneAppearance.background).not.toBe('#dce4e5')
    store.setProjectId('look-b')
    store.setProjectPresentation(authored)
    expect(useViewer.getState()).toMatchObject({
      sceneTheme: 'studio',
      edges: 'off',
      shading: 'rendered',
    })
    store.setProjectId('look-a')
    store.setProjectPresentation(authored)
    expect(useViewer.getState()).toMatchObject({
      sceneTheme: 'night',
      edges: 'soft',
      shading: 'rendered',
      renderQuality: 'low',
    })
    store.resetProjectLook()
    expect(useViewer.getState()).toMatchObject({
      sceneTheme: 'studio',
      edges: 'off',
      shading: 'rendered',
    })
    expect(useViewer.getState().sceneAppearance.toneMappingExposure).toBe(0.94)
  })

  test('an explicit temporary theme bypasses custom lighting even with the same theme id', () => {
    const store = useViewer.getState()
    store.setProjectId('look-a')
    store.setProjectPresentation(authored)
    store.showSceneTheme('studio')
    expect(useViewer.getState().sceneAppearance.background).not.toBe('#dce4e5')
    store.showSceneTheme(null)
    expect(useViewer.getState().sceneAppearance.background).toBe('#dce4e5')
    expect(useViewer.getState().projectPreferences['look-a']?.look).toBeUndefined()
    store.setProjectPresentation(undefined)
    expect(useViewer.getState().sceneAppearance.background).not.toBe('#dce4e5')
  })

  test('an embed without a project id can override and restore its authored look', () => {
    const store = useViewer.getState()
    store.setProjectPresentation({ ...authored, shadows: true })
    store.setSceneTheme('night')
    store.setEdges('strong')
    store.setShadows(false)
    store.setShading('solid')
    expect(useViewer.getState()).toMatchObject({
      sceneTheme: 'night',
      edges: 'soft',
      shadows: false,
      shading: 'rendered',
      renderQuality: 'low',
    })
    store.resetProjectLook()
    expect(useViewer.getState()).toMatchObject({
      sceneTheme: 'studio',
      edges: 'off',
      shadows: true,
      shading: 'rendered',
    })
    store.setProjectId('look-next')
    expect(useViewer.getState().projectPreferences['']).toBeUndefined()
    store.setProjectPresentation(authored)
    expect(useViewer.getState().sceneAppearance.background).toBe('#dce4e5')
  })
})

describe('the site ground with showGround off', () => {
  test('stands in while a level below grade is shown, and leaves showGround to the author otherwise', () => {
    // An authored landscape supplies the ground (showGround false): the level display hides it
    // with the storeys above a basement, so the site's ground draws then.
    expect(siteGroundShown({ showGround: false }, { belowGrade: true })).toBe(true)
    expect(siteGroundShown({ showGround: false }, { belowGrade: false })).toBe(false)
  })

  test('is the site’s own ground whatever the display says when showGround is on or absent', () => {
    for (const showGround of [undefined, true]) {
      expect(siteGroundShown({ showGround }, { belowGrade: false })).toBe(true)
      expect(siteGroundShown({ showGround }, { belowGrade: true })).toBe(true)
    }
  })
})

describe('render quality', () => {
  const original = useViewer.getState()
  afterEach(() => useViewer.setState(original, true))

  test('auto follows the detected tier; a pick holds until auto is chosen again', () => {
    const store = useViewer.getState()
    store.setRenderQuality('auto')
    store.setDetectedRenderQuality('low')
    expect(useViewer.getState().renderQuality).toBe('low')
    store.setRenderQuality('high')
    store.setDetectedRenderQuality('medium')
    expect(useViewer.getState()).toMatchObject({
      renderQuality: 'high',
      renderQualityChoice: 'high',
    })
    store.setRenderQuality('auto')
    expect(useViewer.getState().renderQuality).toBe('medium')
  })
})

test('denied preference storage does not block hydration or presentation changes', async () => {
  const savedWindow = Object.getOwnPropertyDescriptor(globalThis, 'window')
  try {
    for (const storage of [
      {
        get localStorage(): Storage {
          throw new DOMException('Denied', 'SecurityError')
        },
      },
      {
        localStorage: {
          getItem() {
            throw new DOMException('Denied', 'SecurityError')
          },
          setItem() {
            throw new DOMException('Full', 'QuotaExceededError')
          },
          removeItem() {
            throw new DOMException('Denied', 'SecurityError')
          },
        },
      },
    ]) {
      Object.defineProperty(globalThis, 'window', { configurable: true, value: storage })
      await useViewer.persist.rehydrate()
      useViewer.getState().setShowMeasurements(false)
      expect(useViewer.getState().showMeasurements).toBe(false)
      useViewer.getState().setShowMeasurements(true)
      expect(useViewer.getState().showMeasurements).toBe(true)
      expect(() => useViewer.persist.clearStorage()).not.toThrow()
    }
  } finally {
    if (savedWindow) Object.defineProperty(globalThis, 'window', savedWindow)
    else Reflect.deleteProperty(globalThis, 'window')
  }
})

describe('daylight presentation', () => {
  const original = useViewer.getState()
  afterEach(() => useViewer.setState(original, true))

  test('an empty scene uses the host site; null preserves scene facts and location precedence', () => {
    const store = useViewer.getState()
    store.setDaylightSite({ northRotation: 1.2, lat: -33.87, lng: 151.21 })
    expect(resolveDaylightSite(undefined, useViewer.getState().daylightSite, null)).toEqual({
      northRotation: 1.2,
      location: { lat: -33.87, lng: 151.21 },
      source: 'site',
    })
    store.setDaylightSite(null)
    const site = {
      northRotation: 0.7,
      parcel: { originLngLat: [2.35, 48.86] as const },
      dossier: { point: { lat: 1, lng: 2 } },
    }
    expect(
      resolveDaylightSite(site, useViewer.getState().daylightSite, { lat: 10, lng: 20 }),
    ).toEqual({
      northRotation: 0.7,
      location: { lat: 48.86, lng: 2.35 },
      source: 'site',
    })
    store.setDaylightSite({ northRotation: 2 })
    expect(
      resolveDaylightSite(site, useViewer.getState().daylightSite, { lat: 10, lng: 20 }),
    ).toEqual({
      northRotation: 2,
      location: { lat: 10, lng: 20 },
      source: 'device',
    })
  })

  test('project changes reset the override; rerendering the same project retains it', () => {
    const store = useViewer.getState()
    store.setProjectId('sun-a')
    store.setDaylightSite({ northRotation: 1 })
    store.setProjectId('sun-a')
    expect(useViewer.getState().daylightSite).toEqual({ northRotation: 1 })
    store.setProjectId('sun-b')
    expect(useViewer.getState().daylightSite).toBeNull()
  })

  test('all presets survive storage reloads, and the site override is never persisted', async () => {
    const savedWindow = Object.getOwnPropertyDescriptor(globalThis, 'window')
    const values = new Map<string, string>()
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: {
        localStorage: {
          getItem: (key: string) => values.get(key) ?? null,
          setItem: (key: string, value: string) => values.set(key, value),
          removeItem: (key: string) => values.delete(key),
        },
      },
    })
    try {
      for (const preset of ['dawn', 'golden', 'midday', 'blue', 'night'] as const) {
        useViewer.getState().setDaylightSite({ northRotation: 1 })
        useViewer.getState().setTimeOfDay(preset)
        const persisted = values.get('viewer-preferences')!
        expect(JSON.parse(persisted).state.daylightSite).toBeUndefined()
        useViewer.setState({ timeOfDay: 'midday', daylightSite: null })
        values.set('viewer-preferences', persisted)
        await useViewer.persist.rehydrate()
        expect(useViewer.getState().timeOfDay).toBe(preset)
        expect(useViewer.getState().daylightSite).toBeNull()
      }
    } finally {
      if (savedWindow) Object.defineProperty(globalThis, 'window', savedWindow)
      else Reflect.deleteProperty(globalThis, 'window')
    }
  })
})

describe('section presentation', () => {
  const defaults = {
    sectionEnabled: false,
    sectionAxis: 'y',
    sectionPosition: 0,
    sectionFlipped: false,
    sectionShadows: 'full' as const,
  }
  afterEach(() => useViewer.setState(defaults))

  test('defaults, setters and project changes are transient presentation', () => {
    const viewer = useViewer.getState()
    viewer.setProjectId('section-a')
    expect(useViewer.getState()).toMatchObject(defaults)
    viewer.setSectionEnabled(true)
    viewer.setSectionShadows('cut')
    viewer.setSectionAxis('z')
    viewer.setSectionPosition(4.5)
    viewer.setSectionFlipped(true)
    expect(useViewer.getState()).toMatchObject({
      sectionEnabled: true,
      sectionAxis: 'z',
      sectionPosition: 4.5,
      sectionFlipped: true,
      sectionShadows: 'cut',
    })
    viewer.setProjectId('section-a')
    expect(useViewer.getState().sectionEnabled).toBe(true)
    viewer.setProjectId('section-b')
    expect(useViewer.getState()).toMatchObject(defaults)
    viewer.setProjectId('section-a')
    expect(useViewer.getState()).toMatchObject(defaults)
  })

  test('no section field is written to preference storage', () => {
    const savedWindow = Object.getOwnPropertyDescriptor(globalThis, 'window')
    let persisted = ''
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: {
        localStorage: {
          getItem: () => null,
          setItem: (_key: string, value: string) => {
            persisted = value
          },
          removeItem: () => {},
        },
      },
    })
    try {
      const viewer = useViewer.getState()
      viewer.setSectionEnabled(true)
      viewer.setSectionShadows('cut')
      viewer.setSectionAxis('x')
      viewer.setSectionPosition(12)
      viewer.setSectionFlipped(true)
      const state = JSON.parse(persisted).state
      for (const key of Object.keys(defaults)) expect(state).not.toHaveProperty(key)
    } finally {
      if (savedWindow) Object.defineProperty(globalThis, 'window', savedWindow)
      else Reflect.deleteProperty(globalThis, 'window')
    }
  })
})

describe('family presentation', () => {
  afterEach(() => useViewer.getState().setXrayFamily(null))
  test('defaults to no family, retains it for the same project and resets on project change', () => {
    const viewer = useViewer.getState()
    expect(useViewer.getInitialState().xrayFamily).toBeNull()
    viewer.setProjectId('xray-a')
    viewer.setXrayFamily('items')
    viewer.setProjectId('xray-a')
    expect(useViewer.getState().xrayFamily).toBe('items')
    viewer.setProjectId('xray-b')
    expect(useViewer.getState().xrayFamily).toBeNull()
    viewer.setProjectId('xray-a')
    expect(useViewer.getState().xrayFamily).toBeNull()
  })
  test('family is omitted from preference storage', () => {
    const storage = useViewer.persist.getOptions().storage!
    const original = storage.setItem
    let written: any
    storage.setItem = (_key, value) => {
      written = value
    }
    try {
      useViewer.getState().setXrayFamily('items')
      expect(written.state).not.toHaveProperty('xrayFamily')
    } finally {
      storage.setItem = original
    }
  })
})
