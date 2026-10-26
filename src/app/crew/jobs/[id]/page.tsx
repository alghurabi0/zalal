import { ExternalLink, Phone, SearchX } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { type ReactNode, Suspense } from "react";
import { z } from "zod";

import { JobMap } from "@/components/crew/job-map";
import { LiveJobs } from "@/components/crew/live-jobs";
import { Screen } from "@/components/layout/screen";
import { StatusBadge } from "@/components/orders/status-badge";
import { BackButton } from "@/components/ui/back-button";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton, SkeletonGroup } from "@/components/ui/skeleton";
import { requireViewer } from "@/lib/auth/viewer";
import { mapsLink } from "@/lib/crew/jobs";
import { getJob, getSterilantText, type JobDetails } from "@/lib/crew/queries";
import { nextStep } from "@/lib/crew/status";
import { formatDayTime, serviceDayParts, slotParts } from "@/lib/dates";
import { formatIQD } from "@/lib/money";
import { buildTimeline } from "@/lib/orders/timeline";
import { routes } from "@/lib/routes";

import { JobActions } from "./job-actions";
import { JobMedia } from "./job-media";

/**
 * Job detail (C3, spec §8.1): the pin with directions, a call to the
 * customer while the job is open, tank lines, the customer's note and
 * files, the crew's own photos and clips (C3b), the timeline with staff
 * notes, and the status button (C3a) with the finish form (C4). Live GPS
 * comes with part C.
 */
export default function JobPage(props: PageProps<"/crew/jobs/[id]">) {
  return (
    <Screen className="bg-bg">
      <Suspense fallback={<JobSkeleton />}>
        <JobContent {...props} />
      </Suspense>
    </Screen>
  );
}

async function JobContent({ params }: PageProps<"/crew/jobs/[id]">) {
  const { id } = await params;
  const viewer = await requireViewer(routes.crewJob(id), "crew");
  const t = await getTranslations("Crew");
  const jobId = z.uuid().safeParse(id);
  const [job, sterilantText] = await Promise.all([
    jobId.success ? getJob(jobId.data) : null,
    getSterilantText(),
  ]);

  if (!job) {
    return (
      <>
        <LiveJobs />
        <Header />
        <EmptyState
          icon={SearchX}
          titleAs="h1"
          title={t("job.notFound")}
          description={t("job.notFoundBody")}
          action={
            <Button href={routes.crew} size="footer" className="w-full">
              {t("job.back")}
            </Button>
          }
        />
      </>
    );
  }

  const tUI = await getTranslations("UI");
  return (
    <>
      <LiveJobs />
      <Header>
        <h1 className="flex-1 text-20 font-black">
          {t.rich("number", {
            number: job.number,
            num: (chunks) => <span dir="ltr">{chunks}</span>,
          })}
        </h1>
        <StatusBadge status={job.status} label={t(`status.${job.status}`)} className="text-13" />
      </Header>
      <div className="flex flex-1 flex-col gap-3 px-4 pb-6">
        <Place job={job} />
        <Summary job={job} />
        {job.customer_note && (
          <Section title={t("job.note")}>
            <p className="text-15 whitespace-pre-line text-body-2">{job.customer_note}</p>
          </Section>
        )}
        {job.media.length > 0 && <Files job={job} />}
        <JobMedia
          userId={viewer.id}
          orderId={job.id}
          crewId={job.crew_id}
          status={job.status}
          files={job.crewMedia}
        />
        <Timeline job={job} />
        {!nextStep(job.status) && <p className="px-1 text-14 text-muted">{t("job.closed")}</p>}
      </div>
      <JobActions
        userId={viewer.id}
        sterilantText={sterilantText}
        orderId={job.id}
        status={job.status}
        amount={tUI("iqd", { amount: formatIQD(job.total_iqd) })}
      />
    </>
  );
}

function Header({ children }: { children?: ReactNode }) {
  return (
    <div className="flex items-center gap-3 px-5 pt-5 pb-3.5">
      <BackButton href={routes.crew} />
      {children}
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Card className="flex flex-col gap-2.5 p-4">
      <h2 className="text-16 font-extrabold">{title}</h2>
      {children}
    </Card>
  );
}

/** The map, the address copy, directions and the call button. */
async function Place({ job }: { job: JobDetails }) {
  const t = await getTranslations("Crew.job");
  return (
    <Card className="flex flex-col overflow-hidden">
      <JobMap lat={job.lat} lng={job.lng} />
      <div className="flex flex-col gap-3 p-4">
        <p className="text-16 font-extrabold">
          {job.district}
          <span className="block text-14 font-normal text-body-2">{job.landmark}</span>
        </p>
        <div className="flex flex-col gap-2">
          {job.contact && (
            <Button href={`tel:${job.contact.phone}`} size="md" className="w-full gap-2">
              <Phone aria-hidden className="size-4.5 shrink-0" />
              <span className="truncate">
                {job.contact.name ? t("callNamed", { name: job.contact.name }) : t("call")}
              </span>
            </Button>
          )}
          <Button
            href={mapsLink(job.lat, job.lng)}
            target="_blank"
            rel="noreferrer"
            variant="secondary"
            size="md"
            className="w-full gap-2"
          >
            <ExternalLink aria-hidden className="size-4.5 shrink-0" />
            {t("openMaps")}
          </Button>
        </div>
      </div>
    </Card>
  );
}

async function Summary({ job }: { job: JobDetails }) {
  const t = await getTranslations("Crew");
  const tBooking = await getTranslations("Booking");
  const tTanks = await getTranslations("Tanks");
  const { weekday, day } = serviceDayParts(job.service_date);
  return (
    <Card className="flex flex-col gap-2.5 p-4">
      <dl className="flex flex-col gap-2.5">
        <div className="flex flex-col border-b border-divider pb-2.5">
          <dt className="text-13 text-muted">{t("job.when")}</dt>
          <dd className="text-15 font-bold">
            {t("job.whenValue", {
              weekday,
              day,
              slot: tBooking("slot", slotParts(job.slot_start_at, job.slot_end_at)),
            })}
          </dd>
        </div>
        <div className="flex flex-col">
          <dt className="text-13 text-muted">{t("job.tanks")}</dt>
          <dd>
            <ul className="flex flex-col text-15 font-bold">
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
          </dd>
        </div>
      </dl>
    </Card>
  );
}

async function Files({ job }: { job: JobDetails }) {
  const t = await getTranslations("Crew.job");
  let photos = 0;
  let videos = 0;
  return (
    <Section title={t("files")}>
      <ul className="grid grid-cols-3 gap-2">
        {job.media.map((file) => {
          const label =
            file.mediaType === "photo" ? t("photo", { n: ++photos }) : t("video", { n: ++videos });
          return (
            <li key={file.id} className="aspect-square overflow-hidden rounded-chip bg-well">
              {!file.url ? (
                <span className="flex size-full items-center justify-center p-1 text-center text-11 text-muted">
                  {t("fileMissing")}
                </span>
              ) : file.mediaType === "photo" ? (
                <a href={file.url} target="_blank" rel="noreferrer" className="block size-full">
                  {/* Signed links that expire in an hour: next/image would
                      cache them on the server, so a plain img. */}
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={file.url} alt={label} className="size-full object-cover" />
                </a>
              ) : (
                <video
                  src={file.url}
                  controls
                  preload="metadata"
                  aria-label={label}
                  className="size-full bg-navy object-cover"
                />
              )}
            </li>
          );
        })}
      </ul>
    </Section>
  );
}

/** Newest first, with the staff note under its event (the crew reads them). */
async function Timeline({ job }: { job: JobDetails }) {
  const t = await getTranslations("Crew");
  const entries = buildTimeline(job.events).reverse();
  return (
    <Section title={t("job.timeline")}>
      <ol className="flex flex-col gap-3">
        {entries.map((entry) => {
          const note = job.notes.get(entry.id);
          const text =
            entry.kind === "status" ? t(`events.${entry.status}`) : t(`events.${entry.kind}`);
          return (
            <li key={entry.id} className="flex flex-col border-s-2 border-track ps-3">
              <span className="text-15 font-bold">{text}</span>
              <span className="text-13 text-muted">{formatDayTime(entry.at)}</span>
              {note && (
                <p className="mt-1 rounded-chip bg-well p-2 text-14 whitespace-pre-line text-body-2">
                  <span className="sr-only">{t("job.noteLabel")}</span>
                  {note}
                </p>
              )}
            </li>
          );
        })}
      </ol>
    </Section>
  );
}

function JobSkeleton() {
  return (
    <SkeletonGroup className="flex flex-col gap-3 px-4 pt-5">
      <div className="flex items-center gap-3 px-1">
        <Skeleton className="size-11 rounded-full" />
        <Skeleton className="h-7 w-32" />
      </div>
      <Skeleton className="h-72 rounded-card" />
      <Skeleton className="h-32 rounded-card" />
    </SkeletonGroup>
  );
}
