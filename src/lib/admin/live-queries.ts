import "server-only";

import type { CrewPosition } from "@/lib/live/queries";
import { createClient } from "@/lib/supabase/server";

import { areaFromDatabase, type MultiPolygonCoords } from "./geojson";

// The live map (A3, spec §8.2), read as an admin: every order on the way,
// its crew and the crew's latest position, and the active service areas
// for the drawn map.

export type LiveJob = {
  orderId: string;
  number: number;
  district: string;
  landmark: string;
  home: { lat: number; lng: number };
  crewId: string;
  crewName: string;
  /** From the crew now assigned; null until its phone sends one. */
  position: CrewPosition | null;
};

export type LiveMapData = {
  jobs: LiveJob[];
  areas: MultiPolygonCoords[];
  /** The server's clock when this was read (ms), for the positions' age. */
  readAt: number;
};

type JobRow = {
  id: string;
  number: number;
  district: string;
  landmark: string;
  lat: number;
  lng: number;
  crew_id: string;
  crews: { name: string } | null;
};

export async function adminLiveMap(): Promise<LiveMapData> {
  const supabase = await createClient();
  const [orders, areas] = await Promise.all([
    supabase
      .from("orders")
      .select("id, number, district, landmark, lat, lng, crew_id, crews(name)")
      .eq("status", "on_the_way")
      .not("crew_id", "is", null)
      .order("slot_start_at")
      .limit(200)
      .overrideTypes<JobRow[], { merge: false }>(),
    supabase.rpc("admin_service_areas"),
  ]);
  if (orders.error) throw new Error(`Live orders read failed: ${orders.error.message}`);
  if (areas.error) throw new Error(`Service areas read failed: ${areas.error.message}`);

  const ids = orders.data.map((order) => order.id);
  const positions = new Map<string, CrewPosition & { crew_id: string }>();
  if (ids.length > 0) {
    const { data, error } = await supabase
      .from("crew_live_location")
      .select("order_id, crew_id, lat, lng, accuracy_m, updated_at")
      .in("order_id", ids);
    if (error) throw new Error(`Positions read failed: ${error.message}`);
    for (const { order_id, ...row } of data) positions.set(order_id, row);
  }

  return {
    jobs: orders.data.map((order) => {
      const position = positions.get(order.id);
      return {
        orderId: order.id,
        number: order.number,
        district: order.district,
        landmark: order.landmark,
        home: { lat: order.lat, lng: order.lng },
        crewId: order.crew_id,
        crewName: order.crews?.name ?? "",
        // A position from a crew the job was taken from doesn't count.
        position:
          position && position.crew_id === order.crew_id
            ? {
                lat: position.lat,
                lng: position.lng,
                accuracy_m: position.accuracy_m,
                updated_at: position.updated_at,
              }
            : null,
      };
    }),
    areas: areas.data.filter((area) => area.active).map((area) => areaFromDatabase(area.area)),
    readAt: Date.now(),
  };
}
