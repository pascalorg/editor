import { notFound } from 'next/navigation'
import { getServerSession } from 'next-auth/next'
import { prisma } from '@/lib/prisma'
import { authOptions } from '@/lib/auth'
import Link from 'next/link'
import { Download, Tag, ArrowLeft, Globe } from 'lucide-react'
import { CloneButton } from './_components/CloneButton'

export default async function AssetDetailPage({
  params,
}: {
  params: Promise<{ assetId: string }>
}) {
  const { assetId } = await params
  const [session, asset] = await Promise.all([
    getServerSession(authOptions),
    prisma.marketplaceAsset.findUnique({
      where: { id: assetId, isPublished: true },
      include: {
        author: {
          select: {
            id: true,
            name: true,
            image: true,
            bio: true,
            publishedAssets: {
              where: { isPublished: true },
              select: { id: true, title: true, thumbnailUrl: true, cloneCount: true },
              orderBy: { cloneCount: 'desc' },
              take: 6,
            },
          },
        },
        project: { select: { thumbnailUrl: true, name: true } },
      },
    }),
  ])

  if (!asset) notFound()

  const isAuthenticated = !!session?.user

  return (
    <div className="min-h-screen bg-[#0A0A0A] text-white">
      <div className="fixed top-0 right-0 w-[500px] h-[400px] bg-indigo-600/6 blur-[140px] rounded-full pointer-events-none" />

      <div className="max-w-6xl mx-auto px-6 py-8">
        {/* Back nav */}
        <Link href="/marketplace" className="inline-flex items-center gap-2 text-zinc-500 hover:text-white text-sm transition-colors mb-8">
          <ArrowLeft className="w-4 h-4" /> Back to Marketplace
        </Link>

        <div className="grid grid-cols-1 lg:grid-cols-[1fr_380px] gap-8">
          {/* Left: Asset details */}
          <div>
            {/* Thumbnail */}
            <div className="aspect-[16/10] rounded-2xl overflow-hidden border border-white/[0.07] bg-zinc-950 mb-6">
              {(asset.thumbnailUrl ?? asset.project.thumbnailUrl) ? (
                <img
                  src={asset.thumbnailUrl ?? asset.project.thumbnailUrl ?? ''}
                  alt={asset.title}
                  className="w-full h-full object-cover opacity-80"
                />
              ) : (
                <div className="w-full h-full bg-[linear-gradient(rgba(255,255,255,0.015)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.015)_1px,transparent_1px)] bg-[size:40px_40px] flex items-center justify-center">
                  <Globe className="w-16 h-16 text-zinc-700" />
                </div>
              )}
            </div>

            <h1 className="text-2xl font-bold mb-3">{asset.title}</h1>
            {asset.description && (
              <p className="text-zinc-400 text-sm leading-relaxed mb-5">{asset.description}</p>
            )}

            {asset.tags.length > 0 && (
              <div className="flex flex-wrap gap-2 mb-8">
                {asset.tags.map((t: string) => (
                  <Link
                    key={t}
                    href={`/marketplace?tag=${t}`}
                    className="flex items-center gap-1.5 px-3 py-1 rounded-lg border border-white/[0.08] bg-white/[0.03] text-xs text-zinc-400 hover:border-indigo-500/30 hover:text-indigo-300 transition-all"
                  >
                    <Tag className="w-3 h-3" /> {t}
                  </Link>
                ))}
              </div>
            )}

            {/* Stats */}
            <div className="flex items-center gap-6 py-4 border-t border-white/[0.06]">
              <div className="flex items-center gap-2 text-sm text-zinc-400">
                <Download className="w-4 h-4 text-indigo-400" />
                <span><strong className="text-white">{asset.cloneCount}</strong> clones</span>
              </div>
            </div>
          </div>

          {/* Right: Creator profile + clone CTA */}
          <div className="space-y-4">
            {/* Clone CTA card */}
            <div className="rounded-2xl border border-white/[0.08] bg-white/[0.03] backdrop-blur-xl p-5">
              <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/10 to-transparent rounded-t-2xl" />
              <h3 className="font-semibold text-sm mb-1">Clone to Your Workspace</h3>
              <p className="text-xs text-zinc-500 mb-4">
                Creates a copy in your drafts. All 3D assets are shared (no extra storage cost).
              </p>
              <CloneButton assetId={asset.id} isAuthenticated={isAuthenticated} />
              {!isAuthenticated && (
                <p className="text-center text-xs text-zinc-600 mt-2">
                  <Link href="/login" className="text-indigo-400 hover:text-indigo-300">Sign in</Link> to clone
                </p>
              )}
            </div>

            {/* Creator profile card */}
            <div className="rounded-2xl border border-white/[0.07] bg-white/[0.03] overflow-hidden">
              {/* Banner */}
              <div className="h-20 bg-gradient-to-br from-indigo-500/20 to-violet-600/20 relative">
                <div className="absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0.03)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.03)_1px,transparent_1px)] bg-[size:24px_24px]" />
              </div>

              <div className="px-5 pb-5">
                {/* Avatar */}
                <div className="-mt-6 mb-3">
                  <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-indigo-500 to-violet-600 border-2 border-[#0A0A0A] flex items-center justify-center text-sm font-bold text-white shadow-lg">
                    {(asset.author.name?.[0] ?? 'A').toUpperCase()}
                  </div>
                </div>

                <h4 className="font-bold text-sm">{asset.author.name ?? 'Anonymous'}</h4>
                {asset.author.bio && (
                  <p className="text-xs text-zinc-500 mt-1 leading-relaxed">{asset.author.bio}</p>
                )}

                {/* Author's other published assets */}
                {asset.author.publishedAssets.length > 1 && (
                  <div className="mt-4">
                    <p className="text-[11px] font-semibold text-zinc-500 uppercase tracking-wider mb-2">More by this creator</p>
                    <div className="grid grid-cols-3 gap-1.5">
                      {asset.author.publishedAssets
                        .filter((a: { id: string }) => a.id !== asset.id)
                        .slice(0, 6)
                        .map((a: { id: string; title: string; thumbnailUrl: string | null }) => (
                          <Link key={a.id} href={`/marketplace/${a.id}`} className="group">
                            <div className="aspect-square rounded-lg overflow-hidden bg-zinc-900 border border-white/[0.06] group-hover:border-indigo-500/30 transition-colors">
                              {a.thumbnailUrl ? (
                                <img src={a.thumbnailUrl} alt={a.title} className="w-full h-full object-cover opacity-60 group-hover:opacity-80 transition-opacity" />
                              ) : (
                                <div className="w-full h-full bg-zinc-900" />
                              )}
                            </div>
                          </Link>
                        ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
