export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      activity_logs: {
        Row: {
          action: string
          action_code: string | null
          action_params: Json
          category: string
          created_at: string
          detail: string | null
          detail_json: Json | null
          id: string
          ip_address: string | null
          org_id: string | null
          target_id: string | null
          target_name: string | null
          target_type: string | null
          user_id: string
        }
        Insert: {
          action: string
          action_code?: string | null
          action_params?: Json
          category?: string
          created_at?: string
          detail?: string | null
          detail_json?: Json | null
          id?: string
          ip_address?: string | null
          org_id?: string | null
          target_id?: string | null
          target_name?: string | null
          target_type?: string | null
          user_id: string
        }
        Update: {
          action?: string
          action_code?: string | null
          action_params?: Json
          category?: string
          created_at?: string
          detail?: string | null
          detail_json?: Json | null
          id?: string
          ip_address?: string | null
          org_id?: string | null
          target_id?: string | null
          target_name?: string | null
          target_type?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "activity_logs_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      agent_status: {
        Row: {
          id: string
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          id?: string
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          id?: string
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      channel_allowed_projects: {
        Row: {
          channel_id: string
          created_at: string
          design_project_id: string
          id: string
          sort_order: number
        }
        Insert: {
          channel_id: string
          created_at?: string
          design_project_id: string
          id?: string
          sort_order?: number
        }
        Update: {
          channel_id?: string
          created_at?: string
          design_project_id?: string
          id?: string
          sort_order?: number
        }
        Relationships: [
          {
            foreignKeyName: "channel_allowed_projects_channel_id_fkey"
            columns: ["channel_id"]
            isOneToOne: false
            referencedRelation: "channels"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "channel_allowed_projects_design_project_id_fkey"
            columns: ["design_project_id"]
            isOneToOne: false
            referencedRelation: "design_projects"
            referencedColumns: ["id"]
          },
        ]
      }
      channel_bgm_items: {
        Row: {
          channel_id: string
          created_at: string
          id: string
          media_id: string
          sort_order: number
        }
        Insert: {
          channel_id: string
          created_at?: string
          id?: string
          media_id: string
          sort_order?: number
        }
        Update: {
          channel_id?: string
          created_at?: string
          id?: string
          media_id?: string
          sort_order?: number
        }
        Relationships: [
          {
            foreignKeyName: "channel_bgm_items_channel_id_fkey"
            columns: ["channel_id"]
            isOneToOne: false
            referencedRelation: "channels"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "channel_bgm_items_media_id_fkey"
            columns: ["media_id"]
            isOneToOne: false
            referencedRelation: "media_items"
            referencedColumns: ["id"]
          },
        ]
      }
      channel_blocks: {
        Row: {
          block_type: string
          channel_id: string
          color: string
          created_at: string
          design_project_id: string | null
          effective_from: string | null
          effective_to: string | null
          enabled: boolean
          end_at: string | null
          end_time: string | null
          id: string
          name: string
          org_id: string
          priority: number
          start_at: string | null
          start_time: string | null
          updated_at: string
          weekdays: string[]
        }
        Insert: {
          block_type: string
          channel_id: string
          color?: string
          created_at?: string
          design_project_id?: string | null
          effective_from?: string | null
          effective_to?: string | null
          enabled?: boolean
          end_at?: string | null
          end_time?: string | null
          id?: string
          name?: string
          org_id: string
          priority?: number
          start_at?: string | null
          start_time?: string | null
          updated_at?: string
          weekdays?: string[]
        }
        Update: {
          block_type?: string
          channel_id?: string
          color?: string
          created_at?: string
          design_project_id?: string | null
          effective_from?: string | null
          effective_to?: string | null
          enabled?: boolean
          end_at?: string | null
          end_time?: string | null
          id?: string
          name?: string
          org_id?: string
          priority?: number
          start_at?: string | null
          start_time?: string | null
          updated_at?: string
          weekdays?: string[]
        }
        Relationships: [
          {
            foreignKeyName: "channel_blocks_channel_id_fkey"
            columns: ["channel_id"]
            isOneToOne: false
            referencedRelation: "channels"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "channel_blocks_design_project_id_fkey"
            columns: ["design_project_id"]
            isOneToOne: false
            referencedRelation: "design_projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "channel_blocks_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      channel_delete_requests: {
        Row: {
          cancelled_at: string | null
          channel_id: string
          created_at: string
          executed_at: string | null
          id: string
          org_id: string | null
          reason: string
          requested_by: string
          status: string
          updated_at: string
        }
        Insert: {
          cancelled_at?: string | null
          channel_id: string
          created_at?: string
          executed_at?: string | null
          id?: string
          org_id?: string | null
          reason?: string
          requested_by: string
          status?: string
          updated_at?: string
        }
        Update: {
          cancelled_at?: string | null
          channel_id?: string
          created_at?: string
          executed_at?: string | null
          id?: string
          org_id?: string | null
          reason?: string
          requested_by?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "channel_delete_requests_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      channels: {
        Row: {
          bgm_volume: number
          collab_scope: string
          color: string
          created_at: string
          created_by: string | null
          default_design_project_id: string | null
          description: string
          enabled: boolean
          id: string
          name: string
          org_id: string
          sort_order: number
          team_id: string | null
          updated_at: string
        }
        Insert: {
          bgm_volume?: number
          collab_scope?: string
          color?: string
          created_at?: string
          created_by?: string | null
          default_design_project_id?: string | null
          description?: string
          enabled?: boolean
          id?: string
          name: string
          org_id: string
          sort_order?: number
          team_id?: string | null
          updated_at?: string
        }
        Update: {
          bgm_volume?: number
          collab_scope?: string
          color?: string
          created_at?: string
          created_by?: string | null
          default_design_project_id?: string | null
          description?: string
          enabled?: boolean
          id?: string
          name?: string
          org_id?: string
          sort_order?: number
          team_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "channels_default_design_project_id_fkey"
            columns: ["default_design_project_id"]
            isOneToOne: false
            referencedRelation: "design_projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "channels_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "channels_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      chat_session_notes: {
        Row: {
          content: string
          created_at: string
          created_by: string
          id: string
          session_id: string
          updated_at: string
        }
        Insert: {
          content: string
          created_at?: string
          created_by: string
          id?: string
          session_id: string
          updated_at?: string
        }
        Update: {
          content?: string
          created_at?: string
          created_by?: string
          id?: string
          session_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "chat_session_notes_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "customer_chat_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      chat_session_tags: {
        Row: {
          created_at: string
          id: string
          session_id: string
          tag_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          session_id: string
          tag_id: string
        }
        Update: {
          created_at?: string
          id?: string
          session_id?: string
          tag_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "chat_session_tags_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "customer_chat_sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "chat_session_tags_tag_id_fkey"
            columns: ["tag_id"]
            isOneToOne: false
            referencedRelation: "chat_tags"
            referencedColumns: ["id"]
          },
        ]
      }
      chat_tags: {
        Row: {
          color: string
          created_at: string
          created_by: string
          id: string
          name: string
        }
        Insert: {
          color?: string
          created_at?: string
          created_by: string
          id?: string
          name: string
        }
        Update: {
          color?: string
          created_at?: string
          created_by?: string
          id?: string
          name?: string
        }
        Relationships: []
      }
      cs_agents: {
        Row: {
          created_at: string
          email: string
          id: string
          invited_by: string
          status: string
          updated_at: string
          user_id: string | null
        }
        Insert: {
          created_at?: string
          email: string
          id?: string
          invited_by: string
          status?: string
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          created_at?: string
          email?: string
          id?: string
          invited_by?: string
          status?: string
          updated_at?: string
          user_id?: string | null
        }
        Relationships: []
      }
      customer_chat_messages: {
        Row: {
          attachment_type: string | null
          attachment_url: string | null
          content: string
          created_at: string
          id: string
          is_read: boolean
          sender_name: string | null
          sender_type: string
          session_id: string
        }
        Insert: {
          attachment_type?: string | null
          attachment_url?: string | null
          content: string
          created_at?: string
          id?: string
          is_read?: boolean
          sender_name?: string | null
          sender_type?: string
          session_id: string
        }
        Update: {
          attachment_type?: string | null
          attachment_url?: string | null
          content?: string
          created_at?: string
          id?: string
          is_read?: boolean
          sender_name?: string | null
          sender_type?: string
          session_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "customer_chat_messages_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "customer_chat_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      customer_chat_sessions: {
        Row: {
          assigned_to: string | null
          closed_at: string | null
          created_at: string
          id: string
          org_id: string | null
          status: string
          subject: string | null
          telegram_chat_id: number | null
          updated_at: string
          user_id: string
        }
        Insert: {
          assigned_to?: string | null
          closed_at?: string | null
          created_at?: string
          id?: string
          org_id?: string | null
          status?: string
          subject?: string | null
          telegram_chat_id?: number | null
          updated_at?: string
          user_id: string
        }
        Update: {
          assigned_to?: string | null
          closed_at?: string | null
          created_at?: string
          id?: string
          org_id?: string | null
          status?: string
          subject?: string | null
          telegram_chat_id?: number | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "customer_chat_sessions_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      customer_satisfaction_ratings: {
        Row: {
          created_at: string
          feedback: string | null
          id: string
          rating: number
          session_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          feedback?: string | null
          id?: string
          rating: number
          session_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          feedback?: string | null
          id?: string
          rating?: number
          session_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "customer_satisfaction_ratings_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: true
            referencedRelation: "customer_chat_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      delegation_grants: {
        Row: {
          created_at: string
          expires_at: string
          grantee_id: string
          grantee_scope: string
          grantor_id: string
          id: string
          reason: string | null
          revoked_at: string | null
          revoked_by: string | null
          status: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          expires_at: string
          grantee_id: string
          grantee_scope: string
          grantor_id: string
          id?: string
          reason?: string | null
          revoked_at?: string | null
          revoked_by?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          expires_at?: string
          grantee_id?: string
          grantee_scope?: string
          grantor_id?: string
          id?: string
          reason?: string | null
          revoked_at?: string | null
          revoked_by?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
      delegation_requests: {
        Row: {
          created_at: string
          customer_id: string
          grant_id: string | null
          hours: number
          id: string
          reason: string | null
          requester_id: string
          resolved_at: string | null
          session_id: string
          status: string
        }
        Insert: {
          created_at?: string
          customer_id: string
          grant_id?: string | null
          hours?: number
          id?: string
          reason?: string | null
          requester_id: string
          resolved_at?: string | null
          session_id: string
          status?: string
        }
        Update: {
          created_at?: string
          customer_id?: string
          grant_id?: string | null
          hours?: number
          id?: string
          reason?: string | null
          requester_id?: string
          resolved_at?: string | null
          session_id?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "delegation_requests_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "customer_chat_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      design_project_delete_requests: {
        Row: {
          cancelled_at: string | null
          created_at: string
          design_project_id: string
          executed_at: string | null
          id: string
          org_id: string | null
          reason: string
          requested_by: string
          status: string
          updated_at: string
        }
        Insert: {
          cancelled_at?: string | null
          created_at?: string
          design_project_id: string
          executed_at?: string | null
          id?: string
          org_id?: string | null
          reason?: string
          requested_by: string
          status?: string
          updated_at?: string
        }
        Update: {
          cancelled_at?: string | null
          created_at?: string
          design_project_id?: string
          executed_at?: string | null
          id?: string
          org_id?: string | null
          reason?: string
          requested_by?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "design_project_delete_requests_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      design_projects: {
        Row: {
          aspect: string
          collab_scope: string
          created_at: string
          created_by: string | null
          id: string
          name: string
          org_id: string | null
          team_id: string | null
          updated_at: string
          zones: Json
        }
        Insert: {
          aspect?: string
          collab_scope?: string
          created_at?: string
          created_by?: string | null
          id?: string
          name: string
          org_id?: string | null
          team_id?: string | null
          updated_at?: string
          zones?: Json
        }
        Update: {
          aspect?: string
          collab_scope?: string
          created_at?: string
          created_by?: string | null
          id?: string
          name?: string
          org_id?: string | null
          team_id?: string | null
          updated_at?: string
          zones?: Json
        }
        Relationships: [
          {
            foreignKeyName: "design_projects_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "design_projects_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      device_licenses: {
        Row: {
          code: string
          created_at: string
          created_by: string | null
          device_model: string
          device_serial: string
          id: string
          note: string | null
          org_id: string
          revoked_at: string | null
          revoked_by: string | null
          status: string
          updated_at: string
        }
        Insert: {
          code: string
          created_at?: string
          created_by?: string | null
          device_model: string
          device_serial: string
          id?: string
          note?: string | null
          org_id: string
          revoked_at?: string | null
          revoked_by?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          code?: string
          created_at?: string
          created_by?: string | null
          device_model?: string
          device_serial?: string
          id?: string
          note?: string | null
          org_id?: string
          revoked_at?: string | null
          revoked_by?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "device_licenses_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      device_models: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          name: string
          sort_order: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          name: string
          sort_order?: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          name?: string
          sort_order?: number
          updated_at?: string
        }
        Relationships: []
      }
      email_send_log: {
        Row: {
          created_at: string
          error_message: string | null
          id: string
          message_id: string | null
          metadata: Json | null
          recipient_email: string
          status: string
          template_name: string
        }
        Insert: {
          created_at?: string
          error_message?: string | null
          id?: string
          message_id?: string | null
          metadata?: Json | null
          recipient_email: string
          status: string
          template_name: string
        }
        Update: {
          created_at?: string
          error_message?: string | null
          id?: string
          message_id?: string | null
          metadata?: Json | null
          recipient_email?: string
          status?: string
          template_name?: string
        }
        Relationships: []
      }
      email_send_state: {
        Row: {
          auth_email_ttl_minutes: number
          batch_size: number
          id: number
          retry_after_until: string | null
          send_delay_ms: number
          transactional_email_ttl_minutes: number
          updated_at: string
        }
        Insert: {
          auth_email_ttl_minutes?: number
          batch_size?: number
          id?: number
          retry_after_until?: string | null
          send_delay_ms?: number
          transactional_email_ttl_minutes?: number
          updated_at?: string
        }
        Update: {
          auth_email_ttl_minutes?: number
          batch_size?: number
          id?: number
          retry_after_until?: string | null
          send_delay_ms?: number
          transactional_email_ttl_minutes?: number
          updated_at?: string
        }
        Relationships: []
      }
      email_unsubscribe_tokens: {
        Row: {
          created_at: string
          email: string
          id: string
          token: string
          used_at: string | null
        }
        Insert: {
          created_at?: string
          email: string
          id?: string
          token: string
          used_at?: string | null
        }
        Update: {
          created_at?: string
          email?: string
          id?: string
          token?: string
          used_at?: string | null
        }
        Relationships: []
      }
      installed_widgets: {
        Row: {
          id: string
          org_id: string
          widget_id: string
          installed_by: string | null
          installed_at: string
        }
        Insert: {
          id?: string
          org_id: string
          widget_id: string
          installed_by?: string | null
          installed_at?: string
        }
        Update: {
          id?: string
          org_id?: string
          widget_id?: string
          installed_by?: string | null
          installed_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "installed_widgets_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "installed_widgets_widget_id_fkey"
            columns: ["widget_id"]
            isOneToOne: false
            referencedRelation: "widgets"
            referencedColumns: ["id"]
          },
        ]
      }
      invitations: {
        Row: {
          created_at: string
          email: string
          expires_at: string
          id: string
          invited_by: string
          org_id: string
          status: string
          token: string
        }
        Insert: {
          created_at?: string
          email: string
          expires_at?: string
          id?: string
          invited_by: string
          org_id: string
          status?: string
          token?: string
        }
        Update: {
          created_at?: string
          email?: string
          expires_at?: string
          id?: string
          invited_by?: string
          org_id?: string
          status?: string
          token?: string
        }
        Relationships: [
          {
            foreignKeyName: "invitations_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      iot_devices: {
        Row: {
          created_at: string
          created_by: string | null
          device_type: string
          id: string
          name: string
          org_id: string
          screen_id: string
          status: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          device_type?: string
          id?: string
          name: string
          org_id: string
          screen_id: string
          status?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          device_type?: string
          id?: string
          name?: string
          org_id?: string
          screen_id?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "iot_devices_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "iot_devices_screen_id_fkey"
            columns: ["screen_id"]
            isOneToOne: false
            referencedRelation: "screens"
            referencedColumns: ["id"]
          },
        ]
      }
      iot_sensor_readings: {
        Row: {
          device_id: string
          id: string
          org_id: string
          recorded_at: string
          screen_id: string
          unit: string
          value: number
        }
        Insert: {
          device_id: string
          id?: string
          org_id: string
          recorded_at?: string
          screen_id: string
          unit?: string
          value: number
        }
        Update: {
          device_id?: string
          id?: string
          org_id?: string
          recorded_at?: string
          screen_id?: string
          unit?: string
          value?: number
        }
        Relationships: [
          {
            foreignKeyName: "iot_sensor_readings_device_id_fkey"
            columns: ["device_id"]
            isOneToOne: false
            referencedRelation: "iot_devices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "iot_sensor_readings_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "iot_sensor_readings_screen_id_fkey"
            columns: ["screen_id"]
            isOneToOne: false
            referencedRelation: "screens"
            referencedColumns: ["id"]
          },
        ]
      }
      knowledge_categories: {
        Row: {
          created_at: string
          created_by: string
          description: string
          icon: string
          id: string
          name: string
          parent_key: string
          sort_order: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by: string
          description?: string
          icon?: string
          id?: string
          name: string
          parent_key?: string
          sort_order?: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string
          description?: string
          icon?: string
          id?: string
          name?: string
          parent_key?: string
          sort_order?: number
          updated_at?: string
        }
        Relationships: []
      }
      knowledge_files: {
        Row: {
          created_at: string
          file_name: string
          file_size: string
          file_type: string
          id: string
          knowledge_item_id: string
          storage_path: string
          uploaded_by: string
        }
        Insert: {
          created_at?: string
          file_name: string
          file_size?: string
          file_type?: string
          id?: string
          knowledge_item_id: string
          storage_path: string
          uploaded_by: string
        }
        Update: {
          created_at?: string
          file_name?: string
          file_size?: string
          file_type?: string
          id?: string
          knowledge_item_id?: string
          storage_path?: string
          uploaded_by?: string
        }
        Relationships: [
          {
            foreignKeyName: "knowledge_files_knowledge_item_id_fkey"
            columns: ["knowledge_item_id"]
            isOneToOne: false
            referencedRelation: "knowledge_items"
            referencedColumns: ["id"]
          },
        ]
      }
      knowledge_item_shares: {
        Row: {
          created_at: string
          id: string
          knowledge_item_id: string
          org_id: string
          shared_by: string
        }
        Insert: {
          created_at?: string
          id?: string
          knowledge_item_id: string
          org_id: string
          shared_by: string
        }
        Update: {
          created_at?: string
          id?: string
          knowledge_item_id?: string
          org_id?: string
          shared_by?: string
        }
        Relationships: [
          {
            foreignKeyName: "knowledge_item_shares_knowledge_item_id_fkey"
            columns: ["knowledge_item_id"]
            isOneToOne: false
            referencedRelation: "knowledge_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "knowledge_item_shares_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      knowledge_item_tags: {
        Row: {
          created_at: string
          created_by: string
          id: string
          knowledge_item_id: string
          tag_id: string
        }
        Insert: {
          created_at?: string
          created_by: string
          id?: string
          knowledge_item_id: string
          tag_id: string
        }
        Update: {
          created_at?: string
          created_by?: string
          id?: string
          knowledge_item_id?: string
          tag_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "knowledge_item_tags_knowledge_item_id_fkey"
            columns: ["knowledge_item_id"]
            isOneToOne: false
            referencedRelation: "knowledge_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "knowledge_item_tags_tag_id_fkey"
            columns: ["tag_id"]
            isOneToOne: false
            referencedRelation: "knowledge_tags"
            referencedColumns: ["id"]
          },
        ]
      }
      knowledge_items: {
        Row: {
          category: string
          category_id: string | null
          created_at: string
          created_by: string
          description: string
          file_count: number
          id: string
          org_id: string
          sub_category: string
          synced: boolean
          title: string
          updated_at: string
        }
        Insert: {
          category: string
          category_id?: string | null
          created_at?: string
          created_by: string
          description?: string
          file_count?: number
          id?: string
          org_id: string
          sub_category?: string
          synced?: boolean
          title: string
          updated_at?: string
        }
        Update: {
          category?: string
          category_id?: string | null
          created_at?: string
          created_by?: string
          description?: string
          file_count?: number
          id?: string
          org_id?: string
          sub_category?: string
          synced?: boolean
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "knowledge_items_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "knowledge_categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "knowledge_items_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      knowledge_tags: {
        Row: {
          color: string
          created_at: string
          created_by: string
          id: string
          name: string
          sort_order: number
          updated_at: string
        }
        Insert: {
          color?: string
          created_at?: string
          created_by: string
          id?: string
          name: string
          sort_order?: number
          updated_at?: string
        }
        Update: {
          color?: string
          created_at?: string
          created_by?: string
          id?: string
          name?: string
          sort_order?: number
          updated_at?: string
        }
        Relationships: []
      }
      license_codes: {
        Row: {
          assigned_org_id: string
          code: string
          created_at: string
          created_by: string
          extend_days: number
          id: string
          plan_name: string
          plan_tier: Database["public"]["Enums"]["plan_tier"] | null
          redeemed_at: string | null
          redeemed_by_org: string | null
          status: string
        }
        Insert: {
          assigned_org_id: string
          code: string
          created_at?: string
          created_by: string
          extend_days?: number
          id?: string
          plan_name?: string
          plan_tier?: Database["public"]["Enums"]["plan_tier"] | null
          redeemed_at?: string | null
          redeemed_by_org?: string | null
          status?: string
        }
        Update: {
          assigned_org_id?: string
          code?: string
          created_at?: string
          created_by?: string
          extend_days?: number
          id?: string
          plan_name?: string
          plan_tier?: Database["public"]["Enums"]["plan_tier"] | null
          redeemed_at?: string | null
          redeemed_by_org?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "license_codes_assigned_org_id_fkey"
            columns: ["assigned_org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "license_codes_redeemed_by_org_fkey"
            columns: ["redeemed_by_org"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      license_redeem_attempts: {
        Row: {
          attempt_at: string
          code_attempted: string
          error_code: string | null
          id: string
          org_id: string | null
          success: boolean
          user_id: string
        }
        Insert: {
          attempt_at?: string
          code_attempted: string
          error_code?: string | null
          id?: string
          org_id?: string | null
          success?: boolean
          user_id: string
        }
        Update: {
          attempt_at?: string
          code_attempted?: string
          error_code?: string | null
          id?: string
          org_id?: string | null
          success?: boolean
          user_id?: string
        }
        Relationships: []
      }
      media_item_tags: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          media_id: string
          tag_id: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          media_id: string
          tag_id: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          media_id?: string
          tag_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "media_item_tags_media_id_fkey"
            columns: ["media_id"]
            isOneToOne: false
            referencedRelation: "media_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "media_item_tags_tag_id_fkey"
            columns: ["tag_id"]
            isOneToOne: false
            referencedRelation: "media_tags"
            referencedColumns: ["id"]
          },
        ]
      }
      media_items: {
        Row: {
          created_at: string
          deleted_at: string | null
          design_project_id: string | null
          duration_seconds: number | null
          height: number | null
          id: string
          is_system: boolean
          md5: string | null
          mime_type: string
          name: string
          org_id: string
          original_name: string
          size_bytes: number
          source_bitrate: number | null
          source_codec: string | null
          source_container: string | null
          source_fps: number | null
          thumbnail: string
          transcode_completed_at: string | null
          transcode_error: string | null
          transcode_requested_at: string | null
          transcode_status: string
          type: string
          uploaded_by: string | null
          url: string
          width: number | null
        }
        Insert: {
          created_at?: string
          deleted_at?: string | null
          design_project_id?: string | null
          duration_seconds?: number | null
          height?: number | null
          id?: string
          is_system?: boolean
          md5?: string | null
          mime_type?: string
          name: string
          org_id: string
          original_name?: string
          size_bytes?: number
          source_bitrate?: number | null
          source_codec?: string | null
          source_container?: string | null
          source_fps?: number | null
          thumbnail?: string
          transcode_completed_at?: string | null
          transcode_error?: string | null
          transcode_requested_at?: string | null
          transcode_status?: string
          type?: string
          uploaded_by?: string | null
          url?: string
          width?: number | null
        }
        Update: {
          created_at?: string
          deleted_at?: string | null
          design_project_id?: string | null
          duration_seconds?: number | null
          height?: number | null
          id?: string
          is_system?: boolean
          md5?: string | null
          mime_type?: string
          name?: string
          org_id?: string
          original_name?: string
          size_bytes?: number
          source_bitrate?: number | null
          source_codec?: string | null
          source_container?: string | null
          source_fps?: number | null
          thumbnail?: string
          transcode_completed_at?: string | null
          transcode_error?: string | null
          transcode_requested_at?: string | null
          transcode_status?: string
          type?: string
          uploaded_by?: string | null
          url?: string
          width?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "media_items_design_project_id_fkey"
            columns: ["design_project_id"]
            isOneToOne: false
            referencedRelation: "design_projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "media_items_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      media_tags: {
        Row: {
          color: string
          created_at: string
          created_by: string | null
          id: string
          name: string
          org_id: string
          updated_at: string
        }
        Insert: {
          color?: string
          created_at?: string
          created_by?: string | null
          id?: string
          name: string
          org_id: string
          updated_at?: string
        }
        Update: {
          color?: string
          created_at?: string
          created_by?: string | null
          id?: string
          name?: string
          org_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "media_tags_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      notifications: {
        Row: {
          body: string
          created_at: string
          created_by: string | null
          id: string
          is_read: boolean
          link: string
          title: string
          type: string
          user_id: string
        }
        Insert: {
          body?: string
          created_at?: string
          created_by?: string | null
          id?: string
          is_read?: boolean
          link?: string
          title: string
          type?: string
          user_id: string
        }
        Update: {
          body?: string
          created_at?: string
          created_by?: string | null
          id?: string
          is_read?: boolean
          link?: string
          title?: string
          type?: string
          user_id?: string
        }
        Relationships: []
      }
      organizations: {
        Row: {
          created_at: string
          created_by: string | null
          description: string | null
          id: string
          license_expires_at: string
          license_plan: string
          license_reminder_sent: Json
          name: string
          plan_tier: Database["public"]["Enums"]["plan_tier"]
          timezone: string
          updated_at: string
          webhook_token: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          license_expires_at?: string
          license_plan?: string
          license_reminder_sent?: Json
          name: string
          plan_tier?: Database["public"]["Enums"]["plan_tier"]
          timezone?: string
          updated_at?: string
          webhook_token?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          license_expires_at?: string
          license_plan?: string
          license_reminder_sent?: Json
          name?: string
          plan_tier?: Database["public"]["Enums"]["plan_tier"]
          timezone?: string
          updated_at?: string
          webhook_token?: string
        }
        Relationships: []
      }
      playback_logs: {
        Row: {
          duration_seconds: number
          id: string
          media_id: string | null
          media_name: string
          org_id: string
          played_at: string
          screen_id: string | null
        }
        Insert: {
          duration_seconds?: number
          id?: string
          media_id?: string | null
          media_name?: string
          org_id: string
          played_at?: string
          screen_id?: string | null
        }
        Update: {
          duration_seconds?: number
          id?: string
          media_id?: string | null
          media_name?: string
          org_id?: string
          played_at?: string
          screen_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "playback_logs_media_id_fkey"
            columns: ["media_id"]
            isOneToOne: false
            referencedRelation: "media_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "playback_logs_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "playback_logs_screen_id_fkey"
            columns: ["screen_id"]
            isOneToOne: false
            referencedRelation: "screens"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          avatar_url: string | null
          created_at: string
          display_name: string | null
          id: string
          preferred_lang: string | null
          preferred_theme: string | null
          preferred_tz: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string
          display_name?: string | null
          id?: string
          preferred_lang?: string | null
          preferred_theme?: string | null
          preferred_tz?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          avatar_url?: string | null
          created_at?: string
          display_name?: string | null
          id?: string
          preferred_lang?: string | null
          preferred_theme?: string | null
          preferred_tz?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      publish_records: {
        Row: {
          channel_id: string | null
          channel_name: string
          created_at: string
          id: string
          published_by: string | null
          scheduled_at: string | null
          screen_id: string | null
          screen_name: string
          status: string
        }
        Insert: {
          channel_id?: string | null
          channel_name?: string
          created_at?: string
          id?: string
          published_by?: string | null
          scheduled_at?: string | null
          screen_id?: string | null
          screen_name?: string
          status?: string
        }
        Update: {
          channel_id?: string | null
          channel_name?: string
          created_at?: string
          id?: string
          published_by?: string | null
          scheduled_at?: string | null
          screen_id?: string | null
          screen_name?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "publish_records_channel_id_fkey"
            columns: ["channel_id"]
            isOneToOne: false
            referencedRelation: "channels"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "publish_records_screen_id_fkey"
            columns: ["screen_id"]
            isOneToOne: false
            referencedRelation: "screens"
            referencedColumns: ["id"]
          },
        ]
      }
      quick_reply_templates: {
        Row: {
          created_at: string
          created_by: string
          id: string
          label: string
          sort_order: number
          text: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by: string
          id?: string
          label: string
          sort_order?: number
          text: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string
          id?: string
          label?: string
          sort_order?: number
          text?: string
          updated_at?: string
        }
        Relationships: []
      }
      schedule_cleanup_settings: {
        Row: {
          enabled: boolean
          id: number
          last_deleted_count: number
          last_run_at: string | null
          last_run_by: string | null
          last_run_error: string | null
          last_run_status: string
          media_enabled: boolean
          media_last_deleted_count: number
          media_last_run_at: string | null
          media_last_run_by: string | null
          media_last_run_error: string | null
          media_last_run_status: string
          media_retention_days: number
          retention_days: number
          updated_at: string
        }
        Insert: {
          enabled?: boolean
          id?: number
          last_deleted_count?: number
          last_run_at?: string | null
          last_run_by?: string | null
          last_run_error?: string | null
          last_run_status?: string
          media_enabled?: boolean
          media_last_deleted_count?: number
          media_last_run_at?: string | null
          media_last_run_by?: string | null
          media_last_run_error?: string | null
          media_last_run_status?: string
          media_retention_days?: number
          retention_days?: number
          updated_at?: string
        }
        Update: {
          enabled?: boolean
          id?: number
          last_deleted_count?: number
          last_run_at?: string | null
          last_run_by?: string | null
          last_run_error?: string | null
          last_run_status?: string
          media_enabled?: boolean
          media_last_deleted_count?: number
          media_last_run_at?: string | null
          media_last_run_by?: string | null
          media_last_run_error?: string | null
          media_last_run_status?: string
          media_retention_days?: number
          retention_days?: number
          updated_at?: string
        }
        Relationships: []
      }
      screen_alerts: {
        Row: {
          acknowledged_at: string | null
          acknowledged_by: string | null
          created_at: string
          detected_at: string
          id: string
          last_seen_at: string | null
          note: string
          org_id: string
          resolved_at: string | null
          resolved_by: string | null
          screen_id: string
          status: string
          updated_at: string
        }
        Insert: {
          acknowledged_at?: string | null
          acknowledged_by?: string | null
          created_at?: string
          detected_at?: string
          id?: string
          last_seen_at?: string | null
          note?: string
          org_id: string
          resolved_at?: string | null
          resolved_by?: string | null
          screen_id: string
          status?: string
          updated_at?: string
        }
        Update: {
          acknowledged_at?: string | null
          acknowledged_by?: string | null
          created_at?: string
          detected_at?: string
          id?: string
          last_seen_at?: string | null
          note?: string
          org_id?: string
          resolved_at?: string | null
          resolved_by?: string | null
          screen_id?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "screen_alerts_screen_id_fkey"
            columns: ["screen_id"]
            isOneToOne: false
            referencedRelation: "screens"
            referencedColumns: ["id"]
          },
        ]
      }
      screen_channel_subscriptions: {
        Row: {
          channel_id: string
          created_at: string
          id: string
          is_default: boolean
          screen_id: string
        }
        Insert: {
          channel_id: string
          created_at?: string
          id?: string
          is_default?: boolean
          screen_id: string
        }
        Update: {
          channel_id?: string
          created_at?: string
          id?: string
          is_default?: boolean
          screen_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "screen_channel_subscriptions_channel_id_fkey"
            columns: ["channel_id"]
            isOneToOne: false
            referencedRelation: "channels"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "screen_channel_subscriptions_screen_id_fkey"
            columns: ["screen_id"]
            isOneToOne: false
            referencedRelation: "screens"
            referencedColumns: ["id"]
          },
        ]
      }
      screen_channel_switch_triggers: {
        Row: {
          created_at: string
          enabled: boolean
          id: string
          screen_id: string
          target_channel_id: string
          trigger_type: string
          trigger_value: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          enabled?: boolean
          id?: string
          screen_id: string
          target_channel_id: string
          trigger_type: string
          trigger_value?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          enabled?: boolean
          id?: string
          screen_id?: string
          target_channel_id?: string
          trigger_type?: string
          trigger_value?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "screen_channel_switch_triggers_screen_id_fkey"
            columns: ["screen_id"]
            isOneToOne: false
            referencedRelation: "screens"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "screen_channel_switch_triggers_target_channel_id_fkey"
            columns: ["target_channel_id"]
            isOneToOne: false
            referencedRelation: "channels"
            referencedColumns: ["id"]
          },
        ]
      }
      screen_health_report_schedules: {
        Row: {
          cadence: string
          created_at: string
          created_by: string | null
          day_of_week: number | null
          enabled: boolean
          hour_utc: number
          id: string
          include_offline_only: boolean
          last_error: string | null
          last_run_at: string | null
          last_status: string | null
          org_id: string
          recipients: string[]
          time_range_hours: number
          timezone: string
          updated_at: string
        }
        Insert: {
          cadence: string
          created_at?: string
          created_by?: string | null
          day_of_week?: number | null
          enabled?: boolean
          hour_utc?: number
          id?: string
          include_offline_only?: boolean
          last_error?: string | null
          last_run_at?: string | null
          last_status?: string | null
          org_id: string
          recipients?: string[]
          time_range_hours?: number
          timezone?: string
          updated_at?: string
        }
        Update: {
          cadence?: string
          created_at?: string
          created_by?: string | null
          day_of_week?: number | null
          enabled?: boolean
          hour_utc?: number
          id?: string
          include_offline_only?: boolean
          last_error?: string | null
          last_run_at?: string | null
          last_status?: string | null
          org_id?: string
          recipients?: string[]
          time_range_hours?: number
          timezone?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "screen_health_report_schedules_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      screen_logs: {
        Row: {
          created_at: string
          created_by: string | null
          event_code: string | null
          event_detail: string | null
          event_params: Json
          event_title: string
          event_type: string
          id: string
          org_id: string
          screen_id: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          event_code?: string | null
          event_detail?: string | null
          event_params?: Json
          event_title: string
          event_type?: string
          id?: string
          org_id: string
          screen_id: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          event_code?: string | null
          event_detail?: string | null
          event_params?: Json
          event_title?: string
          event_type?: string
          id?: string
          org_id?: string
          screen_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "screen_logs_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "screen_logs_screen_id_fkey"
            columns: ["screen_id"]
            isOneToOne: false
            referencedRelation: "screens"
            referencedColumns: ["id"]
          },
        ]
      }
      screen_smart_trigger_overrides: {
        Row: {
          created_at: string
          enabled: boolean
          id: string
          rule_id: string
          screen_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          enabled?: boolean
          id?: string
          rule_id: string
          screen_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          enabled?: boolean
          id?: string
          rule_id?: string
          screen_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "screen_smart_trigger_overrides_rule_id_fkey"
            columns: ["rule_id"]
            isOneToOne: false
            referencedRelation: "smart_trigger_rules"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "screen_smart_trigger_overrides_screen_id_fkey"
            columns: ["screen_id"]
            isOneToOne: false
            referencedRelation: "screens"
            referencedColumns: ["id"]
          },
        ]
      }
      screen_smart_trigger_rules: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          rule_id: string
          screen_id: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          rule_id: string
          screen_id: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          rule_id?: string
          screen_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "screen_smart_trigger_rules_rule_id_fkey"
            columns: ["rule_id"]
            isOneToOne: false
            referencedRelation: "smart_trigger_rules"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "screen_smart_trigger_rules_screen_id_fkey"
            columns: ["screen_id"]
            isOneToOne: false
            referencedRelation: "screens"
            referencedColumns: ["id"]
          },
        ]
      }
      screens: {
        Row: {
          avg_download_speed: string
          avg_upload_speed: string
          branch: string
          connection_type: string
          created_at: string
          firmware_version: string
          id: string
          ip_address: string
          location: string
          name: string
          online: boolean
          org_id: string
          resolution: string
          serial_number: string
          status: string
          team_id: string | null
          timezone: string
          updated_at: string
          uploaded_by: string | null
        }
        Insert: {
          avg_download_speed?: string
          avg_upload_speed?: string
          branch?: string
          connection_type?: string
          created_at?: string
          firmware_version?: string
          id?: string
          ip_address?: string
          location?: string
          name: string
          online?: boolean
          org_id: string
          resolution?: string
          serial_number?: string
          status?: string
          team_id?: string | null
          timezone?: string
          updated_at?: string
          uploaded_by?: string | null
        }
        Update: {
          avg_download_speed?: string
          avg_upload_speed?: string
          branch?: string
          connection_type?: string
          created_at?: string
          firmware_version?: string
          id?: string
          ip_address?: string
          location?: string
          name?: string
          online?: boolean
          org_id?: string
          resolution?: string
          serial_number?: string
          status?: string
          team_id?: string | null
          timezone?: string
          updated_at?: string
          uploaded_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "screens_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "screens_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      security_audit_findings: {
        Row: {
          created_at: string
          findings: Json
          findings_count: number
          id: string
          ok: boolean
          pinned: boolean
          run_at: string
          triggered_by: string
        }
        Insert: {
          created_at?: string
          findings?: Json
          findings_count?: number
          id?: string
          ok: boolean
          pinned?: boolean
          run_at?: string
          triggered_by?: string
        }
        Update: {
          created_at?: string
          findings?: Json
          findings_count?: number
          id?: string
          ok?: boolean
          pinned?: boolean
          run_at?: string
          triggered_by?: string
        }
        Relationships: []
      }
      smart_trigger_logs: {
        Row: {
          created_at: string
          debug_id: string | null
          error_message: string | null
          id: string
          org_id: string
          rule_id: string | null
          screen_id: string | null
          success: boolean
          trigger_key: string
          trigger_payload: Json
          trigger_source: string
        }
        Insert: {
          created_at?: string
          debug_id?: string | null
          error_message?: string | null
          id?: string
          org_id: string
          rule_id?: string | null
          screen_id?: string | null
          success?: boolean
          trigger_key?: string
          trigger_payload?: Json
          trigger_source: string
        }
        Update: {
          created_at?: string
          debug_id?: string | null
          error_message?: string | null
          id?: string
          org_id?: string
          rule_id?: string | null
          screen_id?: string | null
          success?: boolean
          trigger_key?: string
          trigger_payload?: Json
          trigger_source?: string
        }
        Relationships: [
          {
            foreignKeyName: "smart_trigger_logs_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "smart_trigger_logs_rule_id_fkey"
            columns: ["rule_id"]
            isOneToOne: false
            referencedRelation: "smart_trigger_rules"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "smart_trigger_logs_screen_id_fkey"
            columns: ["screen_id"]
            isOneToOne: false
            referencedRelation: "screens"
            referencedColumns: ["id"]
          },
        ]
      }
      smart_trigger_rules: {
        Row: {
          color: string
          cooldown_seconds: number
          created_at: string
          created_by: string | null
          description: string
          duration_seconds: number
          enabled: boolean
          icon: string
          id: string
          mode: string
          name: string
          org_id: string
          priority: number
          restore_behavior: string
          restore_channel_id: string | null
          scope: string
          screen_id: string | null
          target_design_project_id: string | null
          trigger_condition: Json
          trigger_key: string
          trigger_source: string
          updated_at: string
        }
        Insert: {
          color?: string
          cooldown_seconds?: number
          created_at?: string
          created_by?: string | null
          description?: string
          duration_seconds?: number
          enabled?: boolean
          icon?: string
          id?: string
          mode: string
          name: string
          org_id: string
          priority?: number
          restore_behavior?: string
          restore_channel_id?: string | null
          scope?: string
          screen_id?: string | null
          target_design_project_id?: string | null
          trigger_condition?: Json
          trigger_key?: string
          trigger_source: string
          updated_at?: string
        }
        Update: {
          color?: string
          cooldown_seconds?: number
          created_at?: string
          created_by?: string | null
          description?: string
          duration_seconds?: number
          enabled?: boolean
          icon?: string
          id?: string
          mode?: string
          name?: string
          org_id?: string
          priority?: number
          restore_behavior?: string
          restore_channel_id?: string | null
          scope?: string
          screen_id?: string | null
          target_design_project_id?: string | null
          trigger_condition?: Json
          trigger_key?: string
          trigger_source?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "smart_trigger_rules_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "smart_trigger_rules_restore_channel_id_fkey"
            columns: ["restore_channel_id"]
            isOneToOne: false
            referencedRelation: "channels"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "smart_trigger_rules_screen_id_fkey"
            columns: ["screen_id"]
            isOneToOne: false
            referencedRelation: "screens"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "smart_trigger_rules_target_design_project_id_fkey"
            columns: ["target_design_project_id"]
            isOneToOne: false
            referencedRelation: "design_projects"
            referencedColumns: ["id"]
          },
        ]
      }
      support_tickets: {
        Row: {
          assigned_to: string | null
          created_at: string
          created_by: string
          description: string
          id: string
          priority: string
          session_id: string | null
          status: string
          title: string
          updated_at: string
        }
        Insert: {
          assigned_to?: string | null
          created_at?: string
          created_by: string
          description?: string
          id?: string
          priority?: string
          session_id?: string | null
          status?: string
          title: string
          updated_at?: string
        }
        Update: {
          assigned_to?: string | null
          created_at?: string
          created_by?: string
          description?: string
          id?: string
          priority?: string
          session_id?: string | null
          status?: string
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "support_tickets_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "customer_chat_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      suppressed_emails: {
        Row: {
          created_at: string
          email: string
          id: string
          metadata: Json | null
          reason: string
        }
        Insert: {
          created_at?: string
          email: string
          id?: string
          metadata?: Json | null
          reason: string
        }
        Update: {
          created_at?: string
          email?: string
          id?: string
          metadata?: Json | null
          reason?: string
        }
        Relationships: []
      }
      system_admins: {
        Row: {
          added_by: string | null
          created_at: string
          id: string
          is_root: boolean
          note: string
          user_id: string
        }
        Insert: {
          added_by?: string | null
          created_at?: string
          id?: string
          is_root?: boolean
          note?: string
          user_id: string
        }
        Update: {
          added_by?: string | null
          created_at?: string
          id?: string
          is_root?: boolean
          note?: string
          user_id?: string
        }
        Relationships: []
      }
      team_members: {
        Row: {
          created_at: string
          id: string
          role: string
          team_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role?: string
          team_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: string
          team_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "team_members_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      teams: {
        Row: {
          created_at: string
          created_by: string | null
          description: string | null
          id: string
          name: string
          org_id: string
          permissions: Json
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          name: string
          org_id: string
          permissions?: Json
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          name?: string
          org_id?: string
          permissions?: Json
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "teams_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      telegram_bot_state: {
        Row: {
          id: number
          update_offset: number
          updated_at: string
        }
        Insert: {
          id: number
          update_offset?: number
          updated_at?: string
        }
        Update: {
          id?: number
          update_offset?: number
          updated_at?: string
        }
        Relationships: []
      }
      ticket_comments: {
        Row: {
          content: string
          created_at: string
          created_by: string
          id: string
          ticket_id: string
          updated_at: string
        }
        Insert: {
          content: string
          created_at?: string
          created_by: string
          id?: string
          ticket_id: string
          updated_at?: string
        }
        Update: {
          content?: string
          created_at?: string
          created_by?: string
          id?: string
          ticket_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "ticket_comments_ticket_id_fkey"
            columns: ["ticket_id"]
            isOneToOne: false
            referencedRelation: "support_tickets"
            referencedColumns: ["id"]
          },
        ]
      }
      trigger_share_keys: {
        Row: {
          created_at: string
          id: number
          secret: string
        }
        Insert: {
          created_at?: string
          id?: number
          secret: string
        }
        Update: {
          created_at?: string
          id?: number
          secret?: string
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
      widgets: {
        Row: {
          app_id: string | null
          config: Json
          created_at: string
          created_by: string
          id: string
          name: string
          name_i18n: Json
          org_id: string | null
          scope: string
          sort_order: number
          thumbnail: string
          updated_at: string
          widget_type: string
        }
        Insert: {
          app_id?: string | null
          config?: Json
          created_at?: string
          created_by: string
          id?: string
          name: string
          name_i18n?: Json
          org_id?: string | null
          scope: string
          sort_order?: number
          thumbnail?: string
          updated_at?: string
          widget_type: string
        }
        Update: {
          app_id?: string | null
          config?: Json
          created_at?: string
          created_by?: string
          id?: string
          name?: string
          name_i18n?: Json
          org_id?: string | null
          scope?: string
          sort_order?: number
          thumbnail?: string
          updated_at?: string
          widget_type?: string
        }
        Relationships: [
          {
            foreignKeyName: "widgets_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      _active_design_project_ids: {
        Args: never
        Returns: {
          id: string
        }[]
      }
      add_system_admin: {
        Args: { _note?: string; _user_id: string }
        Returns: Json
      }
      admin_unlock_redeem_attempts: {
        Args: { _user_id: string }
        Returns: Json
      }
      audit_rls_coverage: { Args: never; Returns: Json }
      audit_rls_security_regressions: { Args: never; Returns: Json }
      auto_delete_old_expired_channel_blocks: { Args: never; Returns: number }
      auto_delete_unused_media: { Args: never; Returns: number }
      auto_disable_expired_channel_blocks: { Args: never; Returns: number }
      bootstrap_user_organization: {
        Args: { _org_name: string }
        Returns: Json
      }
      check_screen_license_status: {
        Args: { _screen_id: string }
        Returns: Json
      }
      count_channel_references: {
        Args: { _channel_id: string }
        Returns: number
      }
      count_design_project_references: {
        Args: { _project_id: string }
        Returns: number
      }
      db_health_overview: { Args: never; Returns: Json }
      db_health_run_maintenance: {
        Args: { _action: string; _table_name: string }
        Returns: Json
      }
      db_health_slow_queries: {
        Args: never
        Returns: {
          calls: number
          max_exec_ms: number
          mean_exec_ms: number
          query: string
          rows_returned: number
          total_exec_ms: number
        }[]
      }
      db_health_table_stats: {
        Args: never
        Returns: {
          dead_tuples: number
          index_size_bytes: number
          last_analyze: string
          last_autovacuum: string
          last_vacuum: string
          live_tuples: number
          row_estimate: number
          table_name: string
          table_size_bytes: number
          total_size_bytes: number
        }[]
      }
      db_health_unused_indexes: {
        Args: never
        Returns: {
          index_name: string
          index_scans: number
          index_size_bytes: number
          is_primary: boolean
          is_unique: boolean
          table_name: string
        }[]
      }
      delete_device_license: { Args: { _id: string }; Returns: Json }
      delete_email: {
        Args: { message_id: number; queue_name: string }
        Returns: boolean
      }
      delete_license_code: { Args: { _id: string }; Returns: Json }
      enqueue_email: {
        Args: { payload: Json; queue_name: string }
        Returns: number
      }
      generate_device_license: {
        Args: {
          _device_model: string
          _device_serial: string
          _note?: string
          _org_id: string
        }
        Returns: Json
      }
      generate_license_codes:
        | {
            Args: {
              _assigned_org_id: string
              _count: number
              _extend_days: number
              _plan_name: string
            }
            Returns: Json
          }
        | {
            Args: {
              _assigned_org_id: string
              _count: number
              _extend_days: number
              _plan_name: string
              _plan_tier?: Database["public"]["Enums"]["plan_tier"]
            }
            Returns: Json
          }
      get_channel_schedule_intervals: {
        Args: { _channel_id: string; _from: string; _to: string; _tz: string }
        Returns: {
          block_id: string
          block_type: string
          color: string
          day: string
          design_project_id: string
          end_min: number
          name: string
          priority: number
          start_min: number
        }[]
      }
      get_knowledge_item_org: { Args: { _item_id: string }; Returns: string }
      get_plan_limits: {
        Args: { _tier: Database["public"]["Enums"]["plan_tier"] }
        Returns: Json
      }
      get_user_org_ids: { Args: { _user_id: string }; Returns: string[] }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      is_active_cs_agent: { Args: { _user_id: string }; Returns: boolean }
      is_org_admin: { Args: { _user_id: string }; Returns: boolean }
      is_system_admin: { Args: { _user_id: string }; Returns: boolean }
      list_system_admins: {
        Args: never
        Returns: {
          added_by: string
          avatar_url: string
          created_at: string
          display_name: string
          is_root: boolean
          note: string
          user_id: string
        }[]
      }
      lookup_device_license_by_code: { Args: { _code: string }; Returns: Json }
      move_to_dlq: {
        Args: {
          dlq_name: string
          message_id: number
          payload: Json
          source_queue: string
        }
        Returns: number
      }
      prune_security_audit_findings: { Args: never; Returns: Json }
      purge_soft_deleted_media: { Args: never; Returns: number }
      purge_soft_deleted_media_item: {
        Args: { _media_id: string }
        Returns: Json
      }
      read_email_batch: {
        Args: { batch_size: number; queue_name: string; vt: number }
        Returns: {
          message: Json
          msg_id: number
          read_ct: number
        }[]
      }
      redeem_invitation_token: { Args: { _token: string }; Returns: Json }
      redeem_license_code: {
        Args: { _code: string; _org_id: string }
        Returns: Json
      }
      regenerate_org_webhook_token: {
        Args: { _org_id: string }
        Returns: string
      }
      remove_system_admin: { Args: { _user_id: string }; Returns: Json }
      restore_device_license: { Args: { _id: string }; Returns: Json }
      restore_soft_deleted_media: { Args: { _media_id: string }; Returns: Json }
      revoke_device_license: { Args: { _id: string }; Returns: Json }
      run_media_cleanup_now: { Args: never; Returns: Json }
      run_schedule_cleanup_now: { Args: never; Returns: Json }
      run_security_regression_audit_scheduled: { Args: never; Returns: Json }
      safe_text_to_jsonb: { Args: { _input: string }; Returns: Json }
      search_users_for_admin: {
        Args: { _query: string }
        Returns: {
          avatar_url: string
          display_name: string
          email: string
          user_id: string
        }[]
      }
      try_execute_project_delete_request: {
        Args: { _request_id: string }
        Returns: Json
      }
      update_schedule_cleanup_settings:
        | {
            Args: { _enabled: boolean; _retention_days: number }
            Returns: Json
          }
        | {
            Args: {
              _enabled: boolean
              _media_enabled?: boolean
              _media_retention_days?: number
              _retention_days: number
            }
            Returns: Json
          }
      user_can_view_shared_item: {
        Args: { _item_id: string; _user_id: string }
        Returns: boolean
      }
      user_in_org: {
        Args: { _org_id: string; _user_id: string }
        Returns: boolean
      }
      verify_device_license: {
        Args: { _code: string; _device_model: string; _device_serial: string }
        Returns: Json
      }
    }
    Enums: {
      app_role: "admin" | "user" | "org_admin"
      plan_tier:
        | "evaluation"
        | "starter"
        | "business"
        | "professional"
        | "enterprise"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      app_role: ["admin", "user", "org_admin"],
      plan_tier: [
        "evaluation",
        "starter",
        "business",
        "professional",
        "enterprise",
      ],
    },
  },
} as const
