'use client';

import 'leaflet/dist/leaflet.css';
import L from 'leaflet';
import { useEffect } from 'react';
import { MapContainer, Marker, Popup, TileLayer, useMap, useMapEvents } from 'react-leaflet';
import type { MapPoint } from '@lotok/shared';
import { formatMoney } from '@lotok/shared';

/** Тайлы карты настраиваются: OSM по умолчанию; в production — коммерческий провайдер (2ГИС, Яндекс, собственный). */
const TILE_URL = process.env.NEXT_PUBLIC_MAP_TILES ?? 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png';
const ATTRIBUTION = process.env.NEXT_PUBLIC_MAP_ATTRIBUTION ?? '&copy; участники OpenStreetMap';

const pinIcon = (label: string, active = false) =>
  L.divIcon({
    className: '',
    html: `<div style="transform:translate(-50%,-100%);white-space:nowrap;background:${active ? '#F59E0B' : '#0E8C76'};color:${active ? '#121619' : '#fff'};font:700 12px system-ui;padding:4px 8px;border-radius:10px;box-shadow:0 2px 8px rgba(0,0,0,.25)">${label}</div>`,
    iconSize: [0, 0],
  });

function BoundsWatcher({ onChange }: { onChange: (b: L.LatLngBounds) => void }) {
  const map = useMapEvents({ moveend: () => onChange(map.getBounds()) });
  useEffect(() => onChange(map.getBounds()), [map, onChange]);
  return null;
}

export function ListingsMap({
  points,
  center,
  zoom = 11,
  onBounds,
  focusId,
}: {
  points: MapPoint[];
  center: [number, number];
  zoom?: number;
  onBounds?: (b: { south: number; west: number; north: number; east: number }) => void;
  focusId?: string | null;
}) {
  return (
    <MapContainer center={center} zoom={zoom} className="size-full" scrollWheelZoom>
      <TileLayer url={TILE_URL} attribution={ATTRIBUTION} />
      {onBounds && <BoundsWatcher onChange={(b) => onBounds({ south: b.getSouth(), west: b.getWest(), north: b.getNorth(), east: b.getEast() })} />}
      {points.map((p) => (
        <Marker key={p.id} position={[p.lat, p.lng]} icon={pinIcon(p.price ? formatMoney(p.price) : '•', p.id === focusId)}>
          <Popup>
            <a href={`/listing/${p.id}`} style={{ fontWeight: 600 }}>
              {p.title}
            </a>
          </Popup>
        </Marker>
      ))}
    </MapContainer>
  );
}

function ClickPicker({ onPick }: { onPick: (lat: number, lng: number) => void }) {
  useMapEvents({ click: (e) => onPick(e.latlng.lat, e.latlng.lng) });
  return null;
}

function Recenter({ center }: { center: [number, number] }) {
  const map = useMap();
  useEffect(() => {
    map.setView(center);
  }, [center, map]);
  return null;
}

export function MapPicker({ value, center, onChange }: { value: [number, number] | null; center: [number, number]; onChange: (lat: number, lng: number) => void }) {
  return (
    <MapContainer center={value ?? center} zoom={12} className="size-full" scrollWheelZoom={false}>
      <TileLayer url={TILE_URL} attribution={ATTRIBUTION} />
      <Recenter center={value ?? center} />
      <ClickPicker onPick={onChange} />
      {value && <Marker position={value} icon={pinIcon('Здесь', true)} />}
    </MapContainer>
  );
}
