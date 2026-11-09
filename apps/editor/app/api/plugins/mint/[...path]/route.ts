import { handleMintPascalRequest } from '@mint/pascal-plugin/server'
import { resolvePublicUrl } from '@/lib/public-url'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const route = (request: Request) =>
  handleMintPascalRequest(request, { origin: resolvePublicUrl(request) })

export { route as GET, route as POST }
