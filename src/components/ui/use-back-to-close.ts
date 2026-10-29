"use client";

import { useCallback, useEffect, useRef } from "react";

/**
 * The phone's back button closes an open sheet or photo instead of leaving
 * the page. Opening adds a history entry on the same URL (Next copies its
 * own state into it); back pops that entry and closes the top layer only.
 * Closing any other way removes the entry again, so the next back leaves
 * the page as before. A layer that is `blocked` (saving) stays open: its
 * entry is put back. Call the returned `release` before navigating from
 * inside the layer with `router.replace`: the new page then takes the
 * layer's entry, and back goes to the page under the layer.
 */

type Layer = { onBack: () => void; blocked: () => boolean };

const layers: Layer[] = [];
// Pops this module started itself (history.back() after a close).
let ownPops = 0;
let listening = false;

function onPopState() {
  if (ownPops > 0) {
    ownPops--;
    return;
  }
  const top = layers.at(-1);
  if (!top) return;
  if (top.blocked()) {
    window.history.pushState(null, "");
    return;
  }
  layers.pop();
  top.onBack();
}

/**
 * Before a full page load (location.assign, a form post): forget every open
 * layer, so none calls history.back() as it unmounts, which would cancel the
 * load (account deletion, logout).
 */
export function releaseAllLayers() {
  layers.length = 0;
}

export function useBackToClose(
  open: boolean,
  onBack: () => void,
  blocked: () => boolean = () => false,
) {
  const latest = useRef({ onBack, blocked });
  const current = useRef<Layer | null>(null);
  useEffect(() => {
    latest.current = { onBack, blocked };
  });

  useEffect(() => {
    if (!open) return;
    if (!listening) {
      window.addEventListener("popstate", onPopState);
      listening = true;
    }
    const layer: Layer = {
      onBack: () => latest.current.onBack(),
      blocked: () => latest.current.blocked(),
    };
    const href = window.location.href;
    window.history.pushState(null, "");
    layers.push(layer);
    current.current = layer;

    return () => {
      current.current = null;
      const index = layers.indexOf(layer);
      // Already popped by the back button, or released.
      if (index === -1) return;
      layers.splice(index, 1);
      // The page changed under the layer (a redirect): going back now would
      // undo it.
      if (window.location.href !== href) return;
      ownPops++;
      window.history.back();
    };
  }, [open]);

  return useCallback(() => {
    const layer = current.current;
    const index = layer ? layers.indexOf(layer) : -1;
    if (index !== -1) layers.splice(index, 1);
  }, []);
}
