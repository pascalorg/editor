import { describe, expect, test } from 'bun:test'
import {
  createSceneApi,
  DoorNode,
  type HandleDescriptor,
  useScene,
  WindowNode,
} from '@pascal-app/core'
import { doorDefinition } from '../door/definition'
import { windowDefinition } from '../window/definition'

const scene = createSceneApi(useScene)
const sha = 'a'.repeat(64)

function source(params: { id: string; default: number }[]) {
  return {
    kind: 'script' as const,
    language: 'three' as const,
    script: sha,
    artifact: sha,
    params: {},
    manifest: {
      bounds: { min: [-0.9, 0, -0.1], max: [0.9, 2.4, 0.1] },
      params: params.map((param) => ({ ...param, kind: 'number', label: param.id })),
      parts: [],
      surfaces: [],
      undersides: [],
      slots: [],
      anchors: [],
      lights: [],
      animations: [],
      cutout: true,
      collider: false,
      triangles: 12,
    },
  }
}

const kinds = (handles: HandleDescriptor[]) => handles.map((handle) => handle.kind)

describe('a scripted opening shows only the handles its params drive', () => {
  test('no params: no resize arrows and no rounding dots', () => {
    const window = WindowNode.parse({ id: 'window_s', source: source([]) })
    const handles = (windowDefinition.handles as Function)(window, scene) as HandleDescriptor[]
    expect(handles).toEqual([])
  })

  test('a width param keeps the two side arrows, nothing else', () => {
    const window = WindowNode.parse({
      id: 'window_w',
      source: source([{ id: 'width', default: 1.8 }]),
    })
    const handles = (windowDefinition.handles as Function)(window, scene) as HandleDescriptor[]
    expect(kinds(handles)).toEqual(['linear-resize', 'linear-resize'])
  })

  test('a door keeps its move handle and drops the rounding dots', () => {
    const door = DoorNode.parse({ id: 'door_s', source: source([{ id: 'height', default: 2.4 }]) })
    const handles = (doorDefinition.handles as Function)(door, scene) as HandleDescriptor[]
    expect(handles.some((handle) => handle.kind === 'corner-radius')).toBe(false)
    expect(handles.filter((handle) => handle.kind === 'linear-resize')).toHaveLength(1)
  })
})
