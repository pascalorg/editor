import { docsMarkdown, getDocsMarkdownSection } from '@/lib/docs.md'

export function GET(request: Request) {
  const section = new URL(request.url).searchParams.get('section')
  const markdown = section ? getDocsMarkdownSection(section, { context: true }) : docsMarkdown

  if (!markdown) {
    return new Response('Section not found.\n', {
      status: 404,
      headers: {
        'content-type': 'text/plain; charset=utf-8',
      },
    })
  }

  return new Response(markdown, {
    headers: {
      'content-type': 'text/markdown; charset=utf-8',
      'cache-control': 'public, max-age=3600',
    },
  })
}
