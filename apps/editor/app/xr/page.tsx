import { XRPreviewEnvironment } from '@/components/xr/xr-preview-environment'

export default async function LocalXRPreviewPage({
  searchParams,
}: {
  searchParams: Promise<{ source?: string }>
}) {
  const { source } = await searchParams
  return <XRPreviewEnvironment liveSnapshot={source === 'live'} />
}
