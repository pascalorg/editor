import { buildLlmsIndex } from '@/lib/llms-index'

export function GET() {
  return new Response(buildLlmsIndex(), {
    headers: {
      'content-type': 'text/plain; charset=utf-8',
      'cache-control': 'public, max-age=3600',
    },
  })
}
