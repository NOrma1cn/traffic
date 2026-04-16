import React, { useEffect, useRef, useState, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import * as THREE from 'three';
import { TrackballControls } from 'three/addons/controls/TrackballControls.js';
// @ts-ignore
import { geoVoronoi } from 'd3-geo-voronoi';
import { deriveWeatherVisual, type WeatherDecalCondition } from '../weather';

/* ─────────────────────────── Types ─────────────────────────── */

export interface WeatherData {
  condition: string;
  precipitation_pct: number;
  cloudcover: number;
  wind_kmh: number;
  temp_c?: number;
  humidity?: number;
  month_index?: number;
}

export type PanoramaMode = 'weather' | 'congestion' | 'spacetime';

interface NetworkSphereModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSelectSensor: (sensorIdx: number) => void;
  onSelectNation?: (nationIdx: number) => void;
  onToggleViewMode?: () => void;
  graphData: { nodes: any[]; links: any[]; metadata?: any } | null;
  globalLevels: number[];
  selectedSensor: number;
  viewMode?: PanoramaMode;
  // Weather can now be an array of 12 distinct months from the backend
  weather?: WeatherData | WeatherData[] | null;
  // Spacetime mode: month for each nation (12 nations, 1-12)
  spacetimeMonths?: number[];
}

export interface RegionNation {
  nationIdx: number;
  childSensors: number[];
  polygon3D: THREE.Vector3[]; // Border ring
  centroid3D: THREE.Vector3;  // Capital / Icon location
  level: number;
}

/* ─────────────────── Constants ─────────────────── */

const SPHERE_R = 2.0;
const PHI = Math.PI * (3 - Math.sqrt(5));
const NUM_NATIONS = 12;
const MIN_CAMERA_DISTANCE = 3.8;
const MAX_CAMERA_DISTANCE = 9.0;
const MIN_ROTATE_SPEED = 0.9;
const MAX_ROTATE_SPEED = 4.0;

/* ─────────────────── Helpers ─────────────────── */

function fibSphere(N: number): THREE.Vector3[] {
  const pts: THREE.Vector3[] = [];
  for (let i = 0; i < N; i++) {
    const y = 1 - (i / (N - 1)) * 2;
    const r = Math.sqrt(1 - y * y);
    const theta = PHI * i;
    pts.push(new THREE.Vector3(Math.cos(theta) * r, y, Math.sin(theta) * r));
  }
  return pts;
}

function cartToLonLat(v: THREE.Vector3): [number, number] {
  const norm = v.clone().normalize();
  const lat = Math.asin(Math.max(-1, Math.min(1, norm.y))) * (180 / Math.PI);
  const lon = Math.atan2(norm.z, norm.x) * (180 / Math.PI);
  return [lon, lat];
}

function lonLatTo3D(lon: number, lat: number, r: number): THREE.Vector3 {
  const phi = (lat * Math.PI) / 180;
  const theta = (lon * Math.PI) / 180;
  return new THREE.Vector3(
    r * Math.cos(phi) * Math.cos(theta),
    r * Math.sin(phi),
    r * Math.cos(phi) * Math.sin(theta),
  );
}

function levelToRegionColor(level: number): THREE.Color {
  if (level >= 3.0) return new THREE.Color(0x6b1f1f); // severe
  if (level >= 2.0) return new THREE.Color(0x4a2828); // high
  if (level >= 1.0) return new THREE.Color(0x3d3528); // medium
  return new THREE.Color(0x2a2d35);                  // low
}

function levelToPulseColor(level: number): THREE.Color {
  const t = THREE.MathUtils.clamp(level / 3.0, 0, 1);
  const stops = [
    new THREE.Color(0x4e88b7),
    new THREE.Color(0xc7a546),
    new THREE.Color(0xe37b38),
    new THREE.Color(0xff5a4f),
  ];

  if (t <= 1 / 3) return stops[0].clone().lerp(stops[1], t * 3);
  if (t <= 2 / 3) return stops[1].clone().lerp(stops[2], (t - 1 / 3) * 3);
  return stops[2].clone().lerp(stops[3], (t - 2 / 3) * 3);
}

function levelToNodeColor(level: number): THREE.Color {
  if (level >= 3) return new THREE.Color(0xd13131);
  if (level >= 1) return new THREE.Color(0x9e5c3e);
  return new THREE.Color(0x445566);
}

function withSaturation(color: THREE.Color, saturation: number, target: THREE.Color) {
  const hsl = { h: 0, s: 0, l: 0 };
  color.getHSL(hsl);
  target.setHSL(hsl.h, THREE.MathUtils.clamp(saturation, 0, 1), hsl.l);
  return target;
}

function congestionPercentFromNodeLevel(level: number) {
  if (level >= 3) return 100;
  if (level >= 1) return 50;
  return 0;
}

function congestionPercentFromSensors(sensorIds: number[], levels: number[]) {
  if (sensorIds.length === 0) return 0;
  let total = 0;
  for (const sensorId of sensorIds) {
    total += congestionPercentFromNodeLevel(levels[sensorId] ?? 0);
  }
  return Math.round(total / sensorIds.length);
}

function drawCongestionBadge(
  ctx: CanvasRenderingContext2D,
  size: number,
  pct: number,
  _color: THREE.Color,
) {
  ctx.clearRect(0, 0, size, size);
  ctx.save();
  ctx.translate(size / 2, size / 2);
  ctx.font = `800 ${Math.round(size * 0.28)}px "Helvetica Neue", Arial, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = 'rgba(255, 255, 255, 0.98)';
  ctx.fillText(`${pct}%`, 0, 0);
  ctx.restore();
}

function orientCameraToSensor(
  camera: THREE.PerspectiveCamera,
  sensorPositions: THREE.Vector3[],
  selectedSensor: number,
  distance: number,
) {
  const fallbackDir = new THREE.Vector3(0, 0, 1);
  const selectedPos = selectedSensor >= 0 && selectedSensor < sensorPositions.length
    ? sensorPositions[selectedSensor]
    : null;
  const viewDir = selectedPos ? selectedPos.clone().normalize() : fallbackDir;

  camera.position.copy(viewDir.clone().multiplyScalar(distance));

  const worldUp = Math.abs(viewDir.y) > 0.92 ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(0, 1, 0);
  const side = new THREE.Vector3().crossVectors(worldUp, viewDir).normalize();
  camera.up.copy(new THREE.Vector3().crossVectors(viewDir, side).normalize());
  camera.lookAt(0, 0, 0);
}

function buildSphericalVoronoi(seedPts: THREE.Vector3[]) {
  const seedLL: [number, number][] = seedPts.map(cartToLonLat);
  return geoVoronoi(seedLL).polygons();
}

function relaxedSeedFromFeature(feature: any): THREE.Vector3 {
  const featureCoords = feature.geometry.coordinates[0];
  const uniqueCoords = featureCoords.slice(0, -1);
  const centroid = new THREE.Vector3();

  for (const pt of uniqueCoords) {
    centroid.add(lonLatTo3D(pt[0], pt[1], 1));
  }

  return centroid.normalize().multiplyScalar(SPHERE_R);
}

/* ─────────────────── Nation Topology ─────────────────── */

function buildNations(graphData: any, globalLevels: number[]): {
  nations: RegionNation[], 
  sensorPositions: THREE.Vector3[],
  borderEdges: {va: THREE.Vector3, vb: THREE.Vector3}[],
  cellPolygons: THREE.Vector3[][]
} {
  if (!graphData?.nodes?.length) {
    return { nations: [], sensorPositions: [], borderEdges: [], cellPolygons: [] };
  }

  const nodes = graphData.nodes;
  const sensorCount = nodes.length;
  // Use abstract uniform distribution (Fibonacci Sphere) instead of real geographic lat/lon mapping
  // This avoids clumping bugs and ensures a premium "Weather Net" aesthetic covering the whole globe
  const sensorPositions = fibSphere(sensorCount).map(p => p.multiplyScalar(SPHERE_R));

  // 1. Primitive Cells: Generate Voronoi territories
  let polys: any;
  try {
    polys = buildSphericalVoronoi(sensorPositions);
  } catch (e) {
    console.error("[3D] Voronoi failed:", e);
    return { nations: [], sensorPositions: [], borderEdges: [], cellPolygons: [] };
  }

  const features = polys.features;
  const cellPolygons: THREE.Vector3[][] = [];
  for (let i = 0; i < sensorCount; i++) {
    // GeoVoronoi features might not match sensor index 1:1 if coords are identical
    // But we use the features directly from the Voronoi build
    const feat = features[i];
    if (!feat) {
      cellPolygons.push([]);
      continue;
    }
    const ring3D: THREE.Vector3[] = feat.geometry.coordinates[0].slice(0, -1).map((pt: number[]) => 
      lonLatTo3D(pt[0], pt[1], SPHERE_R)
    );
    cellPolygons.push(ring3D);
  }

  // 2. Nation Clustering: Deploy 12 Capitals and assign cells
  const nationSeeds = fibSphere(NUM_NATIONS);
  const nations: RegionNation[] = Array.from({length: NUM_NATIONS}, (_, i) => ({
    nationIdx: i,
    childSensors: [],
    polygon3D: [], 
    centroid3D: nationSeeds[i], 
    level: 0,
  }));

  for (let si = 0; si < sensorCount; si++) {
    let minD = Infinity;
    let closestN = 0;
    const pos = sensorPositions[si];
    for (let ni = 0; ni < NUM_NATIONS; ni++) {
      const d = pos.distanceToSquared(nationSeeds[ni]);
      if (d < minD) { minD = d; closestN = ni; }
    }
    nations[closestN].childSensors.push(si);
  }

  for (const n of nations) {
    if (n.childSensors.length === 0) continue;
    let sumLevel = 0;
    const centerMass = new THREE.Vector3();
    for (const id of n.childSensors) {
       sumLevel += (globalLevels[id] ?? 0);
       centerMass.add(sensorPositions[id]);
    }
    n.level = sumLevel / n.childSensors.length;
    n.centroid3D = centerMass.normalize().multiplyScalar(SPHERE_R);
  }

  // 3. Edge-Stitching Algorithm: Identify zigzag outer boundaries
  const edgeMap = new Map<string, {va: THREE.Vector3, vb: THREE.Vector3, nSet: Set<number>}>();
  const getEdgeKey = (va: THREE.Vector3, vb: THREE.Vector3) => {
    // Increase precision to 4 decimals to avoid merging distinct adjacent nodes or failing to match them
    const ha = va.x.toFixed(4) + '|' + va.y.toFixed(4) + '|' + va.z.toFixed(4);
    const hb = vb.x.toFixed(4) + '|' + vb.y.toFixed(4) + '|' + vb.z.toFixed(4);
    return ha < hb ? ha + '#' + hb : hb + '#' + ha;
  };

  for (let i = 0; i < sensorCount; i++) {
    const nIdx = nations.findIndex(n => n.childSensors.includes(i));
    if (nIdx === -1) continue;
    const ring = cellPolygons[i];
    for (let j = 0; j < ring.length; j++) {
      const va = ring[j];
      const vb = ring[(j+1)%ring.length];
      const key = getEdgeKey(va, vb);
      if (!edgeMap.has(key)) edgeMap.set(key, {va, vb, nSet: new Set()});
      edgeMap.get(key)!.nSet.add(nIdx);
    }
  }

  const borderEdges: {va: THREE.Vector3, vb: THREE.Vector3}[] = [];
  Array.from(edgeMap.values()).forEach(val => {
    // If edge falls exactly between two nations, it elevates to being a sovereign boundary line
    if (val.nSet.size > 1) {
       borderEdges.push({va: val.va, vb: val.vb});
    }
  });

  return { nations, sensorPositions, borderEdges, cellPolygons };
}

/* ─────────────────── 3D Floating Vector Decals ─────────────────── */

function createWeatherMaterialCache(): Record<string, THREE.MeshBasicMaterial> {
  const cache: Record<string, THREE.MeshBasicMaterial> = {};
  const types: WeatherDecalCondition[] = ['Sun', 'Rainy', 'Cloudy'];

  types.forEach(cond => {
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 512;
    const ctx = canvas.getContext('2d')!;
    const tex = new THREE.CanvasTexture(canvas);
    tex.minFilter = THREE.LinearFilter;
    
    let svgStr = '';
    if (cond === 'Sun') {
       svgStr = `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 24 24" fill="none" stroke="%23fbbf24" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="5"/><path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/></svg>`;
    } else if (cond === 'Rainy') {
       svgStr = `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 24 24" fill="none" stroke="%2360a5fa" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 14.899A7 7 0 1 1 15.71 8h1.79a4.5 4.5 0 0 1 2.5 8.242"/><path d="M16 14v6"/><path d="M8 14v6"/><path d="M12 16v6"/></svg>`;
    } else {
       svgStr = `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 24 24" fill="none" stroke="%23e5e5e5" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z"/></svg>`;
    }

    const img = new Image();
    img.onload = () => {
        ctx.shadowColor = cond === 'Rainy' ? 'rgba(96, 165, 250, 0.4)' 
                        : cond === 'Sun' ? 'rgba(251, 191, 36, 0.4)' 
                        : 'rgba(255, 255, 255, 0.3)';
        ctx.shadowBlur = 15;
        ctx.shadowOffsetX = 0;
        ctx.shadowOffsetY = 4;
        ctx.drawImage(img, 48, 48, 416, 416);
        tex.needsUpdate = true;
    };
    img.src = "data:image/svg+xml;charset=utf-8," + svgStr;

    cache[cond] = new THREE.MeshBasicMaterial({ 
       map: tex, 
       transparent: true, 
       side: THREE.DoubleSide, 
       depthWrite: false, 
       depthTest: true 
    });
  });
  
  return cache;
}

/* ─────────────────── Three.js Scene Builder ─────────────────── */

function buildScene(
  canvas: HTMLCanvasElement,
  nations: RegionNation[],
  sensorPositions: THREE.Vector3[],
  borderEdges: {va: THREE.Vector3, vb: THREE.Vector3}[],
  cellPolygons: THREE.Vector3[][],
  latestProps: React.MutableRefObject<{
    selectedSensor: number;
    globalLevels: number[];
    weathersData: WeatherData[];
    viewMode: PanoramaMode;
    spacetimeMonths: number[];
  }>,
  onSelectSensor: (idx: number) => void,
  onZoomChange: (dist: number) => void
): () => void {
  const sensorCount = sensorPositions.length;
  
  console.log('[buildScene] Starting with:', {
    canvasWidth: canvas.clientWidth,
    canvasHeight: canvas.clientHeight,
    sensorCount,
    nationCount: nations.length,
    borderEdgeCount: borderEdges.length,
  });
  
  // Ensure canvas has valid dimensions
  if (canvas.clientWidth === 0 || canvas.clientHeight === 0) {
    console.error('[buildScene] Canvas has zero dimensions!', {
      clientWidth: canvas.clientWidth,
      clientHeight: canvas.clientHeight,
      offsetWidth: canvas.offsetWidth,
      offsetHeight: canvas.offsetHeight,
    });
    // Return empty cleanup function
    return () => {};
  }

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setSize(canvas.clientWidth, canvas.clientHeight, false);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  
  console.log('[buildScene] Renderer created:', {
    width: renderer.domElement.width,
    height: renderer.domElement.height,
  });

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(45, canvas.clientWidth / canvas.clientHeight, 0.1, 50);
  orientCameraToSensor(camera, sensorPositions, latestProps.current.selectedSensor, 6.5);
  
  console.log('[buildScene] Camera positioned:', {
    position: camera.position.toArray(),
    aspect: camera.aspect,
  });

  const getNationLevel = (nationIdx: number, levels: number[]) => {
    const sensorIds = nations[nationIdx]?.childSensors ?? [];
    if (sensorIds.length === 0) return 0;
    let sum = 0;
    for (const sensorId of sensorIds) sum += levels[sensorId] ?? 0;
    return sum / sensorIds.length;
  };

  // Use TrackballControls instead of OrbitControls to completely eliminate Gimbal Lock at the poles.
  // Trackball allows full 360-degree unconstrained tumbling of the globe.
  const controls = new TrackballControls(camera, canvas);
  controls.noPan = true;
  controls.rotateSpeed = MAX_ROTATE_SPEED;
  controls.zoomSpeed = 1.0;
  controls.minDistance = MIN_CAMERA_DISTANCE;
  controls.maxDistance = MAX_CAMERA_DISTANCE;
  controls.staticMoving = false; // Set to false to enable damping/inertia
  controls.dynamicDampingFactor = 0.12;
  controls.target.set(0, 0, 0);

  scene.add(new THREE.AmbientLight(0xaabbdd, 0.2));
  const dLight = new THREE.DirectionalLight(0x8899cc, 0.4);
  dLight.position.set(5, 3, 5);
  scene.add(dLight);

  /* ── 0. Backface Occluder Sphere ── */
  // An invisible sphere slightly smaller than the main radius that writes to the Depth Buffer
  // This physically blocks any lines/points on the rear hemisphere from being drawn, 
  // while allowing the CSS background 'through' the planet for holographics.
  const occluderGeo = new THREE.SphereGeometry(SPHERE_R - 0.02, 48, 48);
  const occluderMat = new THREE.MeshBasicMaterial({ 
      colorWrite: false, 
      depthWrite: true, 
      transparent: false 
  });
  const occluderMesh = new THREE.Mesh(occluderGeo, occluderMat);
  occluderMesh.renderOrder = -1; // Ensure occluder is drafted into depth buffer before transparent lines
  scene.add(occluderMesh);

  /* ── 1. Inject 3D Floating Vector Decals ── */
  const weatherIcons: {
    weatherMesh: THREE.Mesh,
    weatherMaterial: THREE.MeshBasicMaterial,
    congestionMesh: THREE.Mesh,
    spacetimeMesh: THREE.Mesh,
    basePos: THREE.Vector3,
    upDir: THREE.Vector3,
    nIdx: number,
    congestionTexture: THREE.CanvasTexture,
    congestionMaterial: THREE.MeshBasicMaterial,
    congestionCtx: CanvasRenderingContext2D,
    lastPct: number,
    spacetimeTexture: THREE.CanvasTexture,
    spacetimeMaterial: THREE.MeshBasicMaterial,
    spacetimeCtx: CanvasRenderingContext2D,
    lastMonth: number,
    // 当前透明度（用于平滑过渡）
    currentWeatherOpacity: number,
    currentCongestionOpacity: number,
    currentSpacetimeOpacity: number,
  }[] = [];
  const { weathersData, spacetimeMonths } = latestProps.current;
  const initWxFallback = weathersData && weathersData.length > 0 ? weathersData[0] : null;
  const decalMats = createWeatherMaterialCache();
  
  // 绘制月份标签的函数
  const drawMonthLabel = (
    ctx: CanvasRenderingContext2D,
    size: number,
    month: number,
    _color: THREE.Color,
  ) => {
    ctx.clearRect(0, 0, size, size);
    ctx.save();
    ctx.translate(size / 2, size / 2);
    ctx.font = `800 ${Math.round(size * 0.32)}px "Helvetica Neue", Arial, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = 'rgba(255, 255, 255, 0.98)';
    ctx.fillText(`${month}月`, 0, 0);
    ctx.restore();
  };
  
  for (let i = 0; i < nations.length; i++) {
      const n = nations[i];
      const wx = (weathersData && weathersData[i]) || initWxFallback;
      const cond = deriveWeatherVisual(wx).decalCondition;
      
      const geo = new THREE.PlaneGeometry(1, 1);
      const weatherMaterial = decalMats[cond].clone();
      weatherMaterial.map = decalMats[cond].map;
      const weatherMesh = new THREE.Mesh(geo, weatherMaterial);
      weatherMesh.scale.set(0.65, 0.65, 1.0);
      
      const upDir = n.centroid3D.clone().normalize();
      const basePos = upDir.clone().multiplyScalar(SPHERE_R + 0.12); 
      weatherMesh.position.copy(basePos);

      const congestionCanvas = document.createElement('canvas');
      congestionCanvas.width = 512;
      congestionCanvas.height = 512;
      const congestionCtx = congestionCanvas.getContext('2d')!;
      const congestionTexture = new THREE.CanvasTexture(congestionCanvas);
      congestionTexture.minFilter = THREE.LinearFilter;
      const initialNationLevel = getNationLevel(i, latestProps.current.globalLevels);
      const initialPct = congestionPercentFromSensors(n.childSensors, latestProps.current.globalLevels);
      const initialColor = levelToPulseColor(initialNationLevel);
      drawCongestionBadge(congestionCtx, 512, initialPct, initialColor);
      congestionTexture.needsUpdate = true;
      const congestionMaterial = new THREE.MeshBasicMaterial({
        map: congestionTexture,
        transparent: true,
        side: THREE.DoubleSide,
        depthWrite: false,
        depthTest: true,
      });
      const congestionMesh = new THREE.Mesh(geo, congestionMaterial);
      congestionMesh.scale.set(0.65, 0.65, 1.0);
      congestionMesh.position.copy(basePos);
      
      // 时空模式：月份标签
      const spacetimeCanvas = document.createElement('canvas');
      spacetimeCanvas.width = 512;
      spacetimeCanvas.height = 512;
      const spacetimeCtx = spacetimeCanvas.getContext('2d')!;
      const spacetimeTexture = new THREE.CanvasTexture(spacetimeCanvas);
      spacetimeTexture.minFilter = THREE.LinearFilter;
      const initialMonth = spacetimeMonths[i] || 1;
      drawMonthLabel(spacetimeCtx, 512, initialMonth, new THREE.Color(0xffffff));
      spacetimeTexture.needsUpdate = true;
      const spacetimeMaterial = new THREE.MeshBasicMaterial({
        map: spacetimeTexture,
        transparent: true,
        side: THREE.DoubleSide,
        depthWrite: false,
        depthTest: true,
      });
      const spacetimeMesh = new THREE.Mesh(geo, spacetimeMaterial);
      spacetimeMesh.scale.set(0.65, 0.65, 1.0);
      spacetimeMesh.position.copy(basePos);
      
      scene.add(weatherMesh);
      scene.add(congestionMesh);
      scene.add(spacetimeMesh);
      weatherIcons.push({
        weatherMesh,
        weatherMaterial,
        congestionMesh,
        spacetimeMesh,
        basePos,
        upDir,
        nIdx: i,
        congestionTexture,
        congestionMaterial,
        congestionCtx,
        lastPct: initialPct,
        spacetimeTexture,
        spacetimeMaterial,
        spacetimeCtx,
        lastMonth: initialMonth,
        currentWeatherOpacity: 0,
        currentCongestionOpacity: 0,
        currentSpacetimeOpacity: 0,
      });
  }

  /* ── 1. Render Invisible Faces & True Geographical Borders ── */
  const faceVerts: number[] = [];
  const faceColors: number[] = [];
  const borderVerts: number[] = [];
  const faceToSensor: number[] = []; // Array that maps triangle index to sensor ID
  const sensorToNation: number[] = new Array(sensorCount).fill(-1);

  for (let ni = 0; ni < nations.length; ni++) {
    for (const si of nations[ni].childSensors) {
      sensorToNation[si] = ni;
    }
  }

  for (let i = 0; i < cellPolygons.length; i++) {
    const ring = cellPolygons[i];
    
    const sensorLevel = latestProps.current.globalLevels[i] ?? 0;
    const col = levelToNodeColor(sensorLevel);

    // Any generic polygon can be drawn by fanning triangles from the 0-th vertex
    for (let j = 1; j < ring.length - 1; j++) {
        faceVerts.push(ring[0].x, ring[0].y, ring[0].z, ring[j].x, ring[j].y, ring[j].z, ring[j+1].x, ring[j+1].y, ring[j+1].z);
        faceColors.push(col.r, col.g, col.b, 0, col.r, col.g, col.b, 0, col.r, col.g, col.b, 0);
        faceToSensor.push(i); // Map this triangle to the i-th sensor node
    }
  }

  // Safely interpolate exactly on edge
  for (const edge of borderEdges) {
    const SEGMENTS = 8;
    let prevPt = edge.va.clone();
    for (let step = 1; step <= SEGMENTS; step++) {
        const t = step / SEGMENTS;
        const nextPt = edge.va.clone().lerp(edge.vb, t).normalize().multiplyScalar(SPHERE_R);
        borderVerts.push(prevPt.x, prevPt.y, prevPt.z, nextPt.x, nextPt.y, nextPt.z);
        prevPt = nextPt;
    }
  }

  // Face Geometry (Invisible intentionally)
  const faceGeo = new THREE.BufferGeometry();
  faceGeo.setAttribute('position', new THREE.Float32BufferAttribute(faceVerts, 3));
  const faceColorAttr = new THREE.Float32BufferAttribute(faceColors, 4);
  faceGeo.setAttribute('color', faceColorAttr);
  faceGeo.computeVertexNormals();
  const faceMat = new THREE.MeshBasicMaterial({
    vertexColors: true,
    transparent: true,
    opacity: 1.0,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
  const mapMesh = new THREE.Mesh(faceGeo, faceMat);
  scene.add(mapMesh);

  // Border Lines (12 Country Borders)
  const borderGeo = new THREE.BufferGeometry();
  borderGeo.setAttribute('position', new THREE.Float32BufferAttribute(borderVerts, 3));
  const borderMat = new THREE.LineBasicMaterial({ color: 0x556677, transparent: true, opacity: 0.5 });
  const mapLines = new THREE.LineSegments(borderGeo, borderMat);
  scene.add(mapLines);

  /* ── 2. Sensor Nodes (Surface Rings) ── */
  const nodeGeo = new THREE.RingGeometry(0.58, 1.0, 24);
  const nodeMat = new THREE.MeshBasicMaterial({
    color: 0xffffff,
    transparent: true,
    opacity: 0.92,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
  const nodeMesh = new THREE.InstancedMesh(nodeGeo, nodeMat, sensorCount);
  nodeMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  scene.add(nodeMesh);

  // Distribute specific location matrices
  const dummy = new THREE.Object3D();
  const nodeCurrentColors = Array.from({ length: sensorCount }, () => new THREE.Color(0x000000));
  const nodeTargetColors = Array.from({ length: sensorCount }, () => new THREE.Color(0x000000));
  const nodeCurrentScales = new Float32Array(sensorCount);
  const nodeTargetScales = new Float32Array(sensorCount);
  const nodeNormal = new THREE.Vector3();
  const nodeBaseQuat = new THREE.Quaternion();
  const pulseColor = new THREE.Color();
  const sensorPulseAngles = new Float32Array(sensorCount);
  const sensorOverlayMix = new Float32Array(sensorCount).fill(latestProps.current.viewMode === 'congestion' ? 1 : 0);
  const sensorOverlayStartMix = new Float32Array(sensorCount).fill(latestProps.current.viewMode === 'congestion' ? 1 : 0);
  const nationOverlayMix = new Float32Array(nations.length).fill(latestProps.current.viewMode === 'congestion' ? 1 : 0);
  let hoveredNation = -1;
  let hoveredSensor = -1;
  let activeSelectedSensor = latestProps.current.selectedSensor;
  let activeViewMode = latestProps.current.viewMode;
  let pulseOriginSensor = latestProps.current.selectedSensor;
  let pulseElapsed = 0;
  // 加快脉冲速度
  let pulseTravelDuration = 1.2;
  let pulseRiseDuration = 0.08;
  let pulseHoldDuration = 0.3;
  let pulseFadeDuration = 0.6;
  let pulseMaxAngle = Math.PI;
  let pulseAngularSpeed = Math.PI / pulseTravelDuration;
  let congestionTransitionElapsed = 0;
  let congestionTransitionTarget = latestProps.current.viewMode === 'congestion' ? 1 : 0;
  let congestionTransitionActive = false;
  let congestionTileTransitionDuration = 0.9;
  
  // 国界线亮度过渡（时空模式专用）
  let borderBrightness = 0.5; // 0.5 = 正常，1.0 = 高亮（白色）
  let borderBrightnessTarget = latestProps.current.viewMode === 'spacetime' ? 1.0 : 0.5;
  let borderBrightnessTransitionDuration = 0.6;
  
  // 智能过渡系统：记录上一次切换的时间，避免快速连续切换导致的跳跃
  let lastModeSwitchTime = 0;
  let minSwitchInterval = 0.3; // 最小切换间隔（秒）

  const syncNationOverlayMix = () => {
    for (let ni = 0; ni < nations.length; ni++) {
      const childSensors = nations[ni]?.childSensors ?? [];
      if (childSensors.length === 0) {
        nationOverlayMix[ni] = 0;
        continue;
      }
      let sum = 0;
      for (const sensorId of childSensors) sum += sensorOverlayMix[sensorId] ?? 0;
      nationOverlayMix[ni] = sum / childSensors.length;
    }
  };

  const setPulseOrigin = (originSensor: number) => {
    pulseOriginSensor = originSensor >= 0 && originSensor < sensorCount ? originSensor : 0;
    pulseMaxAngle = 0.001;

    const originPos = sensorPositions[pulseOriginSensor]?.clone().normalize() ?? new THREE.Vector3(0, 0, 1);
    for (let i = 0; i < sensorCount; i++) {
      const targetPos = sensorPositions[i]?.clone().normalize() ?? originPos;
      const dot = THREE.MathUtils.clamp(originPos.dot(targetPos), -1, 1);
      const angle = Math.acos(dot);
      sensorPulseAngles[i] = angle;
      if (angle > pulseMaxAngle) pulseMaxAngle = angle;
    }
    pulseAngularSpeed = pulseMaxAngle / Math.max(pulseTravelDuration, 0.001);
  };

  const resetPulse = (originSensor: number) => {
    // 如果脉冲正在进行中，不要完全重置，而是从当前状态继续
    // 这样可以避免快速切换时的跳跃感
    if (pulseElapsed > 0 && pulseElapsed < pulseRiseDuration + pulseHoldDuration + pulseFadeDuration) {
      // 脉冲正在进行，只更新原点，不重置时间
      setPulseOrigin(originSensor);
    } else {
      // 脉冲已结束或未开始，正常重置
      pulseElapsed = 0;
      setPulseOrigin(originSensor);
    }
  };

  const startCongestionTransition = (originSensor: number, nextViewMode: PanoramaMode) => {
    const newTarget = nextViewMode === 'congestion' ? 1 : 0;
    
    // 更新国界线亮度目标
    borderBrightnessTarget = nextViewMode === 'spacetime' ? 1.0 : 0.5;
    
    // 如果正在过渡中且目标方向相反，智能反转而不是重置
    if (congestionTransitionActive && congestionTransitionTarget !== newTarget) {
      // 计算当前进度（0-1）
      const currentProgress = congestionTransitionElapsed / congestionTileTransitionDuration;
      
      // 反转目标
      congestionTransitionTarget = newTarget;
      
      // 从当前状态继续，而不是重置
      // 使用当前的实际混合值作为新的起点
      for (let i = 0; i < sensorCount; i++) {
        sensorOverlayStartMix[i] = sensorOverlayMix[i];
      }
      
      // 根据当前进度调整剩余时间，让反转更平滑
      congestionTransitionElapsed = 0;
      
      // 更新脉冲原点
      setPulseOrigin(originSensor);
    } else if (!congestionTransitionActive || congestionTransitionTarget !== newTarget) {
      // 新的过渡或相同方向的过渡
      setPulseOrigin(originSensor);
      congestionTransitionElapsed = 0;
      congestionTransitionTarget = newTarget;
      congestionTransitionActive = true;
      for (let i = 0; i < sensorCount; i++) {
        sensorOverlayStartMix[i] = sensorOverlayMix[i];
      }
    }
  };

  const updateNodes = () => {
    const { selectedSensor, globalLevels } = latestProps.current;

    for (let i = 0; i < sensorCount; i++) {
        const nationId = sensorToNation[i];
        const isInHoveredNation = nationId !== -1 && nationId === hoveredNation;
        const isHoveredNode = i === hoveredSensor;
        const isTargeted = i === selectedSensor;

        // Node specific congestion color
        const level = globalLevels[i] ?? 0;
        if (isTargeted) {
            nodeTargetScales[i] = 0.07;
            nodeTargetColors[i].set(0x00ffff);
        } else if (isHoveredNode) {
            nodeTargetScales[i] = 0.05;
            nodeTargetColors[i].set(0xffffff);
        } else if (isInHoveredNation) {
            nodeTargetScales[i] = 0.028;
            nodeTargetColors[i].copy(levelToNodeColor(level));
        } else {
            nodeTargetScales[i] = 0.0001;
            nodeTargetColors[i].set(0x000000);
        }
    }
  };
  updateNodes(); // initial
  setPulseOrigin(activeSelectedSensor);
  pulseElapsed = 0; // 从0开始，让脉冲可见
  syncNationOverlayMix();

  /* ── Raycaster Click Logic ── */
  const raycaster = new THREE.Raycaster();
  const mouse = new THREE.Vector2();
  const mousedownPos = { x: 0, y: 0 };

  const handlePointer = (e: MouseEvent | { clientX: number, clientY: number }) => {
    const rect = canvas.getBoundingClientRect();
    mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(mouse, camera);
  };

  const onMouseDown = (e: MouseEvent) => {
    mousedownPos.x = e.clientX;
    mousedownPos.y = e.clientY;
  };
  canvas.addEventListener('mousedown', onMouseDown);

  const onClick = (e: MouseEvent) => {
    // DRAG vs CLICK: Calculate pixel distance moved
    const dx = e.clientX - mousedownPos.x;
    const dy = e.clientY - mousedownPos.y;
    const moveDist = Math.sqrt(dx * dx + dy * dy);

    // If moved more than 5 pixels, assume it's a drag rotation, not a selection click
    if (moveDist > 5) return;

    handlePointer(e);
    // Raycast against the mapMesh surface to find the node index reliably
    const hits = raycaster.intersectObject(mapMesh);
    if (hits.length > 0 && hits[0].faceIndex !== undefined) {
      const sensorIdx = faceToSensor[hits[0].faceIndex];
      if (sensorIdx !== undefined) {
          // PRECISION FIX: Check if the click point is actually near the node centroid
          const distToNode = hits[0].point.distanceTo(sensorPositions[sensorIdx]);
          if (distToNode < 0.15) {
              onSelectSensor(sensorIdx);
          }
      }
    }
  };
  canvas.addEventListener('click', onClick);

  const onMouseMove = (e: MouseEvent) => {
    handlePointer(e);
  };
  canvas.addEventListener('mousemove', onMouseMove);

  const onMouseLeave = () => {
    hoveredNation = -1;
    hoveredSensor = -1;
    updateNodes();
  };
  canvas.addEventListener('mouseleave', onMouseLeave);

  /* ── Resize handler ── */
  const onResize = () => {
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    controls.handleResize();
  };
  window.addEventListener('resize', onResize);

  /* ── Atmospheric Global Shell (Average of all 12 as a base) ── */
  // Removed: atmospheric shell with scanning rings - now using clean transparent globe
  const atmGeo = new THREE.SphereGeometry(SPHERE_R + 0.005, 48, 48);
  const atmMat = new THREE.MeshBasicMaterial({
    transparent: true,
    side: THREE.DoubleSide,
    depthWrite: false,
    opacity: 0,
  });
  const atmMesh = new THREE.Mesh(atmGeo, atmMat);
  scene.add(atmMesh);

  /* ── Planetary Edge Glow (Space Halo) ── */
  const haloGeo = new THREE.SphereGeometry(SPHERE_R + 0.12, 64, 64);
  const haloMat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: {
      uMode: { value: latestProps.current.viewMode === 'congestion' ? 1.0 : 0.0 }
    },
    vertexShader: `
      varying vec3 vNormal;
      void main() {
        vNormal = normalize(normalMatrix * normal);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      varying vec3 vNormal;
      uniform float uMode;
      void main() {
        // High intensity right on the grazing edge, dropping quickly towards center
        float intensity = pow(1.0 - abs(dot(vNormal, vec3(0.0, 0.0, 1.0))), 3.5);
        vec3 blueGlow = vec3(0.08, 0.35, 0.65);
        vec3 neutralGlow = vec3(0.3, 0.32, 0.35);
        vec3 finalGlow = mix(neutralGlow, blueGlow, uMode);
        gl_FragColor = vec4(finalGlow, intensity);
      }
    `,
  });
  const haloMesh = new THREE.Mesh(haloGeo, haloMat);
  scene.add(haloMesh);

  /* ── Render & LOD Loop ── */
  let animId = 0;
  let elapsed = 0;
  let lastFrame = performance.now();
  let lastDist = camera.position.length(); // 使用实际相机距离初始化
  let frameCount = 0;
  let initialZoomReported = false; // 标记是否已报告初始缩放

  const animate = () => {
    animId = requestAnimationFrame(animate);
    const now = performance.now();
    const dt = (now - lastFrame) / 1000;
    lastFrame = now;
    elapsed += dt;
    
    // Log first few frames for debugging
    if (frameCount < 3) {
      console.log(`[buildScene] Frame ${frameCount}:`, {
        cameraPos: camera.position.toArray(),
        sceneChildren: scene.children.length,
        elapsed,
      });
    }
    frameCount++;

    // Zoomed-in views need finer rotation control to avoid overshooting small regions.
    const controlDist = camera.position.length();
    const zoomFactor = THREE.MathUtils.clamp(
      (controlDist - MIN_CAMERA_DISTANCE) / (MAX_CAMERA_DISTANCE - MIN_CAMERA_DISTANCE),
      0,
      1,
    );
    controls.rotateSpeed = THREE.MathUtils.lerp(MIN_ROTATE_SPEED, MAX_ROTATE_SPEED, zoomFactor);
    controls.update();
    const dist = camera.position.length();
    
    // 第一帧立即报告初始缩放级别，避免UI突变
    if (!initialZoomReported) {
      onZoomChange(dist);
      initialZoomReported = true;
      lastDist = dist;
    } else if (Math.abs(dist - lastDist) > 0.05) {
      // 后续帧：只有距离变化超过阈值才更新
      lastDist = dist;
      onZoomChange(dist);
    }
    
    // ── Update Hover Scanner ──
    const hits = raycaster.intersectObject(mapMesh);
    let newHoverNation = -1;
    let newHoveredSensor = -1;
    if (hits.length > 0 && hits[0].faceIndex !== undefined) {
        const sIdx = faceToSensor[hits[0].faceIndex];
        if (sIdx !== undefined) {
            // BROAD HOVER: Any territory hit triggers the nation-wide scan
            newHoverNation = sensorToNation[sIdx];
            if (hits[0].point.distanceTo(sensorPositions[sIdx]) < 0.15) {
              newHoveredSensor = sIdx;
            }
        }
    }
    
    const { selectedSensor, viewMode } = latestProps.current;
    const sensorChanged = selectedSensor !== activeSelectedSensor;
    const modeChanged = viewMode !== activeViewMode;
    if (newHoverNation !== hoveredNation || newHoveredSensor !== hoveredSensor || sensorChanged || modeChanged) {
        hoveredNation = newHoverNation;
        hoveredSensor = newHoveredSensor;
        updateNodes();
        if (modeChanged) {
          // 智能过渡：检查距离上次切换的时间
          const timeSinceLastSwitch = elapsed - lastModeSwitchTime;
          
          if (timeSinceLastSwitch < minSwitchInterval && congestionTransitionActive) {
            // 快速连续切换：使用智能反转
            startCongestionTransition(selectedSensor, viewMode);
          } else {
            // 正常切换
            startCongestionTransition(selectedSensor, viewMode);
            resetPulse(selectedSensor);
          }
          
          lastModeSwitchTime = elapsed;
        } else if (sensorChanged && activeViewMode === 'weather' && !congestionTransitionActive && congestionTransitionTarget === 0) {
          resetPulse(selectedSensor);
        }
        activeSelectedSensor = selectedSensor;
        activeViewMode = viewMode;
    }

    // ── Polygon Face State ──
    pulseElapsed += dt;
    let maxOverlayMix = 0;
    if (congestionTransitionActive) {
      congestionTransitionElapsed += dt;
      let transitionDone = true;
      for (let i = 0; i < sensorCount; i++) {
        const arrivalTime = sensorPulseAngles[i] / Math.max(pulseAngularSpeed, 0.001);
        const localTransitionElapsed = congestionTransitionElapsed - arrivalTime;
        let nextMix = sensorOverlayStartMix[i];
        if (localTransitionElapsed > 0) {
          // 使用平滑的缓动函数（ease-in-out）
          const rawProgress = THREE.MathUtils.clamp(localTransitionElapsed / congestionTileTransitionDuration, 0, 1);
          // Smoothstep 缓动：3t² - 2t³
          const smoothProgress = rawProgress * rawProgress * (3 - 2 * rawProgress);
          nextMix = THREE.MathUtils.lerp(sensorOverlayStartMix[i], congestionTransitionTarget, smoothProgress);
        }
        sensorOverlayMix[i] = nextMix;
        if (Math.abs(nextMix - congestionTransitionTarget) > 0.001) transitionDone = false;
        if (nextMix > maxOverlayMix) maxOverlayMix = nextMix;
      }
      if (transitionDone) {
        congestionTransitionActive = false;
        for (let i = 0; i < sensorCount; i++) {
          sensorOverlayMix[i] = congestionTransitionTarget;
        }
        maxOverlayMix = congestionTransitionTarget;
      }
    } else {
      maxOverlayMix = congestionTransitionTarget;
      for (let i = 0; i < sensorCount; i++) {
        sensorOverlayMix[i] = congestionTransitionTarget;
      }
    }
    syncNationOverlayMix();
    const showCongestionOverlay = congestionTransitionTarget === 1 || congestionTransitionActive || maxOverlayMix > 0.001;
    
    // Smoothly update shader mode uniform
    const curUMode = 0;
    const targetUMode = (congestionTransitionTarget > 0.5 || congestionTransitionActive) ? 1.0 : 0.0;
    haloMat.uniforms.uMode.value = THREE.MathUtils.lerp(curUMode, targetUMode, 0.1);

    for (let triIdx = 0; triIdx < faceToSensor.length; triIdx++) {
      const sensorIdx = faceToSensor[triIdx];
      const sensorLevel = latestProps.current.globalLevels[sensorIdx] ?? 0;

      let alpha = 0;
      const angle = sensorPulseAngles[sensorIdx] ?? pulseMaxAngle;
      const arrivalTime = angle / Math.max(pulseAngularSpeed, 0.001);
      const localPulseElapsed = pulseElapsed - arrivalTime;
      const congestionMix = THREE.MathUtils.clamp(sensorLevel / 3.0, 0, 1);
      
      // 计算脉冲混合度
      let pulseMix = 0;
      let saturation = 1.0;
      
      if (localPulseElapsed > 0) {
        if (localPulseElapsed < pulseRiseDuration) {
          pulseMix = localPulseElapsed / pulseRiseDuration;
        } else if (localPulseElapsed < pulseRiseDuration + pulseHoldDuration) {
          pulseMix = 1.0;
        } else if (localPulseElapsed < pulseRiseDuration + pulseHoldDuration + pulseFadeDuration) {
          const fadeProgress = (localPulseElapsed - pulseRiseDuration - pulseHoldDuration) / pulseFadeDuration;
          pulseMix = 1.0 - fadeProgress;
          saturation = THREE.MathUtils.lerp(1.0, 0.12, fadeProgress);
        }
      }

      // 脉冲颜色：根据拥堵级别选择
      const basePulseCol = new THREE.Color();
      if (sensorLevel >= 3) {
        // 严重拥堵：红色
        basePulseCol.set(0xff5a4f);
      } else if (sensorLevel >= 2) {
        // 高拥堵：橙色
        basePulseCol.set(0xe37b38);
      } else if (sensorLevel >= 1) {
        // 中等拥堵：黄色
        basePulseCol.set(0xc7a546);
      } else {
        // 正常：明亮的蓝色，使用传感器索引生成不同的蓝色调
        const hue = 0.52 + ((sensorIdx * 73) % 100) * 0.0018; // 蓝色范围 0.52-0.70
        const sat = 0.75 + ((sensorIdx * 37) % 100) * 0.002; // 饱和度 0.75-0.95
        const light = 0.55 + ((sensorIdx * 59) % 100) * 0.0015; // 亮度 0.55-0.70
        basePulseCol.setHSL(hue, sat, light);
      }
      
      withSaturation(basePulseCol, saturation, pulseColor);

      if (showCongestionOverlay) {
        // 拥堵模式：基础颜色 + 脉冲高亮
        const baseAlpha = sensorOverlayMix[sensorIdx] * (0.08 + congestionMix * 0.3);
        alpha = baseAlpha + pulseMix * 0.25;
      } else {
        // 天气模式：仅显示脉冲
        const maxAlpha = 0.55 + congestionMix * 0.25;
        alpha = pulseMix * maxAlpha;
      }

      for (let v = 0; v < 3; v++) {
        const base = triIdx * 12 + v * 4;
        faceColorAttr.array[base] = pulseColor.r;
        faceColorAttr.array[base + 1] = pulseColor.g;
        faceColorAttr.array[base + 2] = pulseColor.b;
        faceColorAttr.array[base + 3] = alpha;
      }
    }
    faceColorAttr.needsUpdate = true;

    // ── Animate 2D Surface Rings ──
    for (let i = 0; i < sensorCount; i++) {
       const p = sensorPositions[i];
       nodeNormal.copy(p).normalize();
       nodeCurrentScales[i] = THREE.MathUtils.lerp(nodeCurrentScales[i], nodeTargetScales[i], 0.16);
       nodeCurrentColors[i].lerp(nodeTargetColors[i], 0.16);

       const isTargeted = i === latestProps.current.selectedSensor;
       const isHoveredNode = i === hoveredSensor;
       const pulse = isTargeted
         ? 1.0 + Math.sin(elapsed * 4.5) * 0.08
         : isHoveredNode
           ? 1.0 + Math.sin(elapsed * 7.0) * 0.06
           : 1.0;

       dummy.position.copy(p).addScaledVector(nodeNormal, 0.006);
       dummy.scale.setScalar(nodeCurrentScales[i] * pulse);
       nodeBaseQuat.setFromUnitVectors(new THREE.Vector3(0, 0, 1), nodeNormal);
       dummy.quaternion.copy(nodeBaseQuat);
       dummy.updateMatrix();
       nodeMesh.setMatrixAt(i, dummy.matrix);
       nodeMesh.setColorAt(i, nodeCurrentColors[i]);
    }
    nodeMesh.instanceMatrix.needsUpdate = true;
    if (nodeMesh.instanceColor) nodeMesh.instanceColor.needsUpdate = true;

    // ── Update 3D Floating Weather Plane Decals ──
    for (const wi of weatherIcons) {
       const nationMix = nationOverlayMix[wi.nIdx] ?? 0;
       const nationLevel = getNationLevel(wi.nIdx, latestProps.current.globalLevels);
       const pct = congestionPercentFromSensors(nations[wi.nIdx]?.childSensors ?? [], latestProps.current.globalLevels);
       if (pct !== wi.lastPct) {
         drawCongestionBadge(wi.congestionCtx, 512, pct, levelToNodeColor(nationLevel));
         wi.congestionTexture.needsUpdate = true;
         wi.lastPct = pct;
       }
       
       // 更新月份标签（如果需要）
       const currentMonth = latestProps.current.spacetimeMonths[wi.nIdx] || 1;
       if (currentMonth !== wi.lastMonth) {
         drawMonthLabel(wi.spacetimeCtx, 512, currentMonth, new THREE.Color(0xffffff));
         wi.spacetimeTexture.needsUpdate = true;
         wi.lastMonth = currentMonth;
       }
       
       const liveWx = (latestProps.current.weathersData && latestProps.current.weathersData[wi.nIdx]) || initWxFallback;
       const liveCond = deriveWeatherVisual(liveWx).decalCondition;
       wi.weatherMaterial.map = decalMats[liveCond].map;
       
       // 2. Static placement + billboard
       wi.weatherMesh.position.copy(wi.basePos);
       wi.congestionMesh.position.copy(wi.basePos);
       wi.spacetimeMesh.position.copy(wi.basePos);
       wi.weatherMesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), wi.upDir);
       wi.congestionMesh.quaternion.copy(camera.quaternion);
       wi.spacetimeMesh.quaternion.copy(camera.quaternion);
       
       // 3. Direct crossfade between weather, congestion, and spacetime overlays
       const iconOp = Math.max(0, Math.min(1, (dist - 4.5) / 2.0)) * 0.9;
       const currentMode = latestProps.current.viewMode;
       
       // 计算目标透明度
       let targetWeatherOpacity = 0;
       let targetCongestionOpacity = 0;
       let targetSpacetimeOpacity = 0;
       
       if (currentMode === 'spacetime') {
         // 时空模式：显示月份
         targetSpacetimeOpacity = iconOp;
       } else if (currentMode === 'congestion') {
         // 拥堵模式：显示拥堵百分比
         targetCongestionOpacity = iconOp;
       } else {
         // 天气模式：显示天气图标
         targetWeatherOpacity = iconOp;
       }
       
       // 平滑过渡（使用 lerp 插值）
       const transitionSpeed = 0.12; // 过渡速度
       wi.currentWeatherOpacity = THREE.MathUtils.lerp(wi.currentWeatherOpacity, targetWeatherOpacity, transitionSpeed);
       wi.currentCongestionOpacity = THREE.MathUtils.lerp(wi.currentCongestionOpacity, targetCongestionOpacity, transitionSpeed);
       wi.currentSpacetimeOpacity = THREE.MathUtils.lerp(wi.currentSpacetimeOpacity, targetSpacetimeOpacity, transitionSpeed);
       
       // 应用透明度
       wi.weatherMaterial.opacity = wi.currentWeatherOpacity;
       wi.congestionMaterial.opacity = wi.currentCongestionOpacity;
       wi.spacetimeMaterial.opacity = wi.currentSpacetimeOpacity;
       
       wi.weatherMesh.visible = wi.currentWeatherOpacity > 0.001;
       wi.congestionMesh.visible = wi.currentCongestionOpacity > 0.001;
       wi.spacetimeMesh.visible = wi.currentSpacetimeOpacity > 0.001;
    }

    // 国界线亮度平滑过渡
    borderBrightness = THREE.MathUtils.lerp(borderBrightness, borderBrightnessTarget, 0.08);
    
    // 根据距离和国界线亮度计算最终透明度
    const baseBorderOp = 0.2 + Math.max(0, Math.min(1, (dist - 4.0) / 3.0)) * 0.5;
    const brightnessMultiplier = 0.5 + (borderBrightness - 0.5) * 1.5; // 0.5 -> 0.5, 1.0 -> 1.25
    borderMat.opacity = baseBorderOp * brightnessMultiplier;
    
    // 国界线颜色：从灰蓝色渐变到白色
    const borderColor = new THREE.Color();
    borderColor.setHSL(0.6, 0.3 - (borderBrightness - 0.5) * 0.6, borderBrightness);
    borderMat.color = borderColor;

    if (Math.abs(dist - lastDist) > 0.05) {
      lastDist = dist;
    }

    renderer.render(scene, camera);
  };
  animate();

  return () => {
    cancelAnimationFrame(animId);
    window.removeEventListener('resize', onResize);
    canvas.removeEventListener('mousedown', onMouseDown);
    canvas.removeEventListener('click', onClick);
    canvas.removeEventListener('mousemove', onMouseMove);
    canvas.removeEventListener('mouseleave', onMouseLeave);
    controls.dispose();

    faceGeo.dispose();
    faceMat.dispose();
    borderGeo.dispose();
    borderMat.dispose();
    nodeGeo.dispose();
    nodeMat.dispose();
    Object.values(decalMats).forEach((mat) => mat.dispose());
    for (const wi of weatherIcons) {
      wi.weatherMaterial.dispose();
      wi.congestionMaterial.dispose();
      wi.congestionTexture.dispose();
      wi.spacetimeMaterial.dispose();
      wi.spacetimeTexture.dispose();
    }
    atmGeo.dispose();
    atmMat.dispose();
    haloGeo.dispose();
    haloMat.dispose();
    renderer.dispose();
  };
}

/* ══════════════════════════════════════════════════════════════
   Modal Component
   ══════════════════════════════════════════════════════════════ */

export const NetworkSphereModal: React.FC<NetworkSphereModalProps> = ({
  isOpen,
  onClose,
  onSelectSensor,
  onSelectNation,
  onToggleViewMode,
  graphData,
  globalLevels,
  selectedSensor,
  viewMode = 'weather',
  weather,
  spacetimeMonths,
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const cleanupRef = useRef<(() => void) | null>(null);

  // Safely parse single or multiple weather packets
  const weatherArr: WeatherData[] = useMemo(() => {
    if (!weather) return [];
    if (Array.isArray(weather)) return weather;
    return [weather];
  }, [weather]);

  // Pass dynamic values through a mutable Ref to completely prevent expensive recreating of Three geometries & resetting OrbitCamera!
  const latestProps = useRef({
    selectedSensor,
    globalLevels,
    weathersData: weatherArr,
    viewMode,
    spacetimeMonths: spacetimeMonths || Array.from({ length: 12 }, (_, i) => i + 1),
  });

  useEffect(() => {
    latestProps.current = { 
      selectedSensor, 
      globalLevels, 
      weathersData: weatherArr, 
      viewMode,
      spacetimeMonths: spacetimeMonths || Array.from({ length: 12 }, (_, i) => i + 1),
    };
  }, [selectedSensor, globalLevels, weatherArr, viewMode, spacetimeMonths]);

  const [zoomLevel, setZoomLevel] = useState(0); // 0 (far) to 1 (near)

  /* Build exactly 12 Nations mapping using bottom up Edge Stitching */
  const { nations, sensorPositions, borderEdges, cellPolygons } = useMemo(() => {
    console.log('[NetworkSphere] Building nations from graphData:', {
      hasGraphData: !!graphData,
      nodeCount: graphData?.nodes?.length || 0,
      hasMetadata: !!graphData?.metadata,
    });
    const result = buildNations(graphData, globalLevels);
    console.log('[NetworkSphere] Built nations:', {
      nationCount: result.nations.length,
      sensorCount: result.sensorPositions.length,
      borderEdgeCount: result.borderEdges.length,
    });
    return result;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [graphData]);

  /* Build scene */
  useEffect(() => {
    console.log('[NetworkSphere] Effect triggered:', {
      isOpen,
      hasCanvas: !!canvasRef.current,
      nationCount: nations.length,
      weatherCount: weatherArr.length,
      hasGraphData: !!graphData
    });
    
    if (!isOpen || !canvasRef.current || nations.length === 0) {
      if (isOpen && nations.length === 0) {
        console.warn('[NetworkSphere] Modal is open but nations are empty. graphData state:', !!graphData);
      }
      return;
    }
    
    // Use default weather if none provided
    const effectiveWeather = weatherArr.length > 0 ? weatherArr : Array.from({ length: NUM_NATIONS }, (_, i) => ({
      condition: 'Sunny',
      precipitation_pct: 0,
      cloudcover: 20,
      wind_kmh: 10,
      temp_c: 20,
      humidity: 50,
      month_index: i,
    }));
    
    console.log('[NetworkSphere] Using weather data:', {
      original: weatherArr.length,
      effective: effectiveWeather.length,
    });
    
    // Update latestProps with effective weather
    latestProps.current.weathersData = effectiveWeather;

    const timer = setTimeout(() => {
      if (!canvasRef.current) return;
      
      // Wait for canvas to have dimensions
      const checkDimensions = () => {
        if (!canvasRef.current) return;
        
        const width = canvasRef.current.clientWidth;
        const height = canvasRef.current.clientHeight;
        
        console.log('[NetworkSphere] Canvas dimensions:', { width, height });
        
        if (width === 0 || height === 0) {
          console.warn('[NetworkSphere] Canvas has zero dimensions, retrying...');
          setTimeout(checkDimensions, 100);
          return;
        }
        
        console.log('[NetworkSphere] Building scene...');
        cleanupRef.current = buildScene(
          canvasRef.current,
          nations,
          sensorPositions,
          borderEdges,
          cellPolygons,
          latestProps,
          onSelectSensor,
          (dist: number) => {
            const z = THREE.MathUtils.clamp(
              (MAX_CAMERA_DISTANCE - dist) / (MAX_CAMERA_DISTANCE - MIN_CAMERA_DISTANCE),
              0,
              1
            );
            // Throttle state update slightly if needed, but for now direct is fine
            setZoomLevel(z);
          }
        );
        console.log('[NetworkSphere] Scene built successfully');
      };
      
      checkDimensions();
    }, 50);

    return () => {
      clearTimeout(timer);
      cleanupRef.current?.();
      cleanupRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, nations]);

  // Which nation does the selected sensor belong to?
  const selectedNation = useMemo(() => {
     if (selectedSensor < 0) return -1;
     return nations.findIndex(n => n.childSensors.includes(selectedSensor));
  }, [selectedSensor, nations]);

  // Notify parent which nation the selected sensor belongs to
  useEffect(() => {
    if (onSelectNation) onSelectNation(selectedNation);
  }, [selectedNation, onSelectNation]);

  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isOpen, onClose]);

  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    onToggleViewMode?.();
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0, scale: 1.05 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.98 }}
          transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
          className="fixed inset-0 z-50 flex items-center justify-center bg-[#050505] overflow-hidden"
        >
          {/* Vignette */}
          <div className="absolute inset-0 pointer-events-none opacity-50 bg-[radial-gradient(circle_at_center,_transparent_0%,_#000_100%)] z-10" />

          {/* Canvas */}
          <canvas
            ref={canvasRef}
            className="absolute inset-0 w-full h-full cursor-crosshair z-[5]"
            onContextMenu={handleContextMenu}
          />

          <ModeSwitchOverlay mode={viewMode} zoom={zoomLevel} />
        </motion.div>
      )}
    </AnimatePresence>
  );
};

/* ══════════════════════════════════════════════════════════════
   2D Mode Switch Overlay (Peripheral Arcs)
   ══════════════════════════════════════════════════════════════ */

const ModeSwitchOverlay: React.FC<{ mode: PanoramaMode; zoom: number }> = ({ mode, zoom }) => {
  const [isVisible, setIsVisible] = useState(false);
  const [displayMode, setDisplayMode] = useState<PanoramaMode>(mode);
  const [isTransitioning, setIsTransitioning] = useState(false);

  useEffect(() => {
    // 如果模式改变，先淡出再改变文字
    if (mode !== displayMode) {
      setIsTransitioning(true);
      
      // 等待淡出完成后再改变文字
      const transitionTimer = setTimeout(() => {
        setDisplayMode(mode);
        setIsTransitioning(false);
        setIsVisible(true);
      }, 300); // 300ms 淡出时间
      
      // 5.5秒后完全隐藏
      const hideTimer = setTimeout(() => setIsVisible(false), 5500);
      
      return () => {
        clearTimeout(transitionTimer);
        clearTimeout(hideTimer);
      };
    } else {
      // 首次进入或相同模式，正常显示
      setIsVisible(true);
      setIsTransitioning(false);
      const timer = setTimeout(() => setIsVisible(false), 5500);
      return () => clearTimeout(timer);
    }
  }, [mode, displayMode]);

  const labelText = displayMode === 'weather' ? '天气环境扫描' : 
                    displayMode === 'congestion' ? '交通流量监控' : '时空月份数据';
  const displayString = labelText;

  // Adaptive Curvature Logic:
  // Baseline curves: 
  // left: M 600 1200 Q 100 500 600 -200
  // right: M 1400 -200 Q 1900 500 1400 1200
  // We make the control point X move based on zoom.
  // When zoom=0 (far), CPX should be closer to 600/1400 (flatter).
  // When zoom=1 (near), CPX should be closer to 100/1900 (curved).
  const leftCPX = 600 - (150 + 450 * zoom);
  const rightCPX = 1400 + (150 + 450 * zoom);

  const leftPath = `M 600 1200 Q ${leftCPX} 500 600 -200`;
  const rightPath = `M 1400 -200 Q ${rightCPX} 500 1400 1200`;

  return (
    <AnimatePresence>
      {isVisible && (
        <motion.div
          key={displayMode}
          initial={{ opacity: 0 }}
          animate={{ opacity: isTransitioning ? 0 : 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.3 }}
          className="absolute inset-0 pointer-events-none z-50 flex items-center justify-center overflow-hidden"
        >
          <style>
            {`
              /* Flicker entry for arcs */
              .arc-line-user {
                fill: none;
                stroke: rgba(0, 242, 255, 0.35); /* Using theme cyan */
                stroke-width: 2;
                opacity: 0;
                animation: flickerUser 5s forwards;
              }

              .ui-wrapper-user {
                width: 100%;
                height: 100%;
                animation: fadeOutUser 5s forwards;
              }

              @keyframes flickerUser {
                0% { opacity: 0; }
                2% { opacity: 0.8; }
                4% { opacity: 0; }
                6% { opacity: 1; }
                8% { opacity: 0.2; }
                12%, 100% { opacity: 1; }
              }

              @keyframes fadeOutUser {
                0%, 60% { opacity: 1; }
                75%, 100% { opacity: 0; }
              }
            `}
          </style>

          <div className="ui-wrapper-user">
            <svg viewBox="0 0 2000 1000" preserveAspectRatio="xMidYMid slice" className="w-full h-full">
            <defs>
              <path id="left-path-user" d={leftPath} />
              <path id="right-path-user" d={rightPath} />
            </defs>

            {/* Arcs with flicker */}
            <use href="#left-path-user" className="arc-line-user" />
            <use href="#right-path-user" className="arc-line-user" />

            {/* Left Text */}
            <text fontFamily="'PingFang SC', 'Microsoft YaHei', sans-serif" fontSize="64" fontWeight="300" fill="#ffffff" letterSpacing="24" dy="-20">
              <textPath href="#left-path-user" textAnchor="middle" dominantBaseline="auto">
                {displayString}
                <animate 
                  attributeName="startOffset" 
                  values="-100%; -100%; 50%; 50%" 
                  dur="5s" 
                  repeatCount="1" 
                  calcMode="spline" 
                  keyTimes="0; 0.05; 0.6; 1" 
                  keySplines="0 0 1 1; 0.05 0.9 0.1 1; 0 0 1 1" 
                />
              </textPath>
            </text>

            {/* Right Text */}
            <text fontFamily="'PingFang SC', 'Microsoft YaHei', sans-serif" fontSize="64" fontWeight="300" fill="#ffffff" letterSpacing="24" dy="-20">
              <textPath href="#right-path-user" textAnchor="middle" dominantBaseline="auto">
                {displayString}
                <animate 
                  attributeName="startOffset" 
                  values="-100%; -100%; 50%; 50%" 
                  dur="5s" 
                  repeatCount="1" 
                  calcMode="spline" 
                  keyTimes="0; 0.05; 0.6; 1" 
                  keySplines="0 0 1 1; 0.05 0.9 0.1 1; 0 0 1 1" 
                />
              </textPath>
            </text>
          </svg>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};
