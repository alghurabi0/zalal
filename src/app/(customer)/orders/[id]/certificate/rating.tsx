"use client";

import { Star } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { Chip, ChipGroup } from "@/components/ui/chip";
import { Field } from "@/components/ui/field";
import { Textarea } from "@/components/ui/input";
import { cn } from "@/lib/cn";
import { RATING_TAGS, type RatingTag, ticketNumber } from "@/lib/certificates/format";
import type { CertificateRating } from "@/lib/certificates/queries";
import { routes } from "@/lib/routes";
import { RATING_COMMENT_MAX } from "@/lib/schemas/rating";

import { rateOrder, type RateOrderError } from "./actions";
import { ShareButton } from "./share-button";

const STARS = [1, 2, 3, 4, 5] as const;

/**
 * Report's rating card and footer (spec §5.15): stars, the company tags and
 * an optional comment (spec change: not in the canvas); skippable, and
 * read-only once sent. 3 stars or fewer opens a ticket (rate_order), whose
 * number shows here. مشاركة shares the public link (N15). "بلّغنا" opens the
 * Issue report about this order.
 */
export function Rating({
  orderId,
  rating,
  shareCode,
  certificate,
}: {
  orderId: string;
  rating: CertificateRating | null;
  shareCode: string;
  /** ZL-1024, for the share text. */
  certificate: string;
}) {
  const t = useTranslations("Report.rating");
  const tReport = useTranslations("Report");
  const router = useRouter();
  const [stars, setStars] = useState(rating?.stars ?? 0);
  const [tags, setTags] = useState<RatingTag[]>(rating?.tags ?? []);
  const [comment, setComment] = useState(rating?.comment ?? "");
  const [error, setError] = useState<RateOrderError | null>(null);
  const [pending, startTransition] = useTransition();
  const sent = rating !== null;

  const send = () => {
    if (stars === 0 || sent) return;
    setError(null);
    startTransition(async () => {
      const result = await rateOrder({ orderId, stars, tags, comment });
      if (result.status === "error") {
        setError(result.error);
        if (result.error === "already_rated") router.refresh();
        return;
      }
      router.refresh();
    });
  };

  return (
    <>
      <div className="flex flex-1 flex-col px-4 pt-3 pb-4">
        <form
          id="rating"
          onSubmit={(event) => {
            event.preventDefault();
            send();
          }}
          className="flex flex-col items-center gap-2 rounded-button border border-border bg-surface px-3.5 py-3"
        >
          <h2 className="text-15 font-extrabold">{t("title")}</h2>
          <fieldset disabled={sent || pending} className="flex flex-col items-center">
            <legend className="sr-only">{t("stars")}</legend>
            {/* Stars run 1 → 5 left to right, as in the canvas. */}
            <div dir="ltr" className="flex gap-0.5">
              {STARS.map((n) => (
                <label
                  key={n}
                  className="relative flex size-11 cursor-pointer items-center justify-center rounded-full has-focus-visible:outline-2 has-focus-visible:outline-teal has-disabled:cursor-default"
                >
                  <input
                    type="radio"
                    name="stars"
                    value={n}
                    checked={stars === n}
                    onChange={() => setStars(n)}
                    aria-label={t("star", { n })}
                    className="sr-only"
                  />
                  <Star
                    aria-hidden
                    strokeWidth={1.6}
                    className={cn(
                      "size-7.5 stroke-star",
                      n <= stars ? "fill-warn" : "fill-transparent",
                    )}
                  />
                </label>
              ))}
            </div>
          </fieldset>
          {sent ? (
            // Read-only: only the tags that were picked, as picked chips.
            tags.length > 0 && (
              <ul aria-label={t("tagsLegend")} className="flex flex-wrap justify-center gap-1.5">
                {RATING_TAGS.filter((tag) => tags.includes(tag)).map((tag) => (
                  <li
                    key={tag}
                    className="flex h-9 items-center rounded-full bg-navy px-3 text-13 font-bold text-white"
                  >
                    {t(`tags.${tag}`)}
                  </li>
                ))}
              </ul>
            )
          ) : (
            <ChipGroup
              legend={t("tagsLegend")}
              legendClassName="sr-only"
              bodyClassName="justify-center gap-1.5"
              className="w-full"
            >
              {RATING_TAGS.map((tag) => (
                <Chip
                  key={tag}
                  type="checkbox"
                  variant="tag"
                  name="tags"
                  value={tag}
                  checked={tags.includes(tag)}
                  disabled={pending}
                  onChange={(event) =>
                    setTags((current) =>
                      event.target.checked ? [...current, tag] : current.filter((t) => t !== tag),
                    )
                  }
                >
                  {t(`tags.${tag}`)}
                </Chip>
              ))}
            </ChipGroup>
          )}
          {sent ? (
            comment && <p className="w-full text-14 text-body-2">{comment}</p>
          ) : (
            <Field label={t("comment")} variant="compact" className="w-full">
              {(control) => (
                <Textarea
                  {...control}
                  name="comment"
                  rows={2}
                  maxLength={RATING_COMMENT_MAX}
                  placeholder={t("commentPlaceholder")}
                  value={comment}
                  disabled={pending}
                  onChange={(event) => setComment(event.target.value)}
                />
              )}
            </Field>
          )}
          {sent && (
            <p role="status" className="text-center text-14 font-bold text-ok-fg">
              {t("thanks")}
              {rating.ticketNumber !== null && (
                <span className="block text-13 font-normal text-body-2">
                  {t.rich("ticket", {
                    ticket: ticketNumber(rating.ticketNumber),
                    num: (chunks) => <span dir="ltr">{chunks}</span>,
                  })}
                </span>
              )}
            </p>
          )}
          {error && (
            <p role="alert" className="text-center text-13 font-bold text-danger">
              {t(`errors.${error}`)}
            </p>
          )}
        </form>
        <Link
          href={routes.issueAbout(orderId)}
          className="mt-1 flex min-h-11 items-center justify-center text-14 font-bold text-teal hover:text-navy"
        >
          {tReport("issue")}
        </Link>
      </div>

      <footer className="sticky bottom-0 z-10 flex gap-2.5 border-t border-border bg-surface px-5 pt-3 pb-safe-5.5">
        {!sent && (
          <Button
            type="submit"
            form="rating"
            size="md"
            className="flex-1"
            disabled={stars === 0}
            loading={pending}
            aria-describedby={stars === 0 ? "rating-hint" : undefined}
          >
            {t("send")}
          </Button>
        )}
        <ShareButton
          code={shareCode}
          certificate={certificate}
          className={sent ? "flex-1" : undefined}
          primary={sent}
        />
        {stars === 0 && !sent && (
          <span id="rating-hint" className="sr-only">
            {t("pickStars")}
          </span>
        )}
      </footer>
    </>
  );
}
