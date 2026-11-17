import { notFound } from 'next/navigation'

export default async function DeliveryFixturePage() {
  if (process.env.NODE_ENV !== 'development') notFound()
  const { default: DeliveryFixture } = await import('./fixture-client')
  return <DeliveryFixture />
}
