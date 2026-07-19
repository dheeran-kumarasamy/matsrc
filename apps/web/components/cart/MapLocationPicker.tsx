"use client";

// Interactive map-based delivery location selector for the checkout "delivery"
// step (see CartDrawer.tsx). Lets the builder click anywhere on the map (or
// drag the marker) to pick an exact delivery point, capturing lat/lng.
//
// Loads the Google Maps JavaScript API on demand using the existing
// NEXT_PUBLIC_GOOGLE_MAPS_API_KEY (already used by components/orders/GpsMap.tsx
// for a read-only embed) — no new npm dependency required. Falls back to a
// placeholder if the key isn't configured so local/dev environments without
// the key don't break.

import { useEffect, useRef, useState } from "react";

declare global {
  interface Window {
    google?: any;
    __matsrcGoogleMapsCallbacks?: Array<() => void>;
  }
}

const DEFAULT_CENTER = { lat: 28.6139, lng: 77.209 }; // New Delhi fallback
const SCRIPT_ID = "matsrc-google-maps-script";

function loadGoogleMapsScript(apiKey: string): Promise<void> {
  return new Promise((resolve, reject) => {
    if (window.google?.maps) {
      resolve();
      return;
    }

    const existing = document.getElementById(SCRIPT_ID) as HTMLScriptElement | null;
    if (existing) {
      window.__matsrcGoogleMapsCallbacks = window.__matsrcGoogleMapsCallbacks || [];
      window.__matsrcGoogleMapsCallbacks.push(resolve);
      return;
    }

    window.__matsrcGoogleMapsCallbacks = [resolve];
    (window as any).__matsrcGoogleMapsLoaded = () => {
      window.__matsrcGoogleMapsCallbacks?.forEach((cb) => cb());
      window.__matsrcGoogleMapsCallbacks = [];
    };

    const script = document.createElement("script");
    script.id = SCRIPT_ID;
    script.src = `https://maps.googleapis.com/maps/api/js?key=${apiKey}&callback=__matsrcGoogleMapsLoaded`;
    script.async = true;
    script.defer = true;
    script.onerror = () => reject(new Error("Failed to load Google Maps script"));
    document.head.appendChild(script);
  });
}

interface MapLocationPickerProps {
  lat: number | null;
  lng: number | null;
  onLocationSelect: (lat: number, lng: number) => void;
}

export default function MapLocationPicker({ lat, lng, onLocationSelect }: MapLocationPickerProps) {
  const apiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;
  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<any>(null);
  const markerRef = useRef<any>(null);
  const onLocationSelectRef = useRef(onLocationSelect);
  onLocationSelectRef.current = onLocationSelect;

  const [status, setStatus] = useState<"idle" | "loading" | "ready" | "error">("idle");

  useEffect(() => {
    if (!apiKey || !mapContainerRef.current) return;

    let cancelled = false;
    setStatus("loading");

    loadGoogleMapsScript(apiKey)
      .then(() => {
        if (cancelled || !mapContainerRef.current) return;

        const initialCenter =
          lat !== null && lng !== null ? { lat, lng } : DEFAULT_CENTER;

        const map = new window.google.maps.Map(mapContainerRef.current, {
          center: initialCenter,
          zoom: lat !== null && lng !== null ? 15 : 11,
          streetViewControl: false,
          mapTypeControl: false,
          fullscreenControl: false,
        });

        const marker = new window.google.maps.Marker({
          position: initialCenter,
          map,
          draggable: true,
        });

        marker.addListener("dragend", () => {
          const position = marker.getPosition();
          if (position) {
            onLocationSelectRef.current(position.lat(), position.lng());
          }
        });

        map.addListener("click", (event: any) => {
          const position = event.latLng;
          if (!position) return;
          marker.setPosition(position);
          onLocationSelectRef.current(position.lat(), position.lng());
        });

        mapRef.current = map;
        markerRef.current = marker;
        setStatus("ready");
      })
      .catch(() => {
        if (!cancelled) setStatus("error");
      });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apiKey]);

  // Keep the marker/map in sync if lat/lng change from elsewhere (e.g. the
  // "Use my current location" button), without re-initializing the map.
  useEffect(() => {
    if (status !== "ready" || lat === null || lng === null) return;
    const position = { lat, lng };
    markerRef.current?.setPosition(position);
    mapRef.current?.panTo(position);
  }, [lat, lng, status]);

  if (!apiKey) {
    return (
      <div className="flex h-48 items-center justify-center rounded-lg border border-dashed border-slate-200 bg-slate-50 px-4 text-center text-xs text-slate-400">
        Map selector unavailable — Google Maps API key is not configured.
      </div>
    );
  }

  if (status === "error") {
    return (
      <div className="flex h-48 items-center justify-center rounded-lg border border-dashed border-slate-200 bg-slate-50 px-4 text-center text-xs text-red-500">
        Unable to load the map. You can still use "Use my current location" or enter an address.
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-lg border border-slate-200">
      <div ref={mapContainerRef} className="h-48 w-full bg-slate-100" />
      <p className="border-t border-slate-100 bg-slate-50 px-3 py-1.5 text-[11px] text-slate-400">
        Tap or drag the pin to set the exact delivery location.
      </p>
    </div>
  );
}
