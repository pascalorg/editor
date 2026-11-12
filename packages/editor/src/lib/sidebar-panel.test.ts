import { afterEach, describe, expect, test } from 'bun:test'
import { useSidebarStore } from '../components/ui/primitives/sidebar'
import useEditor from '../store/use-editor'
import {
  openSidebarPanel,
  SIDEBAR_MIN_WIDTH,
  setColumnPanelId,
  setSidebarTabIds,
  showSidebarPanel,
} from './sidebar-panel'

// The desktop layout shows the host's chat in the column an open tool panel takes over: asking
// for the chat brings it back in the tool's place.
describe('showing the chat when it has a column', () => {
  afterEach(() => {
    setColumnPanelId(null)
    setSidebarTabIds([])
  })

  test('takes the place of the open tool panel', () => {
    setSidebarTabIds(['build', 'paint'])
    setColumnPanelId('ai')
    useEditor.getState().setActiveSidebarPanel('paint')
    useSidebarStore.setState({ isCollapsed: false })

    expect(openSidebarPanel(['ai'])).toBe('ai')

    expect(useEditor.getState().activeSidebarPanel).toBe('ai')
  })

  test('a closed tool panel stays closed', () => {
    setColumnPanelId('ai')
    useEditor.getState().setActiveSidebarPanel('build')
    useSidebarStore.setState({ isCollapsed: true, width: 120 })

    showSidebarPanel('ai')

    expect(useEditor.getState().activeSidebarPanel).toBe('ai')
    expect(useSidebarStore.getState().isCollapsed).toBe(true)
    expect(useSidebarStore.getState().width).toBe(120)
  })

  test('without a column (a phone), the chat opens like any panel', () => {
    setSidebarTabIds(['build', 'ai'])
    useEditor.getState().setActiveSidebarPanel('build')
    useSidebarStore.setState({ isCollapsed: true, width: 120 })

    expect(openSidebarPanel(['ai'])).toBe('ai')

    expect(useEditor.getState().activeSidebarPanel).toBe('ai')
    expect(useSidebarStore.getState().isCollapsed).toBe(false)
    expect(useSidebarStore.getState().width).toBe(SIDEBAR_MIN_WIDTH)
  })
})
