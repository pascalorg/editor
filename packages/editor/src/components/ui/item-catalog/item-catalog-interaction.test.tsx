import { describe, expect, it } from 'bun:test'
import type React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { useViewer } from '@pascal-app/viewer'
import useEditor from '../../../store/use-editor'
import { ItemCatalog, type ItemCatalogItem, type ItemCatalogProps } from './item-catalog'

/**
 * Harness that renders ItemCatalog within a valid React hook context
 * and captures the returned React Element tree for inspection and event dispatching.
 */
function renderItemCatalogTree(props: ItemCatalogProps): {
  markup: string
  buttons: React.ReactElement<any>[]
  clickItem: (itemIdOrIndex: string | number) => void
} {
  let capturedElement: React.ReactElement | null = null

  function TestHarness() {
    const element = ItemCatalog(props)
    capturedElement = element
    return element
  }

  const markup = renderToStaticMarkup(<TestHarness />)

  if (!capturedElement) {
    throw new Error('Failed to capture ItemCatalog element tree during render')
  }

  const rootElement = capturedElement as React.ReactElement
  const children = (rootElement.props as { children: React.ReactNode[] })?.children
  const flattenedChildren = Array.isArray(children) ? children.flat().filter(Boolean) : [children]
  const buttons = flattenedChildren.filter(
    (child): child is React.ReactElement<Record<string, any>> =>
      Boolean(child) && (child as React.ReactElement).type === 'button',
  )

  const clickItem = (itemIdOrIndex: string | number) => {
    const button = buttons.find((btn) => {
      if (typeof itemIdOrIndex === 'string') {
        return btn.props['data-item-id'] === itemIdOrIndex
      }
      return btn.props['data-item-id'] === String(itemIdOrIndex)
    }) ?? (typeof itemIdOrIndex === 'number' ? buttons[itemIdOrIndex] : undefined)

    if (!button || !button.props || typeof button.props.onClick !== 'function') {
      throw new Error(`Could not find clickable button for item ${itemIdOrIndex}`)
    }

    button.props.onClick()
  }

  return { markup, buttons, clickItem }
}

describe('ItemCatalog Adversarial Interaction & Callback Challenge (Milestone 1)', () => {
  describe('Dimension 1: onItemClick Callback Delegation & Argument Integrity', () => {
    it('passes the exact item object to onItemClick when clicked', () => {
      const items: ItemCatalogItem[] = [
        { id: 'item-alpha', name: 'Alpha Item', customProp: 42, tags: ['a', 'b'] },
        { id: 'item-beta', label: 'Beta Item', customProp: 99, tool: 'custom-tool' },
      ]

      let receivedItem: ItemCatalogItem | null = null
      let clickCount = 0

      const tree = renderItemCatalogTree({
        items,
        onItemClick: (item) => {
          receivedItem = item
          clickCount++
        },
      })

      tree.clickItem('item-alpha')
      expect(clickCount).toBe(1)
      expect(receivedItem as ItemCatalogItem | null).toBe(items[0]!)
      expect((receivedItem as ItemCatalogItem | null)?.id).toBe('item-alpha')
      expect((receivedItem as any)?.customProp).toBe(42)

      tree.clickItem('item-beta')
      expect(clickCount).toBe(2)
      expect(receivedItem as ItemCatalogItem | null).toBe(items[1]!)
      expect((receivedItem as ItemCatalogItem | null)?.id).toBe('item-beta')
    })

    it('onItemClick overrides item.onClick when both are specified', () => {
      let onItemClickCalled = false
      let itemOnClickCalled = false

      const item: ItemCatalogItem = {
        id: 'both-callbacks',
        label: 'Both Callbacks Item',
        onClick: () => {
          itemOnClickCalled = true
        },
      }

      const tree = renderItemCatalogTree({
        items: [item],
        onItemClick: () => {
          onItemClickCalled = true
        },
      })

      tree.clickItem('both-callbacks')
      expect(onItemClickCalled).toBe(true)
      expect(itemOnClickCalled).toBe(false)
    })

    it('onItemClick prevents default editor tool and selection mutations', () => {
      useEditor.setState({
        mode: 'select' as any,
        tool: 'select' as any,
        selectedItem: null,
      })
      useViewer.setState({
        selection: {
          buildingId: null,
          levelId: null,
          selectedIds: ['node-123', 'node-456'],
          zoneId: 'zone_1',
        },
      } as any)

      let itemClicked: ItemCatalogItem | null = null
      const item: ItemCatalogItem = {
        id: 'delegated-tool-item',
        label: 'Delegated Tool',
        tool: 'wall',
        kind: 'structural',
      }

      const tree = renderItemCatalogTree({
        items: [item],
        onItemClick: (clicked) => {
          itemClicked = clicked
        },
      })

      tree.clickItem('delegated-tool-item')

      expect(itemClicked as ItemCatalogItem | null).toBe(item)
      // Editor state must remain unchanged
      expect(useEditor.getState().mode).toBe('select' as any)
      expect(useEditor.getState().tool).toBe('select' as any)
      expect(useEditor.getState().selectedItem).toBeNull()
      // Viewer selection must NOT be cleared
      expect(useViewer.getState().selection.selectedIds).toEqual(['node-123', 'node-456'])
      expect(useViewer.getState().selection.zoneId).toBe('zone_1')
    })
  })

  describe('Dimension 2: item.onClick Callback Delegation', () => {
    it('invokes item.onClick when onItemClick is not provided', () => {
      let clickedItemA = false
      let clickedItemB = false

      const items: ItemCatalogItem[] = [
        {
          id: 'item-with-click-a',
          label: 'Item A',
          onClick: () => {
            clickedItemA = true
          },
        },
        {
          id: 'item-with-click-b',
          label: 'Item B',
          onClick: () => {
            clickedItemB = true
          },
        },
      ]

      const tree = renderItemCatalogTree({ items })

      tree.clickItem('item-with-click-a')
      expect(clickedItemA).toBe(true)
      expect(clickedItemB).toBe(false)

      tree.clickItem('item-with-click-b')
      expect(clickedItemA).toBe(true)
      expect(clickedItemB).toBe(true)
    })

    it('item.onClick prevents default editor state mutations', () => {
      useEditor.setState({
        mode: 'select' as any,
        tool: 'select' as any,
        selectedItem: null,
      })
      useViewer.setState({
        selection: { buildingId: null, levelId: null, selectedIds: ['node-preserve'], zoneId: null },
      } as any)

      let itemCallbackFired = false
      const item: ItemCatalogItem = {
        id: 'preserve-editor-state-item',
        label: 'Preserve State',
        tool: 'slab',
        onClick: () => {
          itemCallbackFired = true
        },
      }

      const tree = renderItemCatalogTree({ items: [item] })
      tree.clickItem('preserve-editor-state-item')

      expect(itemCallbackFired).toBe(true)
      expect(useEditor.getState().mode).toBe('select' as any)
      expect(useEditor.getState().tool).toBe('select' as any)
      expect(useEditor.getState().selectedItem).toBeNull()
      expect(useViewer.getState().selection.selectedIds).toEqual(['node-preserve'])
    })

    it('handles mixed items (some with onClick, some fallback) in the same catalog', () => {
      useEditor.setState({
        mode: 'select' as any,
        tool: 'select' as any,
        selectedItem: null,
      })

      let customClicked = false
      const items: ItemCatalogItem[] = [
        {
          id: 'custom-action-item',
          label: 'Custom Action',
          onClick: () => {
            customClicked = true
          },
        },
        {
          id: 'standard-placement-item',
          label: 'Standard Placement',
          tool: 'door',
          src: 'https://example.com/door.glb',
        },
      ]

      const tree = renderItemCatalogTree({ items })

      // Click custom item
      tree.clickItem('custom-action-item')
      expect(customClicked).toBe(true)
      expect(useEditor.getState().tool).toBe('select' as any)

      // Click standard fallback item
      tree.clickItem('standard-placement-item')
      expect(useEditor.getState().tool).toBe('door' as any)
      expect(useEditor.getState().mode).toBe('build')
      expect(useEditor.getState().selectedItem?.id).toBe('standard-placement-item')
    })
  })

  describe('Dimension 3: Fallback Editor Selection & Tool Arming', () => {
    it('executes full host placement workflow: clears viewer selection, arms tool, sets build mode', () => {
      useViewer.setState({
        selection: { buildingId: null, levelId: null, selectedIds: ['node-1'], zoneId: 'zone_1' },
      } as any)
      useEditor.setState({
        mode: 'select' as any,
        tool: null,
        selectedItem: null,
      })

      const item: ItemCatalogItem = {
        id: 'rack-01',
        name: 'Pallet Rack',
        tool: 'rack',
        src: 'https://example.com/rack.glb',
      }

      const tree = renderItemCatalogTree({ items: [item] })
      tree.clickItem('rack-01')

      // Viewer selection cleared
      expect(useViewer.getState().selection).toEqual({
        buildingId: null,
        levelId: null,
        selectedIds: [],
        zoneId: null,
      })
      // Editor tool armed
      expect(useEditor.getState().tool).toBe('rack' as any)
      // Editor mode set to build
      expect(useEditor.getState().mode).toBe('build')
      // Selected item set
      expect(useEditor.getState().selectedItem).toBe(item as any)
    })

    it('determines tool fallback hierarchy: tool ?? kind ?? "item"', () => {
      // 1. item.tool defined
      const itemWithTool: ItemCatalogItem = { id: 'tool-item', tool: 'wall', kind: 'mesh' }
      let tree = renderItemCatalogTree({ items: [itemWithTool] })
      tree.clickItem('tool-item')
      expect(useEditor.getState().tool).toBe('wall' as any)

      // 2. item.tool undefined, item.kind defined
      const itemWithKind: ItemCatalogItem = { id: 'kind-item', kind: 'forklift' }
      tree = renderItemCatalogTree({ items: [itemWithKind] })
      tree.clickItem('kind-item')
      expect(useEditor.getState().tool).toBe('forklift' as any)

      // 3. both item.tool and item.kind undefined -> defaults to 'item'
      const bareItem: ItemCatalogItem = { id: 'bare-item' }
      tree = renderItemCatalogTree({ items: [bareItem] })
      tree.clickItem('bare-item')
      expect(useEditor.getState().tool).toBe('item' as any)
    })
  })

  describe('Dimension 4: isItemActive Predicate & Concurrent / Multiple Highlights', () => {
    it('supports multiple active items simultaneously', () => {
      const items: ItemCatalogItem[] = [
        { id: 'item-1', label: 'Item 1', category: 'cat-a' },
        { id: 'item-2', label: 'Item 2', category: 'cat-b' },
        { id: 'item-3', label: 'Item 3', category: 'cat-a' },
        { id: 'item-4', label: 'Item 4', category: 'cat-c' },
        { id: 'item-5', label: 'Item 5', category: 'cat-a' },
      ]

      // Predicate activates all items in 'cat-a' (items 1, 3, 5)
      const tree = renderItemCatalogTree({
        isItemActive: (item) => item.category === 'cat-a',
        items,
      })

      expect(tree.buttons.length).toBe(5)
      expect(tree.buttons[0]?.props['aria-pressed']).toBe(true)
      expect(tree.buttons[0]?.props.className).toContain('ring-2 ring-primary-foreground')

      expect(tree.buttons[1]?.props['aria-pressed']).toBe(false)
      expect(tree.buttons[1]?.props.className).not.toContain('ring-2 ring-primary-foreground')

      expect(tree.buttons[2]?.props['aria-pressed']).toBe(true)
      expect(tree.buttons[2]?.props.className).toContain('ring-2 ring-primary-foreground')

      expect(tree.buttons[3]?.props['aria-pressed']).toBe(false)
      expect(tree.buttons[3]?.props.className).not.toContain('ring-2 ring-primary-foreground')

      expect(tree.buttons[4]?.props['aria-pressed']).toBe(true)
      expect(tree.buttons[4]?.props.className).toContain('ring-2 ring-primary-foreground')
    })

    it('isItemActive strictly overrides item.isSelected', () => {
      const items: ItemCatalogItem[] = [
        {
          id: 'selected-in-prop',
          label: 'Selected in Item Prop',
          isSelected: true,
        },
      ]

      // But isItemActive returns false
      const tree = renderItemCatalogTree({
        isItemActive: () => false,
        items,
      })

      expect(tree.buttons[0]?.props['aria-pressed']).toBe(false)
      expect(tree.buttons[0]?.props.className).not.toContain('ring-2 ring-primary-foreground')
    })

    it('isItemActive dynamically activates items based on external caller state', () => {
      const items: ItemCatalogItem[] = [
        { id: 'chip-brush-1', label: 'Rack Brush' },
        { id: 'chip-brush-2', label: 'Zone Brush' },
      ]

      const activeChipId = 'chip-brush-2'
      const tree = renderItemCatalogTree({
        isItemActive: (item) => item.id === activeChipId,
        items,
      })

      expect(tree.buttons[0]?.props['aria-pressed']).toBe(false)
      expect(tree.buttons[1]?.props['aria-pressed']).toBe(true)
    })
  })

  describe('Dimension 5: Fallback Selection Highlights (when isItemActive is undefined)', () => {
    it('uses item.isSelected if provided', () => {
      const items: ItemCatalogItem[] = [
        { id: 'item-sel-true', label: 'Selected True', isSelected: true },
        { id: 'item-sel-false', label: 'Selected False', isSelected: false },
      ]

      const tree = renderItemCatalogTree({ items })

      expect(tree.buttons[0]?.props['aria-pressed']).toBe(true)
      expect(tree.buttons[0]?.props.className).toContain('ring-2 ring-primary-foreground')

      expect(tree.buttons[1]?.props['aria-pressed']).toBe(false)
      expect(tree.buttons[1]?.props.className).not.toContain('ring-2 ring-primary-foreground')
    })
  })

  describe('Dimension 6: High Volume, Concurrent Edge Cases & Robustness', () => {
    it('handles 200 concurrent items with mixed configurations cleanly', () => {
      const items: ItemCatalogItem[] = Array.from({ length: 200 }, (_, i) => ({
        id: `item-${i}`,
        name: i % 2 === 0 ? `Item ${i}` : undefined,
        label: i % 2 !== 0 ? `Label ${i}` : undefined,
        category: i < 100 ? 'cat-first-half' : 'cat-second-half',
        tags: [`tag-${i % 10}`],
        icon: i % 3 === 0 ? `lucide:icon-${i}` : undefined,
        thumbnail: i % 3 === 1 ? `https://example.com/img-${i}.png` : undefined,
      }))

      let clickedIds: string[] = []
      const tree = renderItemCatalogTree({
        items,
        onItemClick: (item) => {
          if (item.id) clickedIds.push(item.id)
        },
      })

      expect(tree.buttons.length).toBe(200)

      // Simulate clicks on index 0, 50, 150, 199
      tree.clickItem('item-0')
      tree.clickItem('item-50')
      tree.clickItem('item-150')
      tree.clickItem('item-199')

      expect(clickedIds).toEqual(['item-0', 'item-50', 'item-150', 'item-199'])
    })

    it('handles items with missing or empty ids and names gracefully', () => {
      const anonymousItems: ItemCatalogItem[] = [
        {},
        { name: '' },
        { label: 'Has Label Only' },
      ]

      const tree = renderItemCatalogTree({ items: anonymousItems })
      expect(tree.markup).toContain('Has Label Only')
    })
  })
})
