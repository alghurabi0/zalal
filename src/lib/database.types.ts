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
          cleaning_interval_months: number;
          company_phone: string | null;
          id: boolean;
          maintenance_mode: boolean;
          max_tanks_per_order: number;
          min_app_version: string;
          privacy_md: string;
          sms_enabled: boolean;
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
          cleaning_interval_months?: number;
          company_phone?: string | null;
          id?: boolean;
          maintenance_mode?: boolean;
          max_tanks_per_order?: number;
          min_app_version?: string;
          privacy_md?: string;
          sms_enabled?: boolean;
          terms_md?: string;
          updated_at?: string;
          working_days?: number[];
          working_hours_end?: string;
          working_hours_start?: string;
        };
        Update: {
          booking_window_days?: number;
          cancel_cutoff_hours?: number;
          cleaning_interval_months?: number;
          company_phone?: string | null;
          id?: boolean;
          maintenance_mode?: boolean;
          max_tanks_per_order?: number;
          min_app_version?: string;
          privacy_md?: string;
          sms_enabled?: boolean;
          terms_md?: string;
          updated_at?: string;
          working_days?: number[];
          working_hours_end?: string;
          working_hours_start?: string;
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
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      allow_password_set: { Args: { p_user_id: string }; Returns: undefined };
      check_otp: {
        Args: { p_code_hash: string; p_phone: string };
        Returns: Record<string, unknown>;
      };
      delete_address: { Args: { p_address_id: string }; Returns: undefined };
      in_service_area: { Args: { p_lat: number; p_lng: number }; Returns: boolean };
      otp_locked_until: { Args: { p_phone: string }; Returns: string };
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
      request_otp: {
        Args: {
          p_channel: Database["public"]["Enums"]["otp_channel"];
          p_code_hash: string;
          p_phone: string;
        };
        Returns: Record<string, unknown>;
      };
    };
    Enums: {
      address_label: "home" | "family" | "work";
      app_role: "customer" | "crew" | "admin";
      otp_channel: "whatsapp" | "sms";
      tank_size: "s" | "m" | "l";
      tank_type: "roof" | "ground";
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
      otp_channel: ["whatsapp", "sms"],
      tank_size: ["s", "m", "l"],
      tank_type: ["roof", "ground"],
    },
  },
} as const;
