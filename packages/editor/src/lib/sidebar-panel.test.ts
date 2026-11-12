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

// The desktop layout shows the host's chat as a column of its own: asking for it must not take
// the tool panel down, as it did while the chat was one of the panels.
describe('showing the chat when it has a column', () => {
  afterEach(() => {
    setColumnPanelId(null)
    setSidebarTabIds([])
  })

  test('leaves the open tool panel as it is', () => {
    setSidebarTabIds(['build', 'paint'])
    setColumnPanelId('ai')
    useEditor.getState().setActiveSidebarPanel('paint')
    useSidebarStore.setState({ isCollapsed: false })

    expect(openSidebarPanel(['ai'])).toBe('ai')
    showSidebarPanel('ai')

    expect(useEditor.getState().activeSidebarPanel).toBe('paint')
    expect(useSidebarStore.getState().isCollapsed).toBe(false)
  })

  test('a closed tool panel stays closed', () => {
    setColumnPanelId('ai')
    useEditor.getState().setActiveSidebarPanel('build')
    useSidebarStore.setState({ isCollapsed: true })

    showSidebarPanel('ai')

    expect(useEditor.getState().activeSidebarPanel).toBe('build')
    expect(useSidebarStore.getState().isCollapsed).toBe(true)
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
