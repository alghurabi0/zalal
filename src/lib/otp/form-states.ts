// What the Login and OTP Server Actions answer (spec §5.2, §5.3), shared with
// the phone change (N10), which reuses both screens.

/** Why a send didn't happen, for the Login and OTP screens to word. */
export type SendError =
  | { kind: "invalid_phone" }
  | { kind: "wait"; retryAfterS: number }
  | { kind: "locked"; retryAfterS: number }
  | { kind: "sms_disabled" }
  | { kind: "whatsapp_failed"; canTrySms: boolean }
  | { kind: "send_failed" }
  /** Phone change (N10): the new number has an account, or is the current one. */
  | { kind: "phone_taken" }
  | { kind: "same_phone" };

export type SendCodeState = { error: SendError | null; smsEnabled?: boolean };

export type ResendState = {
  error: SendError | null;
  sentAt?: number;
  channel?: "whatsapp" | "sms";
};

export type VerifyState =
  | { status: "idle" }
  /** `userId` only for a login, so analytics can identify the user. */
  | { status: "ok"; destination: string; userId?: string }
  | { status: "wrong_code"; attemptsLeft: number }
  | { status: "locked"; retryAfterS: number }
  | { status: "expired" | "account_unavailable" | "invalid_code" | "phone_taken" };
