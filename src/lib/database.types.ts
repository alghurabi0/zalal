export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Database = {
  public: {
    Tables: {
      addresses: {
        Row: {
          created_at: string;
          deleted_at: string | null;
          district: string;
          id: string;
          is_default: boolean;
          label: Database["public"]["Enums"]["address_label"];
          landmark: string;
          lat: number;
          lng: number;
          location: unknown;
          updated_at: string;
          user_id: string;
        };
        ComputedFields: never;
        Insert: {
          created_at?: string;
          deleted_at?: string | null;
          district: string;
          id?: string;
          is_default?: boolean;
          label: Database["public"]["Enums"]["address_label"];
          landmark: string;
          lat: number;
          lng: number;
          location?: never;
          updated_at?: string;
          user_id?: string;
        };
        Update: {
          created_at?: string;
          deleted_at?: string | null;
          district?: string;
          id?: string;
          is_default?: boolean;
          label?: Database["public"]["Enums"]["address_label"];
          landmark?: string;
          lat?: number;
          lng?: number;
          location?: never;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "addresses_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      admin_audit_log: {
        Row: {
          action: string;
          admin_id: string;
          created_at: string;
          diff: NonNullable<Json>;
          entity: string;
          entity_id: string;
          id: number;
        };
        ComputedFields: never;
        Insert: {
          action: string;
          admin_id: string;
          created_at?: string;
          diff?: NonNullable<Json>;
          entity: string;
          entity_id: string;
          id?: never;
        };
        Update: {
          action?: string;
          admin_id?: string;
          created_at?: string;
          diff?: NonNullable<Json>;
          entity?: string;
          entity_id?: string;
          id?: never;
        };
        Relationships: [
          {
            foreignKeyName: "admin_audit_log_admin_id_fkey";
            columns: ["admin_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      blocked_dates: {
        Row: {
          created_at: string;
          date: string;
          reason: string | null;
        };
        ComputedFields: never;
        Insert: {
          created_at?: string;
          date: string;
          reason?: string | null;
        };
        Update: {
          created_at?: string;
          date?: string;
          reason?: string | null;
        };
        Relationships: [];
      };
      certificates: {
        Row: {
          id: string;
          issued_at: string;
          next_due_on: string;
          order_id: string;
          pdf_path: string | null;
          public_code: string;
          residual_chlorine_mg_l: number | null;
          sterilant: string | null;
          updated_at: string;
        };
        ComputedFields: never;
        Insert: {
          id?: string;
          issued_at?: string;
          next_due_on: string;
          order_id: string;
          pdf_path?: string | null;
          public_code: string;
          residual_chlorine_mg_l?: number | null;
          sterilant?: string | null;
          updated_at?: string;
        };
        Update: {
          id?: string;
          issued_at?: string;
          next_due_on?: string;
          order_id?: string;
          pdf_path?: string | null;
          public_code?: string;
          residual_chlorine_mg_l?: number | null;
          sterilant?: string | null;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "certificates_order_id_fkey";
            columns: ["order_id"];
            isOneToOne: true;
            referencedRelation: "orders";
            referencedColumns: ["id"];
          },
        ];
      };
      crew_live_location: {
        Row: {
          accuracy_m: number;
          crew_id: string;
          id: number;
          lat: number;
          lng: number;
          location: unknown;
          order_id: string;
          updated_at: string;
        };
        ComputedFields: never;
        Insert: {
          accuracy_m: number;
          crew_id: string;
          id?: never;
          lat: number;
          lng: number;
          location?: never;
          order_id: string;
          updated_at?: string;
        };
        Update: {
          accuracy_m?: number;
          crew_id?: string;
          id?: never;
          lat?: number;
          lng?: number;
          location?: never;
          order_id?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "crew_live_location_crew_id_fkey";
            columns: ["crew_id"];
            isOneToOne: false;
            referencedRelation: "crews";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "crew_live_location_order_id_fkey";
            columns: ["order_id"];
            isOneToOne: true;
            referencedRelation: "orders";
            referencedColumns: ["id"];
          },
        ];
      };
      crews: {
        Row: {
          active: boolean;
          created_at: string;
          id: string;
          name: string;
          updated_at: string;
          user_id: string;
        };
        ComputedFields: never;
        Insert: {
          active?: boolean;
          created_at?: string;
          id?: string;
          name: string;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          active?: boolean;
          created_at?: string;
          id?: string;
          name?: string;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "crews_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: true;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      job_reports: {
        Row: {
          created_at: string;
          crew_id: string;
          order_id: string;
          residual_chlorine_mg_l: number | null;
          sterilant: string;
          updated_at: string;
        };
        ComputedFields: never;
        Insert: {
          created_at?: string;
          crew_id: string;
          order_id: string;
          residual_chlorine_mg_l?: number | null;
          sterilant: string;
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          crew_id?: string;
          order_id?: string;
          residual_chlorine_mg_l?: number | null;
          sterilant?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "job_reports_crew_id_fkey";
            columns: ["crew_id"];
            isOneToOne: false;
            referencedRelation: "crews";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "job_reports_order_id_fkey";
            columns: ["order_id"];
            isOneToOne: true;
            referencedRelation: "orders";
            referencedColumns: ["id"];
          },
        ];
      };
      order_event_notes: {
        Row: {
          created_at: string;
          event_id: number;
          note: string;
          order_id: string;
        };
        ComputedFields: never;
        Insert: {
          created_at?: string;
          event_id: number;
          note: string;
          order_id: string;
        };
        Update: {
          created_at?: string;
          event_id?: number;
          note?: string;
          order_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "order_event_notes_event_id_order_id_fkey";
            columns: ["event_id", "order_id"];
            isOneToOne: false;
            referencedRelation: "order_events";
            referencedColumns: ["id", "order_id"];
          },
        ];
      };
      order_events: {
        Row: {
          actor_id: string | null;
          actor_role: Database["public"]["Enums"]["app_role"] | null;
          cancel_reason: Database["public"]["Enums"]["cancel_reason"] | null;
          created_at: string;
          details: NonNullable<Json>;
          from_status: Database["public"]["Enums"]["order_status"] | null;
          id: number;
          is_override: boolean;
          order_id: string;
          to_status: Database["public"]["Enums"]["order_status"];
        };
        ComputedFields: never;
        Insert: {
          actor_id?: string | null;
          actor_role?: Database["public"]["Enums"]["app_role"] | null;
          cancel_reason?: Database["public"]["Enums"]["cancel_reason"] | null;
          created_at?: string;
          details?: NonNullable<Json>;
          from_status?: Database["public"]["Enums"]["order_status"] | null;
          id?: never;
          is_override?: boolean;
          order_id: string;
          to_status: Database["public"]["Enums"]["order_status"];
        };
        Update: {
          actor_id?: string | null;
          actor_role?: Database["public"]["Enums"]["app_role"] | null;
          cancel_reason?: Database["public"]["Enums"]["cancel_reason"] | null;
          created_at?: string;
          details?: NonNullable<Json>;
          from_status?: Database["public"]["Enums"]["order_status"] | null;
          id?: never;
          is_override?: boolean;
          order_id?: string;
          to_status?: Database["public"]["Enums"]["order_status"];
        };
        Relationships: [
          {
            foreignKeyName: "order_events_actor_id_fkey";
            columns: ["actor_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "order_events_order_id_fkey";
            columns: ["order_id"];
            isOneToOne: false;
            referencedRelation: "orders";
            referencedColumns: ["id"];
          },
        ];
      };
      order_items: {
        Row: {
          id: number;
          order_id: string;
          qty: number;
          size: Database["public"]["Enums"]["tank_size"];
          tank_id: string | null;
          tank_type: Database["public"]["Enums"]["tank_type"];
          unit_price_iqd: number;
        };
        ComputedFields: never;
        Insert: {
          id?: never;
          order_id: string;
          qty: number;
          size: Database["public"]["Enums"]["tank_size"];
          tank_id?: string | null;
          tank_type: Database["public"]["Enums"]["tank_type"];
          unit_price_iqd: number;
        };
        Update: {
          id?: never;
          order_id?: string;
          qty?: number;
          size?: Database["public"]["Enums"]["tank_size"];
          tank_id?: string | null;
          tank_type?: Database["public"]["Enums"]["tank_type"];
          unit_price_iqd?: number;
        };
        Relationships: [
          {
            foreignKeyName: "order_items_order_id_fkey";
            columns: ["order_id"];
            isOneToOne: false;
            referencedRelation: "orders";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "order_items_tank_id_fkey";
            columns: ["tank_id"];
            isOneToOne: false;
            referencedRelation: "tanks";
            referencedColumns: ["id"];
          },
        ];
      };
      order_media: {
        Row: {
          bytes: number;
          created_at: string;
          duration_s: number | null;
          id: string;
          kind: Database["public"]["Enums"]["order_media_kind"];
          media_type: Database["public"]["Enums"]["media_type"];
          order_id: string;
          path: string;
          uploaded_by: string | null;
        };
        ComputedFields: never;
        Insert: {
          bytes: number;
          created_at?: string;
          duration_s?: number | null;
          id?: string;
          kind: Database["public"]["Enums"]["order_media_kind"];
          media_type: Database["public"]["Enums"]["media_type"];
          order_id: string;
          path: string;
          uploaded_by?: string | null;
        };
        Update: {
          bytes?: number;
          created_at?: string;
          duration_s?: number | null;
          id?: string;
          kind?: Database["public"]["Enums"]["order_media_kind"];
          media_type?: Database["public"]["Enums"]["media_type"];
          order_id?: string;
          path?: string;
          uploaded_by?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "order_media_order_id_fkey";
            columns: ["order_id"];
            isOneToOne: false;
            referencedRelation: "orders";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "order_media_uploaded_by_fkey";
            columns: ["uploaded_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      orders: {
        Row: {
          address_id: string;
          cash_collected: boolean;
          client_request_id: string;
          created_at: string;
          crew_id: string | null;
          customer_id: string;
          customer_note: string | null;
          district: string;
          id: string;
          landmark: string;
          lat: number;
          lng: number;
          location: unknown;
          number: number;
          payment_method: Database["public"]["Enums"]["payment_method"];
          service_date: string;
          slot_end_at: string;
          slot_id: number;
          slot_start_at: string;
          status: Database["public"]["Enums"]["order_status"];
          total_iqd: number;
          updated_at: string;
        };
        ComputedFields: never;
        Insert: {
          address_id: string;
          cash_collected?: boolean;
          client_request_id: string;
          created_at?: string;
          crew_id?: string | null;
          customer_id: string;
          customer_note?: string | null;
          district: string;
          id?: string;
          landmark: string;
          lat: number;
          lng: number;
          location?: never;
          number?: never;
          payment_method?: Database["public"]["Enums"]["payment_method"];
          service_date: string;
          slot_end_at: string;
          slot_id: number;
          slot_start_at: string;
          status?: Database["public"]["Enums"]["order_status"];
          total_iqd: number;
          updated_at?: string;
        };
        Update: {
          address_id?: string;
          cash_collected?: boolean;
          client_request_id?: string;
          created_at?: string;
          crew_id?: string | null;
          customer_id?: string;
          customer_note?: string | null;
          district?: string;
          id?: string;
          landmark?: string;
          lat?: number;
          lng?: number;
          location?: never;
          number?: never;
          payment_method?: Database["public"]["Enums"]["payment_method"];
          service_date?: string;
          slot_end_at?: string;
          slot_id?: number;
          slot_start_at?: string;
          status?: Database["public"]["Enums"]["order_status"];
          total_iqd?: number;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "orders_address_id_customer_id_fkey";
            columns: ["address_id", "customer_id"];
            isOneToOne: false;
            referencedRelation: "addresses";
            referencedColumns: ["id", "user_id"];
          },
          {
            foreignKeyName: "orders_crew_id_fkey";
            columns: ["crew_id"];
            isOneToOne: false;
            referencedRelation: "crews";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "orders_customer_id_fkey";
            columns: ["customer_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "orders_slot_id_fkey";
            columns: ["slot_id"];
            isOneToOne: false;
            referencedRelation: "slots";
            referencedColumns: ["id"];
          },
        ];
      };
      otp_requests: {
        Row: {
          channel: Database["public"]["Enums"]["otp_channel"];
          channel_used: Database["public"]["Enums"]["otp_channel"] | null;
          code_hash: string;
          created_at: string;
          failed_attempts: number;
          id: number;
          locked_until: string | null;
          phone: string;
          provider_message_id: string | null;
          send_error: string | null;
          sent_at: string | null;
          verified_at: string | null;
        };
        ComputedFields: never;
        Insert: {
          channel: Database["public"]["Enums"]["otp_channel"];
          channel_used?: Database["public"]["Enums"]["otp_channel"] | null;
          code_hash: string;
          created_at?: string;
          failed_attempts?: number;
          id?: never;
          locked_until?: string | null;
          phone: string;
          provider_message_id?: string | null;
          send_error?: string | null;
          sent_at?: string | null;
          verified_at?: string | null;
        };
        Update: {
          channel?: Database["public"]["Enums"]["otp_channel"];
          channel_used?: Database["public"]["Enums"]["otp_channel"] | null;
          code_hash?: string;
          created_at?: string;
          failed_attempts?: number;
          id?: never;
          locked_until?: string | null;
          phone?: string;
          provider_message_id?: string | null;
          send_error?: string | null;
          sent_at?: string | null;
          verified_at?: string | null;
        };
        Relationships: [];
      };
      price_list: {
        Row: {
          price_iqd: number;
          size: Database["public"]["Enums"]["tank_size"];
          tank_type: Database["public"]["Enums"]["tank_type"];
          updated_at: string;
        };
        ComputedFields: never;
        Insert: {
          price_iqd: number;
          size: Database["public"]["Enums"]["tank_size"];
          tank_type: Database["public"]["Enums"]["tank_type"];
          updated_at?: string;
        };
        Update: {
          price_iqd?: number;
          size?: Database["public"]["Enums"]["tank_size"];
          tank_type?: Database["public"]["Enums"]["tank_type"];
          updated_at?: string;
        };
        Relationships: [];
      };
      profiles: {
        Row: {
          created_at: string;
          deleted_at: string | null;
          full_name: string | null;
          id: string;
          phone: string;
          reminders_enabled: boolean;
          role: Database["public"]["Enums"]["app_role"];
          updated_at: string;
        };
        ComputedFields: never;
        Insert: {
          created_at?: string;
          deleted_at?: string | null;
          full_name?: string | null;
          id: string;
          phone: string;
          reminders_enabled?: boolean;
          role?: Database["public"]["Enums"]["app_role"];
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          deleted_at?: string | null;
          full_name?: string | null;
          id?: string;
          phone?: string;
          reminders_enabled?: boolean;
          role?: Database["public"]["Enums"]["app_role"];
          updated_at?: string;
        };
        Relationships: [];
      };
      ratings: {
        Row: {
          comment: string | null;
          created_at: string;
          order_id: string;
          stars: number;
          tags: Database["public"]["Enums"]["rating_tag"][];
          ticket_id: string | null;
        };
        ComputedFields: never;
        Insert: {
          comment?: string | null;
          created_at?: string;
          order_id: string;
          stars: number;
          tags?: Database["public"]["Enums"]["rating_tag"][];
          ticket_id?: string | null;
        };
        Update: {
          comment?: string | null;
          created_at?: string;
          order_id?: string;
          stars?: number;
          tags?: Database["public"]["Enums"]["rating_tag"][];
          ticket_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "ratings_order_id_fkey";
            columns: ["order_id"];
            isOneToOne: true;
            referencedRelation: "orders";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "ratings_ticket_id_fkey";
            columns: ["ticket_id"];
            isOneToOne: true;
            referencedRelation: "tickets";
            referencedColumns: ["id"];
          },
        ];
      };
      service_areas: {
        Row: {
          active: boolean;
          area: unknown;
          created_at: string;
          id: number;
          name: string;
          updated_at: string;
        };
        ComputedFields: never;
        Insert: {
          active?: boolean;
          area: unknown;
          created_at?: string;
          id?: never;
          name: string;
          updated_at?: string;
        };
        Update: {
          active?: boolean;
          area?: unknown;
          created_at?: string;
          id?: never;
          name?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      settings: {
        Row: {
          booking_window_days: number;
          cancel_cutoff_hours: number;
          certificate_text: string;
          cleaning_interval_months: number;
          company_phone: string | null;
          id: boolean;
          maintenance_mode: boolean;
          max_tanks_per_order: number;
          min_app_version: string;
          privacy_md: string;
          sms_enabled: boolean;
          sterilant_text: string;
          terms_md: string;
          updated_at: string;
          working_days: number[];
          working_hours_end: string;
          working_hours_start: string;
        };
        ComputedFields: never;
        Insert: {
          booking_window_days?: number;
          cancel_cutoff_hours?: number;
          certificate_text?: string;
          cleaning_interval_months?: number;
          company_phone?: string | null;
          id?: boolean;
          maintenance_mode?: boolean;
          max_tanks_per_order?: number;
          min_app_version?: string;
          privacy_md?: string;
          sms_enabled?: boolean;
          sterilant_text?: string;
          terms_md?: string;
          updated_at?: string;
          working_days?: number[];
          working_hours_end?: string;
          working_hours_start?: string;
        };
        Update: {
          booking_window_days?: number;
          cancel_cutoff_hours?: number;
          certificate_text?: string;
          cleaning_interval_months?: number;
          company_phone?: string | null;
          id?: boolean;
          maintenance_mode?: boolean;
          max_tanks_per_order?: number;
          min_app_version?: string;
          privacy_md?: string;
          sms_enabled?: boolean;
          sterilant_text?: string;
          terms_md?: string;
          updated_at?: string;
          working_days?: number[];
          working_hours_end?: string;
          working_hours_start?: string;
        };
        Relationships: [];
      };
      slot_bookings: {
        Row: {
          created_at: string;
          order_id: string;
          seat: number;
          service_date: string;
          slot_id: number;
        };
        ComputedFields: never;
        Insert: {
          created_at?: string;
          order_id: string;
          seat: number;
          service_date: string;
          slot_id: number;
        };
        Update: {
          created_at?: string;
          order_id?: string;
          seat?: number;
          service_date?: string;
          slot_id?: number;
        };
        Relationships: [
          {
            foreignKeyName: "slot_bookings_order_id_fkey";
            columns: ["order_id"];
            isOneToOne: true;
            referencedRelation: "orders";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "slot_bookings_slot_id_fkey";
            columns: ["slot_id"];
            isOneToOne: false;
            referencedRelation: "slots";
            referencedColumns: ["id"];
          },
        ];
      };
      slots: {
        Row: {
          active: boolean;
          capacity: number;
          created_at: string;
          end_time: string;
          id: number;
          start_time: string;
          updated_at: string;
          weekdays: number[];
        };
        ComputedFields: never;
        Insert: {
          active?: boolean;
          capacity: number;
          created_at?: string;
          end_time: string;
          id?: never;
          start_time: string;
          updated_at?: string;
          weekdays: number[];
        };
        Update: {
          active?: boolean;
          capacity?: number;
          created_at?: string;
          end_time?: string;
          id?: never;
          start_time?: string;
          updated_at?: string;
          weekdays?: number[];
        };
        Relationships: [];
      };
      tanks: {
        Row: {
          address_id: string;
          created_at: string;
          id: string;
          last_cleaned_at: string | null;
          nickname: string | null;
          size: Database["public"]["Enums"]["tank_size"];
          type: Database["public"]["Enums"]["tank_type"];
          updated_at: string;
          user_id: string;
        };
        ComputedFields: never;
        Insert: {
          address_id: string;
          created_at?: string;
          id?: string;
          last_cleaned_at?: string | null;
          nickname?: string | null;
          size: Database["public"]["Enums"]["tank_size"];
          type: Database["public"]["Enums"]["tank_type"];
          updated_at?: string;
          user_id?: string;
        };
        Update: {
          address_id?: string;
          created_at?: string;
          id?: string;
          last_cleaned_at?: string | null;
          nickname?: string | null;
          size?: Database["public"]["Enums"]["tank_size"];
          type?: Database["public"]["Enums"]["tank_type"];
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "tanks_address_id_user_id_fkey";
            columns: ["address_id", "user_id"];
            isOneToOne: false;
            referencedRelation: "addresses";
            referencedColumns: ["id", "user_id"];
          },
        ];
      };
      tickets: {
        Row: {
          category: Database["public"]["Enums"]["ticket_category"] | null;
          created_at: string;
          description: string | null;
          id: string;
          number: number;
          order_id: string | null;
          source: Database["public"]["Enums"]["ticket_source"];
          status: Database["public"]["Enums"]["ticket_status"];
          updated_at: string;
          user_id: string;
        };
        ComputedFields: never;
        Insert: {
          category?: Database["public"]["Enums"]["ticket_category"] | null;
          created_at?: string;
          description?: string | null;
          id?: string;
          number?: never;
          order_id?: string | null;
          source: Database["public"]["Enums"]["ticket_source"];
          status?: Database["public"]["Enums"]["ticket_status"];
          updated_at?: string;
          user_id: string;
        };
        Update: {
          category?: Database["public"]["Enums"]["ticket_category"] | null;
          created_at?: string;
          description?: string | null;
          id?: string;
          number?: never;
          order_id?: string | null;
          source?: Database["public"]["Enums"]["ticket_source"];
          status?: Database["public"]["Enums"]["ticket_status"];
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "tickets_order_id_user_id_fkey";
            columns: ["order_id", "user_id"];
            isOneToOne: false;
            referencedRelation: "orders";
            referencedColumns: ["id", "customer_id"];
          },
          {
            foreignKeyName: "tickets_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      admin_add_admin: { Args: { p_name: string; p_phone: string }; Returns: boolean };
      admin_addresses_outside_area: { Args: Record<PropertyKey, never>; Returns: number };
      admin_block_date: { Args: { p_date: string; p_reason: string }; Returns: undefined };
      admin_create_crew: { Args: { p_name: string; p_phone: string }; Returns: string };
      admin_create_slot: {
        Args: {
          p_capacity: number;
          p_end_time: string;
          p_start_time: string;
          p_weekdays: number[];
        };
        Returns: number;
      };
      admin_remove_admin: { Args: { p_user_id: string }; Returns: undefined };
      admin_save_service_area: {
        Args: { p_active: boolean; p_area: Json; p_id: number; p_name: string };
        Returns: Record<string, unknown>;
      };
      admin_schedule_conflicts: {
        Args: Record<PropertyKey, never>;
        Returns: {
          number: number;
          order_id: string;
          reason: string;
          service_date: string;
          slot_id: number;
          slot_start_at: string;
          status: Database["public"]["Enums"]["order_status"];
        }[];
      };
      admin_service_areas: {
        Args: Record<PropertyKey, never>;
        Returns: {
          active: boolean;
          area: Json;
          id: number;
          name: string;
          updated_at: string;
        }[];
      };
      admin_set_crew_phone: { Args: { p_crew_id: string; p_phone: string }; Returns: undefined };
      admin_slot_board: {
        Args: { p_from: string; p_to: string };
        Returns: {
          blocked: boolean;
          bookable: boolean;
          capacity: number;
          end_at: string;
          service_date: string;
          slot_id: number;
          start_at: string;
          taken: number;
        }[];
      };
      admin_unblock_date: { Args: { p_date: string }; Returns: undefined };
      admin_update_crew: {
        Args: { p_active: boolean; p_crew_id: string; p_name: string };
        Returns: number;
      };
      admin_update_prices: { Args: { p_prices: Json }; Returns: number };
      admin_update_settings: { Args: { p_patch: Json }; Returns: undefined };
      admin_update_slot: {
        Args: { p_active: boolean; p_capacity: number; p_slot_id: number; p_weekdays: number[] };
        Returns: undefined;
      };
      assign_crew: { Args: { p_crew_id: string; p_order_id: string }; Returns: undefined };
      attach_job_media: {
        Args: {
          p_duration_s?: number;
          p_kind: Database["public"]["Enums"]["order_media_kind"];
          p_order_id: string;
          p_path: string;
        };
        Returns: string;
      };
      booking_availability: {
        Args: Record<PropertyKey, never>;
        Returns: {
          bookable: boolean;
          capacity: number;
          end_at: string;
          remaining: number;
          service_date: string;
          slot_id: number;
          start_at: string;
        }[];
      };
      check_otp: {
        Args: { p_code_hash: string; p_phone: string };
        Returns: Record<string, unknown>;
      };
      create_order: {
        Args: {
          p_address_id: string;
          p_expected_total?: number;
          p_items: Json;
          p_media?: Json;
          p_note?: string;
          p_request_id: string;
          p_service_date: string;
          p_slot_id: number;
        };
        Returns: Record<string, unknown>;
      };
      crew_job_contact: {
        Args: { p_order_id: string };
        Returns: {
          full_name: string;
          phone: string;
        }[];
      };
      delete_address: { Args: { p_address_id: string }; Returns: undefined };
      in_service_area: { Args: { p_lat: number; p_lng: number }; Returns: boolean };
      otp_locked_until: { Args: { p_phone: string }; Returns: string };
      public_certificate: {
        Args: { p_code: string };
        Returns: {
          district: string;
          issued_at: string;
          items: Json;
          number: number;
        }[];
      };
      rate_order: {
        Args: {
          p_comment?: string;
          p_order_id: string;
          p_stars: number;
          p_tags?: Database["public"]["Enums"]["rating_tag"][];
        };
        Returns: number;
      };
      record_otp_send_failed: {
        Args: { p_error: string; p_request_id: number };
        Returns: undefined;
      };
      record_otp_sent: {
        Args: {
          p_channel_used: Database["public"]["Enums"]["otp_channel"];
          p_provider_message_id?: string;
          p_request_id: number;
        };
        Returns: undefined;
      };
      remove_job_media: { Args: { p_media_id: string }; Returns: string };
      request_otp: {
        Args: {
          p_channel: Database["public"]["Enums"]["otp_channel"];
          p_code_hash: string;
          p_phone: string;
        };
        Returns: Record<string, unknown>;
      };
      set_login_password: { Args: { p_password: string; p_user_id: string }; Returns: undefined };
      share_crew_location: {
        Args: { p_accuracy_m: number; p_lat: number; p_lng: number; p_order_id: string };
        Returns: boolean;
      };
      transition_order: {
        Args: {
          p_order_id: string;
          p_payload?: Json;
          p_to_status: Database["public"]["Enums"]["order_status"];
        };
        Returns: undefined;
      };
      unattached_media: {
        Args: {
          p_after_created_at?: string;
          p_after_name?: string;
          p_folder: string;
          p_limit?: number;
        };
        Returns: {
          created_at: string;
          name: string;
        }[];
      };
    };
    Enums: {
      address_label: "home" | "family" | "work";
      app_role: "customer" | "crew" | "admin";
      cancel_reason: "plans_changed" | "time_unsuitable" | "other";
      media_type: "photo" | "video";
      order_media_kind: "customer" | "before" | "after" | "clip";
      order_status:
        | "pending_confirmation"
        | "confirmed"
        | "on_the_way"
        | "arrived"
        | "in_progress"
        | "completed"
        | "cancelled"
        | "no_show";
      otp_channel: "whatsapp" | "sms";
      payment_method: "cash";
      rating_tag: "on_time" | "clean_work" | "respectful" | "clear_photos";
      tank_size: "s" | "m" | "l";
      tank_type: "roof" | "ground";
      ticket_category: "leak" | "smell" | "late" | "staff" | "payment" | "other";
      ticket_source: "app" | "rating";
      ticket_status: "open" | "in_progress" | "closed";
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">;

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">];

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R;
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] & DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R;
      }
      ? R
      : never
    : never;

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema["Tables"] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I;
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I;
      }
      ? I
      : never
    : never;

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema["Tables"] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U;
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U;
      }
      ? U
      : never
    : never;

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    keyof DefaultSchema["Enums"] | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never;

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    keyof DefaultSchema["CompositeTypes"] | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never;

export const Constants = {
  public: {
    Enums: {
      address_label: ["home", "family", "work"],
      app_role: ["customer", "crew", "admin"],
      cancel_reason: ["plans_changed", "time_unsuitable", "other"],
      media_type: ["photo", "video"],
      order_media_kind: ["customer", "before", "after", "clip"],
      order_status: [
        "pending_confirmation",
        "confirmed",
        "on_the_way",
        "arrived",
        "in_progress",
        "completed",
        "cancelled",
        "no_show",
      ],
      otp_channel: ["whatsapp", "sms"],
      payment_method: ["cash"],
      rating_tag: ["on_time", "clean_work", "respectful", "clear_photos"],
      tank_size: ["s", "m", "l"],
      tank_type: ["roof", "ground"],
      ticket_category: ["leak", "smell", "late", "staff", "payment", "other"],
      ticket_source: ["app", "rating"],
      ticket_status: ["open", "in_progress", "closed"],
    },
  },
} as const;
