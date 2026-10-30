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
      article_categories: {
        Row: {
          created_at: string;
          icon: Database["public"]["Enums"]["category_icon"];
          id: number;
          name: string;
          sort: number;
          updated_at: string;
        };
        ComputedFields: never;
        Insert: {
          created_at?: string;
          icon?: Database["public"]["Enums"]["category_icon"];
          id?: never;
          name: string;
          sort?: number;
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          icon?: Database["public"]["Enums"]["category_icon"];
          id?: never;
          name?: string;
          sort?: number;
          updated_at?: string;
        };
        Relationships: [];
      };
      articles: {
        Row: {
          body_md: string;
          category_id: number;
          cover_path: string | null;
          created_at: string;
          featured: boolean;
          id: string;
          published_at: string | null;
          read_minutes: number | null;
          slug: string;
          status: Database["public"]["Enums"]["article_status"];
          title: string;
          updated_at: string;
        };
        ComputedFields: never;
        Insert: {
          body_md?: string;
          category_id: number;
          cover_path?: string | null;
          created_at?: string;
          featured?: boolean;
          id?: string;
          published_at?: string | null;
          read_minutes?: never;
          slug: string;
          status?: Database["public"]["Enums"]["article_status"];
          title: string;
          updated_at?: string;
        };
        Update: {
          body_md?: string;
          category_id?: number;
          cover_path?: string | null;
          created_at?: string;
          featured?: boolean;
          id?: string;
          published_at?: string | null;
          read_minutes?: never;
          slug?: string;
          status?: Database["public"]["Enums"]["article_status"];
          title?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "articles_category_id_fkey";
            columns: ["category_id"];
            isOneToOne: false;
            referencedRelation: "article_categories";
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
          {
            foreignKeyName: "certificates_order_id_fkey";
            columns: ["order_id"];
            isOneToOne: true;
            referencedRelation: "subscription_overview";
            referencedColumns: ["next_order_id"];
          },
        ];
      };
      chat_messages: {
        Row: {
          author: Database["public"]["Enums"]["chat_author"];
          body: string | null;
          bytes: number | null;
          client_id: string | null;
          created_at: string;
          customer_id: string;
          duration_s: number | null;
          id: string;
          kind: Database["public"]["Enums"]["chat_message_kind"];
          media_path: string | null;
          media_type: Database["public"]["Enums"]["media_type"] | null;
          order_id: string | null;
          read_at: string | null;
          sender_id: string | null;
          thread_id: string;
          ticket_id: string | null;
          topic: Database["public"]["Enums"]["chat_topic"] | null;
        };
        ComputedFields: never;
        Insert: {
          author: Database["public"]["Enums"]["chat_author"];
          body?: string | null;
          bytes?: number | null;
          client_id?: string | null;
          created_at?: string;
          customer_id: string;
          duration_s?: number | null;
          id?: string;
          kind?: Database["public"]["Enums"]["chat_message_kind"];
          media_path?: string | null;
          media_type?: Database["public"]["Enums"]["media_type"] | null;
          order_id?: string | null;
          read_at?: string | null;
          sender_id?: string | null;
          thread_id: string;
          ticket_id?: string | null;
          topic?: Database["public"]["Enums"]["chat_topic"] | null;
        };
        Update: {
          author?: Database["public"]["Enums"]["chat_author"];
          body?: string | null;
          bytes?: number | null;
          client_id?: string | null;
          created_at?: string;
          customer_id?: string;
          duration_s?: number | null;
          id?: string;
          kind?: Database["public"]["Enums"]["chat_message_kind"];
          media_path?: string | null;
          media_type?: Database["public"]["Enums"]["media_type"] | null;
          order_id?: string | null;
          read_at?: string | null;
          sender_id?: string | null;
          thread_id?: string;
          ticket_id?: string | null;
          topic?: Database["public"]["Enums"]["chat_topic"] | null;
        };
        Relationships: [
          {
            foreignKeyName: "chat_messages_order_id_customer_id_fkey";
            columns: ["order_id", "customer_id"];
            isOneToOne: false;
            referencedRelation: "orders";
            referencedColumns: ["id", "customer_id"];
          },
          {
            foreignKeyName: "chat_messages_sender_id_fkey";
            columns: ["sender_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "chat_messages_thread_id_customer_id_fkey";
            columns: ["thread_id", "customer_id"];
            isOneToOne: false;
            referencedRelation: "chat_threads";
            referencedColumns: ["id", "user_id"];
          },
          {
            foreignKeyName: "chat_messages_ticket_id_customer_id_fkey";
            columns: ["ticket_id", "customer_id"];
            isOneToOne: false;
            referencedRelation: "tickets";
            referencedColumns: ["id", "user_id"];
          },
        ];
      };
      chat_threads: {
        Row: {
          admin_unread: number;
          created_at: string;
          customer_unread: number;
          id: string;
          last_message_at: string | null;
          user_id: string;
        };
        ComputedFields: never;
        Insert: {
          admin_unread?: number;
          created_at?: string;
          customer_unread?: number;
          id?: string;
          last_message_at?: string | null;
          user_id: string;
        };
        Update: {
          admin_unread?: number;
          created_at?: string;
          customer_unread?: number;
          id?: string;
          last_message_at?: string | null;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "chat_threads_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: true;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      cleaning_reminders: {
        Row: {
          certificate_id: string;
          created_at: string;
          due_on: string;
          kind: Database["public"]["Enums"]["reminder_kind"];
        };
        ComputedFields: never;
        Insert: {
          certificate_id: string;
          created_at?: string;
          due_on: string;
          kind: Database["public"]["Enums"]["reminder_kind"];
        };
        Update: {
          certificate_id?: string;
          created_at?: string;
          due_on?: string;
          kind?: Database["public"]["Enums"]["reminder_kind"];
        };
        Relationships: [
          {
            foreignKeyName: "cleaning_reminders_certificate_id_fkey";
            columns: ["certificate_id"];
            isOneToOne: false;
            referencedRelation: "certificates";
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
          {
            foreignKeyName: "crew_live_location_order_id_fkey";
            columns: ["order_id"];
            isOneToOne: true;
            referencedRelation: "subscription_overview";
            referencedColumns: ["next_order_id"];
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
      expense_categories: {
        Row: {
          active: boolean;
          created_at: string;
          id: number;
          kind: Database["public"]["Enums"]["expense_category_kind"];
          name: string;
          updated_at: string;
        };
        ComputedFields: never;
        Insert: {
          active?: boolean;
          created_at?: string;
          id?: never;
          kind?: Database["public"]["Enums"]["expense_category_kind"];
          name: string;
          updated_at?: string;
        };
        Update: {
          active?: boolean;
          created_at?: string;
          id?: never;
          kind?: Database["public"]["Enums"]["expense_category_kind"];
          name?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      expenses: {
        Row: {
          account_id: string;
          amount_iqd: number;
          category_id: number;
          created_at: string;
          created_by: string;
          id: string;
          note: string | null;
          spent_on: string;
          updated_at: string;
          void_reason: string | null;
          voided_at: string | null;
          voided_by: string | null;
        };
        ComputedFields: never;
        Insert: {
          account_id: string;
          amount_iqd: number;
          category_id: number;
          created_at?: string;
          created_by: string;
          id?: string;
          note?: string | null;
          spent_on: string;
          updated_at?: string;
          void_reason?: string | null;
          voided_at?: string | null;
          voided_by?: string | null;
        };
        Update: {
          account_id?: string;
          amount_iqd?: number;
          category_id?: number;
          created_at?: string;
          created_by?: string;
          id?: string;
          note?: string | null;
          spent_on?: string;
          updated_at?: string;
          void_reason?: string | null;
          voided_at?: string | null;
          voided_by?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "expenses_account_id_fkey";
            columns: ["account_id"];
            isOneToOne: false;
            referencedRelation: "finance_account_balances";
            referencedColumns: ["account_id"];
          },
          {
            foreignKeyName: "expenses_account_id_fkey";
            columns: ["account_id"];
            isOneToOne: false;
            referencedRelation: "finance_accounts";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "expenses_category_id_fkey";
            columns: ["category_id"];
            isOneToOne: false;
            referencedRelation: "expense_categories";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "expenses_created_by_fkey";
            columns: ["created_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "expenses_voided_by_fkey";
            columns: ["voided_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      finance_accounts: {
        Row: {
          active: boolean;
          created_at: string;
          crew_id: string | null;
          id: string;
          kind: Database["public"]["Enums"]["finance_account_kind"];
          name: string | null;
          opening_balance_iqd: number;
          updated_at: string;
        };
        ComputedFields: never;
        Insert: {
          active?: boolean;
          created_at?: string;
          crew_id?: string | null;
          id?: string;
          kind: Database["public"]["Enums"]["finance_account_kind"];
          name?: string | null;
          opening_balance_iqd?: number;
          updated_at?: string;
        };
        Update: {
          active?: boolean;
          created_at?: string;
          crew_id?: string | null;
          id?: string;
          kind?: Database["public"]["Enums"]["finance_account_kind"];
          name?: string | null;
          opening_balance_iqd?: number;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "finance_accounts_crew_id_fkey";
            columns: ["crew_id"];
            isOneToOne: true;
            referencedRelation: "crews";
            referencedColumns: ["id"];
          },
        ];
      };
      finance_discounts: {
        Row: {
          amount_iqd: number;
          created_at: string;
          created_by: string;
          id: string;
          order_id: string | null;
          reason: string | null;
          subscription_id: string | null;
          updated_at: string;
          void_reason: string | null;
          voided_at: string | null;
          voided_by: string | null;
        };
        ComputedFields: never;
        Insert: {
          amount_iqd: number;
          created_at?: string;
          created_by: string;
          id?: string;
          order_id?: string | null;
          reason?: string | null;
          subscription_id?: string | null;
          updated_at?: string;
          void_reason?: string | null;
          voided_at?: string | null;
          voided_by?: string | null;
        };
        Update: {
          amount_iqd?: number;
          created_at?: string;
          created_by?: string;
          id?: string;
          order_id?: string | null;
          reason?: string | null;
          subscription_id?: string | null;
          updated_at?: string;
          void_reason?: string | null;
          voided_at?: string | null;
          voided_by?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "finance_discounts_created_by_fkey";
            columns: ["created_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "finance_discounts_order_id_fkey";
            columns: ["order_id"];
            isOneToOne: false;
            referencedRelation: "orders";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "finance_discounts_order_id_fkey";
            columns: ["order_id"];
            isOneToOne: false;
            referencedRelation: "subscription_overview";
            referencedColumns: ["next_order_id"];
          },
          {
            foreignKeyName: "finance_discounts_subscription_id_fkey";
            columns: ["subscription_id"];
            isOneToOne: false;
            referencedRelation: "subscription_overview";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "finance_discounts_subscription_id_fkey";
            columns: ["subscription_id"];
            isOneToOne: false;
            referencedRelation: "subscriptions";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "finance_discounts_voided_by_fkey";
            columns: ["voided_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      finance_payments: {
        Row: {
          account_id: string;
          amount_iqd: number;
          automatic: boolean;
          created_at: string;
          created_by: string | null;
          id: string;
          note: string | null;
          order_id: string | null;
          paid_on: string;
          sale_id: string | null;
          subscription_id: string | null;
          updated_at: string;
          void_reason: string | null;
          voided_at: string | null;
          voided_by: string | null;
        };
        ComputedFields: never;
        Insert: {
          account_id: string;
          amount_iqd: number;
          automatic?: boolean;
          created_at?: string;
          created_by?: string | null;
          id?: string;
          note?: string | null;
          order_id?: string | null;
          paid_on: string;
          sale_id?: string | null;
          subscription_id?: string | null;
          updated_at?: string;
          void_reason?: string | null;
          voided_at?: string | null;
          voided_by?: string | null;
        };
        Update: {
          account_id?: string;
          amount_iqd?: number;
          automatic?: boolean;
          created_at?: string;
          created_by?: string | null;
          id?: string;
          note?: string | null;
          order_id?: string | null;
          paid_on?: string;
          sale_id?: string | null;
          subscription_id?: string | null;
          updated_at?: string;
          void_reason?: string | null;
          voided_at?: string | null;
          voided_by?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "finance_payments_account_id_fkey";
            columns: ["account_id"];
            isOneToOne: false;
            referencedRelation: "finance_account_balances";
            referencedColumns: ["account_id"];
          },
          {
            foreignKeyName: "finance_payments_account_id_fkey";
            columns: ["account_id"];
            isOneToOne: false;
            referencedRelation: "finance_accounts";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "finance_payments_created_by_fkey";
            columns: ["created_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "finance_payments_order_id_fkey";
            columns: ["order_id"];
            isOneToOne: false;
            referencedRelation: "orders";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "finance_payments_order_id_fkey";
            columns: ["order_id"];
            isOneToOne: false;
            referencedRelation: "subscription_overview";
            referencedColumns: ["next_order_id"];
          },
          {
            foreignKeyName: "finance_payments_sale_id_fkey";
            columns: ["sale_id"];
            isOneToOne: false;
            referencedRelation: "manual_sales";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "finance_payments_subscription_id_fkey";
            columns: ["subscription_id"];
            isOneToOne: false;
            referencedRelation: "subscription_overview";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "finance_payments_subscription_id_fkey";
            columns: ["subscription_id"];
            isOneToOne: false;
            referencedRelation: "subscriptions";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "finance_payments_voided_by_fkey";
            columns: ["voided_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      finance_settings: {
        Row: {
          id: boolean;
          start_on: string;
          updated_at: string;
        };
        ComputedFields: never;
        Insert: {
          id?: boolean;
          start_on: string;
          updated_at?: string;
        };
        Update: {
          id?: boolean;
          start_on?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      finance_transfers: {
        Row: {
          amount_iqd: number;
          created_at: string;
          created_by: string;
          from_account_id: string;
          id: string;
          moved_on: string;
          note: string | null;
          to_account_id: string;
          updated_at: string;
          void_reason: string | null;
          voided_at: string | null;
          voided_by: string | null;
        };
        ComputedFields: never;
        Insert: {
          amount_iqd: number;
          created_at?: string;
          created_by: string;
          from_account_id: string;
          id?: string;
          moved_on: string;
          note?: string | null;
          to_account_id: string;
          updated_at?: string;
          void_reason?: string | null;
          voided_at?: string | null;
          voided_by?: string | null;
        };
        Update: {
          amount_iqd?: number;
          created_at?: string;
          created_by?: string;
          from_account_id?: string;
          id?: string;
          moved_on?: string;
          note?: string | null;
          to_account_id?: string;
          updated_at?: string;
          void_reason?: string | null;
          voided_at?: string | null;
          voided_by?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "finance_transfers_created_by_fkey";
            columns: ["created_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "finance_transfers_from_account_id_fkey";
            columns: ["from_account_id"];
            isOneToOne: false;
            referencedRelation: "finance_account_balances";
            referencedColumns: ["account_id"];
          },
          {
            foreignKeyName: "finance_transfers_from_account_id_fkey";
            columns: ["from_account_id"];
            isOneToOne: false;
            referencedRelation: "finance_accounts";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "finance_transfers_to_account_id_fkey";
            columns: ["to_account_id"];
            isOneToOne: false;
            referencedRelation: "finance_account_balances";
            referencedColumns: ["account_id"];
          },
          {
            foreignKeyName: "finance_transfers_to_account_id_fkey";
            columns: ["to_account_id"];
            isOneToOne: false;
            referencedRelation: "finance_accounts";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "finance_transfers_voided_by_fkey";
            columns: ["voided_by"];
            isOneToOne: false;
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
          {
            foreignKeyName: "job_reports_order_id_fkey";
            columns: ["order_id"];
            isOneToOne: true;
            referencedRelation: "subscription_overview";
            referencedColumns: ["next_order_id"];
          },
        ];
      };
      manual_sales: {
        Row: {
          amount_iqd: number;
          created_at: string;
          created_by: string;
          crew_id: string | null;
          customer_name: string;
          customer_phone: string | null;
          id: string;
          note: string | null;
          place: string | null;
          service: string;
          sold_on: string;
          updated_at: string;
          void_reason: string | null;
          voided_at: string | null;
          voided_by: string | null;
        };
        ComputedFields: never;
        Insert: {
          amount_iqd: number;
          created_at?: string;
          created_by: string;
          crew_id?: string | null;
          customer_name: string;
          customer_phone?: string | null;
          id?: string;
          note?: string | null;
          place?: string | null;
          service: string;
          sold_on: string;
          updated_at?: string;
          void_reason?: string | null;
          voided_at?: string | null;
          voided_by?: string | null;
        };
        Update: {
          amount_iqd?: number;
          created_at?: string;
          created_by?: string;
          crew_id?: string | null;
          customer_name?: string;
          customer_phone?: string | null;
          id?: string;
          note?: string | null;
          place?: string | null;
          service?: string;
          sold_on?: string;
          updated_at?: string;
          void_reason?: string | null;
          voided_at?: string | null;
          voided_by?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "manual_sales_created_by_fkey";
            columns: ["created_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "manual_sales_crew_id_fkey";
            columns: ["crew_id"];
            isOneToOne: false;
            referencedRelation: "crews";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "manual_sales_voided_by_fkey";
            columns: ["voided_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      notifications: {
        Row: {
          audience: Database["public"]["Enums"]["app_role"];
          created_at: string;
          data: NonNullable<Json>;
          id: string;
          order_id: string | null;
          read_at: string | null;
          ticket_id: string | null;
          type: Database["public"]["Enums"]["notification_type"];
          user_id: string;
        };
        ComputedFields: never;
        Insert: {
          audience?: never;
          created_at?: string;
          data?: NonNullable<Json>;
          id?: string;
          order_id?: string | null;
          read_at?: string | null;
          ticket_id?: string | null;
          type: Database["public"]["Enums"]["notification_type"];
          user_id: string;
        };
        Update: {
          audience?: never;
          created_at?: string;
          data?: NonNullable<Json>;
          id?: string;
          order_id?: string | null;
          read_at?: string | null;
          ticket_id?: string | null;
          type?: Database["public"]["Enums"]["notification_type"];
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "notifications_order_id_fkey";
            columns: ["order_id"];
            isOneToOne: false;
            referencedRelation: "orders";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "notifications_order_id_fkey";
            columns: ["order_id"];
            isOneToOne: false;
            referencedRelation: "subscription_overview";
            referencedColumns: ["next_order_id"];
          },
          {
            foreignKeyName: "notifications_ticket_id_fkey";
            columns: ["ticket_id"];
            isOneToOne: false;
            referencedRelation: "tickets";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "notifications_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
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
          {
            foreignKeyName: "order_events_order_id_fkey";
            columns: ["order_id"];
            isOneToOne: false;
            referencedRelation: "subscription_overview";
            referencedColumns: ["next_order_id"];
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
            foreignKeyName: "order_items_order_id_fkey";
            columns: ["order_id"];
            isOneToOne: false;
            referencedRelation: "subscription_overview";
            referencedColumns: ["next_order_id"];
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
            foreignKeyName: "order_media_order_id_fkey";
            columns: ["order_id"];
            isOneToOne: false;
            referencedRelation: "subscription_overview";
            referencedColumns: ["next_order_id"];
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
          subscription_id: string | null;
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
          subscription_id?: string | null;
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
          subscription_id?: string | null;
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
          {
            foreignKeyName: "orders_subscription_id_address_id_fkey";
            columns: ["subscription_id", "address_id"];
            isOneToOne: false;
            referencedRelation: "subscription_overview";
            referencedColumns: ["id", "address_id"];
          },
          {
            foreignKeyName: "orders_subscription_id_address_id_fkey";
            columns: ["subscription_id", "address_id"];
            isOneToOne: false;
            referencedRelation: "subscriptions";
            referencedColumns: ["id", "address_id"];
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
          phone: string | null;
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
          phone?: string | null;
          reminders_enabled?: boolean;
          role?: Database["public"]["Enums"]["app_role"];
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          deleted_at?: string | null;
          full_name?: string | null;
          id?: string;
          phone?: string | null;
          reminders_enabled?: boolean;
          role?: Database["public"]["Enums"]["app_role"];
          updated_at?: string;
        };
        Relationships: [];
      };
      push_subscriptions: {
        Row: {
          auth: string;
          created_at: string;
          endpoint: string;
          id: string;
          p256dh: string;
          saved_at: string;
          user_agent: string | null;
          user_id: string;
        };
        ComputedFields: never;
        Insert: {
          auth: string;
          created_at?: string;
          endpoint: string;
          id?: string;
          p256dh: string;
          saved_at?: string;
          user_agent?: string | null;
          user_id: string;
        };
        Update: {
          auth?: string;
          created_at?: string;
          endpoint?: string;
          id?: string;
          p256dh?: string;
          saved_at?: string;
          user_agent?: string | null;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "push_subscriptions_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
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
            foreignKeyName: "ratings_order_id_fkey";
            columns: ["order_id"];
            isOneToOne: true;
            referencedRelation: "subscription_overview";
            referencedColumns: ["next_order_id"];
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
          certificate_stamp_path: string | null;
          certificate_text: string;
          cleaning_interval_months: number;
          company_phone: string | null;
          company_phone_2: string | null;
          id: boolean;
          maintenance_mode: boolean;
          max_tanks_per_order: number;
          min_app_version: string;
          privacy_md: string;
          sms_enabled: boolean;
          sterilant_text: string;
          subscription_price_iqd: number | null;
          subscription_tanks: number;
          subscription_visits: number;
          support_response_text: string;
          terms_md: string;
          ticket_response_hours: number;
          updated_at: string;
          working_days: number[];
          working_hours_end: string;
          working_hours_start: string;
        };
        ComputedFields: never;
        Insert: {
          booking_window_days?: number;
          cancel_cutoff_hours?: number;
          certificate_stamp_path?: string | null;
          certificate_text?: string;
          cleaning_interval_months?: number;
          company_phone?: string | null;
          company_phone_2?: string | null;
          id?: boolean;
          maintenance_mode?: boolean;
          max_tanks_per_order?: number;
          min_app_version?: string;
          privacy_md?: string;
          sms_enabled?: boolean;
          sterilant_text?: string;
          subscription_price_iqd?: number | null;
          subscription_tanks?: number;
          subscription_visits?: number;
          support_response_text?: string;
          terms_md?: string;
          ticket_response_hours?: number;
          updated_at?: string;
          working_days?: number[];
          working_hours_end?: string;
          working_hours_start?: string;
        };
        Update: {
          booking_window_days?: number;
          cancel_cutoff_hours?: number;
          certificate_stamp_path?: string | null;
          certificate_text?: string;
          cleaning_interval_months?: number;
          company_phone?: string | null;
          company_phone_2?: string | null;
          id?: boolean;
          maintenance_mode?: boolean;
          max_tanks_per_order?: number;
          min_app_version?: string;
          privacy_md?: string;
          sms_enabled?: boolean;
          sterilant_text?: string;
          subscription_price_iqd?: number | null;
          subscription_tanks?: number;
          subscription_visits?: number;
          support_response_text?: string;
          terms_md?: string;
          ticket_response_hours?: number;
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
            foreignKeyName: "slot_bookings_order_id_fkey";
            columns: ["order_id"];
            isOneToOne: true;
            referencedRelation: "subscription_overview";
            referencedColumns: ["next_order_id"];
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
      subscription_notes: {
        Row: {
          author_id: string;
          created_at: string;
          id: number;
          note: string;
          subscription_id: string;
        };
        ComputedFields: never;
        Insert: {
          author_id: string;
          created_at?: string;
          id?: never;
          note: string;
          subscription_id: string;
        };
        Update: {
          author_id?: string;
          created_at?: string;
          id?: never;
          note?: string;
          subscription_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "subscription_notes_author_id_fkey";
            columns: ["author_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "subscription_notes_subscription_id_fkey";
            columns: ["subscription_id"];
            isOneToOne: false;
            referencedRelation: "subscription_overview";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "subscription_notes_subscription_id_fkey";
            columns: ["subscription_id"];
            isOneToOne: false;
            referencedRelation: "subscriptions";
            referencedColumns: ["id"];
          },
        ];
      };
      subscriptions: {
        Row: {
          activated_at: string | null;
          address_id: string;
          created_at: string;
          ended_at: string | null;
          ends_on: string | null;
          expiry_notified_on: string | null;
          id: string;
          paid: boolean;
          price_iqd: number | null;
          requested_at: string;
          starts_on: string | null;
          status: Database["public"]["Enums"]["subscription_status"];
          tanks_covered: number | null;
          updated_at: string;
          user_id: string;
          visits_adjustment: number;
          visits_total: number | null;
        };
        ComputedFields: never;
        Insert: {
          activated_at?: string | null;
          address_id: string;
          created_at?: string;
          ended_at?: string | null;
          ends_on?: string | null;
          expiry_notified_on?: string | null;
          id?: string;
          paid?: boolean;
          price_iqd?: number | null;
          requested_at?: string;
          starts_on?: string | null;
          status?: Database["public"]["Enums"]["subscription_status"];
          tanks_covered?: number | null;
          updated_at?: string;
          user_id: string;
          visits_adjustment?: number;
          visits_total?: number | null;
        };
        Update: {
          activated_at?: string | null;
          address_id?: string;
          created_at?: string;
          ended_at?: string | null;
          ends_on?: string | null;
          expiry_notified_on?: string | null;
          id?: string;
          paid?: boolean;
          price_iqd?: number | null;
          requested_at?: string;
          starts_on?: string | null;
          status?: Database["public"]["Enums"]["subscription_status"];
          tanks_covered?: number | null;
          updated_at?: string;
          user_id?: string;
          visits_adjustment?: number;
          visits_total?: number | null;
        };
        Relationships: [
          {
            foreignKeyName: "subscriptions_address_id_user_id_fkey";
            columns: ["address_id", "user_id"];
            isOneToOne: false;
            referencedRelation: "addresses";
            referencedColumns: ["id", "user_id"];
          },
          {
            foreignKeyName: "subscriptions_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
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
      ticket_media: {
        Row: {
          bytes: number;
          created_at: string;
          duration_s: number | null;
          id: string;
          media_type: Database["public"]["Enums"]["media_type"];
          path: string;
          ticket_id: string;
          user_id: string;
        };
        ComputedFields: never;
        Insert: {
          bytes: number;
          created_at?: string;
          duration_s?: number | null;
          id?: string;
          media_type: Database["public"]["Enums"]["media_type"];
          path: string;
          ticket_id: string;
          user_id: string;
        };
        Update: {
          bytes?: number;
          created_at?: string;
          duration_s?: number | null;
          id?: string;
          media_type?: Database["public"]["Enums"]["media_type"];
          path?: string;
          ticket_id?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "ticket_media_ticket_id_user_id_fkey";
            columns: ["ticket_id", "user_id"];
            isOneToOne: false;
            referencedRelation: "tickets";
            referencedColumns: ["id", "user_id"];
          },
        ];
      };
      ticket_notes: {
        Row: {
          author_id: string;
          created_at: string;
          id: number;
          note: string;
          ticket_id: string;
        };
        ComputedFields: never;
        Insert: {
          author_id: string;
          created_at?: string;
          id?: never;
          note: string;
          ticket_id: string;
        };
        Update: {
          author_id?: string;
          created_at?: string;
          id?: never;
          note?: string;
          ticket_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "ticket_notes_author_id_fkey";
            columns: ["author_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "ticket_notes_ticket_id_fkey";
            columns: ["ticket_id"];
            isOneToOne: false;
            referencedRelation: "tickets";
            referencedColumns: ["id"];
          },
        ];
      };
      tickets: {
        Row: {
          category: Database["public"]["Enums"]["ticket_category"] | null;
          client_id: string | null;
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
          client_id?: string | null;
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
          client_id?: string | null;
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
      finance_account_balances: {
        Row: {
          account_id: string;
          balance_iqd: number | null;
        };
        ComputedFields: never;
        Insert: {
          account_id?: string | null;
          balance_iqd?: never;
        };
        Update: {
          account_id?: string | null;
          balance_iqd?: never;
        };
        Relationships: [];
      };
      finance_customer_balances: {
        Row: {
          amount_iqd: number | null;
          balance_iqd: number | null;
          customer_id: string | null;
          customer_name: string | null;
          customer_phone: string | null;
          items: number | null;
          kind: string | null;
          last_revenue_on: string | null;
          paid_iqd: number | null;
          sale_id: string | null;
        };
        ComputedFields: never;
        Relationships: [];
      };
      finance_receivables: {
        Row: {
          amount_iqd: number | null;
          balance_iqd: number | null;
          counted: boolean | null;
          crew_id: string | null;
          customer_id: string | null;
          customer_name: string | null;
          customer_phone: string | null;
          discount_iqd: number | null;
          item_id: string | null;
          kind: string | null;
          order_id: string | null;
          order_number: number | null;
          paid_iqd: number | null;
          revenue_on: string | null;
          sale_id: string | null;
          service: string | null;
          subscription_id: string | null;
          total_iqd: number | null;
        };
        ComputedFields: never;
        Relationships: [];
      };
      subscription_overview: {
        Row: {
          activated_at: string | null;
          address_district: string | null;
          address_id: string;
          address_label: Database["public"]["Enums"]["address_label"] | null;
          address_landmark: string | null;
          customer_name: string | null;
          customer_phone: string | null;
          ended_at: string | null;
          ends_on: string | null;
          id: string;
          last_visit_on: string | null;
          next_order_at: string | null;
          next_order_id: string | null;
          paid: boolean;
          price_iqd: number | null;
          requested_at: string;
          starts_on: string | null;
          state: string | null;
          status: Database["public"]["Enums"]["subscription_status"];
          tanks_covered: number | null;
          user_id: string;
          visits_adjustment: number;
          visits_held: number | null;
          visits_left: number | null;
          visits_total: number | null;
          visits_used: number | null;
        };
        ComputedFields: never;
        Relationships: [
          {
            foreignKeyName: "subscriptions_address_id_user_id_fkey";
            columns: ["address_id", "user_id"];
            isOneToOne: false;
            referencedRelation: "addresses";
            referencedColumns: ["id", "user_id"];
          },
          {
            foreignKeyName: "subscriptions_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
    };
    Functions: {
      admin_activate_subscription: {
        Args: {
          p_note?: string;
          p_paid: boolean;
          p_price_iqd: number;
          p_starts_on: string;
          p_subscription_id: string;
          p_tanks: number;
          p_visits: number;
        };
        Returns: undefined;
      };
      admin_add_admin: { Args: { p_name: string; p_phone: string }; Returns: boolean };
      admin_add_subscription_note: {
        Args: { p_note: string; p_subscription_id: string };
        Returns: undefined;
      };
      admin_add_ticket_note: { Args: { p_note: string; p_ticket_id: string }; Returns: number };
      admin_addresses_outside_area: { Args: Record<PropertyKey, never>; Returns: number };
      admin_adjust_subscription_visits: {
        Args: { p_delta: number; p_reason: string; p_subscription_id: string };
        Returns: undefined;
      };
      admin_block_date: { Args: { p_date: string; p_reason: string }; Returns: undefined };
      admin_chat_inbox: {
        Args: { p_limit?: number; p_search?: string };
        Returns: {
          admin_unread: number;
          customer_unread: number;
          full_name: string;
          last_author: Database["public"]["Enums"]["chat_author"];
          last_body: string;
          last_kind: Database["public"]["Enums"]["chat_message_kind"];
          last_media_type: Database["public"]["Enums"]["media_type"];
          last_message_at: string;
          last_order_id: string;
          last_topic: Database["public"]["Enums"]["chat_topic"];
          phone: string;
          thread_id: string;
          user_id: string;
        }[];
      };
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
      admin_customers: {
        Args: { p_limit?: number; p_search?: string; p_sort?: string };
        Returns: {
          created_at: string;
          district: string;
          full_name: string;
          id: string;
          last_order_at: string;
          orders_count: number;
          phone: string;
          total: number;
        }[];
      };
      admin_delete_article: { Args: { p_id: string }; Returns: string };
      admin_delete_category: { Args: { p_id: number }; Returns: undefined };
      admin_delete_expense_category: { Args: { p_id: number }; Returns: undefined };
      admin_end_subscription: {
        Args: { p_reason: string; p_subscription_id: string };
        Returns: undefined;
      };
      admin_expense_summary: {
        Args: {
          p_account_id?: string;
          p_category_id?: number;
          p_from: string;
          p_to: string;
          p_voided?: boolean;
          p_words?: string;
        };
        Returns: {
          count: number;
          total: number;
        }[];
      };
      admin_rating_summary: {
        Args: Record<PropertyKey, never>;
        Returns: {
          ratings: number;
          stars: number;
        }[];
      };
      admin_remove_admin: { Args: { p_user_id: string }; Returns: undefined };
      admin_reorder_categories: { Args: { p_ids: number[] }; Returns: undefined };
      admin_revenue_summary: {
        Args: { p_from: string; p_to: string };
        Returns: {
          credit_iqd: number;
          discounts_iqd: number;
          owed_iqd: number;
          received_iqd: number;
          revenue_iqd: number;
        }[];
      };
      admin_save_article: {
        Args: {
          p_body_md?: string;
          p_category_id?: number;
          p_cover_path?: string;
          p_featured?: boolean;
          p_id?: string;
          p_slug?: string;
          p_status?: Database["public"]["Enums"]["article_status"];
          p_title?: string;
        };
        Returns: {
          article_id: string;
          replaced_cover: string;
        }[];
      };
      admin_save_category: {
        Args: {
          p_icon?: Database["public"]["Enums"]["category_icon"];
          p_id?: number;
          p_name?: string;
        };
        Returns: number;
      };
      admin_save_discount: {
        Args: {
          p_amount_iqd?: number;
          p_id?: string;
          p_order_id?: string;
          p_reason?: string;
          p_subscription_id?: string;
        };
        Returns: string;
      };
      admin_save_expense: {
        Args: {
          p_account_id?: string;
          p_amount_iqd?: number;
          p_category_id?: number;
          p_id?: string;
          p_note?: string;
          p_spent_on?: string;
        };
        Returns: string;
      };
      admin_save_expense_category: {
        Args: {
          p_active?: boolean;
          p_id?: number;
          p_kind?: Database["public"]["Enums"]["expense_category_kind"];
          p_name?: string;
        };
        Returns: number;
      };
      admin_save_finance_account: {
        Args: {
          p_active?: boolean;
          p_id?: string;
          p_kind?: Database["public"]["Enums"]["finance_account_kind"];
          p_name?: string;
          p_opening_balance_iqd?: number;
        };
        Returns: string;
      };
      admin_save_manual_sale: {
        Args: {
          p_amount_iqd?: number;
          p_crew_id?: string;
          p_customer_name?: string;
          p_customer_phone?: string;
          p_id?: string;
          p_note?: string;
          p_paid_account_id?: string;
          p_place?: string;
          p_service?: string;
          p_sold_on?: string;
        };
        Returns: string;
      };
      admin_save_payment: {
        Args: {
          p_account_id?: string;
          p_amount_iqd?: number;
          p_id?: string;
          p_note?: string;
          p_order_id?: string;
          p_paid_on?: string;
          p_sale_id?: string;
          p_subscription_id?: string;
        };
        Returns: string;
      };
      admin_save_service_area: {
        Args: { p_active: boolean; p_area: Json; p_id: number; p_name: string };
        Returns: Record<string, unknown>;
      };
      admin_save_transfer: {
        Args: {
          p_amount_iqd?: number;
          p_from_account_id?: string;
          p_id?: string;
          p_moved_on?: string;
          p_note?: string;
          p_to_account_id?: string;
        };
        Returns: string;
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
      admin_set_certificate_stamp: { Args: { p_path?: string }; Returns: string };
      admin_set_crew_phone: { Args: { p_crew_id: string; p_phone: string }; Returns: undefined };
      admin_set_order_subscription: {
        Args: { p_order_id: string; p_use: boolean };
        Returns: undefined;
      };
      admin_set_subscription_paid: {
        Args: { p_paid: boolean; p_subscription_id: string };
        Returns: undefined;
      };
      admin_set_ticket_status: {
        Args: { p_status: Database["public"]["Enums"]["ticket_status"]; p_ticket_id: string };
        Returns: undefined;
      };
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
      admin_update_finance_settings: { Args: { p_start_on: string }; Returns: undefined };
      admin_update_prices: { Args: { p_prices: Json }; Returns: number };
      admin_update_settings: { Args: { p_patch: Json }; Returns: undefined };
      admin_update_slot: {
        Args: { p_active: boolean; p_capacity: number; p_slot_id: number; p_weekdays: number[] };
        Returns: undefined;
      };
      admin_void_discount: { Args: { p_id: string; p_reason: string }; Returns: undefined };
      admin_void_expense: { Args: { p_id: string; p_reason: string }; Returns: undefined };
      admin_void_manual_sale: { Args: { p_id: string; p_reason: string }; Returns: undefined };
      admin_void_payment: { Args: { p_id: string; p_reason: string }; Returns: undefined };
      admin_void_transfer: { Args: { p_id: string; p_reason: string }; Returns: undefined };
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
        Args: { p_from?: string; p_to?: string };
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
      change_login_phone: { Args: { p_phone: string; p_user_id: string }; Returns: undefined };
      chat_thread: { Args: Record<PropertyKey, never>; Returns: string };
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
          p_use_subscription?: boolean;
        };
        Returns: Record<string, unknown>;
      };
      create_ticket: {
        Args: {
          p_category: Database["public"]["Enums"]["ticket_category"];
          p_client_id: string;
          p_description: string;
          p_media?: Json;
          p_order_id?: string;
        };
        Returns: {
          ticket_id: string;
          ticket_number: number;
        }[];
      };
      crew_job_contact: {
        Args: { p_order_id: string };
        Returns: {
          full_name: string;
          phone: string;
        }[];
      };
      delete_account: { Args: Record<PropertyKey, never>; Returns: string[] };
      delete_address: { Args: { p_address_id: string }; Returns: undefined };
      delete_my_push_subscriptions: { Args: Record<PropertyKey, never>; Returns: undefined };
      delete_push_subscription: { Args: { p_endpoint: string }; Returns: undefined };
      in_service_area: { Args: { p_lat: number; p_lng: number }; Returns: boolean };
      mark_all_notifications_read: { Args: Record<PropertyKey, never>; Returns: number };
      mark_chat_read: { Args: { p_thread_id: string }; Returns: number };
      mark_notification_read: { Args: { p_notification_id: string }; Returns: undefined };
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
      request_subscription: { Args: { p_address_id: string }; Returns: string };
      save_push_subscription: {
        Args: { p_auth: string; p_endpoint: string; p_p256dh: string; p_user_agent?: string };
        Returns: undefined;
      };
      send_chat_message: {
        Args: {
          p_body?: string;
          p_client_id: string;
          p_duration_s?: number;
          p_media_path?: string;
          p_order_id?: string;
          p_thread_id?: string;
          p_topic?: Database["public"]["Enums"]["chat_topic"];
        };
        Returns: {
          author: Database["public"]["Enums"]["chat_author"];
          body: string | null;
          bytes: number | null;
          client_id: string | null;
          created_at: string;
          customer_id: string;
          duration_s: number | null;
          id: string;
          kind: Database["public"]["Enums"]["chat_message_kind"];
          media_path: string | null;
          media_type: Database["public"]["Enums"]["media_type"] | null;
          order_id: string | null;
          read_at: string | null;
          sender_id: string | null;
          thread_id: string;
          ticket_id: string | null;
          topic: Database["public"]["Enums"]["chat_topic"] | null;
        };
        SetofOptions: {
          from: "*";
          to: "chat_messages";
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
      set_login_password: { Args: { p_password: string; p_user_id: string }; Returns: undefined };
      share_crew_location: {
        Args: { p_accuracy_m: number; p_lat: number; p_lng: number; p_order_id: string };
        Returns: boolean;
      };
      support_is_open: { Args: Record<PropertyKey, never>; Returns: boolean };
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
      article_status: "draft" | "published";
      cancel_reason: "plans_changed" | "time_unsuitable" | "other";
      category_icon: "droplet" | "sun" | "lid" | "lightbulb" | "help" | "shield";
      chat_author: "customer" | "admin" | "system";
      chat_message_kind: "message" | "auto_reply" | "no_show" | "ticket";
      chat_topic: "reschedule" | "cancel" | "price" | "complaint";
      expense_category_kind: "general" | "wages" | "equipment";
      finance_account_kind: "cash" | "zain_cash" | "bank" | "crew";
      media_type: "photo" | "video";
      notification_type:
        | "order_confirmed"
        | "order_rescheduled"
        | "order_cancelled"
        | "crew_on_the_way"
        | "crew_arrived"
        | "work_started"
        | "order_completed"
        | "order_no_show"
        | "support_message"
        | "ticket_status"
        | "cleaning_reminder"
        | "new_booking"
        | "customer_rescheduled"
        | "customer_cancelled"
        | "customer_message"
        | "new_ticket"
        | "new_job"
        | "job_changed"
        | "subscription_activated"
        | "subscription_declined"
        | "subscription_expiring"
        | "subscription_requested"
        | "order_postponed"
        | "customer_postponed";
      order_media_kind: "customer" | "before" | "after" | "clip";
      order_status:
        | "pending_confirmation"
        | "confirmed"
        | "postponed"
        | "on_the_way"
        | "arrived"
        | "in_progress"
        | "completed"
        | "cancelled"
        | "no_show";
      otp_channel: "whatsapp" | "sms";
      payment_method: "cash";
      rating_tag: "on_time" | "clean_work" | "respectful" | "clear_photos";
      reminder_kind: "week" | "due";
      subscription_status: "requested" | "active" | "declined" | "cancelled";
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
      article_status: ["draft", "published"],
      cancel_reason: ["plans_changed", "time_unsuitable", "other"],
      category_icon: ["droplet", "sun", "lid", "lightbulb", "help", "shield"],
      chat_author: ["customer", "admin", "system"],
      chat_message_kind: ["message", "auto_reply", "no_show", "ticket"],
      chat_topic: ["reschedule", "cancel", "price", "complaint"],
      expense_category_kind: ["general", "wages", "equipment"],
      finance_account_kind: ["cash", "zain_cash", "bank", "crew"],
      media_type: ["photo", "video"],
      notification_type: [
        "order_confirmed",
        "order_rescheduled",
        "order_cancelled",
        "crew_on_the_way",
        "crew_arrived",
        "work_started",
        "order_completed",
        "order_no_show",
        "support_message",
        "ticket_status",
        "cleaning_reminder",
        "new_booking",
        "customer_rescheduled",
        "customer_cancelled",
        "customer_message",
        "new_ticket",
        "new_job",
        "job_changed",
        "subscription_activated",
        "subscription_declined",
        "subscription_expiring",
        "subscription_requested",
        "order_postponed",
        "customer_postponed",
      ],
      order_media_kind: ["customer", "before", "after", "clip"],
      order_status: [
        "pending_confirmation",
        "confirmed",
        "postponed",
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
      reminder_kind: ["week", "due"],
      subscription_status: ["requested", "active", "declined", "cancelled"],
      tank_size: ["s", "m", "l"],
      tank_type: ["roof", "ground"],
      ticket_category: ["leak", "smell", "late", "staff", "payment", "other"],
      ticket_source: ["app", "rating"],
      ticket_status: ["open", "in_progress", "closed"],
    },
  },
} as const;
