/**
 * Database types for Supabase
 * Generated from database schema
 */

export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

export interface Database {
  public: {
    Tables: {
      properties: {
        Row: {
          id: string
          name: string
          owner_id: string
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          name: string
          owner_id: string
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          name?: string
          owner_id?: string
          created_at?: string
          updated_at?: string
        }
      }
      properties_addresses: {
        Row: {
          id: string
          property_id: string
          formatted_address: string
          street_number: string | null
          route: string | null
          locality: string | null
          administrative_area_level_1: string | null
          administrative_area_level_2: string | null
          country: string | null
          postal_code: string | null
          latitude: number | null
          longitude: number | null
          place_id: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          property_id: string
          formatted_address: string
          street_number?: string | null
          route?: string | null
          locality?: string | null
          administrative_area_level_1?: string | null
          administrative_area_level_2?: string | null
          country?: string | null
          postal_code?: string | null
          latitude?: number | null
          longitude?: number | null
          place_id?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          property_id?: string
          formatted_address?: string
          street_number?: string | null
          route?: string | null
          locality?: string | null
          administrative_area_level_1?: string | null
          administrative_area_level_2?: string | null
          country?: string | null
          postal_code?: string | null
          latitude?: number | null
          longitude?: number | null
          place_id?: string | null
          created_at?: string
          updated_at?: string
        }
      }
      properties_models: {
        Row: {
          id: string
          property_id: string
          name: string
          version: number
          draft: boolean
          scene_graph: Json | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          property_id: string
          name: string
          version?: number
          draft?: boolean
          scene_graph?: Json | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          property_id?: string
          name?: string
          version?: number
          draft?: boolean
          scene_graph?: Json | null
          created_at?: string
          updated_at?: string
        }
      }
    }
    Views: {}
    Functions: {}
    Enums: {}
  }
}
