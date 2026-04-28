import { prisma } from '@/lib/prisma'
import Link from 'next/link'
import { Search, Download, Tag } from 'lucide-react'

const POPULAR_TAGS = ['residential', 'commercial', 'interior', 'landscape', 'modern', 'industrial', 'concept']

type SearchParams = { tag?: string; q?: string }

export default async function MarketplacePage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>
}) {
  const { tag, q } = await searchParams

  const assets = await prisma.marketplaceAsset.findMany({
    where: {
      isPublished: true,
      ...(tag ? { tags: { has: tag } } : {}),
      ...(q ? { title: { contains: q, mode: 'insensitive' } } : {}),
    },
    include: {
      author: { select: { id: true, name: true, image: true } },
      project: { select: { thumbnailUrl: true } },
    },
    orderBy: { cloneCount: 'desc' },
    take: 60,
  })

  return (
    <div className="min-h-screen bg-[#0A0A0A] text-white">
      {/* Fixed ambient glow */}
      <div className="fixed top-0 left-1/2 -translate-x-1/2 w-[800px] h-64 bg-indigo-600/8 blur-[120px] rounded-full pointer-events-none" />

      {/* Header */}
      <div className="border-b border-white/[0.06] bg-white/[0.02] backdrop-blur-xl sticky top-0 z-20">
        <div className="max-w-7xl mx-auto px-6 py-5">
          <div className="flex items-center gap-4 mb-5">
            <div>
              <h1 className="text-xl font-bold">Marketplace</h1>
              <p className="text-zinc-500 text-sm">Explore and clone architectural scenes from the community</p>
            </div>
          </div>

          {/* Search + tag filters */}
          <div className="flex flex-col sm:flex-row gap-3">
            <form method="GET" className="relative flex-1 max-w-sm">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500 pointer-events-none" />
              <input
                name="q"
                defaultValue={q}
                placeholder="Search assets…"
                className="w-full pl-9 pr-4 py-2 bg-white/[0.04] border border-white/[0.08] rounded-xl text-sm text-white placeholder-zinc-600 focus:outline-none focus:border-indigo-500/40 transition-all"
              />
              {tag && <input type="hidden" name="tag" value={tag} />}
            </form>
            <div className="flex items-center gap-2 flex-wrap">
              <Link
                href="/marketplace"
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border transition-all ${
                  !tag ? 'border-indigo-500/30 bg-indigo-500/10 text-indigo-300' : 'border-white/[0.08] text-zinc-400 hover:border-white/[0.14] hover:text-white'
                }`}
              >
                All
              </Link>
              {POPULAR_TAGS.map((t) => (
                <Link
                  key={t}
                  href={`/marketplace?tag=${t}`}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border transition-all ${
                    tag === t ? 'border-indigo-500/30 bg-indigo-500/10 text-indigo-300' : 'border-white/[0.08] text-zinc-400 hover:border-white/[0.14] hover:text-white'
                  }`}
                >
                  <Tag className="w-3 h-3" /> {t}
                </Link>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Grid */}
      <div className="max-w-7xl mx-auto px-6 py-8">
        {assets.length === 0 ? (
          <div className="py-24 text-center">
            <p className="text-zinc-500 text-sm">No assets found. Be the first to publish!</p>
          </div>
        ) : (
          <div className="columns-1 sm:columns-2 lg:columns-3 xl:columns-4 gap-4 space-y-4">
            {assets.map((asset) => (
              <div key={asset.id} className="break-inside-avoid">
                <AssetCard asset={asset} />
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

type AssetCardProps = {
  asset: {
    id: string
    title: string
    description: string | null
    tags: string[]
    cloneCount: number
    thumbnailUrl: string | null
    project: { thumbnailUrl: string | null }
    author: { id: string; name: string | null; image: string | null }
  }
}

function AssetCard({ asset }: AssetCardProps) {
  const thumb = asset.thumbnailUrl ?? asset.project.thumbnailUrl
  return (
    <Link href={`/marketplace/${asset.id}`} className="block group">
      <div className="rounded-2xl border border-white/[0.07] bg-white/[0.03] overflow-hidden hover:border-indigo-500/25 hover:bg-white/[0.05] transition-all duration-300 hover:shadow-xl hover:shadow-indigo-500/5">
        {/* Thumbnail */}
        <div className="aspect-[4/3] bg-zinc-950 relative overflow-hidden">
          {thumb ? (
            <img src={thumb} alt={asset.title} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500 opacity-70" />
          ) : (
            <div className="w-full h-full bg-[linear-gradient(rgba(255,255,255,0.015)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.015)_1px,transparent_1px)] bg-[size:32px_32px]" />
          )}
          <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent" />
          {/* Clone count badge */}
          <div className="absolute bottom-2 right-2 flex items-center gap-1 px-2 py-0.5 rounded-md bg-black/60 backdrop-blur-sm border border-white/10 text-[11px] text-zinc-300">
            <Download className="w-3 h-3" /> {asset.cloneCount}
          </div>
        </div>
        <div className="p-3.5">
          <h3 className="font-semibold text-sm group-hover:text-indigo-300 transition-colors line-clamp-1">{asset.title}</h3>
          {/* Author */}
          <div className="flex items-center gap-2 mt-2">
            <div className="w-5 h-5 rounded-full bg-gradient-to-br from-indigo-500 to-violet-600 flex items-center justify-center text-[9px] font-bold text-white flex-shrink-0">
              {(asset.author.name?.[0] ?? 'A').toUpperCase()}
            </div>
            <span className="text-[11px] text-zinc-500 truncate">{asset.author.name ?? 'Anonymous'}</span>
          </div>
          {/* Tags */}
          {asset.tags.length > 0 && (
            <div className="flex flex-wrap gap-1 mt-2.5">
              {asset.tags.slice(0, 3).map((t: string) => (
                <span key={t} className="px-2 py-0.5 rounded-md bg-white/[0.04] border border-white/[0.07] text-[10px] text-zinc-500">
                  {t}
                </span>
              ))}
            </div>
          )}
        </div>
      </div>
    </Link>
  )
}
