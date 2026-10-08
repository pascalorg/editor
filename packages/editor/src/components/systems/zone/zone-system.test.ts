import { expect, test } from 'bun:test'
import { useScene, ZoneNode } from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import { act, create } from '@react-three/test-renderer'
import { createElement } from 'react'
import useEditor from '../../../store/use-editor'
import { ZoneSystem } from './zone-system'

test('a free-drawn zone selected in the plan shows its volume in 3D', async () => {
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
    expect(useViewer.getState().showZones).toBe(true)
    await act(async () => useEditor.getState().setCaptureMode(true))
    expect(useViewer.getState().showZones).toBe(false)
    await act(async () => useEditor.getState().setCaptureMode(false))
    expect(useViewer.getState().showZones).toBe(true)
    await act(async () => useViewer.getState().setSelection({ selectedIds: [] }))
    expect(useViewer.getState().showZones).toBe(false)
  } finally {
    await renderer.unmount()
    useScene.setState(previousScene)
    useViewer.setState(previousViewer)
    useEditor.setState(previousEditor)
  }
})
