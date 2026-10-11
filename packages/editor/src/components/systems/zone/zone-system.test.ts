import { expect, test } from 'bun:test'
import { useScene, ZoneNode } from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import { act, create } from '@react-three/test-renderer'
import { createElement } from 'react'
import useEditor from '../../../store/use-editor'
import { ZoneSystem } from './zone-system'

test('zone volumes mount only while a unit is painted, never for a selected zone', async () => {
  const previousScene = useScene.getState()
  const previousViewer = useViewer.getState()
  const previousEditor = useEditor.getState()
  const zone = ZoneNode.parse({
    name: 'Courtyard',
    polygon: [
      [0, 0],
      [4, 0],
      [4, 4],
      [0, 4],
    ],
  })
  useScene.setState({ nodes: { [zone.id]: zone } })
  useViewer.setState({
    focusedUnitId: null,
    showZones: false,
    selection: { buildingId: null, levelId: null, zoneId: null, selectedIds: [zone.id] },
  })
  useEditor.setState({ isCaptureMode: false })
  const renderer = await create(createElement(ZoneSystem))
  try {
    // A selected drawn zone looks like a room: outline, no tinted volume.
    expect(useViewer.getState().showZones).toBe(false)
    await act(async () => useViewer.setState({ focusedUnitId: 'unit_paint' as never }))
    expect(useViewer.getState().showZones).toBe(true)
    await act(async () => useEditor.getState().setCaptureMode(true))
    expect(useViewer.getState().showZones).toBe(false)
    await act(async () => useEditor.getState().setCaptureMode(false))
    expect(useViewer.getState().showZones).toBe(true)
    await act(async () => useViewer.setState({ focusedUnitId: null }))
    expect(useViewer.getState().showZones).toBe(false)
  } finally {
    await renderer.unmount()
    useScene.setState(previousScene)
    useViewer.setState(previousViewer)
    useEditor.setState(previousEditor)
  }
})
