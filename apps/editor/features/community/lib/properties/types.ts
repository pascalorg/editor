/**
 * Property-related type definitions
 * Isolated from monorepo database schema
 */

// Database table row types
export type DbProperty = {
  id: string
  name: string
  owner_id: string
  organization_id: string | null
  address_id: string
  created_at: string
  updated_at: string
  is_private: boolean
  views: number
  likes: number
  thumbnail_url: string | null
}

export type DbPropertyAddress = {
  id: string
  street_number?: string
  route?: string
  city?: string
  state?: string
  postal_code?: string
  country?: string
  latitude?: string
  longitude?: string
  created_at: string
  updated_at: string
}

export type DbPropertyModel = {
  id: string
  property_id: string
  version: number
  scene_graph: any
  created_at: string
  updated_at: string
  deleted_at: string | null
}

export type DbPropertyLike = {
  id: string
  property_id: string
  user_id: string
  created_at: string
}

// Database schema type for Supabase
export type Database = {
  public: {
    Tables: {
      properties: {
        Row: DbProperty
        Insert: Omit<DbProperty, 'created_at' | 'updated_at' | 'views' | 'likes'>
        Update: Partial<Omit<DbProperty, 'id' | 'created_at' | 'updated_at'>>
      }
      properties_addresses: {
        Row: DbPropertyAddress
        Insert: Omit<DbPropertyAddress, 'created_at' | 'updated_at'>
        Update: Partial<Omit<DbPropertyAddress, 'id' | 'created_at' | 'updated_at'>>
      }
      properties_models: {
        Row: DbPropertyModel
        Insert: Omit<DbPropertyModel, 'created_at' | 'updated_at' | 'deleted_at'>
        Update: Partial<Omit<DbPropertyModel, 'id' | 'created_at' | 'updated_at'>>
      }
      property_likes: {
        Row: DbPropertyLike
        Insert: Omit<DbPropertyLike, 'created_at'>
        Update: Partial<Omit<DbPropertyLike, 'id' | 'created_at'>>
      }
    }
    Functions: {
      increment_property_views: {
        Args: { property_id: string }
        Returns: undefined
      }
      get_property_like_count: {
        Args: { property_id: string }
        Returns: number
      }
    }
  }
}

export type Property = {
  id: string
  name: string
  owner_id: string
  organization_id: string | null
  address_id: string
  created_at: string
  updated_at: string
  // Community features
  is_private: boolean
  views: number
  likes: number
  thumbnail_url: string | null
  address: {
    id: string
    street_number?: string
    route?: string
    city?: string
    state?: string
    postal_code?: string
    country?: string
    latitude?: string
    longitude?: string
  }
}

export type CreatePropertyParams = {
  name: string
  center: [number, number]
  streetNumber?: string
  route?: string
  routeShort?: string
  neighborhood?: string
  city?: string
  county?: string
  state?: string
  stateLong?: string
  postalCode?: string
  postalCodeSuffix?: string
  country?: string
  countryLong?: string
  rawJson?: Record<string, unknown>
  isPrivate?: boolean
  sceneGraph?: any
}
