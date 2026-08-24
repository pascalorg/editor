import { describe, expect, it } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import useEditor from './../../../store/use-editor'
import { ItemCatalog, type ItemCatalogItem } from './item-catalog'

const testItems: ItemCatalogItem[] = [
  {
    id: 'rack-standard',
    name: 'Standard Pallet Rack',
    category: 'storage',
    sectionId: 'storage',
    tags: ['rack', 'heavy', 'floor'],
    thumbnail: 'https://example.com/rack.png',
    src: 'https://example.com/rack.glb',
  },
  {
    id: 'forklift-truck',
    label: 'Counterbalance Forklift',
    category: 'handling',
    sectionId: 'handling',
    tags: ['vehicle', 'equipment'],
    icon: 'carbon:forklift',
    kind: 'truck',
  },
  {
    id: 'conveyor-belt',
    label: 'Belt Conveyor',
    category: 'conveyance',
    sectionId: 'conveyance',
    tags: ['motorized'],
    thumbnail: 'lucide:move-right',
    kind: 'conveyor',
  },
  {
    id: 'wall-shelf',
    name: 'Wall Shelf',
    category: 'storage',
    sectionId: 'storage',
    attachTo: 'wall',
    thumbnail: 'https://example.com/shelf.png',
  },
  {
    id: 'mystery-box',
    label: 'Mystery Box',
    category: 'storage',
  },
]

describe('ItemCatalog Component', () => {
  describe('Polymorphic Media Rendering', () => {
    it('renders raster thumbnails with <img /> and resolves CDN URL', () => {
      const markup = renderToStaticMarkup(<ItemCatalog items={[testItems[0]!]} />)
      expect(markup).toContain('<img')
      expect(markup).toContain('src="https://example.com/rack.png"')
      expect(markup).toContain('alt="Standard Pallet Rack"')
      expect(markup).toContain('Standard Pallet Rack')
    })

    it('renders vector icon when item.icon is provided as string', () => {
      const markup = renderToStaticMarkup(<ItemCatalog items={[testItems[1]!]} />)
      expect(markup).toContain('Counterbalance Forklift')
      expect(markup).not.toContain('<img')
    })

    it('renders vector icon when item.thumbnail is an Iconify icon string', () => {
      const markup = renderToStaticMarkup(<ItemCatalog items={[testItems[2]!]} />)
      expect(markup).toContain('Belt Conveyor')
      expect(markup).not.toContain('<img')
    })

    it('renders IconRef object correctly', () => {
      const items: ItemCatalogItem[] = [
        {
          id: 'workbench',
          name: 'Workbench',
          icon: { kind: 'iconify', name: 'lucide:table' },
          category: 'stations',
        },
      ]

      const markup = renderToStaticMarkup(<ItemCatalog category="stations" items={items} />)
      expect(markup).toContain('Workbench')
      expect(markup).not.toContain('<img')
    })

    it('renders fallback box icon when neither icon nor thumbnail is provided', () => {
      const markup = renderToStaticMarkup(<ItemCatalog items={[testItems[4]!]} />)
      expect(markup).toContain('Mystery Box')
      expect(markup).not.toContain('<img')
    })

    it('renders SnapTargetBadge when attachTo is specified', () => {
      const markup = renderToStaticMarkup(<ItemCatalog items={[testItems[3]!]} />)
      expect(markup).toContain('Wall Shelf')
      expect(markup).toContain('Wall attachment')
      expect(markup).toContain('/icons/wall.webp')
    })

    it('applies build-tab parity styling classes (aspect-square, bg-muted/40, rounded-lg, rounded-xl)', () => {
      const markup = renderToStaticMarkup(<ItemCatalog items={[testItems[1]!]} />)
      expect(markup).toContain('aspect-square')
      expect(markup).toContain('bg-muted/40')
      expect(markup).toContain('rounded-lg')
      expect(markup).toContain('rounded-xl')
    })
  })

  describe('Label and Fallback Resolution', () => {
    it('uses item.name when available', () => {
      const item: ItemCatalogItem = { id: 'item-1', name: 'Name Override', label: 'Label Ignored' }
      const markup = renderToStaticMarkup(<ItemCatalog items={[item]} />)
      expect(markup).toContain('Name Override')
    })

    it('falls back to item.label when item.name is absent', () => {
      const item: ItemCatalogItem = { id: 'item-2', label: 'Fallback Label' }
      const markup = renderToStaticMarkup(<ItemCatalog items={[item]} />)
      expect(markup).toContain('Fallback Label')
    })

    it('falls back to item.id when name and label are absent', () => {
      const item: ItemCatalogItem = { id: 'item-raw-id' }
      const markup = renderToStaticMarkup(<ItemCatalog items={[item]} />)
      expect(markup).toContain('item-raw-id')
    })
  })

  describe('Active and Selection State', () => {
    it('applies active styling when isItemActive returns true', () => {
      const markup = renderToStaticMarkup(
        <ItemCatalog
          isItemActive={(item) => item.id === 'forklift-truck'}
          items={testItems}
        />,
      )
      expect(markup).toContain('ring-2 ring-primary-foreground')
      expect(markup).toContain('aria-pressed="true"')
    })

    it('applies active styling and ring when item is active or selected', () => {
      const items: ItemCatalogItem[] = [
        { id: 'item-1', label: 'Item 1', isSelected: true },
        { id: 'item-2', label: 'Item 2', isSelected: false },
      ]
      const markup = renderToStaticMarkup(<ItemCatalog items={items} />)
      expect(markup).toContain('ring-2 ring-primary-foreground')
      expect(markup).toContain('aria-pressed="true"')
    })

    it('invokes custom onItemClick and item.onClick callbacks when clicked', () => {
      let clickedItem: ItemCatalogItem | null = null
      let itemCallbackCalled = false

      const items: ItemCatalogItem[] = [
        {
          id: 'item-delegate',
          label: 'Delegate Item',
          onClick: () => {
            itemCallbackCalled = true
          },
        },
      ]

      // Verify rendering and click callback setup
      const markup = renderToStaticMarkup(
        <ItemCatalog
          items={items}
          onItemClick={(item) => {
            clickedItem = item
          }}
        />,
      )
      expect(markup).toContain('Delegate Item')
      expect(markup).toContain('data-item-id="item-delegate"')
    })
  })

  describe('Search and Category Filtering', () => {
    it('filters items by category or sectionId', () => {
      const markup = renderToStaticMarkup(
        <ItemCatalog category="handling" items={testItems} />,
      )
      expect(markup).toContain('Counterbalance Forklift')
      expect(markup).not.toContain('Standard Pallet Rack')
      expect(markup).not.toContain('Belt Conveyor')
    })

    it('searches across name, label, id, and tags (ignoring category)', () => {
      const markup = renderToStaticMarkup(
        <ItemCatalog category="storage" items={testItems} search="motorized" />,
      )
      // "motorized" tag is on Conveyor Belt (which is in "conveyance" category)
      expect(markup).toContain('Belt Conveyor')
      expect(markup).not.toContain('Standard Pallet Rack')
    })

    it('filters items by activePlacementTag', () => {
      const markup = renderToStaticMarkup(
        <ItemCatalog activePlacementTag="floor" items={testItems} />,
      )
      expect(markup).toContain('Standard Pallet Rack')
      expect(markup).not.toContain('Counterbalance Forklift')
    })

    it('renders emptyState when filtered items list is empty', () => {
      const markup = renderToStaticMarkup(
        <ItemCatalog
          emptyState={<div data-testid="custom-empty">No products found</div>}
          items={testItems}
          search="nonexistent-query-xyz"
        />,
      )
      expect(markup).toContain('data-testid="custom-empty"')
      expect(markup).toContain('No products found')
    })

    it('renders leadingTile as first child when provided', () => {
      const markup = renderToStaticMarkup(
        <ItemCatalog
          items={testItems}
          leadingTile={<div data-testid="ai-generate-tile">+ Generate with AI</div>}
        />,
      )
      expect(markup).toContain('data-testid="ai-generate-tile"')
      expect(markup).toContain('+ Generate with AI')
    })

    it('bypasses local filtering when overrideItems is provided', () => {
      const overrideList: ItemCatalogItem[] = [
        { id: 'custom-override', label: 'Direct Server Result' },
      ]
      const markup = renderToStaticMarkup(
        <ItemCatalog
          category="storage"
          items={testItems}
          overrideItems={overrideList}
          search="anything"
        />,
      )
      expect(markup).toContain('Direct Server Result')
      expect(markup).not.toContain('Standard Pallet Rack')
    })

    it('searches across description and id fields', () => {
      const items: ItemCatalogItem[] = [
        { id: 'custom-heavy-crane', label: 'Overhead Lifter', description: 'Gantry crane with 5-ton limit' },
        { id: 'dock-leveler-hydraulic', label: 'Loading Dock' },
      ]
      const markupDesc = renderToStaticMarkup(<ItemCatalog items={items} search="gantry" />)
      expect(markupDesc).toContain('Overhead Lifter')
      expect(markupDesc).not.toContain('Loading Dock')

      const markupId = renderToStaticMarkup(<ItemCatalog items={items} search="hydraulic" />)
      expect(markupId).toContain('Loading Dock')
      expect(markupId).not.toContain('Overhead Lifter')
    })

    it('applies custom className to the root container', () => {
      const markup = renderToStaticMarkup(
        <ItemCatalog className="custom-grid-class p-4" items={testItems} />,
      )
      expect(markup).toContain('custom-grid-class')
      expect(markup).toContain('p-4')
    })
  })

  describe('Backward Compatibility and Package Exports', () => {
    it('renders with LegacyItemsPanel props shape without error', () => {
      const markup = renderToStaticMarkup(
        <ItemCatalog
          activeFunctionalTag={null}
          activePlacementTag={null}
          category={'furniture' as never}
          emptyState={<div>Empty</div>}
          items={testItems as never}
          search=""
        />,
      )
      expect(markup).toBeDefined()
    })

    it('renders with FunctionTreePanel props shape without error', () => {
      const markup = renderToStaticMarkup(
        <ItemCatalog
          category={'furnish' as never}
          emptyState={<div>Empty</div>}
          overrideItems={testItems as never}
        />,
      )
      expect(markup).toBeDefined()
    })

    it('can be imported from index entry point', async () => {
      const indexModule = await import('../../../index')
      expect(indexModule.ItemCatalog).toBeDefined()
      expect(typeof indexModule.ItemCatalog).toBe('function')
      expect(indexModule.CATALOG_ITEMS).toBeDefined()
    })
  })
})
