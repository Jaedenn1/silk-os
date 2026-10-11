"use client";

import { useEffect, useRef } from "react";
import { LngLatBounds, Map, Marker, type GeoJSONSource } from "maplibre-gl";
import styles from "./silk-route-map.module.css";

type Point = { lat: number; lon: number };
type RouteGeometry = { type: "LineString"; coordinates: number[][] } | null;

type SilkRouteMapProps = {
  origin: Point;
  destination: Point;
  geometry: RouteGeometry;
  styleUrl: string;
};

export default function SilkRouteMap({ origin, destination, geometry, styleUrl }: SilkRouteMapProps) {
  const hostRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!hostRef.current) return;

    const map = new Map({
      container: hostRef.current,
      style: styleUrl,
      center: [origin.lon, origin.lat],
      zoom: 12,
      attributionControl: false,
      interactive: true,
    });

    const originMarker = document.createElement("div");
    originMarker.className = styles.marker;
    const destinationMarker = document.createElement("div");
    destinationMarker.className = `${styles.marker} ${styles.markerDestination}`;

    const startMarker = new Marker({ element: originMarker }).setLngLat([origin.lon, origin.lat]).addTo(map);
    const endMarker = new Marker({ element: destinationMarker }).setLngLat([destination.lon, destination.lat]).addTo(map);

    map.on("load", () => {
      if (geometry?.coordinates?.length) {
        map.addSource("silk-route", {
          type: "geojson",
          data: {
            type: "Feature",
            properties: {},
            geometry,
          },
        });
        map.addLayer({
          id: "silk-route-line",
          type: "line",
          source: "silk-route",
          paint: {
            "line-color": "#9f91ff",
            "line-width": 5,
            "line-opacity": 0.88,
          },
          layout: {
            "line-cap": "round",
            "line-join": "round",
          },
        });
      }

      const bounds = new LngLatBounds();
      bounds.extend([origin.lon, origin.lat]);
      bounds.extend([destination.lon, destination.lat]);
      for (const coordinate of geometry?.coordinates || []) {
        if (coordinate.length >= 2) bounds.extend([Number(coordinate[0]), Number(coordinate[1])]);
      }
      map.fitBounds(bounds, { padding: 42, maxZoom: 14, duration: 0 });
    });

    return () => {
      startMarker.remove();
      endMarker.remove();
      const source = map.getSource("silk-route") as GeoJSONSource | undefined;
      if (source && map.getLayer("silk-route-line")) map.removeLayer("silk-route-line");
      if (source) map.removeSource("silk-route");
      map.remove();
    };
  }, [destination.lat, destination.lon, geometry, origin.lat, origin.lon, styleUrl]);

  return <div className={styles.mapShell}><div className={styles.map} ref={hostRef} /></div>;
}
