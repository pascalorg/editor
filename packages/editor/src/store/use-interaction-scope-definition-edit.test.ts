import { beforeEach, describe, expect, test } from 'bun:test'
import { useScene } from '@pascal-app/core'
import { type HotSetCandidate, isCandidateInHotSet } from '../lib/interaction/hot-set'
import { resolveOverlayPolicy } from '../lib/interaction/overlay-policy'
import { selectionEnabled } from '../lib/interaction/scope'
import useInteractionScope, { type DefinitionEditScope } from './use-interaction-scope'

const editScope: DefinitionEditScope = {
  kind: 'definition-edit',
  instanceId: 'instance_a',
  definitionId: 'definition_a',
  rootNodeId: 'level_definition-root',
}

const candidate: HotSetCandidate = {
  type: 'wall',
  isFloorLike: false,
  exposesTop: false,
  attachClass: 'surface',
}

beforeEach(() => {
  useInteractionScope.setState({
    scope: { kind: 'idle' },
    definitionEditContext: null,
  })
})

describe('definition edit interaction context', () => {
  test('restores the edit context after a nested gesture ends', () => {
    const store = useInteractionScope.getState()
    store.begin(editScope)
    useInteractionScope
      .getState()
      .begin({ kind: 'handle-drag', nodeId: 'wall_a', handle: 'height' })
    useInteractionScope.getState().end()

    expect(useInteractionScope.getState().scope).toEqual(editScope)
    expect(useInteractionScope.getState().definitionEditContext).toEqual(editScope)
  })

  test('exits explicitly without touching scene history state', () => {
    const pastLength = useScene.temporal.getState().pastStates.length
    const futureLength = useScene.temporal.getState().futureStates.length
    useInteractionScope.getState().begin(editScope)
    useInteractionScope.getState().exitDefinitionEdit()

    expect(useInteractionScope.getState().scope).toEqual({ kind: 'idle' })
    expect(useInteractionScope.getState().definitionEditContext).toBeNull()
    expect(useScene.temporal.getState().pastStates).toHaveLength(pastLength)
    expect(useScene.temporal.getState().futureStates).toHaveLength(futureLength)
  })

  test('keeps definition members selectable while other controls remain available', () => {
    expect(selectionEnabled(editScope)).toBe(true)
    expect(isCandidateInHotSet(editScope, null, candidate)).toBe(true)
    expect(resolveOverlayPolicy(editScope)).toMatchObject({
      conflictingControls: 'shown',
      sceneObjectsPickable: true,
      zoneLabels: 'hidden',
    })
  })
})
