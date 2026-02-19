/**
 * Project-related type definitions
 * Isolated from monorepo database schema
 */

// Database table row types
export type DbProject = {
  id: string
  name: string
  owner_id: string
  organization_id: string | null
  address_id: string | null
  created_at: string
  updated_at: string
  is_private: boolean
  show_scans_public: boolean
  show_guides_public: boolean
  views: number
  likes: number
  thumbnail_url: string | null
}

export type DbProjectAddress = {
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

export type DbProjectModel = {
  id: string
  project_id: string
  version: number
  scene_graph: any
  created_at: string
  updated_at: string
  deleted_at: string | null
}

export type DbProjectLike = {
  id: string
  project_id: string
  user_id: string
  created_at: string
}

// Database schema type for Supabase
export type Database = {
  public: {
    Tables: {
      projects: {
        Row: DbProject
        Insert: Omit<DbProject, 'created_at' | 'updated_at' | 'views' | 'likes' | 'show_scans_public' | 'show_guides_public'> & { show_scans_public?: boolean; show_guides_public?: boolean }
        Update: Partial<Omit<DbProject, 'id' | 'created_at' | 'updated_at'>>
      }
      projects_addresses: {
        Row: DbProjectAddress
        Insert: Omit<DbProjectAddress, 'created_at' | 'updated_at'>
        Update: Partial<Omit<DbProjectAddress, 'id' | 'created_at' | 'updated_at'>>
      }
      projects_models: {
        Row: DbProjectModel
        Insert: Omit<DbProjectModel, 'created_at' | 'updated_at' | 'deleted_at'>
        Update: Partial<Omit<DbProjectModel, 'id' | 'created_at' | 'updated_at'>>
      }
      projects_likes: {
        Row: DbProjectLike
        Insert: Omit<DbProjectLike, 'created_at'>
        Update: Partial<Omit<DbProjectLike, 'id' | 'created_at'>>
      }
    }
    Functions: {
      increment_project_views: {
        Args: { project_id: string }
        Returns: undefined
      }
      get_project_like_count: {
        Args: { project_id: string }
        Returns: number
      }
    }
  }
}

export type ProjectOwner = {
  id: string
  name: string
  username: string | null
  image: string | null
}

export type Project = {
  id: string
  name: string
  owner_id: string
  organization_id: string | null
  address_id: string | null
  created_at: string
  updated_at: string
  // Community features
  is_private: boolean
  show_scans_public: boolean
  show_guides_public: boolean
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
  } | null
  owner?: ProjectOwner | null
}

export type CreateProjectParams = {
  name: string
  center?: [number, number]
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
