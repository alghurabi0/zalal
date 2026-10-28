// Names of the app's own cookies (Supabase sets its own session cookies).

/** Set once Welcome has been shown, so `/` opens Home from then on (spec §5.1). */
export const WELCOMED_COOKIE = "zl_welcomed";

/**
 * The login in progress between Login and OTP: the phone, the channel used
 * and when the code went out. httpOnly, so the number never sits in a URL
 * (and so never in analytics or logs). Read by src/lib/auth/pending-login.ts.
 */
export const PENDING_LOGIN_COOKIE = "zl_login";

/** The address Home shows, chosen in the picker (N2). Falls back to the default. */
export const HOME_ADDRESS_COOKIE = "zl_address";

/**
 * The phone change in progress (N10): which step, the number the latest code
 * went to, and when. Signed, because it records that the current number was
 * proved. Read by src/lib/auth/phone-change.ts.
 */
export const PHONE_CHANGE_COOKIE = "zl_phone";
