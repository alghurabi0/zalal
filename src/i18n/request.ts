import { getRequestConfig } from "next-intl/server";

import messages from "../../messages/ar.json";

// The app has one locale and no locale prefix in URLs. Returning a fixed
// locale (and never reading `requestLocale`) keeps next-intl from calling
// headers(), so pages can still render statically.
export const locale = "ar";
export const timeZone = "Asia/Baghdad";

export default getRequestConfig(() => ({
  locale,
  timeZone,
  messages,
}));
