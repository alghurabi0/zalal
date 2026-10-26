import { CalendarCheck, Paperclip } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { type ReactNode, Suspense } from "react";

import { LogoutButton } from "@/components/auth/logout-button";
import { LiveJobs } from "@/components/crew/live-jobs";
import { RefreshButton } from "@/components/crew/refresh-button";
import { Screen } from "@/components/layout/screen";
import { StatusBadge } from "@/components/orders/status-badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton, SkeletonGroup } from "@/components/ui/skeleton";
import { requireViewer } from "@/lib/auth/viewer";
import { type DayGroup, groupJobs, isEmpty, type SlotGroup } from "@/lib/crew/jobs";
import { type JobCard, listJobs } from "@/lib/crew/queries";
import { baghdadToday, serviceDayParts, slotParts } from "@/lib/dates";
import { routes } from "@/lib/routes";

/**
 * My jobs (C2, spec §8.1): today and tomorrow, grouped by slot. An open job
 * from an earlier day comes first, today's finished jobs last.
 */
export default function CrewPage() {
  return (
    <Screen className="bg-bg">
      <Suspense fallback={<JobsSkeleton />}>
        <Content />
      </Suspense>
    </Screen>
  );
}

async function Content() {
  const viewer = await requireViewer(routes.crew, "crew");
  const t = await getTranslations("Crew");
  // The server's clock in Baghdad, never the device's.
  const today = baghdadToday();
  const groups = groupJobs(await listJobs(today), today);

  return (
    <>
      <LiveJobs poll />
      <Header name={viewer.fullName} />
      {isEmpty(groups) ? (
        <EmptyState
          icon={CalendarCheck}
          title={t("emptyTitle")}
          description={t("emptyBody")}
          action={<RefreshButton />}
        />
      ) : (
        <div className="flex flex-col gap-6 px-4 pb-8">
          {groups.earlier.length > 0 && (
            <Group title={t("earlier")} tone="warn">
              <CardList jobs={groups.earlier} />
            </Group>
          )}
          <Day group={groups.today} which="today" />
          <Day group={groups.tomorrow} which="tomorrow" />
          {groups.done.length > 0 && (
            <Group title={t("done")}>
              <CardList jobs={groups.done} />
            </Group>
          )}
        </div>
      )}
    </>
  );
}

async function Header({ name }: { name: string | null }) {
  const t = await getTranslations("Crew");
  const tProfile = await getTranslations("Profile");
  return (
    <header className="flex items-center gap-3 px-5 pt-5 pb-4">
      <div className="flex flex-1 flex-col">
        <h1 className="text-24 font-black">{t("title")}</h1>
        {name && <p className="text-14 text-muted">{t("hello", { name })}</p>}
      </div>
      <LogoutButton>
        <Button variant="secondary" size="sm">
          {tProfile("logout")}
        </Button>
      </LogoutButton>
    </header>
  );
}

function Group({ title, tone, children }: { title: string; tone?: "warn"; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-2.5">
      <h2
        className={
          tone === "warn" ? "text-16 font-extrabold text-warn-fg" : "text-16 font-extrabold"
        }
      >
        {title}
      </h2>
      {children}
    </section>
  );
}

async function Day({ group, which }: { group: DayGroup<JobCard>; which: "today" | "tomorrow" }) {
  const t = await getTranslations("Crew");
  const { weekday, day } = serviceDayParts(group.date);
  return (
    <Group title={t(which, { weekday, day })}>
      {group.slots.length === 0 ? (
        <p className="rounded-card border border-dashed border-border px-4 py-3 text-14 text-muted">
          {t("noJobs")}
        </p>
      ) : (
        group.slots.map((slot) => <Slot key={slot.slotStartAt} slot={slot} />)
      )}
    </Group>
  );
}

async function Slot({ slot }: { slot: SlotGroup<JobCard> }) {
  const tBooking = await getTranslations("Booking");
  return (
    <div className="flex flex-col gap-2">
      <h3 className="text-14 font-bold text-muted">
        {tBooking("slot", slotParts(slot.slotStartAt, slot.slotEndAt))}
      </h3>
      <CardList jobs={slot.jobs} />
    </div>
  );
}

function CardList({ jobs }: { jobs: JobCard[] }) {
  return (
    <ul className="flex flex-col gap-2.5">
      {jobs.map((job) => (
        <li key={job.id}>
          <JobCardView job={job} />
        </li>
      ))}
    </ul>
  );
}

async function JobCardView({ job }: { job: JobCard }) {
  const t = await getTranslations("Crew");
  const tBooking = await getTranslations("Booking");
  const tTanks = await getTranslations("Tanks");
  const { weekday, day } = serviceDayParts(job.service_date);

  return (
    <Card href={routes.crewJob(job.id)} className="flex flex-col gap-2 p-4">
      <div className="flex items-center gap-2">
        <span className="flex-1 text-17 font-black">
          {t.rich("number", {
            number: job.number,
            num: (chunks) => <span dir="ltr">{chunks}</span>,
          })}
        </span>
        <StatusBadge status={job.status} label={t(`status.${job.status}`)} />
      </div>
      <p className="text-13 text-muted">
        {t("job.whenValue", {
          weekday,
          day,
          slot: tBooking("slot", slotParts(job.slot_start_at, job.slot_end_at)),
        })}
      </p>
      <p className="text-15 font-bold">
        {job.district}
        <span className="block text-14 font-normal text-body-2">{job.landmark}</span>
      </p>
      <ul className="flex flex-col text-14">
        {job.lines.map((line, index) => (
          <li key={index}>
            {t("line", {
              type: tTanks(`types.${line.tank_type}`),
              size: tTanks(`sizes.${line.size}`),
              qty: line.qty,
            })}
          </li>
        ))}
      </ul>
      {job.customer_note && (
        <p className="line-clamp-2 rounded-chip bg-well px-3 py-2 text-13 text-body-2">
          {job.customer_note}
        </p>
      )}
      {job.mediaCount > 0 && (
        <p className="flex items-center gap-1.5 text-13 text-muted">
          <Paperclip aria-hidden className="size-4" />
          {t("files", { count: job.mediaCount })}
        </p>
      )}
    </Card>
  );
}

function JobsSkeleton() {
  return (
    <SkeletonGroup className="flex flex-col gap-3 px-4 pt-5">
      <div className="flex items-center justify-between px-1">
        <Skeleton className="h-8 w-28" />
        <Skeleton className="h-11 w-24 rounded-button" />
      </div>
      <Skeleton className="mt-3 h-5 w-40" />
      <Skeleton className="h-40 rounded-card" />
      <Skeleton className="h-40 rounded-card" />
    </SkeletonGroup>
  );
}
