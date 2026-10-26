"use client";

import { Download, MapPinned, Plus, Upload } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useId, useState, useTransition } from "react";

import { AreaPreview } from "@/components/admin/area-preview";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Field } from "@/components/ui/field";
import { Input, Textarea } from "@/components/ui/input";
import type { AdminServiceArea } from "@/lib/admin/catalog-queries";
import type { AdminEditError } from "@/lib/admin/edit-errors";
import {
  type AreaParseError,
  exportFileName,
  MAX_AREA_POINTS,
  type MultiPolygonCoords,
  parseAreaGeoJson,
  pointCount,
  toFeatureCollection,
} from "@/lib/admin/geojson";
import { cn } from "@/lib/cn";
import { publicEnv } from "@/lib/env";
import { AREA_NAME_MAX } from "@/lib/schemas/admin-catalog";

import { saveServiceArea } from "./actions";
import { AreaMap } from "./area-map";

/** Saves a GeoJSON file in the browser. */
function download(name: string, contents: string) {
  const url = URL.createObjectURL(new Blob([contents], { type: "application/geo+json" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  // Some browsers start the download after click() returns.
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

type Draft = { id: number | null; name: string; active: boolean; area: MultiPolygonCoords };

/** A13's service areas: the list, and the editor for one area at a time. */
export function AreaEditor({
  areas,
  addressesOutside,
}: {
  areas: AdminServiceArea[];
  addressesOutside: number;
}) {
  const t = useTranslations("Admin.area");
  const [draft, setDraft] = useState<Draft | null>(null);
  // Bumped when the draft is replaced (another area, an import), so the map redraws.
  const [version, setVersion] = useState(0);

  const open = (next: Draft) => {
    setDraft(next);
    setVersion((v) => v + 1);
  };

  const parts = (area: MultiPolygonCoords) =>
    t("parts", { count: area.length, points: pointCount(area) });

  return (
    <div className="flex flex-col gap-4">
      {addressesOutside > 0 && (
        <p
          role="status"
          className="rounded-chip bg-warn-bg px-4 py-3 text-14 font-bold text-warn-fg"
        >
          {t("outside", { count: addressesOutside })}
        </p>
      )}

      <div className="grid items-start gap-4 lg:grid-cols-2">
        <section aria-label={t("listCaption")} className="flex flex-col gap-3">
          {areas.length === 0 ? (
            <Card className="py-6">
              <EmptyState icon={MapPinned} title={t("empty")} description={t("emptyBody")} />
            </Card>
          ) : (
            <ul className="flex flex-col gap-3">
              {areas.map((area) => (
                <li key={area.id}>
                  <Card
                    className={cn(
                      "flex flex-col gap-3 p-4",
                      draft?.id === area.id && "border-2 border-navy",
                    )}
                    data-testid={`area-${area.id}`}
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="text-16 font-extrabold">{area.name}</h2>
                      <span
                        className={cn(
                          "rounded-10 px-2 py-0.5 text-12 font-extrabold",
                          area.active ? "bg-ok-bg text-ok-fg" : "bg-well text-muted",
                        )}
                      >
                        {area.active ? t("active") : t("inactive")}
                      </span>
                      <span className="text-13 text-muted">{parts(area.area)}</span>
                    </div>
                    <AreaPreview
                      area={area.area}
                      label={t("previewLabel", { name: area.name })}
                      className="max-h-40"
                    />
                    <div className="flex flex-wrap gap-2">
                      <Button
                        size="sm"
                        variant="secondary"
                        aria-label={t("editorEdit", { name: area.name })}
                        onClick={() => open({ ...area })}
                      >
                        {t("edit")}
                      </Button>
                      <Button
                        size="sm"
                        variant="secondary"
                        aria-label={t("exportArea", { name: area.name })}
                        onClick={() =>
                          download(
                            exportFileName(area.id),
                            toFeatureCollection(area.name, area.area),
                          )
                        }
                      >
                        <Download aria-hidden className="size-4" />
                        {t("export")}
                      </Button>
                    </div>
                  </Card>
                </li>
              ))}
            </ul>
          )}
          <Button
            size="sm"
            variant="secondary"
            className="self-start"
            onClick={() => open({ id: null, name: "", active: true, area: [] })}
          >
            <Plus aria-hidden className="size-4" />
            {t("add")}
          </Button>
        </section>

        {draft && (
          <DraftEditor
            key={`${draft.id ?? "new"}-${version}`}
            draft={draft}
            version={version}
            context={areas.filter((a) => a.active && a.id !== draft.id).map((a) => a.area)}
            onImport={(next) => open({ ...draft, ...next })}
            onClose={() => setDraft(null)}
          />
        )}
      </div>
    </div>
  );
}

function DraftEditor({
  draft,
  version,
  context,
  onImport,
  onClose,
}: {
  draft: Draft;
  version: number;
  context: MultiPolygonCoords[];
  /** A new shape from a file or pasted text; the editor opens again with it. */
  onImport: (next: Omit<Draft, "id">) => void;
  onClose: () => void;
}) {
  const t = useTranslations("Admin.area");
  const tErrors = useTranslations("Admin.editErrors");
  const router = useRouter();
  const apiKey = publicEnv().NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;
  const headingId = useId();
  const fileId = useId();
  const [name, setName] = useState(draft.name);
  const [active, setActive] = useState(draft.active);
  const [area, setArea] = useState(draft.area);
  const [pasting, setPasting] = useState(false);
  const [pasted, setPasted] = useState("");
  const [importError, setImportError] = useState<AreaParseError | null>(null);
  const [error, setError] = useState<AdminEditError | null>(null);
  const [pending, startTransition] = useTransition();
  const nameOk = name.trim().length >= 2;
  const title = draft.id === null ? t("editorAdd") : t("editorEdit", { name: draft.name });

  const load = (text: string) => {
    const result = parseAreaGeoJson(text);
    if (!result.ok) {
      setImportError(result.error);
      return;
    }
    setImportError(null);
    // Keeps what was typed; the editor opens again with the new shape.
    onImport({ name, active, area: result.area });
  };

  const save = () => {
    setError(null);
    if (!nameOk || area.length === 0) return;
    startTransition(async () => {
      const result = await saveServiceArea({ id: draft.id, name, active, area });
      if (result.status === "done") {
        onClose();
      } else {
        setError(result.error);
      }
      router.refresh();
    });
  };

  return (
    <Card className="flex flex-col gap-4 p-4 lg:sticky lg:top-4">
      <h2 id={headingId} className="text-18 font-extrabold">
        {title}
      </h2>
      <form
        aria-labelledby={headingId}
        className="flex flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          save();
        }}
      >
        <Field
          label={t("name")}
          variant="compact"
          error={name !== "" && !nameOk ? t("nameShort") : undefined}
        >
          {(control) => (
            <Input
              {...control}
              variant="compact"
              maxLength={AREA_NAME_MAX}
              required
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          )}
        </Field>
        <label className="flex min-h-11 items-center gap-2.5 text-14 font-bold">
          <input
            type="checkbox"
            className="size-5 accent-navy"
            checked={active}
            onChange={(event) => setActive(event.target.checked)}
          />
          {t("activeLabel")}
        </label>

        <fieldset className="flex flex-col gap-3">
          <legend className="mb-2 text-14 font-bold">{t("shape")}</legend>
          {apiKey ? (
            <AreaMap apiKey={apiKey} area={area} version={version} onChange={setArea} />
          ) : area.length > 0 ? (
            <AreaPreview
              area={area}
              context={context}
              label={t("previewLabel", { name: name || title })}
            />
          ) : (
            <p className="rounded-chip bg-map-bg px-4 py-8 text-center text-14 text-muted">
              {t("noShape")}
            </p>
          )}
          {area.length > 0 && (
            <p className="text-13 text-muted">
              {t("parts", { count: area.length, points: pointCount(area) })}
            </p>
          )}

          <div className="flex flex-wrap gap-2">
            <label
              htmlFor={fileId}
              className="inline-flex h-11 cursor-pointer items-center gap-2 rounded-chip border border-border bg-surface px-3.5 text-14 font-bold has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-teal"
            >
              <Upload aria-hidden className="size-4" />
              {t("importFile")}
              <input
                id={fileId}
                type="file"
                accept=".geojson,.json,application/geo+json,application/json"
                className="sr-only"
                onChange={async (event) => {
                  const file = event.target.files?.[0];
                  event.target.value = "";
                  if (file) load(await file.text());
                }}
              />
            </label>
            <Button
              size="sm"
              variant="secondary"
              aria-expanded={pasting}
              onClick={() => setPasting(!pasting)}
            >
              {t("paste")}
            </Button>
            {area.length > 0 && (
              <Button
                size="sm"
                variant="secondary"
                onClick={() =>
                  download(exportFileName(draft.id), toFeatureCollection(name.trim(), area))
                }
              >
                <Download aria-hidden className="size-4" />
                {t("export")}
              </Button>
            )}
          </div>
          {pasting && (
            <div className="flex flex-col gap-2">
              <Field label={t("pasteLabel")} variant="compact">
                {(control) => (
                  <Textarea
                    {...control}
                    rows={6}
                    dir="ltr"
                    className="font-mono text-12"
                    value={pasted}
                    onChange={(event) => setPasted(event.target.value)}
                  />
                )}
              </Field>
              <Button
                size="sm"
                variant="secondary"
                className="self-start"
                disabled={pasted.trim() === ""}
                onClick={() => load(pasted)}
              >
                {t("usePasted")}
              </Button>
            </div>
          )}
          <p className="text-13 text-muted">{t("importHint")}</p>
          <p role="status" className="text-13 font-bold text-danger">
            {importError &&
              t(`importErrors.${importError}`, { max: MAX_AREA_POINTS.toLocaleString("en-US") })}
          </p>
        </fieldset>

        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="submit"
            size="card"
            loading={pending}
            disabled={!nameOk || area.length === 0}
          >
            {t("save")}
          </Button>
          <Button size="card" variant="secondary" onClick={onClose}>
            {t("cancel")}
          </Button>
          <p role="status" className="text-13 font-bold text-danger">
            {area.length === 0 ? t("needShape") : error && tErrors(error)}
          </p>
        </div>
      </form>
    </Card>
  );
}
