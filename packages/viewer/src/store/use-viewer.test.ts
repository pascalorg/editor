// @ts-expect-error — bun:test is provided by the Bun runtime; viewer does not
// include Bun ambient types in its production declaration build.
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import useViewer, { anyGroundVeiled, groundVeiled, siteGroundShown } from './use-viewer'

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
    expect(anyGroundVeiled({ ...below, groundWindowVeiled: true, walkthroughMode: true })).toBe(
      false,
    )
    expect(anyGroundVeiled({ ...below, groundWindowVeiled: true, walkthroughMode: false })).toBe(
      true,
    )
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
    expect(useViewer.getState()).toMatchObject({
      sceneTheme: 'paper',
      edges: 'strong',
      shading: 'solid',
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
      shading: 'solid',
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
      edges: 'strong',
      shadows: false,
      shading: 'solid',
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
