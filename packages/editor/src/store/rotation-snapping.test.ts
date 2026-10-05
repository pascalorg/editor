import { afterEach, expect, test } from 'bun:test'
import { GROUP_ROTATE_DRAG_LABEL, ROTATE_HANDLE_DRAG_LABEL } from '../lib/contextual-help'
import useEditor, {
  getActiveSnapContext,
  isAngleSnapActive,
  normalizePersistedEditorLayoutState,
} from './use-editor'
import useInteractionScope from './use-interaction-scope'

const initialEditor = useEditor.getState()
const initialScope = useInteractionScope.getState()
afterEach(() => {
  useEditor.setState(initialEditor)
  useInteractionScope.setState(initialScope)
})

for (const handle of [ROTATE_HANDLE_DRAG_LABEL, GROUP_ROTATE_DRAG_LABEL]) {
  test(`${handle} reads and cycles the shared mode without changing placement modes`, () => {
    useInteractionScope.getState().begin({ kind: 'handle-drag', nodeId: 'item_test', handle })
    const placementModes = useEditor.getState().snappingModeByContext
    expect(getActiveSnapContext()).toBe('rotation')
    expect(isAngleSnapActive()).toBe(true)
    expect(useEditor.getState().cycleSnappingMode()).toBe('off')
    expect(isAngleSnapActive()).toBe(false)
    expect(useEditor.getState().snappingModeByContext.wall).toBe(placementModes.wall)
    expect(useEditor.getState().snappingModeByContext.item).toBe(placementModes.item)
    expect(useEditor.getState().cycleSnappingMode()).toBe('angles')
    expect(isAngleSnapActive()).toBe(true)
  })
}

test('older persisted preferences receive the rotation default and retain other modes', () => {
  const merged = normalizePersistedEditorLayoutState({
    snappingModeByContext: { wall: 'off', item: 'lines', polygon: 'grid' },
  })
  expect(merged?.snappingModeByContext).toEqual({
    wall: 'off',
    item: 'lines',
    polygon: 'grid',
    rotation: 'angles',
  })
})

test('persisted rotation mode is retained when valid and reset when invalid', () => {
  expect(
    normalizePersistedEditorLayoutState({ snappingModeByContext: { rotation: 'off' } })
      .snappingModeByContext.rotation,
  ).toBe('off')
  expect(
    normalizePersistedEditorLayoutState({ snappingModeByContext: { rotation: 'grid' } })
      .snappingModeByContext.rotation,
  ).toBe('angles')
})
