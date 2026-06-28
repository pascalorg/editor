import { describe, expect, test } from 'bun:test'
import type { AnyNode } from '@pascal-app/core'
import { resolveOverlayPolicy } from './overlay-policy'
import type { ActiveInteractionScope } from './scope'

const mockNode = (id: string, type: string): AnyNode => ({ id, type }) as unknown as AnyNode

const ACTIVE_SCOPES: ActiveInteractionScope[] = [
  {
    kind: 'placing',
    node: mockNode('i1', 'item'),
    nodeId: 'i1',
    nodeType: 'item',
    view: '3d',
    pressDrag: false,
  },
  { kind: 'moving', node: mockNode('i1', 'item'), nodeId: 'i1', nodeType: 'item', view: '2d' },
  { kind: 'handle-drag', nodeId: 'w1', handle: 'height' },
  { kind: 'drafting', tool: 'wall' },
  { kind: 'reshaping', nodeId: 's1', reshape: 'hole', holeIndex: 0 },
  { kind: 'box-select' },
  { kind: 'painting' },
]

describe('resolveOverlayPolicy', () => {
  test('idle keeps everything shown and pickable', () => {
    const p = resolveOverlayPolicy({ kind: 'idle' })
    expect(p.zoneLabels).toBe('shown')
    expect(p.contextBadges).toBe('shown')
    expect(p.conflictingControls).toBe('shown')
    expect(p.sceneObjectsPickable).toBe(true)
  })

  test('every active scope hides zone labels, fades badges, hides conflicting controls', () => {
    for (const scope of ACTIVE_SCOPES) {
      const p = resolveOverlayPolicy(scope)
      expect(p.zoneLabels).toBe('hidden')
      expect(p.contextBadges).toBe('faded')
      expect(p.conflictingControls).toBe('hidden')
      expect(p.sceneObjectsPickable).toBe(false)
    }
  })

  test('active affordances and the contextual HUD always stay interactive', () => {
    for (const scope of [{ kind: 'idle' } as const, ...ACTIVE_SCOPES]) {
      const p = resolveOverlayPolicy(scope)
      expect(p.activeAffordances).toBe('shown')
      expect(p.contextualHudInteractive).toBe(true)
    }
  })
})
