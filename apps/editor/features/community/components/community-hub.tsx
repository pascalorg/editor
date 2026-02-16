'use client'

import { useEffect, useState } from 'react'
import { useAuth } from '../lib/auth/hooks'
import { useRouter } from 'next/navigation'
import { SignInDialog } from './sign-in-dialog'
import { PropertyGrid } from './property-grid'
import { CreatePropertyButton } from './create-property-button'
import { ProfileDropdown } from './profile-dropdown'
import { NewPropertyDialog } from './new-property-dialog'
import { getPublicProperties, getUserProperties } from '../lib/properties/actions'
import { getLocalProperties, createLocalProperty } from '../lib/local-storage/property-store'
import type { Property } from '../lib/properties/types'
import type { LocalProperty } from '../lib/local-storage/property-store'

export default function CommunityHub() {
  const { isAuthenticated, isLoading: authLoading, user } = useAuth()
  const router = useRouter()
  const [isSignInDialogOpen, setIsSignInDialogOpen] = useState(false)
  const [isNewPropertyDialogOpen, setIsNewPropertyDialogOpen] = useState(false)
  const [localPropertyToSave, setLocalPropertyToSave] = useState<LocalProperty | null>(null)
  const [publicProperties, setPublicProperties] = useState<Property[]>([])
  const [userProperties, setUserProperties] = useState<Property[]>([])
  const [localProperties, setLocalProperties] = useState<LocalProperty[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function loadProperties() {
      setLoading(true)

      // Load public properties (always)
      const publicResult = await getPublicProperties()
      if (publicResult.success) {
        setPublicProperties(publicResult.data || [])
      }

      // Load user properties if authenticated
      if (isAuthenticated) {
        const userResult = await getUserProperties()
        if (userResult.success) {
          setUserProperties(userResult.data || [])
        }
      }

      // Always load local properties
      setLocalProperties(getLocalProperties())

      setLoading(false)
    }

    if (!authLoading) {
      loadProperties()
    }
  }, [isAuthenticated, authLoading])

  const handleCreateProperty = async () => {
    if (!isAuthenticated) {
      // Create local property for guest
      const property = createLocalProperty('Untitled Property')
      router.push(`/editor/${property.id}`)
    } else {
      // Open property creation dialog for authenticated users
      setIsNewPropertyDialogOpen(true)
    }
  }

  const handlePropertyCreated = async (propertyId: string) => {
    // If this was a local property being saved, delete it from localStorage
    if (localPropertyToSave) {
      const { deleteLocalProperty } = await import('../lib/local-storage/property-store')
      deleteLocalProperty(localPropertyToSave.id)
      setLocalProperties(getLocalProperties())
      setLocalPropertyToSave(null)
    }

    // Reload properties and navigate to the new property
    const result = await getUserProperties()
    if (result.success) {
      setUserProperties(result.data || [])
    }
    router.push(`/editor/${propertyId}`)
  }

  const handleSaveLocalToCloud = (localProperty: LocalProperty) => {
    setLocalPropertyToSave(localProperty)
    setIsNewPropertyDialogOpen(true)
  }

  const handlePropertyClick = (propertyId: string) => {
    router.push(`/editor/${propertyId}`)
  }

  const handleViewProperty = (propertyId: string) => {
    router.push(`/viewer/${propertyId}`)
  }


  if (authLoading || loading) {
    return (
      <div className="flex h-screen w-full items-center justify-center">
        <p className="text-muted-foreground">Loading...</p>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b border-border bg-background/95 backdrop-blur sticky top-0 z-10">
        <div className="container mx-auto px-6 py-4">
          <div className="flex items-center justify-between">
            <h1 className="text-2xl font-bold">Hub</h1>
            {!isAuthenticated ? (
              <button
                onClick={() => setIsSignInDialogOpen(true)}
                className="rounded-lg bg-primary px-4 py-2 text-primary-foreground hover:bg-primary/90"
              >
                Sign In
              </button>
            ) : (
              <ProfileDropdown />
            )}
          </div>
        </div>
      </header>

      <main className="container mx-auto px-6 py-8 space-y-12">
        {/* User's Properties Section */}
        {isAuthenticated && (userProperties.length > 0 || localProperties.length > 0) && (
          <section>
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-xl font-semibold">My Properties</h2>
              <CreatePropertyButton onCreateProperty={handleCreateProperty} />
            </div>
            <PropertyGrid
              properties={[...userProperties, ...localProperties]}
              onPropertyClick={handlePropertyClick}
              onViewClick={handleViewProperty}
              onSaveToCloud={handleSaveLocalToCloud}
              showOwner={false}
              canEdit
              onUpdate={() => {
                // Reload properties after settings update
                if (!authLoading) {
                  getUserProperties().then((result) => {
                    if (result.success) {
                      setUserProperties(result.data || [])
                    }
                  })
                }
              }}
            />
          </section>
        )}

        {/* Local Properties Section (Guest Users) */}
        {!isAuthenticated && localProperties.length > 0 && (
          <section>
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-xl font-semibold">My Local Projects</h2>
              <CreatePropertyButton onCreateProperty={handleCreateProperty} />
            </div>
            <PropertyGrid
              properties={localProperties}
              onPropertyClick={handlePropertyClick}
              showOwner={false}
              isLocal
            />
          </section>
        )}

        {/* Create First Property CTA */}
        {!isAuthenticated && localProperties.length === 0 && (
          <section className="text-center py-12">
            <h2 className="text-2xl font-semibold mb-4">Get Started</h2>
            <p className="text-muted-foreground mb-6">
              Create your first property to start designing
            </p>
            <CreatePropertyButton onCreateProperty={handleCreateProperty} />
          </section>
        )}

        {/* Public Properties Section */}
        <section>
          <h2 className="text-xl font-semibold mb-6">Community Properties</h2>
          {publicProperties.length > 0 ? (
            <PropertyGrid
              properties={publicProperties}
              onPropertyClick={handleViewProperty}
              showOwner
            />
          ) : (
            <div className="text-center py-12 text-muted-foreground">
              No public properties yet
            </div>
          )}
        </section>
      </main>

      <SignInDialog open={isSignInDialogOpen} onOpenChange={setIsSignInDialogOpen} />
      <NewPropertyDialog
        open={isNewPropertyDialogOpen}
        onOpenChange={setIsNewPropertyDialogOpen}
        onSuccess={handlePropertyCreated}
        localPropertyData={
          localPropertyToSave
            ? {
                id: localPropertyToSave.id,
                name: localPropertyToSave.name,
                sceneGraph: localPropertyToSave.scene_graph,
              }
            : undefined
        }
      />
    </div>
  )
}
