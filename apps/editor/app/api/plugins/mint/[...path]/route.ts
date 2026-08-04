import { handleMintPascalRequest } from '@mint/pascal-plugin/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const route = (request: Request) => handleMintPascalRequest(request)

export { route as GET, route as POST }
