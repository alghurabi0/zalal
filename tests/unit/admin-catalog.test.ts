import { describe, expect, it } from "vitest";

import { addMonthsTo, monthRange, monthWeeks } from "@/lib/admin/calendar";
import { adminEditErrorFor } from "@/lib/admin/edit-errors";
import {
  areaFromDatabase,
  areaPath,
  boundsOf,
  MAX_AREA_POINTS,
  parseAreaGeoJson,
  pointCount,
  projector,
  toFeatureCollection,
  type PolygonCoords,
} from "@/lib/admin/geojson";
import { timeSlotParts } from "@/lib/dates";
import { normalizeIraqiPhone } from "@/lib/phone";
import {
  blockDateSchema,
  createSlotSchema,
  parsePrice,
  pricesSchema,
  serviceAreaSchema,
  settingsSectionSchema,
  updateSlotSchema,
} from "@/lib/schemas/admin-catalog";

const square: PolygonCoords = [
  [
    [44.0, 32.5],
    [44.1, 32.5],
    [44.1, 32.6],
    [44.0, 32.6],
    [44.0, 32.5],
  ],
];

describe("parseAreaGeoJson", () => {
  it("reads a Polygon as one part", () => {
    const result = parseAreaGeoJson(JSON.stringify({ type: "Polygon", coordinates: square }));
    expect(result).toEqual({ ok: true, area: [square] });
  });

  it("reads a MultiPolygon, a Feature and a FeatureCollection", () => {
    const multi = { type: "MultiPolygon", coordinates: [square, square] };
    expect(parseAreaGeoJson(JSON.stringify(multi))).toEqual({ ok: true, area: [square, square] });
    const feature = { type: "Feature", properties: {}, geometry: multi };
    expect(parseAreaGeoJson(JSON.stringify(feature))).toEqual({
      ok: true,
      area: [square, square],
    });
    const collection = {
      type: "FeatureCollection",
      features: [feature, { type: "Feature", geometry: { type: "Polygon", coordinates: square } }],
    };
    const parsed = parseAreaGeoJson(JSON.stringify(collection));
    expect(parsed.ok && parsed.area.length).toBe(3);
  });

  it("closes an open ring and drops altitudes", () => {
    const open = [
      [
        [44.0, 32.5, 30],
        [44.1, 32.5, 30],
        [44.1, 32.6, 30],
      ],
    ];
    const result = parseAreaGeoJson(JSON.stringify({ type: "Polygon", coordinates: open }));
    expect(result).toEqual({
      ok: true,
      area: [
        [
          [
            [44.0, 32.5],
            [44.1, 32.5],
            [44.1, 32.6],
            [44.0, 32.5],
          ],
        ],
      ],
    });
  });

  it("refuses what isn't an area", () => {
    expect(parseAreaGeoJson("{")).toEqual({ ok: false, error: "json" });
    expect(parseAreaGeoJson('{"type":"Point","coordinates":[44,32]}')).toEqual({
      ok: false,
      error: "type",
    });
    expect(parseAreaGeoJson('{"type":"Polygon","coordinates":[[[44,32],[45,32]]]}')).toEqual({
      ok: false,
      error: "type",
    });
    expect(
      parseAreaGeoJson('{"type":"Polygon","coordinates":[[["a",32],[45,32],[45,33]]]}'),
    ).toEqual({ ok: false, error: "type" });
    expect(parseAreaGeoJson('{"type":"FeatureCollection","features":[]}')).toEqual({
      ok: false,
      error: "empty",
    });
    const ring = Array.from({ length: MAX_AREA_POINTS + 1 }, (_, i) => [
      44 + Math.cos(i) * 0.1,
      32.6 + Math.sin(i) * 0.1,
    ]);
    expect(parseAreaGeoJson(JSON.stringify({ type: "Polygon", coordinates: [ring] }))).toEqual({
      ok: false,
      error: "too_many_points",
    });
  });

  it("round-trips through the export", () => {
    const text = toFeatureCollection("كربلاء", [square]);
    expect(JSON.parse(text).features[0].properties.name).toBe("كربلاء");
    expect(parseAreaGeoJson(text)).toEqual({ ok: true, area: [square] });
  });

  it("reads the database's MultiPolygon and tolerates junk", () => {
    expect(areaFromDatabase({ type: "MultiPolygon", coordinates: [square] })).toEqual([square]);
    expect(areaFromDatabase(null)).toEqual([]);
    expect(pointCount([square, square])).toBe(10);
  });
});

describe("the area preview projection", () => {
  it("keeps north up and east right, inside the padding", () => {
    const bounds = boundsOf([[square]]);
    expect(bounds).toEqual({ minLng: 44.0, minLat: 32.5, maxLng: 44.1, maxLat: 32.6 });
    const project = projector(bounds!, 400, 260, 16);
    const [westX, northY] = project([44.0, 32.6]);
    const [eastX, southY] = project([44.1, 32.5]);
    expect(eastX).toBeGreaterThan(westX);
    expect(southY).toBeGreaterThan(northY);
    for (const v of [westX, eastX]) expect(v).toBeGreaterThanOrEqual(16 - 1e-6);
    expect(northY).toBeCloseTo(16);
    expect(southY).toBeCloseTo(244);
    // A degree of longitude is narrower than a degree of latitude here.
    expect(eastX - westX).toBeLessThan(southY - northY);
    expect(areaPath([square], project)).toMatch(/^M[\d.]+ [\d.]+ (L[\d.]+ [\d.]+ ){4}Z$/);
  });

  it("has no bounds for no shape", () => {
    expect(boundsOf([[]])).toBeNull();
  });
});

describe("the blocked-dates calendar", () => {
  it("lays a month out in weeks from Saturday", () => {
    // 1 October 2026 is a Thursday: five blanks (Sat-Wed) before it.
    const weeks = monthWeeks("2026-10");
    expect(weeks[0]).toEqual([null, null, null, null, null, "2026-10-01", "2026-10-02"]);
    expect(weeks.flat().filter(Boolean)).toHaveLength(31);
    expect(weeks.every((week) => week.length === 7)).toBe(true);
    expect(weeks.at(-1)?.includes("2026-10-31")).toBe(true);
  });

  it("moves between months and finds their ends", () => {
    expect(addMonthsTo("2026-12", 1)).toBe("2027-01");
    expect(addMonthsTo("2026-01", -1)).toBe("2025-12");
    expect(monthRange("2028-02")).toEqual({ from: "2028-02-01", to: "2028-02-29" });
    expect(monthRange("2026-11")).toEqual({ from: "2026-11-01", to: "2026-11-30" });
  });
});

describe("admin form schemas", () => {
  const cells = (["roof", "ground"] as const).flatMap((type) =>
    (["s", "m", "l"] as const).map((size) => ({ type, size, price: 25000 })),
  );

  it("reads typed prices", () => {
    expect(parsePrice("35,000")).toBe(35000);
    expect(parsePrice(" ٣٥٠٠٠ ")).toBe(35000);
    expect(parsePrice("35٬000")).toBe(35000);
    expect(parsePrice("0")).toBeNull();
    expect(parsePrice("1.5")).toBeNull();
    expect(parsePrice("10000001")).toBeNull();
    expect(parsePrice("")).toBeNull();
  });

  it("takes the six price cells, each once", () => {
    expect(pricesSchema.safeParse(cells).success).toBe(true);
    expect(pricesSchema.safeParse(cells.slice(1)).success).toBe(false);
    expect(pricesSchema.safeParse([...cells.slice(1), cells[1]]).success).toBe(false);
    expect(pricesSchema.safeParse([{ ...cells[0], price: 0 }, ...cells.slice(1)]).success).toBe(
      false,
    );
  });

  it("checks slots", () => {
    expect(
      createSlotSchema.parse({ start: "08:00", end: "10:00:00", capacity: 2, weekdays: [6, 0, 0] }),
    ).toEqual({ start: "08:00", end: "10:00", capacity: 2, weekdays: [0, 6] });
    const bad = (patch: object) =>
      createSlotSchema.safeParse({
        start: "08:00",
        end: "10:00",
        capacity: 2,
        weekdays: [0],
        ...patch,
      }).success;
    expect(bad({ end: "08:00" })).toBe(false);
    expect(bad({ capacity: 21 })).toBe(false);
    expect(bad({ weekdays: [] })).toBe(false);
    expect(bad({ weekdays: [7] })).toBe(false);
    expect(bad({ start: "8:00" })).toBe(false);
    expect(
      updateSlotSchema.safeParse({ id: 1, capacity: 1, weekdays: [1], active: false }).success,
    ).toBe(true);
  });

  it("checks blocked days and their reason", () => {
    expect(blockDateSchema.parse({ date: "2026-11-01", reason: "  " })).toEqual({
      date: "2026-11-01",
      reason: null,
    });
    expect(blockDateSchema.parse({ date: "2026-11-01", reason: " عاشوراء " }).reason).toBe(
      "عاشوراء",
    );
    expect(blockDateSchema.safeParse({ date: "2026-11-01", reason: "x" }).success).toBe(false);
    expect(blockDateSchema.safeParse({ date: "1/11/2026", reason: "" }).success).toBe(false);
  });

  it("checks each settings section", () => {
    expect(
      settingsSectionSchema.parse({
        section: "support",
        values: {
          company_phone: "0780 123 4567",
          working_hours_start: "09:00",
          working_hours_end: "21:00",
          working_days: [6, 0, 1],
        },
      }),
    ).toEqual({
      section: "support",
      values: {
        company_phone: "+9647801234567",
        working_hours_start: "09:00",
        working_hours_end: "21:00",
        working_days: [0, 1, 6],
      },
    });
    const support = (patch: object) =>
      settingsSectionSchema.safeParse({
        section: "support",
        values: {
          company_phone: "",
          working_hours_start: "09:00",
          working_hours_end: "21:00",
          working_days: [],
          ...patch,
        },
      });
    expect(support({}).data?.values).toMatchObject({ company_phone: null });
    expect(support({ company_phone: "12" }).success).toBe(false);
    expect(support({ working_hours_end: "08:00" }).success).toBe(false);
    expect(
      settingsSectionSchema.safeParse({
        section: "booking",
        values: {
          booking_window_days: 61,
          cancel_cutoff_hours: 2,
          max_tanks_per_order: 6,
          cleaning_interval_months: 6,
        },
      }).success,
    ).toBe(false);
    expect(
      settingsSectionSchema.parse({ section: "crew", values: { sterilant_text: " كلور " } }).values,
    ).toEqual({ sterilant_text: "كلور" });
    expect(
      settingsSectionSchema.safeParse({
        section: "crew",
        values: { sterilant_text: "x".repeat(101) },
      }).success,
    ).toBe(false);
    // Only the section's own keys get through.
    expect(
      settingsSectionSchema.parse({
        section: "login",
        values: { sms_enabled: false, maintenance_mode: true },
      }).values,
    ).toEqual({ sms_enabled: false });
  });

  it("checks a service area", () => {
    const area = { id: null, name: " كربلاء ", active: true, area: [square] };
    expect(serviceAreaSchema.parse(area).name).toBe("كربلاء");
    expect(serviceAreaSchema.safeParse({ ...area, area: [] }).success).toBe(false);
    expect(serviceAreaSchema.safeParse({ ...area, name: "x" }).success).toBe(false);
  });
});

describe("normalizeIraqiPhone", () => {
  it("takes mobiles and landlines", () => {
    expect(normalizeIraqiPhone("07801234567")).toBe("+9647801234567");
    expect(normalizeIraqiPhone("+964 32 123 4567")).toBe("+964321234567");
    expect(normalizeIraqiPhone("032 123 4567")).toBe("+964321234567");
    expect(normalizeIraqiPhone("12")).toBeNull();
    expect(normalizeIraqiPhone("0771234567")).toBeNull();
    expect(normalizeIraqiPhone("+1 202 555 0100")).toBeNull();
  });
});

describe("admin edit errors", () => {
  it("maps database codes", () => {
    expect(adminEditErrorFor({ code: "ZL015" })).toBe("slot_exists");
    expect(adminEditErrorFor({ code: "ZL016" })).toBe("invalid_area");
    expect(adminEditErrorFor({ code: "ZL017" })).toBe("last_active_area");
    expect(adminEditErrorFor({ code: "22023", message: "date_in_past" })).toBe("date_in_past");
    expect(adminEditErrorFor({ code: "22023", message: "unknown_setting" })).toBe("invalid");
    expect(adminEditErrorFor({ code: "23514" })).toBe("invalid");
    expect(adminEditErrorFor({ code: "P0002" })).toBe("not_found");
    expect(adminEditErrorFor({ code: "42501" })).toBe("failed");
    expect(adminEditErrorFor(null)).toBe("failed");
  });
});

describe("timeSlotParts", () => {
  it("reads a slot's times of day", () => {
    expect(timeSlotParts("08:00:00", "10:00:00")).toEqual({
      from: "8",
      to: "10",
      period: "morning",
    });
    expect(timeSlotParts("16:30:00", "18:00:00")).toEqual({
      from: "4:30",
      to: "6",
      period: "afternoon",
    });
  });
});
