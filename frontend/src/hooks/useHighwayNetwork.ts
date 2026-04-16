import { useState, useEffect } from 'react';

export interface HighwaySegment {
  id: number;
  ref: string;
  name: string;
  oneway: boolean;
  lanes: number;
  maxspeed: string;
  geometry: [number, number][]; // [lat, lon][]
}

export interface HighwayNetworkData {
  source: string;
  region: string;
  totalWays: number;
  bbox: { minLat: number; maxLat: number; minLon: number; maxLon: number };
  summary: Record<string, { segments: number; points: number; names: string[] }>;
  highways: HighwaySegment[];
}

let _cache: HighwayNetworkData | null = null;
let _cachePromise: Promise<HighwayNetworkData> | null = null;

export function fetchHighwayNetwork(): Promise<HighwayNetworkData> {
  if (_cache) return Promise.resolve(_cache);
  if (_cachePromise) return _cachePromise;

  _cachePromise = fetch('/highway_d03.json')
    .then((r) => {
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.json();
    })
    .then((data: HighwayNetworkData) => {
      _cache = data;
      return data;
    })
    .catch((err) => {
      _cachePromise = null;
      throw err;
    });

  return _cachePromise;
}

export function useHighwayNetwork() {
  const [data, setData] = useState<HighwayNetworkData | null>(_cache);
  const [loading, setLoading] = useState(!_cache);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (_cache) {
      setData(_cache);
      setLoading(false);
      return;
    }
    setLoading(true);
    fetchHighwayNetwork()
      .then((d) => {
        setData(d);
        setError(null);
      })
      .catch((e) => setError(String(e?.message ?? e)))
      .finally(() => setLoading(false));
  }, []);

  return { data, loading, error };
}