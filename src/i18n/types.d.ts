import type messages from "../../messages/ar.json";

// Type-checks message keys in useTranslations / getTranslations.
declare module "next-intl" {
  interface AppConfig {
    Locale: "ar";
    Messages: typeof messages;
  }
}
