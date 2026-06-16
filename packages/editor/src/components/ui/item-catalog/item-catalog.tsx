"use client"

import type { AssetInput } from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import { Icon } from '@iconify/react'
import { cn } from './../../../lib/utils'
import useEditor, { type CatalogCategory } from './../../../store/use-editor'
import { CATALOG_ITEMS } from './catalog-items'

const ITEM_NAME_ZH: Record<string, string> = {
  "sprinkler": "\u55b7\u6dcb\u5934",
  "smoke-detector": "\u70df\u96fe\u63a2\u6d4b\u5668",
  "fire-detector": "\u706b\u707e\u63a2\u6d4b\u5668",
  "fire-alarm": "\u706b\u707e\u62a5\u8b66\u5668",
  "fire-extinguisher": "\u706d\u706b\u5668",
  "hydrant": "\u6d88\u9632\u6813",
  "exit-sign": "\u5b89\u5168\u51fa\u53e3\u6807\u8bc6",
  "electric-panel": "\u914d\u7535\u7bb1",
  "ev-wall-charger": "\u7535\u52a8\u8f66\u58c1\u6302\u5145\u7535\u5668",
  "thermostat": "\u6e29\u63a7\u5668",
  "alarm-keypad": "\u62a5\u8b66\u952e\u76d8",
  "factory-electric-box": "\u5de5\u5382\u7535\u7bb1",
  "ac-block": "\u7a7a\u8c03\u5916\u673a\u5757",
  "air-conditioning": "\u7a7a\u8c03",
  "air-conditioner": "\u7a7a\u8c03\u673a",
  "air-conditioner-block": "\u7a7a\u8c03\u51b7\u51dd\u5668",
  "ceiling-fan": "\u540a\u6247",
  "freezer": "\u51b7\u67dc",
  "recessed-light": "\u5d4c\u5165\u5f0f\u706f",
  "ceiling-lamp": "\u540a\u706f",
  "ceiling-light": "\u5438\u9876\u706f",
  "circular-ceiling-light": "\u5706\u5f62\u5438\u9876\u706f",
  "rectangular-ceiling-light": "\u957f\u65b9\u5f62\u5438\u9876\u706f",
  "floor-lamp": "\u843d\u5730\u706f",
  "computer": "\u7535\u8111",
  "television": "\u7535\u89c6",
  "flat-screen-tv": "\u5e73\u677f\u7535\u89c6",
  "stereo-speaker": "\u7acb\u4f53\u58f0\u97f3\u7bb1",
  "sewing-machine": "\u7f1d\u7eab\u673a",
  "shelf": "\u6401\u677f",
  "trash-bin": "\u5783\u573e\u6876",
  "desk": "\u4e66\u684c",
  "office-chair": "\u529e\u516c\u6905",
  "barbell": "\u6760\u94c3",
  "basket-hoop": "\u7bee\u7403\u67b6",
  "factory-straight-pipe": "\u5de5\u5382\u76f4\u7ba1",
  "factory-curved-pipe": "\u5de5\u5382\u5f2f\u7ba1",
  "factory-t-pipe": "\u5de5\u5382\u4e09\u901a\u7ba1",
  "factory-extractor": "\u5de5\u5382\u62bd\u98ce\u673a",
  "factory-barrel": "\u5de5\u5382\u6876",
  "bathroom-sink": "\u6d74\u5ba4\u6d17\u624b\u76c6",
  "bathtub": "\u6d74\u7f38",
  "bedside-table": "\u5e8a\u5934\u67dc",
  "bookshelf": "\u4e66\u67b6",
  "closet": "\u8863\u67dc",
  "coffee-table": "\u8336\u51e0",
  "dining-chair": "\u9910\u6905",
  "dining-table": "\u9910\u684c",
  "double-bed": "\u53cc\u4eba\u5e8a",
  "dresser": "\u68b3\u5986\u67dc",
  "fridge": "\u51b0\u7bb1",
  "kitchen": "\u53a8\u623f\u7ec4\u5408",
  "kitchen-counter": "\u53a8\u623f\u64cd\u4f5c\u53f0",
  "livingroom-chair": "\u5ba2\u5385\u6905",
  "lounge-chair": "\u4f11\u95f2\u6905",
  "single-bed": "\u5355\u4eba\u5e8a",
  "sofa": "\u6c99\u53d1",
  "stove": "\u7089\u7076",
  "washing-machine": "\u6d17\u8863\u673a",
  "barbell-stand": "\u6760\u94c3\u67b6",
  "bean-bag": "\u61d2\u4eba\u6c99\u53d1",
  "books": "\u4e66\u7c4d",
  "bunkbed": "\u53cc\u5c42\u5e8a",
  "coffee-machine": "\u5496\u5561\u673a",
  "couch-medium": "\u4e2d\u53f7\u6c99\u53d1",
  "couch-small": "\u5c0f\u53f7\u6c99\u53d1",
  "herman-miller-aeron-mo8x36k9": "\u8d6b\u66fc\u7c73\u52d2 Aeron \u6905",
  "kettle": "\u6c34\u58f6",
  "kitchen-cabinet": "\u53a8\u623f\u67dc",
  "kitchen-fridge": "\u53a8\u623f\u51b0\u7bb1",
  "kitchen-shelf": "\u53a8\u623f\u7f6e\u7269\u67b6",
  "microwave": "\u5fae\u6ce2\u7089",
  "office-table": "\u529e\u516c\u684c",
  "piano": "\u94a2\u7434",
  "rectangular-carpet": "\u957f\u65b9\u5f62\u5730\u6bef",
  "round-carpet": "\u5706\u5f62\u5730\u6bef",
  "shower": "\u6dcb\u6d74\u95f4",
  "shower-rug": "\u6d74\u5ba4\u57ab",
  "sink-cabinet": "\u6d17\u624b\u76c6\u67dc",
  "small-kitchen-cabinet": "\u5c0f\u53a8\u623f\u67dc",
  "standing-desk-mo8wgz95": "\u5347\u964d\u684c",
  "stool": "\u51f3\u5b50",
  "table": "\u684c\u5b50",
  "threadmill": "\u8dd1\u6b65\u673a",
  "toilet": "\u9a6c\u6876",
  "tub": "\u6d74\u76c6",
  "wall-sink": "\u58c1\u6302\u6d17\u624b\u76c6",
  "wine-bottle": "\u9152\u74f6",
  "power-outlet-moa09g0o": "\u7535\u6e90\u63d2\u5ea7",
  "picture": "\u88c5\u9970\u753b",
  "rectangular-mirror": "\u957f\u65b9\u5f62\u955c\u5b50",
  "wall-art-06": "\u5899\u9762\u88c5\u9970\u753b",
  "table-lamp": "\u53f0\u706f",
  "tv-stand": "\u7535\u89c6\u67dc",
  "1967-chevrolet-camaro-moa24wsf": "1967 \u96ea\u4f5b\u5170\u79d1\u8fc8\u7f57",
  "car-toy": "\u73a9\u5177\u8f66",
  "exercise-bike": "\u5065\u8eab\u8f66",
  "skate": "\u6ed1\u677f",
  "dishwasher-movn72ls": "\u6d17\u7897\u673a",
  "column": "\u67f1\u5b50",
  "pillar": "\u7acb\u67f1",
  "stairs": "\u697c\u68af",
  "parking-spot": "\u505c\u8f66\u4f4d",
  "fence": "\u56f4\u680f",
  "low-fence": "\u4f4e\u56f4\u680f",
  "medium-fence": "\u4e2d\u56f4\u680f",
  "high-fence": "\u9ad8\u56f4\u680f",
  "door": "\u95e8",
  "door-bar": "\u95e8\u6746",
  "door-with-bar": "\u5e26\u6746\u95e8",
  "doorway-front": "\u6b63\u9762\u95e8\u6d1e",
  "glass-door": "\u73bb\u7483\u95e8",
  "window-double": "\u53cc\u6247\u7a97",
  "window-large": "\u5927\u7a97",
  "window-rectangle": "\u77e9\u5f62\u7a97",
  "window-round": "\u5706\u7a97",
  "window-simple": "\u7b80\u6613\u7a97",
  "window-small": "\u5c0f\u7a97",
  "window-small-2": "\u5c0f\u7a97 2",
  "window-square": "\u65b9\u7a97",
  "window1-black-open-1731": "\u9ed1\u8272\u5f00\u542f\u7a97",
  "cactus": "\u4ed9\u4eba\u638c",
  "small-indoor-plant": "\u5c0f\u76c6\u683d",
  "indoor-plant": "\u5ba4\u5185\u690d\u7269",
  "bush": "\u704c\u6728",
  "hedge": "\u7eff\u7bf1",
  "palm": "\u68d5\u6988\u6811",
  "fir-tree": "\u51b7\u6749",
  "tree": "\u6811",
  "ball": "\u77f3\u7403",
  "patio-umbrella": "\u5ead\u9662\u4f1e",
  "outdoor-playhouse": "\u6237\u5916\u513f\u7ae5\u5c4b",
  "sunbed": "\u8eba\u6905",
  "pool-table": "\u53f0\u7403\u684c",
  "tesla": "\u7279\u65af\u62c9 Model Y",
  "scooter": "\u6ed1\u677f\u8f66"
}

function itemMatchesCatalogCategory(item: AssetInput, category: CatalogCategory) {
  if (category === 'mine') return (item.source ?? 'library') === 'mine'
  return (
    item.category === category ||
    ((item.category === 'safety' ||
      item.category === 'lighting' ||
      item.category === 'electrical' ||
      item.category === 'hvac') &&
      category === 'electronics') ||
    (item.category === 'opening' && category === 'structural') ||
    (item.category === 'infrastructure' && category === 'outdoor') ||
    (item.category === 'nature' && category === 'outdoor') ||
    (item.category === 'vehicle' && category === 'outdoor')
  )
}

function getItemDisplayName(item: AssetInput) {
  return ITEM_NAME_ZH[item.id ?? ''] ?? ITEM_NAME_ZH[item.name] ?? item.name
}

function itemMatchesSearch(item: AssetInput, search: string) {
  const normalized = search.trim().toLowerCase()
  if (!normalized) return true
  return (
    item.name.toLowerCase().includes(normalized) ||
    getItemDisplayName(item).toLowerCase().includes(normalized)
  )
}

function getMineItemTypeLabel(item: AssetInput) {
  const tags = item.tags ?? []
  if (tags.includes('articraft')) return '\u5173\u8282\u8d44\u4ea7'
  if (tags.includes('image-to-3d')) return '\u56fe\u751f\u5efa\u6a21'
  if (tags.includes('imported') || tags.includes('glb')) return '\u5bfc\u5165\u6a21\u578b'
  return '\u6211\u7684\u7269\u54c1'
}

function getItemTypeLabel(item: AssetInput, category: CatalogCategory) {
  if (category === 'mine') return getMineItemTypeLabel(item)
  if (item.attachTo === 'wall' || item.attachTo === 'wall-side') return '\u5899\u9762'
  if (item.attachTo === 'ceiling') return '\u5929\u82b1'
  if (item.tags?.includes('countertop')) return '\u53f0\u9762'
  return '\u5730\u9762'
}

function getItemIcon(item: AssetInput, category: CatalogCategory) {
  const tags = item.tags ?? []
  if (category === 'mine') {
    if (tags.includes('articraft')) return 'mdi:robot-industrial-outline'
    if (tags.includes('image-to-3d')) return 'mdi:image-auto-adjust'
    if (tags.includes('imported') || tags.includes('glb')) return 'mdi:cube-outline'
    return 'mdi:cube-scan'
  }
  if (tags.includes('door')) return 'mdi:door'
  if (tags.includes('window')) return 'mdi:window-closed-variant'
  if (tags.includes('lighting')) return 'mdi:lightbulb-outline'
  if (tags.includes('safety')) return 'mdi:shield-alert-outline'
  if (tags.includes('plant') || tags.includes('tree')) return 'mdi:tree-outline'
  if (item.attachTo === 'wall' || item.attachTo === 'wall-side') return 'mdi:wall'
  if (item.attachTo === 'ceiling') return 'mdi:ceiling-light-outline'
  return 'mdi:cube-outline'
}

export function ItemCatalog({
  category,
  items: itemsOverride,
  activePlacementTag = null,
  activeFunctionalTag = null,
  search = '',
  overrideItems,
  leadingTile,
  emptyState,
  onDeleteItem,
}: {
  category: CatalogCategory
  items?: AssetInput[]
  activePlacementTag?: string | null
  activeFunctionalTag?: string | null
  search?: string
  /** When set, bypasses all filtering and displays these items directly (used for server search results) */
  overrideItems?: AssetInput[]
  /** Rendered as the first grid cell, always visible when there are items. */
  leadingTile?: React.ReactNode
  /** Rendered when there are no items to show. Replaces the empty grid. */
  emptyState?: React.ReactNode
  onDeleteItem?: (item: AssetInput) => void
}) {
  const selectedItem = useEditor((state) => state.selectedItem)
  const setSelectedItem = useEditor((state) => state.setSelectedItem)
  const setMode = useEditor((state) => state.setMode)
  const setTool = useEditor((state) => state.setTool)

  const sourceItems = itemsOverride ?? CATALOG_ITEMS
  // Server-provided results bypass all local filtering; otherwise filter by category/search/tags
  const filteredItems =
    overrideItems ??
    (() => {
      const categoryItems = search
        ? sourceItems
        : sourceItems.filter((item) => itemMatchesCatalogCategory(item, category))
      return categoryItems.filter((item) => {
        const tags = item.tags ?? []
        if (activePlacementTag && !tags.includes(activePlacementTag)) return false
        if (activeFunctionalTag && !tags.includes(activeFunctionalTag)) return false
        if (!itemMatchesSearch(item, search)) return false
        return true
      })
    })()

  if (filteredItems.length === 0 && emptyState) {
    return <>{emptyState}</>
  }

  return (
    <div className="grid grid-cols-2 gap-1.5">
      {leadingTile ? <div className="col-span-2 mb-1">{leadingTile}</div> : null}
      {filteredItems.map((item, index) => {
        const displayName = getItemDisplayName(item)
        const isSelected = selectedItem?.src === item?.src
        const typeLabel = getItemTypeLabel(item, category)
        return (
          <div
            className={cn(
              'group flex min-h-10 items-center gap-2 rounded-lg border border-border/50 bg-[#2C2C2E]/70 px-2 py-1.5 text-left transition-[background-color,border-color,color,box-shadow] hover:cursor-pointer hover:border-primary/35 hover:bg-white/5 hover:text-foreground',
              isSelected && 'border-[#a684ff]/70 bg-[#a684ff]/10 text-foreground shadow-sm',
            )}
            key={`${item.src}-${index}`}
            onClick={() => {
              useViewer.getState().setSelection({ selectedIds: [], zoneId: null })
              setSelectedItem(item)
              setTool('item')
              setMode('build')
            }}
            onKeyDown={(event) => {
              if (event.key !== 'Enter' && event.key !== ' ') return
              event.preventDefault()
              setSelectedItem(item)
              setTool('item')
              setMode('build')
            }}
            role="button"
            tabIndex={0}
          >
            <div
              className={cn(
                'flex size-6 shrink-0 items-center justify-center rounded-md bg-muted/70 text-muted-foreground transition-colors group-hover:bg-muted group-hover:text-foreground',
                isSelected && 'bg-[#a684ff]/15 text-[#c7adff]',
              )}
            >
              <Icon aria-hidden className="size-3.5" icon={getItemIcon(item, category)} />
            </div>
            <div className="min-w-0 flex-1">
              <div className="truncate font-medium text-[12px] text-foreground leading-4">
                {displayName}
              </div>
              <div className="mt-0.5 flex items-center gap-1.5 text-[9px] text-muted-foreground/75">
                <span
                  className={cn(
                    'rounded bg-muted/60 px-1.5 py-0.5 leading-none transition-colors group-hover:bg-muted/80 group-hover:text-muted-foreground',
                    isSelected && 'bg-[#a684ff]/15 text-[#c7adff]',
                  )}
                >
                  {typeLabel}
                </span>
              </div>
            </div>
            {onDeleteItem ? (
              <button
                aria-label={`\u5220\u9664 ${displayName}`}
                className="flex size-5 shrink-0 items-center justify-center rounded text-muted-foreground/70 opacity-0 transition-[background-color,color,opacity] hover:bg-destructive/15 hover:text-destructive group-hover:opacity-100"
                onClick={(event) => {
                  event.preventDefault()
                  event.stopPropagation()
                  onDeleteItem(item)
                }}
                title={'\u5220\u9664'}
                type="button"
              >
                {'\u00d7'}
              </button>
            ) : null}
          </div>
        )
      })}
    </div>
  )
}
