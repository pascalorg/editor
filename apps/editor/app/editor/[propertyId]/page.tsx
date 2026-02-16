'use client'

import Editor from '@/components/editor'
import { useParams } from 'next/navigation'
import { useEffect, useLayoutEffect } from 'react'
import { usePropertyStore } from '@/features/community/lib/properties/store'
import { useAuth } from '@/features/community/lib/auth/hooks'

export default function EditorPage() {
  const params = useParams()
  const propertyId = params.propertyId as string
  const { isAuthenticated } = useAuth()
  const setActiveProperty = usePropertyStore((state) => state.setActiveProperty)

  // Use layoutEffect to set active property BEFORE the editor renders and hooks run
  useLayoutEffect(() => {
    // For authenticated users with cloud properties, set the active property from URL
    if (isAuthenticated && propertyId && !propertyId.startsWith('local_')) {
      setActiveProperty(propertyId)
    }
  }, [propertyId, isAuthenticated, setActiveProperty])

  return (
    <div className="flex h-screen w-full max-w-screen">
      <div className="relative h-full w-full">
        <Editor propertyId={propertyId} />
      </div>
    </div>
  )
}
