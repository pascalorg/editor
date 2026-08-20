import { getDocsMarkdownSection, isMarkdownSectionId } from '@/lib/docs.md'

function notFound() {
  return new Response('Section not found.\n', {
    status: 404,
    headers: { 'content-type': 'text/plain; charset=utf-8' },
  })
}

export async function GET(_request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  if (!slug.endsWith('.md')) {
    return notFound()
  }

  const sectionId = slug.slice(0, -'.md'.length)
  const markdown = isMarkdownSectionId(sectionId)
    ? getDocsMarkdownSection(sectionId, { context: true })
    : null
  if (!markdown) {
    return notFound()
  }

  return new Response(markdown, {
    headers: {
      'content-type': 'text/markdown; charset=utf-8',
      'cache-control': 'public, max-age=3600',
    },
  })
}
