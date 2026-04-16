import React, { useRef, useMemo, useEffect } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { HighwayNetworkData, HighwaySegment } from '../hooks/useHighwayNetwork';

interface SensorNode {
  id: string;
  index: number;
  freeway: string;
  direction: string;
  abs_pm: number;
  latitude: number;
  longitude: number;
  station_name: string;
}

interface RoadNetwork3DProps {
  sensors: SensorNode[];
  selectedSensorIndex: number | null;
  onSensorClick?: (sensorIndex: number) => void;
  height?: number;
  highwayData?: HighwayNetworkData | null;
}

// Color map for different freeways
const FREEWAY_COLORS: Record<string, number> = {
  'I 5': 0xfbbf24,       // amber
  'I 80': 0x22d3ee,      // cyan
  'US 50': 0x38bdf8,     // sky blue
  'CA 99': 0xa78bfa,     // violet
  'CA 160': 0x34d399,    // emerald
  'CA 244': 0xfb923c,    // orange
  'I 80 Business': 0x06b6d4, // darker cyan
  'I 80 BUS;US 50': 0x0ea5e9,
  'US 50;I 80 Business': 0x0ea5e9,
};

function getRefColor(ref: string): number {
  if (FREEWAY_COLORS[ref]) return FREEWAY_COLORS[ref];
  // Try partial match
  for (const key of Object.keys(FREEWAY_COLORS)) {
    if (ref.includes(key) || key.includes(ref)) return FREEWAY_COLORS[key];
  }
  return 0x64748b; // default slate
}

// Lat/Lon to local km coordinates
function projectLatLon(lat: number, lon: number, centerLat: number, centerLon: number, cosLat: number) {
  const x = (lon - centerLon) * 111.32 * cosLat;
  const z = -(lat - centerLat) * 111.32;
  return { x, z };
}

const RoadNetwork3D: React.FC<RoadNetwork3DProps> = ({
  sensors,
  selectedSensorIndex,
  onSensorClick,
  height = 600,
  highwayData,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);

  // Compute center from highway data bbox
  const { centerLat, centerLon, cosLat } = useMemo(() => {
    if (highwayData) {
      const bb = highwayData.bbox;
      const cLat = (bb.minLat + bb.maxLat) / 2;
      const cLon = (bb.minLon + bb.maxLon) / 2;
      return { centerLat: cLat, centerLon: cLon, cosLat: Math.cos(cLat * Math.PI / 180) };
    }
    // Fallback: center on sensors
    if (sensors.length > 0) {
      const cLat = sensors.reduce((s, p) => s + p.latitude, 0) / sensors.length;
      const cLon = sensors.reduce((s, p) => s + p.longitude, 0) / sensors.length;
      return { centerLat: cLat, centerLon: cLon, cosLat: Math.cos(cLat * Math.PI / 180) };
    }
    return { centerLat: 38.55, centerLon: -121.45, cosLat: Math.cos(38.55 * Math.PI / 180) };
  }, [highwayData, sensors]);

  // Group highway segments by ref for rendering
  const groupedHighways = useMemo(() => {
    if (!highwayData) return new Map<string, HighwaySegment[]>();

    const groups = new Map<string, HighwaySegment[]>();
    for (const seg of highwayData.highways) {
      const ref = seg.ref || 'unknown';
      if (!groups.has(ref)) groups.set(ref, []);
      groups.get(ref)!.push(seg);
    }
    return groups;
  }, [highwayData]);

  // Compute scene bounds
  const sceneBounds = useMemo(() => {
    if (highwayData) {
      const bb = highwayData.bbox;
      const tl = projectLatLon(bb.maxLat, bb.minLon, centerLat, centerLon, cosLat);
      const br = projectLatLon(bb.minLat, bb.maxLon, centerLat, centerLon, cosLat);
      const w = Math.abs(br.x - tl.x);
      const h = Math.abs(br.z - tl.z);
      return { w: Math.max(w, 1), h: Math.max(h, 1), cx: (tl.x + br.x) / 2, cz: (tl.z + br.z) / 2 };
    }
    // Fallback from sensors
    if (sensors.length === 0) return { w: 1, h: 1, cx: 0, cz: 0 };
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (const s of sensors) {
      const { x, z } = projectLatLon(s.latitude, s.longitude, centerLat, centerLon, cosLat);
      minX = Math.min(minX, x); maxX = Math.max(maxX, x);
      minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z);
    }
    return { w: (maxX - minX) || 1, h: (maxZ - minZ) || 1, cx: (minX + maxX) / 2, cz: (minZ + maxZ) / 2 };
  }, [highwayData, sensors, centerLat, centerLon, cosLat]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const width = container.clientWidth;
    const heightActual = container.clientHeight;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x06060a);

    const maxDim = Math.max(sceneBounds.w, sceneBounds.h);

    const camera = new THREE.PerspectiveCamera(50, width / heightActual, 0.01, 5000);
    camera.position.set(sceneBounds.cx, maxDim * 0.8, sceneBounds.cz + maxDim * 0.5);
    camera.lookAt(sceneBounds.cx, 0, sceneBounds.cz);

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(width, heightActual);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    container.appendChild(renderer.domElement);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.05;
    controls.target.set(sceneBounds.cx, 0, sceneBounds.cz);
    controls.maxPolarAngle = Math.PI * 0.45;

    // Lights
    scene.add(new THREE.AmbientLight(0xffffff, 0.5));
    const dLight = new THREE.DirectionalLight(0xffffff, 0.6);
    dLight.position.set(maxDim * 0.5, maxDim * 2, maxDim * 0.3);
    scene.add(dLight);

    // Ground grid
    const gridSize = maxDim * 2;
    scene.add(new THREE.GridHelper(gridSize, 40, 0x111125, 0x0a0a18));

    // Scale factors - much thicker for visibility at large scale
    const lineWidth = maxDim * 0.006;
    const sensorRadius = maxDim * 0.012;
    const glowRadius = sensorRadius * 2.5;

    // Animated objects refs
    const animatedObjects: {
      glowSphere?: THREE.Mesh;
      glowMat?: THREE.MeshBasicMaterial;
      ring?: THREE.Mesh;
      ringMat?: THREE.MeshBasicMaterial;
      beamLine?: THREE.Line;
      beamMat?: THREE.LineBasicMaterial;
      hoveredMesh: THREE.Mesh | null;
      particleSystems: { pts: THREE.Points; speeds: number[]; ts: number[]; curve: THREE.CatmullRomCurve3; rRadius: number; }[];
    } = { hoveredMesh: null, particleSystems: [] };

    // ========================
    // RENDER HIGHWAY NETWORK (batched for performance)
    // ========================
    if (groupedHighways.size > 0) {
      // For each ref: merge all segment geometries into ONE LineSegments object
      for (const [ref, segments] of groupedHighways) {
        const roadColor = getRefColor(ref);

        // Collect all line segment pairs for this ref
        const vertices: number[] = [];
        for (const seg of segments) {
          if (seg.geometry.length < 2) continue;
          for (let i = 0; i < seg.geometry.length - 1; i++) {
            const { x: x1, z: z1 } = projectLatLon(seg.geometry[i][0], seg.geometry[i][1], centerLat, centerLon, cosLat);
            const { x: x2, z: z2 } = projectLatLon(seg.geometry[i + 1][0], seg.geometry[i + 1][1], centerLat, centerLon, cosLat);
            vertices.push(x1, 0, z1, x2, 0, z2);
          }
        }

        if (vertices.length === 0) continue;

        // Create a single merged LineSegments for this highway
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
        const mat = new THREE.LineBasicMaterial({
          color: roadColor,
          linewidth: 2, // Note: linewidth > 1 only works on some GPUs
          transparent: true,
          opacity: 0.8,
        });
        const lineSegs = new THREE.LineSegments(geo, mat);
        scene.add(lineSegs);

        // For major highways: add a fat TubeGeometry along the longest segment
        const majorRefs = ['I 5', 'I 80', 'US 50', 'CA 99'];
        if (majorRefs.some(r => ref.includes(r))) {
          // Find longest segment
          let longest = segments[0];
          for (const seg of segments) {
            if (seg.geometry.length > longest.geometry.length) longest = seg;
          }
          if (longest.geometry.length >= 3) {
            try {
              const pts = longest.geometry.map(([lat, lon]) => {
                const { x, z } = projectLatLon(lat, lon, centerLat, centerLon, cosLat);
                return new THREE.Vector3(x, 0, z);
              });
              const curve = new THREE.CatmullRomCurve3(pts);
              const tubeGeo = new THREE.TubeGeometry(curve, pts.length * 3, lineWidth * 0.3, 6, false);
              const tubeMat = new THREE.MeshStandardMaterial({
                color: roadColor,
                roughness: 0.3,
                metalness: 0.6,
                transparent: true,
                opacity: 0.6,
              });
              scene.add(new THREE.Mesh(tubeGeo, tubeMat));

              // Flowing particles along this highway's longest segment
              const particleCount = 30;
              const particlePositions = new Float32Array(particleCount * 3);
              const speeds: number[] = [];
              const ts: number[] = [];
              for (let i = 0; i < particleCount; i++) {
                const t = Math.random();
                const pt = curve.getPointAt(t);
                particlePositions[i * 3] = pt.x;
                particlePositions[i * 3 + 1] = pt.y + lineWidth;
                particlePositions[i * 3 + 2] = pt.z;
                speeds.push(0.0005 + Math.random() * 0.001);
                ts.push(t);
              }
              const particleGeo = new THREE.BufferGeometry();
              particleGeo.setAttribute('position', new THREE.BufferAttribute(particlePositions, 3));
              const particleMat = new THREE.PointsMaterial({
                color: roadColor,
                size: lineWidth * 1.5,
                transparent: true,
                opacity: 0.6,
                blending: THREE.AdditiveBlending,
                depthWrite: false,
              });
              const particles = new THREE.Points(particleGeo, particleMat);
              scene.add(particles);
              animatedObjects.particleSystems.push({ pts: particles, speeds, ts, curve, rRadius: lineWidth });
            } catch { /* skip */ }
          }
        }
      }
    } else {
      // Fallback: draw roads from sensor positions (original behavior)
      const corridorSensors = (() => {
        if (selectedSensorIndex == null || sensors.length === 0) return sensors;
        const selected = sensors.find(s => s.index === selectedSensorIndex);
        if (!selected) return sensors;
        return sensors.filter(s => s.freeway === selected.freeway && s.direction === selected.direction)
          .sort((a, b) => a.abs_pm - b.abs_pm);
      })();

      if (corridorSensors.length >= 2) {
        const basePoints = corridorSensors.map(s => {
          const { x, z } = projectLatLon(s.latitude, s.longitude, centerLat, centerLon, cosLat);
          return new THREE.Vector3(x, 0, z);
        });

        const interpolated: THREE.Vector3[] = [];
        for (let i = 0; i < basePoints.length - 1; i++) {
          const start = basePoints[i];
          const end = basePoints[i + 1];
          interpolated.push(start.clone());
          for (let j = 1; j < 4; j++) {
            const t = j / 4;
            interpolated.push(new THREE.Vector3(
              start.x + (end.x - start.x) * t,
              0,
              start.z + (end.z - start.z) * t,
            ));
          }
        }
        interpolated.push(basePoints[basePoints.length - 1].clone());

        const selected = corridorSensors.find(s => s.index === selectedSensorIndex);
        const freeway = selected?.freeway ?? '';
        const colorMap: Record<string, number> = {
          '80': 0x22d3ee, '50': 0x38bdf8, '99': 0xa78bfa,
          '5': 0xfbbf24, '51': 0x34d399, '65': 0xfb923c,
        };
        const roadColor = colorMap[freeway] || 0x64748b;

        try {
          const curve = new THREE.CatmullRomCurve3(interpolated);
          const tubeGeo = new THREE.TubeGeometry(curve, interpolated.length * 5, lineWidth, 8, false);
          const tubeMat = new THREE.MeshStandardMaterial({ color: roadColor, roughness: 0.3, metalness: 0.6, transparent: true, opacity: 0.85 });
          scene.add(new THREE.Mesh(tubeGeo, tubeMat));
        } catch { /* skip */ }
      }
    }

    // ========================
    // RENDER SENSOR NODES
    // ========================
    const sensorMeshes: THREE.Mesh[] = [];
    for (const sensor of sensors) {
      const { x, z } = projectLatLon(sensor.latitude, sensor.longitude, centerLat, centerLon, cosLat);
      const pos = new THREE.Vector3(x, 0, z);
      const isSelected = sensor.index === selectedSensorIndex;

      // Sensor sphere
      const geo = new THREE.SphereGeometry(isSelected ? sensorRadius * 1.3 : sensorRadius, 16, 16);
      const mat = new THREE.MeshStandardMaterial({
        color: isSelected ? 0x00ff88 : 0xffffff,
        emissive: isSelected ? 0x00ff88 : 0x334455,
        emissiveIntensity: isSelected ? 0.8 : 0.15,
        roughness: 0.2,
        metalness: 0.8,
      });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.copy(pos);
      mesh.userData = { sensorIndex: sensor.index };
      scene.add(mesh);
      sensorMeshes.push(mesh);

      // Vertical pin for non-selected
      if (!isSelected) {
        const pinGeo = new THREE.CylinderGeometry(sensorRadius * 0.15, sensorRadius * 0.15, sensorRadius * 2, 8);
        const pinMat = new THREE.MeshBasicMaterial({ color: 0x667788, transparent: true, opacity: 0.5 });
        const pin = new THREE.Mesh(pinGeo, pinMat);
        pin.position.set(x, sensorRadius * 1.5, z);
        scene.add(pin);
      }

      // Selected sensor effects
      if (isSelected) {
        // Beam line
        const linePoints = [pos.clone(), new THREE.Vector3(x, -sensorRadius * 3, z)];
        const lineGeo = new THREE.BufferGeometry().setFromPoints(linePoints);
        const beamMat = new THREE.LineBasicMaterial({ color: 0x00ff88, transparent: true, opacity: 0.3 });
        const beamLine = new THREE.Line(lineGeo, beamMat);
        scene.add(beamLine);
        animatedObjects.beamLine = beamLine;
        animatedObjects.beamMat = beamMat;

        // Glow sphere
        const glowGeo = new THREE.SphereGeometry(glowRadius, 16, 16);
        const glowMat = new THREE.MeshBasicMaterial({ color: 0x00ff88, transparent: true, opacity: 0.12 });
        const glow = new THREE.Mesh(glowGeo, glowMat);
        glow.position.copy(pos);
        scene.add(glow);
        animatedObjects.glowSphere = glow;
        animatedObjects.glowMat = glowMat;

        // Ground ring
        const ringGeo = new THREE.RingGeometry(glowRadius * 0.6, glowRadius * 0.9, 32);
        const ringMat = new THREE.MeshBasicMaterial({ color: 0x00ff88, transparent: true, opacity: 0.3, side: THREE.DoubleSide });
        const ring = new THREE.Mesh(ringGeo, ringMat);
        ring.position.set(x, 0.01, z);
        ring.rotation.x = -Math.PI / 2;
        scene.add(ring);
        animatedObjects.ring = ring;
        animatedObjects.ringMat = ringMat;
      }
    }

    // ========================
    // LABELS: highway ref labels as sprites
    // ========================
    for (const [ref, segments] of groupedHighways) {
      if (segments.length === 0) continue;
      // Place label at midpoint of longest segment
      let longest = segments[0];
      for (const seg of segments) {
        if (seg.geometry.length > longest.geometry.length) longest = seg;
      }
      const midIdx = Math.floor(longest.geometry.length / 2);
      const [lat, lon] = longest.geometry[midIdx];
      const { x, z } = projectLatLon(lat, lon, centerLat, centerLon, cosLat);

      const canvas = document.createElement('canvas');
      canvas.width = 256;
      canvas.height = 64;
      const ctx = canvas.getContext('2d')!;
      ctx.fillStyle = 'rgba(0,0,0,0)';
      ctx.fillRect(0, 0, 256, 64);

      // Background pill
      const color = '#' + getRefColor(ref).toString(16).padStart(6, '0');
      ctx.fillStyle = 'rgba(0,0,0,0.6)';
      ctx.roundRect(10, 8, 236, 48, 12);
      ctx.fill();
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      ctx.roundRect(10, 8, 236, 48, 12);
      ctx.stroke();

      ctx.font = 'bold 28px monospace';
      ctx.fillStyle = color;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(ref, 128, 32);

      const tex = new THREE.CanvasTexture(canvas);
      tex.minFilter = THREE.LinearFilter;
      const spriteMat = new THREE.SpriteMaterial({ map: tex, transparent: true, opacity: 0.9 });
      const sprite = new THREE.Sprite(spriteMat);
      sprite.position.set(x, maxDim * 0.06, z);
      sprite.scale.set(maxDim * 0.12, maxDim * 0.03, 1);
      scene.add(sprite);
    }

    // ========================
    // ANIMATION LOOP
    // ========================
    let animId = 0;
    let elapsed = 0;
    let prevTime = performance.now();

    const animate = () => {
      animId = requestAnimationFrame(animate);
      const now = performance.now();
      const dt = (now - prevTime) / 1000;
      prevTime = now;
      elapsed += dt;

      // Glow breath animation
      if (animatedObjects.glowSphere) {
        const breath = 0.5 + 0.5 * Math.sin(elapsed * 2.0);
        animatedObjects.glowSphere.scale.setScalar(1.0 + breath * 0.3);
        if (animatedObjects.glowMat) {
          animatedObjects.glowMat.opacity = 0.08 + breath * 0.08;
        }
      }
      if (animatedObjects.ring) {
        const ringBreath = 0.5 + 0.5 * Math.sin(elapsed * 2.0 + Math.PI * 0.5);
        animatedObjects.ring.scale.setScalar(1.0 + ringBreath * 0.15);
        if (animatedObjects.ringMat) {
          animatedObjects.ringMat.opacity = 0.15 + ringBreath * 0.2;
        }
      }
      if (animatedObjects.beamMat) {
        animatedObjects.beamMat.opacity = 0.15 + (0.5 + 0.5 * Math.sin(elapsed * 1.5)) * 0.2;
      }

      // Particle flow animation
      for (const ps of animatedObjects.particleSystems) {
        const posAttr = ps.pts.geometry.getAttribute('position') as THREE.BufferAttribute;
        const arr = posAttr.array as Float32Array;
        for (let i = 0; i < ps.ts.length; i++) {
          ps.ts[i] = (ps.ts[i] + ps.speeds[i]) % 1.0;
          try {
            const pt = ps.curve.getPointAt(ps.ts[i]);
            arr[i * 3] = pt.x;
            arr[i * 3 + 1] = pt.y + ps.rRadius * 2;
            arr[i * 3 + 2] = pt.z;
          } catch { /* skip */ }
        }
        posAttr.needsUpdate = true;
      }

      controls.update();
      renderer.render(scene, camera);
    };
    animate();

    // Raycaster for interaction
    const raycaster = new THREE.Raycaster();
    const mouse = new THREE.Vector2();
    const mdown = { x: 0, y: 0 };

    const onMD = (e: MouseEvent) => { mdown.x = e.clientX; mdown.y = e.clientY; };
    const onClick = (e: MouseEvent) => {
      if (Math.hypot(e.clientX - mdown.x, e.clientY - mdown.y) > 5) return;
      const rect = container.getBoundingClientRect();
      mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(mouse, camera);
      const hits = raycaster.intersectObjects(sensorMeshes);
      for (const hit of hits) {
        if (hit.object.userData.sensorIndex !== undefined) {
          onSensorClick?.(hit.object.userData.sensorIndex);
          break;
        }
      }
    };

    const onMove = (e: MouseEvent) => {
      const rect = container.getBoundingClientRect();
      mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(mouse, camera);

      if (animatedObjects.hoveredMesh) {
        const hMat = (animatedObjects.hoveredMesh.material as any);
        if (!hMat._wasSelected) {
          hMat.emissiveIntensity = hMat._origEmissive ?? 0.15;
        }
        animatedObjects.hoveredMesh.scale.setScalar(1);
        animatedObjects.hoveredMesh = null;
        container.style.cursor = 'default';
      }

      const hits = raycaster.intersectObjects(sensorMeshes);
      if (hits.length > 0) {
        const hitMesh = hits[0].object as THREE.Mesh;
        const hMat = hitMesh.material as THREE.MeshStandardMaterial;
        if (!(hMat as any)._origEmissiveSet) {
          (hMat as any)._origEmissive = hMat.emissiveIntensity;
          (hMat as any)._origEmissiveSet = true;
          (hMat as any)._wasSelected = hitMesh.userData.sensorIndex === selectedSensorIndex;
        }
        if (!(hMat as any)._wasSelected) {
          hMat.emissiveIntensity = 0.5;
          hitMesh.scale.setScalar(1.15);
        } else {
          hitMesh.scale.setScalar(1.05);
        }
        animatedObjects.hoveredMesh = hitMesh;
        container.style.cursor = 'pointer';
      }
    };

    container.addEventListener('mousedown', onMD);
    container.addEventListener('click', onClick);
    container.addEventListener('mousemove', onMove);

    const onResize = () => {
      const w = container.clientWidth;
      const h = container.clientHeight;
      renderer.setSize(w, h);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      controls.update();
    };
    window.addEventListener('resize', onResize);

    return () => {
      cancelAnimationFrame(animId);
      container.removeEventListener('mousedown', onMD);
      container.removeEventListener('click', onClick);
      container.removeEventListener('mousemove', onMove);
      window.removeEventListener('resize', onResize);
      controls.dispose();
      renderer.dispose();
      if (container.contains(renderer.domElement)) container.removeChild(renderer.domElement);
    };
  }, [sensors, selectedSensorIndex, onSensorClick, groupedHighways, sceneBounds, centerLat, centerLon, cosLat]);

  return (
    <div
      ref={containerRef}
      style={{ width: '100%', height: `${height}px` }}
      className="rounded-xl overflow-hidden border border-zinc-800/50"
    />
  );
};

export default RoadNetwork3D;