/** Minimal hand-written types for the permission schema.
 *  Replace with generated types (`supabase gen types typescript`) once
 *  the project is linked to a Supabase project. */

export type Json = string | number | boolean | null | { [key: string]: Json } | Json[]

export interface Database {
  public: {
    Tables: {
      user_profiles: {
        Row: {
          id: string
          display_name: string
          role: 'admin' | 'editor' | 'viewer'
          is_active: boolean
          created_at: string
          updated_at: string
        }
        Insert: {
          id: string
          display_name?: string
          role?: 'admin' | 'editor' | 'viewer'
          is_active?: boolean
          created_at?: string
          updated_at?: string
        }
        Update: {
          display_name?: string
          role?: 'admin' | 'editor' | 'viewer'
          is_active?: boolean
          updated_at?: string
        }
        Relationships: []
      }
      groups: {
        Row: {
          id: string
          name: string
          description: string | null
          color: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          name: string
          description?: string | null
          color?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          name?: string
          description?: string | null
          color?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      group_members: {
        Row: {
          id: string
          group_id: string
          user_id: string
          created_at: string
        }
        Insert: {
          id?: string
          group_id: string
          user_id: string
          created_at?: string
        }
        Update: {
          group_id?: string
          user_id?: string
        }
        Relationships: []
      }
      parameter_permissions: {
        Row: {
          id: string
          group_id: string
          node_kind: string
          parameter_key: string
          can_write: boolean
          created_at: string
        }
        Insert: {
          id?: string
          group_id: string
          node_kind: string
          parameter_key: string
          can_write?: boolean
          created_at?: string
        }
        Update: {
          can_write?: boolean
        }
        Relationships: []
      }
      custom_fields: {
        Row: {
          id: string
          key: string
          label: string
          field_type: 'text' | 'number' | 'date' | 'boolean' | 'enum'
          node_kind: string
          options: Json | null
          unit: string | null
          required: boolean
          sort_order: number
          created_at: string
        }
        Insert: {
          id?: string
          key: string
          label: string
          field_type: 'text' | 'number' | 'date' | 'boolean' | 'enum'
          node_kind?: string
          options?: Json | null
          unit?: string | null
          required?: boolean
          sort_order?: number
          created_at?: string
        }
        Update: {
          label?: string
          field_type?: 'text' | 'number' | 'date' | 'boolean' | 'enum'
          node_kind?: string
          options?: Json | null
          unit?: string | null
          required?: boolean
          sort_order?: number
        }
        Relationships: []
      }
      custom_field_permissions: {
        Row: {
          id: string
          custom_field_id: string
          group_id: string
          can_write: boolean
        }
        Insert: {
          id?: string
          custom_field_id: string
          group_id: string
          can_write?: boolean
        }
        Update: {
          can_write?: boolean
        }
        Relationships: []
      }
      audit_log: {
        Row: {
          id: string
          user_id: string | null
          user_name: string
          scene_id: string
          node_id: string
          node_kind: string
          node_label: string | null
          action: 'create' | 'update' | 'delete'
          field_key: string | null
          field_label: string | null
          old_value: Json | null
          new_value: Json | null
          created_at: string
        }
        Insert: {
          id?: string
          user_id?: string | null
          user_name: string
          scene_id: string
          node_id: string
          node_kind: string
          node_label?: string | null
          action: 'create' | 'update' | 'delete'
          field_key?: string | null
          field_label?: string | null
          old_value?: Json | null
          new_value?: Json | null
          created_at?: string
        }
        Update: never
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      is_admin: { Args: Record<never, never>; Returns: boolean }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

export type UserProfile = Database['public']['Tables']['user_profiles']['Row']
export type Group = Database['public']['Tables']['groups']['Row']
export type GroupMember = Database['public']['Tables']['group_members']['Row']
export type ParameterPermission = Database['public']['Tables']['parameter_permissions']['Row']
export type CustomField = Database['public']['Tables']['custom_fields']['Row']
export type CustomFieldPermission = Database['public']['Tables']['custom_field_permissions']['Row']
export type AuditLogEntry = Database['public']['Tables']['audit_log']['Row']
