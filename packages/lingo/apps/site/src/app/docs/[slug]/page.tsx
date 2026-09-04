import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'

import { DocsPageActions } from '@/components/site/docs-page-actions'
import { getDocsMarkdownSection, markdownSectionIds } from '@/lib/docs.md'
import { docsPages, getDocsPage } from '@/lib/docs-catalog'
import { renderDocsSectionHtml } from '@/lib/docs-markdown-html'

const SITE_URL = 'https://lingo.pascal.app'

export const dynamicParams = false

export function generateStaticParams() {
  return markdownSectionIds.map((id) => ({ slug: id }))
}

function sectionPage(slug: string) {
  const page = getDocsPage(slug)
  if (!(page && markdownSectionIds.includes(slug))) {
    return null
  }
  return page
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>
}): Promise<Metadata> {
  const { slug } = await params
  const page = sectionPage(slug)
  if (!page) {
    return {}
  }

  const title = slug === 'introduction' ? 'Introduction' : page.title
  const description = page.description

  return {
    title,
    description,
    keywords: [...page.keywords, 'lingo', 'natural language', 'parser'],
    alternates: {
      canonical: `/docs/${slug}`,
      types: { 'text/markdown': `/docs/${slug}.md` },
    },
    // metadata.openGraph replaces (not merges) the layout's; repeat shared fields.
    openGraph: {
      type: 'article',
      url: `/docs/${slug}`,
      siteName: 'lingo',
      title: `${title} | lingo`,
      description,
    },
  }
}

export default async function DocsSectionPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const page = sectionPage(slug)
  const markdown = getDocsMarkdownSection(slug)
  if (!(page && markdown)) {
    notFound()
  }

  const html = await renderDocsSectionHtml(markdown)
  const markdownWithContext = getDocsMarkdownSection(slug, { context: true }) ?? markdown
  const group = docsPages.find((item) => item.id === slug)?.group
  const title = slug === 'introduction' ? 'Introduction' : page.title

  const index = markdownSectionIds.indexOf(slug)
  const previousId = index > 0 ? markdownSectionIds[index - 1] : null
  const nextId = index < markdownSectionIds.length - 1 ? markdownSectionIds[index + 1] : null
  const previous = previousId ? getDocsPage(previousId) : null
  const next = nextId ? getDocsPage(nextId) : null

  const jsonLd = [
    {
      '@context': 'https://schema.org',
      '@type': 'TechArticle',
      headline: `${title} — lingo docs`,
      description: page.description,
      url: `${SITE_URL}/docs/${slug}`,
      inLanguage: 'en',
      isPartOf: {
        '@type': 'WebSite',
        name: 'lingo',
        url: `${SITE_URL}/`,
      },
      about: {
        '@type': 'SoftwareSourceCode',
        name: 'lingo',
        codeRepository: 'https://github.com/pascalorg/lingo',
        programmingLanguage: 'TypeScript',
      },
    },
    {
      '@context': 'https://schema.org',
      '@type': 'BreadcrumbList',
      itemListElement: [
        { '@type': 'ListItem', position: 1, name: 'lingo', item: `${SITE_URL}/` },
        { '@type': 'ListItem', position: 2, name: 'Docs', item: `${SITE_URL}/docs` },
        { '@type': 'ListItem', position: 3, name: title, item: `${SITE_URL}/docs/${slug}` },
      ],
    },
  ]

  return (
    <>
      <script
        dangerouslySetInnerHTML={{
          __html: JSON.stringify(jsonLd).replace(/</g, '\\u003c'),
        }}
        type="application/ld+json"
      />
      <div className="mx-auto w-full max-w-7xl px-4 pt-6 pb-8 sm:px-6 sm:pt-8 lg:px-8">
        <article className="mx-auto w-full min-w-0 max-w-[48rem]">
          <nav aria-label="Breadcrumb" className="mb-6 text-muted-foreground text-sm">
            <ol className="flex flex-wrap items-center gap-1.5">
              <li>
                <Link className="transition-colors hover:text-foreground" href="/docs">
                  Docs
                </Link>
              </li>
              {group ? (
                <>
                  <li aria-hidden="true">/</li>
                  <li>{group}</li>
                </>
              ) : null}
              <li aria-hidden="true">/</li>
              <li aria-current="page" className="text-foreground">
                {title}
              </li>
            </ol>
          </nav>

          <header className="flex flex-col gap-3">
            <div className="flex items-start justify-between gap-3">
              <h1 className="font-semibold text-3xl">{title}</h1>
              <DocsPageActions
                className="shrink-0"
                markdown={markdownWithContext}
                markdownHref={`/docs/${slug}.md`}
              />
            </div>
            <p className="max-w-[65ch] text-muted-foreground">{page.description}</p>
            <p className="text-muted-foreground text-sm">
              Prefer the live demos?{' '}
              <Link
                className="underline underline-offset-2 transition-colors hover:text-foreground"
                href={`/docs#${slug}`}
              >
                Open this section in the interactive docs
              </Link>
              .
            </p>
          </header>

          <div
            className="docs-prose mt-8"
            // Trust boundary: repo-authored docs markdown rendered through
            // marked + Shiki only — no user-supplied content reaches this sink.
            dangerouslySetInnerHTML={{ __html: html }}
          />

          <nav
            aria-label="Section pagination"
            className="mt-12 flex flex-col gap-3 border-border border-t pt-6 sm:flex-row sm:justify-between"
          >
            {previous && previousId ? (
              <Link
                className="group flex flex-col gap-0.5 rounded-lg text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
                href={`/docs/${previousId}`}
              >
                <span className="text-muted-foreground text-xs">Previous</span>
                <span className="font-medium transition-colors group-hover:text-foreground">
                  {previousId === 'introduction' ? 'Introduction' : previous.title}
                </span>
              </Link>
            ) : (
              <span />
            )}
            {next && nextId ? (
              <Link
                className="group flex flex-col gap-0.5 rounded-lg text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring sm:items-end sm:text-right"
                href={`/docs/${nextId}`}
              >
                <span className="text-muted-foreground text-xs">Next</span>
                <span className="font-medium transition-colors group-hover:text-foreground">
                  {nextId === 'introduction' ? 'Introduction' : next.title}
                </span>
              </Link>
            ) : null}
          </nav>
        </article>
      </div>
    </>
  )
}
