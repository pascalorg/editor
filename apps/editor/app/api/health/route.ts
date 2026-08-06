export function GET() {
  return Response.json({
    status: 'ok',
    app: 'editor',
    version: process.env.PASCAL_RUNTIME_VERSION ?? null,
    instanceId: process.env.PASCAL_INSTANCE_ID ?? null,
    timestamp: new Date().toISOString(),
  })
}
