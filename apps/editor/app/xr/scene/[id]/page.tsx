import { XRPreviewEnvironment } from '@/components/xr/xr-preview-environment'

export default async function SceneXRPreviewPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ source?: string }>
}) {
  const { id } = await params
  const { source } = await searchParams
  return <XRPreviewEnvironment liveSnapshot={source === 'live'} sceneId={id} />
}
