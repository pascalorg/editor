export function GET() {
  return Response.json({ status: 'ok', app: 'editor', timestamp: new Date().toISOString() })
}
