import { getRequestConfig } from "next-intl/server";

import messages from "../../messages/ar.json";

import { locale, timeZone } from "./config";

export { locale, timeZone };

// Returning a fixed locale (and never reading `requestLocale`) keeps
// next-intl from calling headers(), so pages can still render statically.
export default getRequestConfig(() => ({
  locale,
  timeZone,
  messages,
}));
