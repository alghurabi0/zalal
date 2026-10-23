import { Cairo } from "next/font/google";

// Cairo is a variable font, so one file covers weights 400–900. Shared by the
// root layout and global-error.tsx, which replaces it after a crash.
export const cairo = Cairo({
  subsets: ["arabic", "latin"],
  variable: "--font-cairo",
  display: "swap",
});
