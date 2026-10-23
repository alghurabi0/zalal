import { useTranslations } from "next-intl";

// Placeholder until the Welcome screen (Main.dc.html) is built on the UI kit.
export default function Page() {
  const t = useTranslations("Welcome");

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-phone flex-col items-center justify-center gap-5.5 bg-navy px-8 text-center text-white">
      <div className="flex flex-col items-center gap-0.5">
        <h1 className="text-44 leading-display font-black">{t("name")}</h1>
        <span lang="en" className="text-14 font-bold tracking-wordmark text-aqua">
          {t("wordmark")}
        </span>
      </div>
      <p className="text-17 text-on-dark-body">{t("tagline")}</p>
    </main>
  );
}
