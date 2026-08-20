import { docsMarkdown } from '@/lib/docs.md'

export function GET() {
  return new Response(docsMarkdown, {
    headers: {
      'content-type': 'text/markdown; charset=utf-8',
      'cache-control': 'public, max-age=3600',
    },
  })
}
