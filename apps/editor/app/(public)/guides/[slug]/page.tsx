import type { Lang } from '@panel/lib/types'
import type { Metadata } from 'next'
import { cookies } from 'next/headers'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { DocsShell } from '@/components/public/docs-shell'
import { allGuideSlugs, guidePageFor, guidesFor } from '@/lib/guides-content'
import { slugify } from '@/lib/slugify'

export const dynamic = 'force-dynamic'

interface Params {
  params: Promise<{ slug: string }>
}

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { slug } = await params
  const page = guidePageFor('en', slug)
  return { title: page?.title ?? 'Documentation' }
}

/** One documentation page: heading, description, sections, and where to go next. */
export default async function GuidePage({ params }: Params) {
  const { slug } = await params
  if (!allGuideSlugs().includes(slug)) notFound()

  const jar = await cookies()
  const lang: Lang = jar.get('digitaltwin_lang')?.value === 'tr' ? 'tr' : 'en'
  const guides = guidesFor(lang)
  const page = guidePageFor(lang, slug)
  if (!page) notFound()

  const group = guides.groups.find((g) => g.pages.some((p) => p.slug === slug))
  const flat = guides.groups.flatMap((g) => g.pages)
  const index = flat.findIndex((p) => p.slug === slug)
  const previous = index > 0 ? flat[index - 1] : undefined
  const next = index >= 0 && index < flat.length - 1 ? flat[index + 1] : undefined

  const nav = guides.groups.map((g) => ({
    title: g.title,
    pages: g.pages.map((p) => ({ slug: p.slug, title: p.title })),
  }))

  return (
    <DocsShell
      groups={nav}
      onThisPage={page.blocks.map((block) => ({
        id: slugify(block.heading),
        title: block.heading,
      }))}
      onThisPageLabel={lang === 'tr' ? 'Bu sayfada' : 'On this page'}
    >
      <article className="flex max-w-[720px] flex-col gap-9">
        <header className="flex flex-col gap-[7px]">
          {group ? (
            <span className="font-mono text-[10px] text-muted-fg uppercase tracking-[0.14em]">
              {group.title}
            </span>
          ) : null}
          <h1 className="m-0 font-bold text-[32px] leading-[1.15] tracking-[-0.025em]">
            {page.title}
          </h1>
          <p className="m-0 text-[15px] text-muted-fg leading-[1.65]">{page.description}</p>
        </header>

        {page.blocks.map((block) => (
          <section
            className="flex scroll-mt-[86px] flex-col gap-[10px]"
            id={slugify(block.heading)}
            key={block.heading}
          >
            <h2 className="m-0 font-semibold text-[19px] tracking-[-0.015em]">{block.heading}</h2>

            {block.body?.map((paragraph) => (
              <p className="m-0 text-[14.5px] text-fg leading-[1.75]" key={paragraph}>
                {paragraph}
              </p>
            ))}

            {block.points ? (
              <ul className="m-0 flex list-none flex-col gap-[7px] p-0">
                {block.points.map((point) => (
                  <li className="flex gap-[10px] text-[14.5px] text-fg leading-[1.7]" key={point}>
                    <span
                      aria-hidden
                      className="mt-[9px] h-[4px] w-[4px] shrink-0 rounded-full bg-brand"
                    />
                    <span>{point}</span>
                  </li>
                ))}
              </ul>
            ) : null}

            {block.table ? (
              <div className="overflow-x-auto rounded-[12px] border border-border bg-surface">
                <table className="w-full border-collapse text-[13.5px]">
                  <thead>
                    <tr className="border-border border-b text-left font-mono text-[9.5px] text-muted-fg uppercase tracking-[0.12em]">
                      <th className="px-[13px] py-[9px] font-medium">{block.table.columns[0]}</th>
                      <th className="px-[13px] py-[9px] font-medium">{block.table.columns[1]}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {block.table.rows.map(([key, value]) => (
                      <tr className="border-border-soft border-t" key={key}>
                        <td className="px-[13px] py-[9px] align-top">
                          <span className="rounded-[5px] border border-border bg-field px-[7px] py-[2px] font-mono text-[12px] text-fg">
                            {key}
                          </span>
                        </td>
                        <td className="px-[13px] py-[9px] text-muted-fg">{value}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}
          </section>
        ))}

        {previous || next ? (
          <nav className="flex flex-wrap gap-[10px] border-border border-t pt-6">
            {previous ? (
              <Link
                className="flex min-w-0 flex-1 flex-col gap-[3px] rounded-[10px] border border-border bg-surface p-[12px] no-underline transition-colors hover:bg-hover"
                href={`/guides/${previous.slug}`}
              >
                <span className="font-mono text-[9.5px] text-muted-fg uppercase tracking-[0.12em]">
                  ←
                </span>
                <span className="font-medium text-[13.5px] text-fg">{previous.title}</span>
              </Link>
            ) : null}
            {next ? (
              <Link
                className="flex min-w-0 flex-1 flex-col items-end gap-[3px] rounded-[10px] border border-border bg-surface p-[12px] no-underline transition-colors hover:bg-hover"
                href={`/guides/${next.slug}`}
              >
                <span className="font-mono text-[9.5px] text-muted-fg uppercase tracking-[0.12em]">
                  →
                </span>
                <span className="font-medium text-[13.5px] text-fg">{next.title}</span>
              </Link>
            ) : null}
          </nav>
        ) : null}
      </article>
    </DocsShell>
  )
}
