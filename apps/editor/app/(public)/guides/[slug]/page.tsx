import type { Lang } from '@panel/lib/types'
import type { Metadata } from 'next'
import { cookies } from 'next/headers'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { allGuideSlugs, guidePageFor, guidesFor } from '@/lib/guides-content'

export const dynamic = 'force-dynamic'

interface Params {
  params: Promise<{ slug: string }>
}

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { slug } = await params
  const page = guidePageFor('en', slug)
  return { title: page?.title ?? 'Documentation' }
}

/** One documentation page: title, description, then its sections. */
export default async function GuidePage({ params }: Params) {
  const { slug } = await params
  if (!allGuideSlugs().includes(slug)) notFound()

  const jar = await cookies()
  const lang: Lang = jar.get('digitaltwin_lang')?.value === 'tr' ? 'tr' : 'en'
  const page = guidePageFor(lang, slug)
  if (!page) notFound()

  // Where this page sits, so the reader can step to the next one.
  const flat = guidesFor(lang).groups.flatMap((group) => group.pages)
  const index = flat.findIndex((p) => p.slug === slug)
  const previous = index > 0 ? flat[index - 1] : undefined
  const next = index >= 0 && index < flat.length - 1 ? flat[index + 1] : undefined

  return (
    <article className="flex flex-col gap-8">
      <header className="flex flex-col gap-[7px]">
        <Link
          className="font-mono text-[10px] text-muted-fg uppercase tracking-[0.14em] no-underline hover:text-fg"
          href="/guides"
        >
          ← {guidesFor(lang).title}
        </Link>
        <h1 className="m-0 font-semibold text-[26px] leading-[1.2] tracking-[-0.02em]">
          {page.title}
        </h1>
        <p className="m-0 text-[14px] text-muted-fg leading-[1.65]">{page.description}</p>
      </header>

      {page.blocks.map((block) => (
        <section className="flex flex-col gap-[10px]" key={block.heading}>
          <h2 className="m-0 font-semibold text-[16px] tracking-[-0.01em]">{block.heading}</h2>

          {block.body?.map((paragraph) => (
            <p className="m-0 text-[13.5px] text-fg leading-[1.7]" key={paragraph}>
              {paragraph}
            </p>
          ))}

          {block.points ? (
            <ul className="m-0 flex list-none flex-col gap-[6px] p-0">
              {block.points.map((point) => (
                <li className="flex gap-[9px] text-[13.5px] text-fg leading-[1.65]" key={point}>
                  <span
                    aria-hidden
                    className="mt-[8px] h-[4px] w-[4px] shrink-0 rounded-full bg-brand"
                  />
                  <span>{point}</span>
                </li>
              ))}
            </ul>
          ) : null}

          {block.table ? (
            <div className="overflow-x-auto rounded-[12px] border border-border bg-surface">
              <table className="w-full border-collapse text-[13px]">
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
                        <span className="rounded-[5px] border border-border bg-field px-[7px] py-[2px] font-mono text-[11.5px] text-fg">
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
        <nav className="flex flex-wrap gap-[10px] border-border border-t pt-5">
          {previous ? (
            <Link
              className="flex min-w-0 flex-1 flex-col gap-[3px] rounded-[10px] border border-border bg-surface p-[12px] no-underline transition-colors hover:bg-hover"
              href={`/guides/${previous.slug}`}
            >
              <span className="font-mono text-[9.5px] text-muted-fg uppercase tracking-[0.12em]">
                ←
              </span>
              <span className="font-medium text-[13px] text-fg">{previous.title}</span>
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
              <span className="font-medium text-[13px] text-fg">{next.title}</span>
            </Link>
          ) : null}
        </nav>
      ) : null}
    </article>
  )
}
