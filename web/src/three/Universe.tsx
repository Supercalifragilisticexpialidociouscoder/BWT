import { useEffect, useLayoutEffect, useMemo, useRef, useState, type MutableRefObject } from 'react';
import { Canvas, useFrame, useThree, type ThreeEvent } from '@react-three/fiber';
import * as THREE from 'three';
import type { Layout, Node, NodeState } from './layout';
import { DAY, LANE } from './layout';
import { buildFormGeometries } from './geometries';
import { FORMS, type Form } from '../lib/categories';

/**
 * The Event Universe — a WebGL map of the real event calendar, and an interface:
 * hover/tap selects, the camera travels through time, and selection lights the event's
 * date line across the floor. Everything is driven by `layout`, built from API records.
 */

const BG = new THREE.Color('#0c0b0a');
const PAPER = new THREE.Color('#f2ece2');
const SIGNAL = new THREE.Color('#c9f03c');
const WARN = new THREE.Color('#f2b441');

export interface TimeView {
  /** Day (relative to today) the camera looks at. */
  centerDay: number;
  /** Width of the framed window in days. */
  spanDays: number;
}

export type Anchor = { pos: [number, number, number]; el: HTMLElement | null };

export interface UniverseProps {
  layout: Layout;
  selectedId: string | null;
  hoveredId: string | null;
  category: string | null;
  view: TimeView;
  onHover: (id: string | null) => void;
  onSelect: (id: string | null) => void;
  /** 0 → hero visible, 1 → scrolled into the directory. Read every frame, never re-renders. */
  progress: MutableRefObject<number>;
  reduced: boolean;
  lowPower: boolean;
  anchors: MutableRefObject<Map<string, Anchor>>;
  onReady?: () => void;
  onFail?: (reason: string) => void;
}

const BRIGHTNESS: Record<NodeState, number> = {
  live: 1,
  open: 1,
  full: 0.8,
  not_yet_open: 0.68,
  closed: 0.42,
  ended: 0.36,
  cancelled: 0.28,
};

/* ---------------------------------------------------------------- floor */

const floorVertex = /* glsl */ `
  varying vec3 vWorld;
  void main() {
    vec4 w = modelMatrix * vec4(position, 1.0);
    vWorld = w.xyz;
    gl_Position = projectionMatrix * viewMatrix * w;
  }
`;

const floorFragment = /* glsl */ `
  uniform float uDay;
  uniform float uToday;
  uniform float uLane;
  uniform float uZ0;
  uniform float uLanes;
  uniform float uMinX;
  uniform float uMaxX;
  uniform float uSelX;
  uniform float uSelOn;
  uniform float uFar;
  uniform vec3 uPaper;
  uniform vec3 uSignal;
  varying vec3 vWorld;

  float line(float coord, float width) {
    float d = abs(fract(coord - 0.5) - 0.5) / fwidth(coord);
    return 1.0 - min(d / width, 1.0);
  }

  void main() {
    float zMin = uZ0 - uLane * 0.75;
    float zMax = uZ0 + uLane * (uLanes - 0.25);
    float strip = smoothstep(zMin - 0.6, zMin, vWorld.z) * (1.0 - smoothstep(zMax, zMax + 0.6, vWorld.z));
    float inRange = smoothstep(uMinX - 2.0, uMinX, vWorld.x) * (1.0 - smoothstep(uMaxX + 1.0, uMaxX + 4.0, vWorld.x)) * strip;
    float day = line(vWorld.x / uDay, 0.8) * 0.15 * inRange;
    float week = line(vWorld.x / (uDay * 7.0), 1.2) * 0.42 * inRange;
    float laneCoord = (vWorld.z - uZ0) / uLane;
    float lane = line(laneCoord, 0.9) * 0.3 * strip * smoothstep(uMinX - 3.0, uMinX - 1.0, vWorld.x) * (1.0 - smoothstep(uMaxX + 1.0, uMaxX + 3.0, vWorld.x));
    float today = (1.0 - smoothstep(0.0, 0.045, abs(vWorld.x - uToday))) * strip;
    float todayGlow = (1.0 - smoothstep(0.0, 0.9, abs(vWorld.x - uToday))) * 0.05 * strip;
    // The selected event's date, drawn across every lane.
    float sel = (1.0 - smoothstep(0.0, 0.03, abs(vWorld.x - uSelX))) * strip * uSelOn * 0.85;

    float dist = length(vWorld.xz - cameraPosition.xz);
    float fade = 1.0 - smoothstep(uFar * 0.45, uFar, dist);
    float grid = max(max(day, week), lane);
    float lit = clamp(today + todayGlow + sel, 0.0, 1.0);
    vec3 col = mix(uPaper, uSignal, step(0.001, lit) * clamp(lit / max(grid + lit, 0.001), 0.0, 1.0));
    float a = clamp(max(grid, lit), 0.0, 1.0) * fade;
    gl_FragColor = vec4(col, a);
  }
`;

function Floor({ layout, selected }: { layout: Layout; selected: Node | undefined }) {
  const material = useRef<THREE.ShaderMaterial>(null);
  const width = layout.maxX - layout.minX + 80;
  const depth = layout.maxZ - layout.minZ + 60;
  const uniforms = useMemo(
    () => ({
      uDay: { value: DAY },
      uToday: { value: layout.todayX },
      uLane: { value: LANE },
      uZ0: { value: layout.minZ },
      uLanes: { value: Math.max(layout.lanes.length, 1) },
      uMinX: { value: layout.minX },
      uMaxX: { value: layout.maxX },
      uSelX: { value: 0 },
      uSelOn: { value: 0 },
      uFar: { value: 60 },
      uPaper: { value: PAPER },
      uSignal: { value: SIGNAL },
    }),
    [layout],
  );
  useFrame((state, delta) => {
    const u = material.current?.uniforms;
    if (!u) return;
    if (selected) u.uSelX!.value = selected.x;
    u.uSelOn!.value = THREE.MathUtils.damp(u.uSelOn!.value, selected ? 1 : 0, 6, delta);
    u.uFar!.value = (state.scene.fog as THREE.Fog | null)?.far ?? 60;
  });
  return (
    <mesh rotation-x={-Math.PI / 2} position={[(layout.minX + layout.maxX) / 2, 0, (layout.minZ + layout.maxZ) / 2]} renderOrder={-1}>
      <planeGeometry args={[width, depth]} />
      <shaderMaterial ref={material} vertexShader={floorVertex} fragmentShader={floorFragment} uniforms={uniforms} transparent depthWrite={false} />
    </mesh>
  );
}

/* ---------------------------------------------------------------- beacons */

const tmp = new THREE.Object3D();
const color = new THREE.Color();
const stemColor = new THREE.Color();

function Beacons({ layout, selectedId, hoveredId, category, onHover, onSelect, reduced }: Pick<UniverseProps, 'layout' | 'selectedId' | 'hoveredId' | 'category' | 'onHover' | 'onSelect' | 'reduced'>) {
  const nodes = layout.nodes;
  const forms = useMemo(() => buildFormGeometries(), []);
  const stemGeo = useMemo(() => new THREE.BoxGeometry(0.026, 1, 0.026).translate(0, 0.5, 0), []);
  const hitGeo = useMemo(() => new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0), []);
  const discGeo = useMemo(() => new THREE.CircleGeometry(0.075, 24).rotateX(-Math.PI / 2), []);
  const ringGeo = useMemo(() => new THREE.RingGeometry(0.11, 0.135, 32).rotateX(-Math.PI / 2), []);
  const lidGeo = useMemo(() => new THREE.BoxGeometry(0.42, 0.025, 0.06), []);
  useEffect(
    () => () => {
      Object.values(forms).forEach((g) => g.dispose());
      [stemGeo, hitGeo, discGeo, ringGeo, lidGeo].forEach((g) => g.dispose());
    },
    [forms, stemGeo, hitGeo, discGeo, ringGeo, lidGeo],
  );

  // Index nodes by form so each form is one instanced draw call.
  const byForm = useMemo(() => {
    const m = new Map<Form, number[]>();
    nodes.forEach((n, i) => m.set(n.form, [...(m.get(n.form) ?? []), i]));
    return m;
  }, [nodes]);
  const teamIdx = useMemo(() => nodes.flatMap((n, i) => (n.mode === 'team' ? [i] : [])), [nodes]);
  const soloIdx = useMemo(() => nodes.flatMap((n, i) => (n.mode === 'individual' ? [i] : [])), [nodes]);
  const fullIdx = useMemo(() => nodes.flatMap((n, i) => (n.state === 'full' ? [i] : [])), [nodes]);
  const liveIdx = useMemo(() => nodes.flatMap((n, i) => (n.live ? [i] : [])), [nodes]);

  const stems = useRef<THREE.InstancedMesh>(null);
  const hits = useRef<THREE.InstancedMesh>(null);
  const discs = useRef<THREE.InstancedMesh>(null);
  const rings = useRef<THREE.InstancedMesh>(null);
  const lids = useRef<THREE.InstancedMesh>(null);
  const heads = useRef(new Map<Form, THREE.InstancedMesh>());
  const focusRing = useRef<THREE.Mesh>(null);
  const liveRings = useRef<THREE.Group>(null);

  const frames = useRef(0);
  const anim = useRef({ b: new Float32Array(0), s: new Float32Array(0), k: new Float32Array(0) });
  if (anim.current.b.length !== nodes.length) {
    anim.current = { b: new Float32Array(nodes.length), s: new Float32Array(nodes.length), k: new Float32Array(nodes.length).fill(1) };
  }

  useLayoutEffect(() => {
    nodes.forEach((n, i) => {
      tmp.rotation.set(0, 0, 0);
      tmp.position.set(n.x, 0, n.z);
      tmp.scale.set(1, n.h, 1);
      tmp.updateMatrix();
      stems.current?.setMatrixAt(i, tmp.matrix);
      stems.current?.setColorAt(i, PAPER);
      tmp.scale.set(0.62, n.h + 0.5, 0.62);
      tmp.updateMatrix();
      hits.current?.setMatrixAt(i, tmp.matrix);
    });
    const place = (mesh: THREE.InstancedMesh | null, idx: number[], y: (n: Node) => number) => {
      if (!mesh) return;
      idx.forEach((ni, k) => {
        const n = nodes[ni]!;
        tmp.position.set(n.x, y(n), n.z);
        tmp.scale.setScalar(1);
        tmp.updateMatrix();
        mesh.setMatrixAt(k, tmp.matrix);
        mesh.setColorAt(k, PAPER);
      });
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      mesh.computeBoundingSphere();
    };
    place(discs.current, soloIdx, () => 0.004);
    place(rings.current, teamIdx, () => 0.004);
    place(lids.current, fullIdx, (n) => n.h + 0.34);
    byForm.forEach((idx, form) => place(heads.current.get(form) ?? null, idx, (n) => n.h));
    for (const m of [stems.current, hits.current]) {
      if (!m) continue;
      m.instanceMatrix.needsUpdate = true;
      if (m.instanceColor) m.instanceColor.needsUpdate = true;
      m.computeBoundingSphere();
    }
  }, [nodes, byForm, soloIdx, teamIdx, fullIdx]);

  useFrame((state, delta) => {
    const t = state.clock.elapsedTime;
    const { b, s, k: scale } = anim.current;
    const step = reduced ? 1 : 1 - Math.exp(-delta * 8);
    let changed = false;
    nodes.forEach((n, i) => {
      const isSel = n.id === selectedId;
      const isHover = n.id === hoveredId;
      const filtered = category !== null && n.category !== category;
      let tb = BRIGHTNESS[n.state];
      if (filtered) tb = 0.1;
      else if (selectedId && !isSel) tb = Math.min(tb, 0.3);
      if (isSel || isHover) tb = 1;
      const ts = isSel ? 1 : isHover ? 0.65 : n.live && !filtered && !selectedId ? 1 : 0;
      const tk = isSel ? 1.55 : isHover ? 1.25 : 1;
      const nb = b[i]! + (tb - b[i]!) * step;
      const ns = s[i]! + (ts - s[i]!) * step;
      const nk = scale[i]! + (tk - scale[i]!) * step;
      if (Math.abs(nb - b[i]!) > 1e-4 || Math.abs(ns - s[i]!) > 1e-4 || Math.abs(nk - scale[i]!) > 1e-4) changed = true;
      b[i] = nb;
      s[i] = ns;
      scale[i] = nk;
    });
    frames.current++;
    if (changed || frames.current < 3) {
      nodes.forEach((_, i) => {
        color.copy(PAPER).lerp(SIGNAL, s[i]!).multiplyScalar(b[i]!);
        stems.current?.setColorAt(i, stemColor.copy(color).multiplyScalar(0.6));
      });
      byForm.forEach((idx, form) => {
        const mesh = heads.current.get(form);
        if (!mesh) return;
        idx.forEach((ni, kk) => {
          const n = nodes[ni]!;
          color.copy(PAPER).lerp(SIGNAL, s[ni]!).multiplyScalar(b[ni]!);
          mesh.setColorAt(kk, color);
          tmp.position.set(n.x, n.h, n.z);
          tmp.rotation.set(0, 0, 0);
          tmp.scale.setScalar(scale[ni]!);
          tmp.updateMatrix();
          mesh.setMatrixAt(kk, tmp.matrix);
        });
        mesh.instanceMatrix.needsUpdate = true;
        if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      });
      for (const [mesh, idx] of [
        [discs.current, soloIdx],
        [rings.current, teamIdx],
      ] as const) {
        if (!mesh) continue;
        idx.forEach((ni, kk) => mesh.setColorAt(kk, color.copy(PAPER).lerp(SIGNAL, s[ni]!).multiplyScalar(b[ni]! * 0.8)));
        if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      }
      if (lids.current) {
        fullIdx.forEach((ni, kk) => lids.current!.setColorAt(kk, color.copy(WARN).multiplyScalar(Math.max(0.25, b[ni]!))));
        if (lids.current.instanceColor) lids.current.instanceColor.needsUpdate = true;
      }
      if (stems.current?.instanceColor) stems.current.instanceColor.needsUpdate = true;
    }

    const focus = nodes.find((n) => n.id === (selectedId ?? hoveredId));
    if (focusRing.current) {
      focusRing.current.visible = Boolean(focus);
      if (focus) focusRing.current.position.set(focus.x, 0.006, focus.z);
    }
    // Live events: a slow, low-contrast ripple on the floor (once every ~3 s).
    if (liveRings.current) {
      liveRings.current.children.forEach((c, i) => {
        const phase = reduced ? 0.35 : (t / 3 + i * 0.5) % 1;
        c.scale.setScalar(0.6 + phase * 2.2);
        ((c as THREE.Mesh).material as THREE.MeshBasicMaterial).opacity = (1 - phase) * (selectedId ? 0.15 : 0.45);
      });
    }
  });

  const handleMove = (e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation();
    const n = e.instanceId !== undefined ? nodes[e.instanceId] : undefined;
    if (n && n.id !== hoveredId) onHover(n.id);
    document.body.style.cursor = n ? 'pointer' : '';
  };

  return (
    <group>
      {nodes.length > 0 && (
        <instancedMesh ref={stems} args={[stemGeo, undefined, nodes.length]} frustumCulled={false}>
          <meshBasicMaterial toneMapped={false} />
        </instancedMesh>
      )}
      {FORMS.map((form) => {
        const idx = byForm.get(form);
        if (!idx?.length) return null;
        return (
          <instancedMesh
            key={`${form}-${idx.length}`}
            ref={(m) => {
              if (m) heads.current.set(form, m);
              else heads.current.delete(form);
            }}
            args={[forms[form], undefined, idx.length]}
            frustumCulled={false}
          >
            <meshLambertMaterial toneMapped={false} emissive={'#2a2824'} />
          </instancedMesh>
        );
      })}
      {soloIdx.length > 0 && (
        <instancedMesh key={`d-${soloIdx.length}`} ref={discs} args={[discGeo, undefined, soloIdx.length]} frustumCulled={false}>
          <meshBasicMaterial toneMapped={false} transparent opacity={0.7} depthWrite={false} />
        </instancedMesh>
      )}
      {teamIdx.length > 0 && (
        <instancedMesh key={`r-${teamIdx.length}`} ref={rings} args={[ringGeo, undefined, teamIdx.length]} frustumCulled={false}>
          <meshBasicMaterial toneMapped={false} transparent opacity={0.85} depthWrite={false} side={THREE.DoubleSide} />
        </instancedMesh>
      )}
      {fullIdx.length > 0 && (
        <instancedMesh key={`l-${fullIdx.length}`} ref={lids} args={[lidGeo, undefined, fullIdx.length]} frustumCulled={false}>
          <meshBasicMaterial toneMapped={false} />
        </instancedMesh>
      )}
      {nodes.length > 0 && (
        <instancedMesh
          key={`h-${nodes.length}`}
          ref={hits}
          args={[hitGeo, undefined, nodes.length]}
          onPointerMove={handleMove}
          onPointerOut={() => {
            onHover(null);
            document.body.style.cursor = '';
          }}
          onClick={(e) => {
            e.stopPropagation();
            const n = e.instanceId !== undefined ? nodes[e.instanceId] : undefined;
            if (n) onSelect(n.id === selectedId ? null : n.id);
          }}
        >
          <meshBasicMaterial transparent opacity={0} depthWrite={false} colorWrite={false} />
        </instancedMesh>
      )}
      <mesh ref={focusRing} rotation-x={-Math.PI / 2} visible={false}>
        <ringGeometry args={[0.3, 0.335, 48]} />
        <meshBasicMaterial color={SIGNAL} toneMapped={false} transparent opacity={0.9} depthWrite={false} />
      </mesh>
      <group ref={liveRings}>
        {liveIdx.map((ni) => {
          const n = nodes[ni]!;
          return (
            <mesh key={n.id} position={[n.x, 0.005, n.z]} rotation-x={-Math.PI / 2}>
              <ringGeometry args={[0.3, 0.32, 48]} />
              <meshBasicMaterial color={SIGNAL} toneMapped={false} transparent opacity={0.3} depthWrite={false} />
            </mesh>
          );
        })}
      </group>
    </group>
  );
}

/* ---------------------------------------------------------------- camera */

function CameraRig({ layout, selectedId, category, view, progress, reduced }: Pick<UniverseProps, 'layout' | 'selectedId' | 'category' | 'view' | 'progress' | 'reduced'>) {
  const { camera, size, scene } = useThree();
  const persp = camera as THREE.PerspectiveCamera;
  const target = useRef(new THREE.Vector3());
  const wantPos = useRef(new THREE.Vector3());
  const wantTarget = useRef(new THREE.Vector3());
  const offset = useRef({ x: 0, y: 0 });
  const first = useRef(true);
  const frames = useRef(0);

  useFrame((state, delta) => {
    frames.current++;
    const aspect = size.width / size.height;
    const wide = aspect > 1.15;
    const p = progress.current;
    const node = layout.nodes.find((n) => n.id === selectedId);
    const lane = category ? layout.lanes.find((l) => l.slug === category) : undefined;
    const laneSpan = layout.maxZ - layout.minZ + LANE;
    const back = THREE.MathUtils.clamp(1.25 / aspect, 0.9, 2.2);
    const spanW = view.spanDays * DAY;
    const s = THREE.MathUtils.clamp(spanW / 16, 0.65, 3.2);
    const focusX = view.centerDay * DAY;

    let wantOffX: number;
    let wantOffY = 0;
    if (node) {
      wantTarget.current.set(node.x, node.h * 0.5, node.z);
      wantPos.current.set(node.x - 3.6, node.h * 0.5 + 2.1, node.z + 5.4);
      // Keep the selected event clear of the docked panel (right on desktop, bottom on phones).
      wantOffX = wide ? 0.06 : 0;
      wantOffY = wide ? 0 : 0.2;
    } else {
      const tz = lane ? lane.z : (layout.minZ + layout.maxZ) / 2;
      wantTarget.current.set(focusX + spanW * 0.32, 0.6, tz - laneSpan * 0.05);
      wantPos.current.set(focusX - 6.8 * back * s, 2.3 + 1.5 * back * s, tz + laneSpan * (lane ? 0.25 : 0.5) + 3.6 * back * s);
      wantOffX = wide ? (size.width >= 1280 ? -0.3 : -0.18) : 0;
      // Portrait screens: the headline owns the top, so frame the landscape lower.
      wantOffY = wide ? 0 : -0.14;
      if (!reduced) {
        wantPos.current.x += Math.sin(state.clock.elapsedTime * 0.07) * 0.5 + state.pointer.x * 0.7;
        wantPos.current.y += state.pointer.y * 0.35;
      }
    }
    // Scrolling into the directory lifts the camera into a plan view.
    wantPos.current.y += p * 12;
    wantPos.current.z -= p * 3;

    const lambda = reduced || first.current ? 1e3 : node ? 3 : 2.2;
    first.current = false;
    camera.position.x = THREE.MathUtils.damp(camera.position.x, wantPos.current.x, lambda, delta);
    camera.position.y = THREE.MathUtils.damp(camera.position.y, wantPos.current.y, lambda, delta);
    camera.position.z = THREE.MathUtils.damp(camera.position.z, wantPos.current.z, lambda, delta);
    target.current.x = THREE.MathUtils.damp(target.current.x, wantTarget.current.x, lambda, delta);
    target.current.y = THREE.MathUtils.damp(target.current.y, wantTarget.current.y, lambda, delta);
    target.current.z = THREE.MathUtils.damp(target.current.z, wantTarget.current.z, lambda, delta);
    camera.lookAt(target.current);

    const ox = THREE.MathUtils.damp(offset.current.x, wantOffX, lambda, delta);
    const oy = THREE.MathUtils.damp(offset.current.y, wantOffY, lambda, delta);
    if (Math.abs(ox - offset.current.x) > 1e-4 || Math.abs(oy - offset.current.y) > 1e-4 || frames.current < 2) {
      offset.current = { x: ox, y: oy };
      persp.setViewOffset(size.width, size.height, ox * size.width, oy * size.height, size.width, size.height);
      persp.updateProjectionMatrix();
    }
    // Fog reaches further when the framed window is wider.
    const fog = scene.fog as THREE.Fog | null;
    if (fog) fog.far = THREE.MathUtils.damp(fog.far, 34 + spanW * 1.1, 3, delta);
  });
  // The view offset is tied to the canvas size; re-apply it on resize.
  useEffect(() => {
    persp.setViewOffset(size.width, size.height, offset.current.x * size.width, offset.current.y * size.height, size.width, size.height);
    persp.updateProjectionMatrix();
  }, [size.width, size.height, persp]);
  return null;
}

/* ---------------------------------------------------------------- DOM label projector */

const proj = new THREE.Vector3();

function Projector({ anchors }: Pick<UniverseProps, 'anchors'>) {
  const { camera, size } = useThree();
  useFrame(() => {
    anchors.current.forEach(({ pos, el }) => {
      if (!el) return;
      proj.set(pos[0], pos[1], pos[2]).project(camera);
      const visible = proj.z < 1 && Math.abs(proj.x) < 1.15 && Math.abs(proj.y) < 1.15;
      el.style.transform = `translate3d(${((proj.x * 0.5 + 0.5) * size.width).toFixed(1)}px, ${((-proj.y * 0.5 + 0.5) * size.height).toFixed(1)}px, 0)`;
      el.style.visibility = visible ? 'visible' : 'hidden';
    });
  });
  return null;
}

function Lifecycle({ onReady, onFail }: Pick<UniverseProps, 'onReady' | 'onFail'>) {
  const { gl } = useThree();
  const ready = useRef(false);
  useEffect(() => {
    const canvas = gl.domElement;
    const lost = (e: Event) => {
      e.preventDefault();
      onFail?.('context_lost');
    };
    canvas.addEventListener('webglcontextlost', lost);
    return () => canvas.removeEventListener('webglcontextlost', lost);
  }, [gl, onFail]);
  useFrame(() => {
    if (!ready.current) {
      ready.current = true;
      onReady?.();
    }
  });
  return null;
}

export default function Universe(props: UniverseProps) {
  const container = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(true);
  useEffect(() => {
    const el = container.current;
    if (!el) return;
    // Render nothing while the stage is off-screen or the tab is hidden.
    let inView = true;
    const update = () => setVisible(inView && !document.hidden);
    const io = new IntersectionObserver(([entry]) => {
      inView = Boolean(entry?.isIntersecting);
      update();
    });
    io.observe(el);
    document.addEventListener('visibilitychange', update);
    return () => {
      io.disconnect();
      document.removeEventListener('visibilitychange', update);
      document.body.style.cursor = '';
    };
  }, []);
  const selected = props.layout.nodes.find((n) => n.id === props.selectedId);

  return (
    <div ref={container} className="absolute inset-0" aria-hidden>
      <Canvas
        dpr={props.lowPower ? [1, 1.25] : [1, 1.75]}
        frameloop={visible ? 'always' : 'never'}
        camera={{ fov: 38, near: 0.1, far: 220, position: [0, 6, 18] }}
        gl={{ antialias: !props.lowPower, powerPreference: props.lowPower ? 'low-power' : 'high-performance', alpha: false }}
        onPointerMissed={() => props.selectedId && props.onSelect(null)}
        onCreated={({ gl, scene }) => {
          gl.setClearColor(BG, 1);
          scene.fog = new THREE.Fog(BG, 16, 56);
        }}
      >
        <hemisphereLight args={['#f2ece2', '#14130f', 1.6]} />
        <directionalLight position={[-4, 8, 6]} intensity={1.4} />
        <Floor layout={props.layout} selected={selected} />
        <Beacons {...props} />
        <CameraRig layout={props.layout} selectedId={props.selectedId} category={props.category} view={props.view} progress={props.progress} reduced={props.reduced} />
        <Projector anchors={props.anchors} />
        <Lifecycle onReady={props.onReady} onFail={props.onFail} />
      </Canvas>
    </div>
  );
}
