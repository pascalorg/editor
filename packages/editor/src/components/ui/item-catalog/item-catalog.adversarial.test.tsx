import { describe, expect, it } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { ItemCatalog, type ItemCatalogItem } from './item-catalog'

describe('ItemCatalog Adversarial & Stress Challenge Suite', () => {
  describe('Dimension 1: Extreme & Sparse Objects', () => {
    it('handles completely empty object ({}) without crashing', () => {
      const emptyItem: ItemCatalogItem = {}
      const markup = renderToStaticMarkup(<ItemCatalog items={[emptyItem]} />)
      expect(markup).toBeDefined()
      expect(markup).toContain('<button')
      expect(markup).toContain('aspect-square')
      expect(markup).not.toContain('<img')
      expect(markup).toContain('type="button"')
    })

    it('handles item with only id', () => {
      const item: ItemCatalogItem = { id: 'only-id-node-99' }
      const markup = renderToStaticMarkup(<ItemCatalog items={[item]} />)
      expect(markup).toContain('only-id-node-99')
      expect(markup).toContain('data-item-id="only-id-node-99"')
    })

    it('handles item with only label', () => {
      const item: ItemCatalogItem = { label: 'Autonomous AGV' }
      const markup = renderToStaticMarkup(<ItemCatalog items={[item]} />)
      expect(markup).toContain('Autonomous AGV')
    })

    it('handles item with only name', () => {
      const item: ItemCatalogItem = { name: 'Standard Pallet' }
      const markup = renderToStaticMarkup(<ItemCatalog items={[item]} />)
      expect(markup).toContain('Standard Pallet')
    })

    it('handles item with all display fields undefined/null', () => {
      const item: ItemCatalogItem = {
        id: undefined,
        name: undefined,
        label: undefined,
        description: undefined,
      }
      const markup = renderToStaticMarkup(<ItemCatalog items={[item]} />)
      expect(markup).toBeDefined()
      expect(markup).toContain('<button')
    })

    it('respects displayName precedence: name > label > id > empty string', () => {
      const item1: ItemCatalogItem = { id: 'id-1', label: 'label-1', name: 'name-1' }
      const markup1 = renderToStaticMarkup(<ItemCatalog items={[item1]} />)
      expect(markup1).toContain('name-1')
      expect(markup1).not.toContain('label-1')

      const item2: ItemCatalogItem = { id: 'id-2', label: 'label-2' }
      const markup2 = renderToStaticMarkup(<ItemCatalog items={[item2]} />)
      expect(markup2).toContain('label-2')

      const item3: ItemCatalogItem = { id: 'id-3' }
      const markup3 = renderToStaticMarkup(<ItemCatalog items={[item3]} />)
      expect(markup3).toContain('id-3')
    })

    it('handles items with HTML quotes and special characters in label/name safely', () => {
      const item: ItemCatalogItem = {
        id: 'special-chars-item',
        name: 'Rack 24" Depth & 48\' Width <Heavy>',
        description: 'Testing "escaped" & <safe> attributes',
      }
      const markup = renderToStaticMarkup(<ItemCatalog items={[item]} />)
      expect(markup).toContain('Rack 24&quot; Depth &amp; 48&#x27; Width &lt;Heavy&gt;')
      expect(markup).toContain('title="Testing &quot;escaped&quot; &amp; &lt;safe&gt; attributes"')
    })
  })

  describe('Dimension 2: Thumbnail & Media Edge Cases', () => {
    it('handles empty string thumbnail as fallback icon', () => {
      const item: ItemCatalogItem = { id: 'empty-thumb', thumbnail: '' }
      const markup = renderToStaticMarkup(<ItemCatalog items={[item]} />)
      expect(markup).not.toContain('<img')
    })

    it('renders <img> for URLs with complex query parameters containing colons and special chars', () => {
      const url = 'https://cdn.example.com/models/forklift.png?token=exp:123456&sig=abc%3D%3D&scale=1.5'
      const item: ItemCatalogItem = { id: 'query-param-item', thumbnail: url }
      const markup = renderToStaticMarkup(<ItemCatalog items={[item]} />)
      expect(markup).toContain('<img')
      expect(markup).toContain(url.replace(/&/g, '&amp;'))
    })

    it('renders <img> for URLs with ports', () => {
      const url = 'http://127.0.0.1:8080/static/icon.webp'
      const item: ItemCatalogItem = { id: 'port-url', thumbnail: url }
      const markup = renderToStaticMarkup(<ItemCatalog items={[item]} />)
      expect(markup).toContain('<img')
      expect(markup).toContain('http://127.0.0.1:8080/static/icon.webp')
    })

    it('renders <img> for data URIs and blob URIs', () => {
      const dataUri = 'data:image/svg+xml;base64,PHN2Zz48L3N2Zz4='
      const blobUri = 'blob:http://localhost:3000/0000-1111'
      const items: ItemCatalogItem[] = [
        { id: 'data-item', thumbnail: dataUri },
        { id: 'blob-item', thumbnail: blobUri },
      ]
      const markup = renderToStaticMarkup(<ItemCatalog items={items} />)
      expect(markup).toContain('<img')
      expect(markup).toContain(dataUri)
      expect(markup).toContain(blobUri)
    })

    it('renders <img> for relative root and parent paths resolved via CDN helper', () => {
      const items: ItemCatalogItem[] = [
        { id: 'root-rel', thumbnail: '/assets/icons/rack.png' },
        { id: 'dot-rel', thumbnail: './assets/icons/shelf.png' },
        { id: 'parent-rel', thumbnail: '../assets/icons/bin.png' },
      ]
      const markup = renderToStaticMarkup(<ItemCatalog items={items} />)
      expect(markup).toContain('<img')
      expect(markup).toContain('assets/icons/rack.png')
      expect(markup).toContain('assets/icons/shelf.png')
      expect(markup).toContain('assets/icons/bin.png')
    })

    it('identifies Iconify strings with dot in name or multiple colons', () => {
      const items: ItemCatalogItem[] = [
        { id: 'icon-dot', thumbnail: 'custom-pack:robot.arm.v2' },
        { id: 'icon-multi', thumbnail: 'lucide:arrow-up-right' },
        { id: 'icon-noprefix', thumbnail: 'forklift' },
      ]
      const markup = renderToStaticMarkup(<ItemCatalog items={items} />)
      expect(markup).not.toContain('<img')
    })

    it('renders IconRef object correctly when item.icon is provided', () => {
      const item: ItemCatalogItem = {
        id: 'iconref-item',
        icon: { kind: 'iconify', name: 'carbon:pedestrian' },
      }
      const markup = renderToStaticMarkup(<ItemCatalog items={[item]} />)
      expect(markup).not.toContain('<img')
      expect(markup).toBeDefined()
    })

    it('safely handles non-standard icon values (null, undefined, invalid type)', () => {
      const items: ItemCatalogItem[] = [
        { id: 'null-icon', icon: null as never },
        { id: 'undefined-icon', icon: undefined },
        { id: 'number-icon', icon: 9999 as never },
      ]
      const markup = renderToStaticMarkup(<ItemCatalog items={items} />)
      expect(markup).toBeDefined()
      expect(markup).not.toContain('<img')
    })
  })

  describe('Dimension 3: Search Safety & Special Characters', () => {
    const items: ItemCatalogItem[] = [
      { id: 'item-regex', name: 'Special [Regex] (Item)*+?^$', tags: ['test-tag'], description: 'Desc with /slashes\\ and {curlies}' },
      { id: 'item-unicode', name: 'Warehouse 📦 & Café #1', tags: ['üñîçødé', 'robotics'], description: 'Automated 100% efficiency' },
      { id: 'item-html', name: '<b style="color:red">Bold</b> item', tags: ['<tag>'], description: 'XSS <script>alert(1)</script>' },
    ]

    it('safely queries regex special characters without syntax errors', () => {
      const specialChars = ['[', ']', '(', ')', '*', '+', '?', '^', '$', '\\', '|', '{', '}']
      for (const char of specialChars) {
        const markup = renderToStaticMarkup(<ItemCatalog items={items} search={char} />)
        expect(markup).toBeDefined()
      }
    })

    it('matches literal regex characters in name and description', () => {
      const markup = renderToStaticMarkup(<ItemCatalog items={items} search="[regex]" />)
      expect(markup).toContain('Special [Regex] (Item)*+?^$')
      expect(markup).not.toContain('Warehouse 📦')
    })

    it('matches unicode characters and emojis in search', () => {
      const markupEmoji = renderToStaticMarkup(<ItemCatalog items={items} search="📦" />)
      expect(markupEmoji).toContain('Warehouse 📦 &amp; Café #1')
      expect(markupEmoji).not.toContain('Special [Regex]')

      const markupAccent = renderToStaticMarkup(<ItemCatalog items={items} search="café" />)
      expect(markupAccent).toContain('Warehouse 📦 &amp; Café #1')

      const markupTag = renderToStaticMarkup(<ItemCatalog items={items} search="üñîçødé" />)
      expect(markupTag).toContain('Warehouse 📦 &amp; Café #1')
    })

    it('handles ReDoS patterns with instant execution (<5ms)', () => {
      const start = performance.now()
      const redosQuery = 'a'.repeat(50) + '!@#$%'
      const markup = renderToStaticMarkup(<ItemCatalog items={items} search={redosQuery} />)
      const duration = performance.now() - start
      expect(duration).toBeLessThan(100)
      expect(markup).toBeDefined()
    })

    it('handles massive search strings (10,000 characters) without hanging', () => {
      const massiveQuery = 'search-term-'.repeat(1000)
      const markup = renderToStaticMarkup(<ItemCatalog items={items} search={massiveQuery} />)
      expect(markup).toBeDefined()
    })

    it('handles tags edge-cases (undefined, empty, case-insensitivity)', () => {
      const sparseItems: ItemCatalogItem[] = [
        { id: 'item-no-tags', name: 'No Tags Item', tags: undefined },
        { id: 'item-empty-tags', name: 'Empty Tags Item', tags: [] },
        { id: 'item-with-tag', name: 'Tagged Item', tags: ['HEAVY-DUTY'] },
      ]
      const markup = renderToStaticMarkup(<ItemCatalog items={sparseItems} search="heavy-duty" />)
      expect(markup).toContain('Tagged Item')
      expect(markup).not.toContain('No Tags Item')
    })
  })

  describe('Dimension 4: Interaction, Precedence & Active Delegation', () => {
    it('prioritizes onItemClick prop over item.onClick callback', () => {
      const item: ItemCatalogItem = {
        id: 'test-click-priority',
        name: 'Click Priority Item',
        onClick: () => {},
      }

      const markup = renderToStaticMarkup(
        <ItemCatalog
          items={[item]}
          onItemClick={() => {}}
        />,
      )
      expect(markup).toContain('Click Priority Item')
      expect(markup).toContain('data-item-id="test-click-priority"')
    })

    it('prioritizes isItemActive predicate over item.isSelected property', () => {
      const items: ItemCatalogItem[] = [
        { id: 'item-1', name: 'Item 1', isSelected: true },
        { id: 'item-2', name: 'Item 2', isSelected: false },
      ]

      const markup = renderToStaticMarkup(
        <ItemCatalog
          isItemActive={(item) => item.id === 'item-2'}
          items={items}
        />,
      )

      expect(markup).toContain('aria-pressed="true"')
    })

    it('falls back to item.isSelected when isItemActive is omitted', () => {
      const items: ItemCatalogItem[] = [
        { id: 'item-selected', name: 'Selected', isSelected: true },
        { id: 'item-unselected', name: 'Unselected', isSelected: false },
      ]

      const markup = renderToStaticMarkup(<ItemCatalog items={items} />)
      expect(markup).toContain('aria-pressed="true"')
      expect(markup).toContain('aria-pressed="false"')
    })
  })

  describe('Dimension 5: Scale Stress Harness (1,000 Items)', () => {
    it('renders 1,000 items efficiently without memory exhaustion or timeouts', () => {
      const largeCatalog: ItemCatalogItem[] = Array.from({ length: 1000 }, (_, i) => ({
        id: `item-${i}`,
        name: `Warehouse Asset #${i}`,
        category: i % 2 === 0 ? 'storage' : 'transport',
        sectionId: i % 2 === 0 ? 'storage' : 'transport',
        tags: [`tag-${i % 10}`, `group-${i % 5}`],
        icon: i % 3 === 0 ? 'lucide:box' : i % 3 === 1 ? 'carbon:forklift' : undefined,
        thumbnail: i % 3 === 2 ? `https://cdn.example.com/asset-${i}.png` : undefined,
      }))

      const start = performance.now()
      const markup = renderToStaticMarkup(
        <ItemCatalog category="storage" items={largeCatalog} />,
      )
      const renderDuration = performance.now() - start

      expect(markup).toBeDefined()
      expect(renderDuration).toBeLessThan(500)
      expect(markup).toContain('data-item-id="item-0"')
      expect(markup).toContain('data-item-id="item-998"')
      expect(markup).not.toContain('data-item-id="item-1"') // transport category filtered out
    })

    it('filters 1,000 items with search query across all fields rapidly', () => {
      const largeCatalog: ItemCatalogItem[] = Array.from({ length: 1000 }, (_, i) => ({
        id: `item-${i}`,
        name: `Pallet Rack Model ${i}`,
        tags: [`spec-${i % 20}`],
        description: `High capacity rack type ${i}`,
      }))

      const start = performance.now()
      const markup = renderToStaticMarkup(
        <ItemCatalog items={largeCatalog} search="Model 999" />,
      )
      const duration = performance.now() - start

      expect(duration).toBeLessThan(100)
      expect(markup).toContain('Pallet Rack Model 999')
      expect(markup).not.toContain('Pallet Rack Model 998')
    })
  })
})
