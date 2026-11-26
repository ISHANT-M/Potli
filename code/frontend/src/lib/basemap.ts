import { maplibreGL } from '@maplibre/maplibre-gl-leaflet';
import type { Map } from 'leaflet';
import { setWorkerUrl } from 'maplibre-gl';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';
import 'maplibre-gl/dist/maplibre-gl.css';

setWorkerUrl(workerUrl);

const style = (import.meta.env.VITE_MAP_STYLE_URL as string | undefined)?.trim() || 'https://tiles.openfreemap.org/styles/liberty';

/** Shared by all Leaflet views; data pins are independent of the basemap. */
export function addBasemap(map: Map, onUnavailable: () => void): void {
  try {
    const layer = maplibreGL({ style });
    layer.addTo(map);
    const gl = layer.getMaplibreMap();
    const timer = setTimeout(onUnavailable, 12_000);
    gl.once('idle', () => clearTimeout(timer));
    gl.on('error', onUnavailable);
    map.once('unload', () => {
      clearTimeout(timer);
      gl.off('error', onUnavailable);
    });
  } catch {
    onUnavailable();
  }
}
