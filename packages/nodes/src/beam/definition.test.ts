import { expect, test } from 'bun:test'
import { type BeamNode, createBeam, createSceneApi, useScene } from '@pascal-app/core'
import { beamDefinition } from './definition'
import { beamToolOptions, useBeamDraft } from './draft-settings'
import { beamBox, buildBeamGeometry } from './geometry'

const IN = 0.0254

test('a beam is a selectable, duplicable, deletable structural kind drawn with its own tool', () => {
  expect(beamDefinition).toMatchObject({
    kind: 'beam',
    category: 'structure',
    snapProfile: 'structural',
    presentation: { label: 'Beam', paletteSection: 'structure' },
  })
  expect(beamDefinition.capabilities).toMatchObject({
    selectable: { hitVolume: 'bbox' },
    duplicable: true,
    deletable: true,
    drawTool: true,
  })
  expect(typeof beamDefinition.tool).toBe('function')
  expect(Object.keys(beamDefinition.affordanceTools ?? {}).sort()).toEqual([
    'move',
    'move-endpoint',
  ])
  expect(Object.keys(beamDefinition.floorplanAffordances ?? {})).toEqual(['move-endpoint'])
  const defaults = beamDefinition.defaults()
  expect(defaults).toMatchObject({ plies: 1, material: 'sawn', placement: 'dropped' })
})

test('selected, it has a move arrow either side, a picker at each end and a top tracker', () => {
  const beam = createBeam({ start: [0, 0], end: [4, 0], preset: '6x8', topElevation: 2.4 })
  const handles =
    typeof beamDefinition.handles === 'function'
      ? beamDefinition.handles(beam, createSceneApi(useScene))
      : (beamDefinition.handles ?? [])
  expect(handles.map((handle) => handle.kind)).toEqual([
    'tap-action',
    'tap-action',
    'tap-action',
    'tap-action',
    'linear-resize',
  ])
  const sceneApi = createSceneApi(useScene)
  const [side, , startPicker, , top] = handles
  // the side arrow sits beside the beam at its mid-depth
  const at = side!.placement.position(beam, sceneApi)
  expect(at[1]).toBeCloseTo(2.4 - 3.75 * IN)
  expect(Math.abs(at[2])).toBeGreaterThan(beam.width / 2)
  // the end picker stands at the beam's underside at its start
  expect(startPicker!.placement.position(beam, sceneApi)).toEqual([0, 2.4 - 7.5 * IN, 0])
  // the top tracker writes the top it is dragged to
  if (top?.kind !== 'linear-resize') throw new Error('the top handle resizes')
  expect(top.currentValue(beam)).toBeCloseTo(2.4)
  expect(top.apply(beam, 2.1, sceneApi)).toEqual({ topElevation: 2.1 } as Partial<BeamNode>)
})

test('the box sits along the centreline with its top where the beam resolves it', () => {
  const beam = createBeam({ start: [1, 1], end: [1, 5], preset: '6x8' })
  const box = beamBox(beam, 2.7)!
  expect(box.position[0]).toBeCloseTo(1)
  expect(box.position[1]).toBeCloseTo(2.7 - 3.75 * IN)
  expect(box.position[2]).toBeCloseTo(3)
  expect(box.size[0]).toBeCloseTo(4)
  // local +X runs along the beam: a run toward +Z turns it -90°
  expect(box.rotationY).toBeCloseTo(-Math.PI / 2)
  expect(beamBox({ ...beam, end: beam.start }, 2.7)).toBeNull()
})

test('a built-up beam shows its plies, a steel one its flanges and web', () => {
  const plies = buildBeamGeometry(
    { width: 4.5 * IN, depth: 9.25 * IN, plies: 3, material: 'sawn' },
    2,
  )
  const solid = buildBeamGeometry(
    { width: 5.5 * IN, depth: 7.5 * IN, plies: 1, material: 'sawn' },
    2,
  )
  const steel = buildBeamGeometry(
    { width: 3.94 * IN, depth: 7.89 * IN, plies: 1, material: 'steel' },
    2,
  )
  const triangles = (geometry: ReturnType<typeof buildBeamGeometry>) =>
    geometry.getAttribute('position').count / 3
  expect(triangles(solid)).toBe(12)
  expect(triangles(plies)).toBe(36)
  expect(triangles(steel)).toBe(36)
  // the plies keep the beam's full width between their outer faces
  plies.computeBoundingBox()
  expect(plies.boundingBox!.max.z - plies.boundingBox!.min.z).toBeCloseTo(4.5 * IN, 4)
  expect(solid.getAttribute('uv')).toBeTruthy()
})

test("the tool's rows pick a material, its sizes and the top", () => {
  expect(beamToolOptions.map((option) => option.id)).toEqual([
    'beam-material',
    'beam-size-sawn',
    'beam-size-lvl',
    'beam-size-glulam',
    'beam-size-steel',
    'beam-top',
  ])
  const [material, sawn, lvl] = beamToolOptions
  expect(sawn!.visible!.value()).toBe(true)
  expect(lvl!.visible!.value()).toBe(false)
  // picking LVL brings its usual size along; going treated keeps a sawn size
  material!.set('lvl')
  expect(useBeamDraft.getState()).toMatchObject({ material: 'lvl', preset: '(2)lvl-1-3/4x11-7/8' })
  expect(lvl!.visible!.value()).toBe(true)
  material!.set('pressure-treated')
  expect(useBeamDraft.getState().preset).toBe('6x8')
  sawn!.set('(3)2x12')
  material!.set('sawn')
  expect(useBeamDraft.getState().preset).toBe('(3)2x12')
  useBeamDraft.setState({ preset: '6x8', material: 'sawn', top: 'ceiling-dropped' })
})
