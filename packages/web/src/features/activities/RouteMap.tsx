import { useEffect, useRef } from "react";

/**
 * GPS route map. Lazy-loads Leaflet on mount so the mapping library never
 * touches the main bundle. Only rendered when the viewer is authorized to
 * see the route (owner or verified guardian) — the API omits it otherwise.
 */
export function RouteMap({ points }: { points: Array<[number, number]> }) {
  const divRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<{ remove: () => void } | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const L = await import("leaflet");
      await import("leaflet/dist/leaflet.css");
      if (cancelled || !divRef.current || mapRef.current) return;
      const map = L.map(divRef.current, {
        scrollWheelZoom: false,
        attributionControl: true,
      });
      L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 19,
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
      }).addTo(map);
      const latlngs = points.map(([lat, lon]) => L.latLng(lat, lon));
      L.polyline(latlngs, { color: "#c6f135", weight: 4, opacity: 0.9 }).addTo(map);
      const startIcon = L.divIcon({
        className: "",
        html: '<div style="background:#c6f135;width:14px;height:14px;border-radius:50%;border:2px solid #0b0f0e"></div>',
        iconSize: [14, 14],
        iconAnchor: [7, 7],
      });
      const endIcon = L.divIcon({
        className: "",
        html: '<div style="background:#ff5c5c;width:14px;height:14px;border-radius:50%;border:2px solid #0b0f0e"></div>',
        iconSize: [14, 14],
        iconAnchor: [7, 7],
      });
      L.marker(latlngs[0], { icon: startIcon }).addTo(map);
      L.marker(latlngs[latlngs.length - 1], { icon: endIcon }).addTo(map);
      map.fitBounds(L.latLngBounds(latlngs).pad(0.15));
      mapRef.current = map;
    })();
    return () => {
      cancelled = true;
      mapRef.current?.remove();
      mapRef.current = null;
    };
  }, [points]);

  return (
    <div
      ref={divRef}
      className="z-0 h-60 w-full overflow-hidden rounded-xl"
      aria-label="GPS route map"
    />
  );
}
