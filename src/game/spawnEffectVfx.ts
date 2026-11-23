import * as THREE from 'three';

export interface WorldSpawnPoint {
  id: string;
  label: string;
  x: number;
  z: number;
  facingYaw: number;
}

/**
 * 3 distinct, non-overlapping Player Spawn Points spread cleanly across the arena,
 * guaranteed clear of static pillars and baseplate walls.
 */
export const PLAYER_SPAWN_POINTS: ReadonlyArray<WorldSpawnPoint> = [
  {
    id: 'spawn-south-plaza',
    label: 'South Courtyard',
    x: 0.0,
    z: 14.2,
    facingYaw: 0,
  },
  {
    id: 'spawn-east-overlook',
    label: 'East Overlook',
    x: 24.5,
    z: -4.5,
    facingYaw: Math.PI * 0.48,
  },
  {
    id: 'spawn-west-flank',
    label: 'West Flank',
    x: -24.5,
    z: -14.5,
    facingYaw: -Math.PI * 0.62,
  },
];

interface PadBeacon {
  root: THREE.Group;
  outerRing: THREE.Mesh;
  innerRing: THREE.Mesh;
  coreDisc: THREE.Mesh;
  motes: THREE.Mesh[];
  moteAngles: number[];
}

interface ActiveSpawnPulse {
  root: THREE.Group;
  ring: THREE.Mesh;
  ringMat: THREE.MeshBasicMaterial;
  column: THREE.Mesh;
  colMat: THREE.MeshBasicMaterial;
  elapsed: number;
  duration: number;
}

/**
 * Renders subtle animated cartoon ground spawn beacons at the 3 world spawn points,
 * plus a crisp ground arrival pulse whenever a player spawns or respawns.
 */
export class SpawnPadVfxSystem {
  public readonly group = new THREE.Group();

  private readonly pads: PadBeacon[] = [];
  private readonly pulses: ActiveSpawnPulse[] = [];
  private readonly pulsePool: ActiveSpawnPulse[] = [];

  private readonly outerRingGeo = new THREE.RingGeometry(1.06, 1.24, 24);
  private readonly innerRingGeo = new THREE.RingGeometry(0.62, 0.75, 16);
  private readonly coreDiscGeo = new THREE.CircleGeometry(0.56, 20);
  private readonly moteGeo = new THREE.BoxGeometry(0.11, 0.11, 0.11);
  private readonly pulseRingGeo = new THREE.RingGeometry(0.45, 0.92, 24);
  private readonly pulseColGeo = new THREE.CylinderGeometry(0.75, 1.05, 3.2, 20, 1, true);

  private readonly outerRingMat = new THREE.MeshBasicMaterial({
    color: '#63D6FF',
    transparent: true,
    opacity: 0.56,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
  private readonly innerRingMat = new THREE.MeshBasicMaterial({
    color: '#C9F4FF',
    transparent: true,
    opacity: 0.48,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
  private readonly coreDiscMat = new THREE.MeshBasicMaterial({
    color: '#2B9EFF',
    transparent: true,
    opacity: 0.18,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
  private readonly moteMat = new THREE.MeshBasicMaterial({
    color: '#AEEFFF',
    transparent: true,
    opacity: 0.78,
  });

  private time = 0;

  constructor() {
    this.outerRingGeo.rotateX(-Math.PI / 2);
    this.innerRingGeo.rotateX(-Math.PI / 2);
    this.coreDiscGeo.rotateX(-Math.PI / 2);
    this.pulseRingGeo.rotateX(-Math.PI / 2);

    for (const sp of PLAYER_SPAWN_POINTS) {
      const root = new THREE.Group();
      root.position.set(sp.x, 0.018, sp.z);

      const outerRing = new THREE.Mesh(this.outerRingGeo, this.outerRingMat);
      const innerRing = new THREE.Mesh(this.innerRingGeo, this.innerRingMat);
      innerRing.position.y = 0.004;
      const coreDisc = new THREE.Mesh(this.coreDiscGeo, this.coreDiscMat);
      coreDisc.position.y = 0.002;
      root.add(coreDisc, outerRing, innerRing);

      const motes: THREE.Mesh[] = [];
      const moteAngles: number[] = [];
      for (let i = 0; i < 4; i++) {
        const angle = (i / 4) * Math.PI * 2;
        const mote = new THREE.Mesh(this.moteGeo, this.moteMat);
        mote.position.set(Math.cos(angle) * 0.92, 0.14 + i * 0.06, Math.sin(angle) * 0.92);
        root.add(mote);
        motes.push(mote);
        moteAngles.push(angle);
      }

      this.group.add(root);
      this.pads.push({
        root,
        outerRing,
        innerRing,
        coreDisc,
        motes,
        moteAngles,
      });
    }
  }

  private acquirePulse(): ActiveSpawnPulse {
    const pooled = this.pulsePool.pop();
    if (pooled) return pooled;

    const root = new THREE.Group();
    const ringMat = new THREE.MeshBasicMaterial({
      color: '#7CE4FF',
      transparent: true,
      opacity: 0.9,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    const ring = new THREE.Mesh(this.pulseRingGeo, ringMat);

    const colMat = new THREE.MeshBasicMaterial({
      color: '#63D6FF',
      transparent: true,
      opacity: 0.34,
      side: THREE.DoubleSide,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const column = new THREE.Mesh(this.pulseColGeo, colMat);
    column.position.y = 1.6;
    root.add(ring, column);
    this.group.add(root);

    return {
      root,
      ring,
      ringMat,
      column,
      colMat,
      elapsed: 0,
      duration: 0.95,
    };
  }

  public triggerArrivalBurst(x: number, z: number): void {
    const p = this.acquirePulse();
    p.root.position.set(x, 0.025, z);
    p.ring.scale.setScalar(0.5);
    p.ringMat.opacity = 0.9;
    p.column.scale.set(1, 0.85, 1);
    p.colMat.opacity = 0.34;
    p.elapsed = 0;
    p.duration = 0.95;
    p.root.visible = true;
    this.pulses.push(p);
  }

  public update(dt: number): void {
    const safeDt = Math.min(dt, 0.05);
    this.time += safeDt;

    for (let i = 0; i < this.pads.length; i++) {
      const pad = this.pads[i];
      pad.outerRing.rotation.y = this.time * 0.45 + i;
      pad.innerRing.rotation.y = -this.time * 0.85 - i;
      const pulse = 1 + Math.sin(this.time * 2.6 + i * 1.3) * 0.045;
      pad.coreDisc.scale.setScalar(pulse);

      for (let m = 0; m < pad.motes.length; m++) {
        const ang = pad.moteAngles[m] + this.time * 1.15;
        const bob = ((this.time * 0.55 + m * 0.25 + i * 0.17) % 1);
        const mote = pad.motes[m];
        mote.position.set(
          Math.cos(ang) * (0.86 + Math.sin(this.time * 2 + m) * 0.08),
          0.08 + bob * 0.72,
          Math.sin(ang) * (0.86 + Math.sin(this.time * 2 + m) * 0.08),
        );
        mote.rotation.y = ang;
        mote.rotation.x = this.time * 2.2;
        const s = 0.55 + Math.sin(bob * Math.PI) * 0.65;
        mote.scale.setScalar(s);
      }
    }

    for (let i = this.pulses.length - 1; i >= 0; i--) {
      const p = this.pulses[i];
      p.elapsed += safeDt;
      const t = Math.min(1, p.elapsed / p.duration);
      const easeOut = 1 - Math.pow(1 - t, 3);

      p.ring.scale.setScalar(0.55 + easeOut * 2.15);
      p.ringMat.opacity = (1 - t) * 0.88;

      p.column.scale.set(1 - t * 0.45, 0.85 + t * 0.4, 1 - t * 0.45);
      p.colMat.opacity = (1 - t) * 0.34;

      if (p.elapsed >= p.duration) {
        this.pulses.splice(i, 1);
        p.root.visible = false;
        this.pulsePool.push(p);
      }
    }
  }

  public dispose(): void {
    while (this.pulses.length > 0) {
      const p = this.pulses.pop();
      if (p) {
        this.group.remove(p.root);
        p.ringMat.dispose();
        p.colMat.dispose();
      }
    }
    while (this.pulsePool.length > 0) {
      const p = this.pulsePool.pop();
      if (p) {
        this.group.remove(p.root);
        p.ringMat.dispose();
        p.colMat.dispose();
      }
    }
    this.outerRingGeo.dispose();
    this.innerRingGeo.dispose();
    this.coreDiscGeo.dispose();
    this.moteGeo.dispose();
    this.pulseRingGeo.dispose();
    this.pulseColGeo.dispose();
    this.outerRingMat.dispose();
    this.innerRingMat.dispose();
    this.coreDiscMat.dispose();
    this.moteMat.dispose();
  }
}

function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}

function easeInOutQuad(t: number): number {
  return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
}

/**
 * Pooled, zero-GC blue energy orb VFX used for exact 2.5s opposite
 * Spawn (materialization: large orb contracts & dissipates inward) and
 * Death (dissolution: small core expands & absorbs outward) animations.
 */
export class BlueOrbTransitionVfx {
  public readonly group = new THREE.Group();

  private readonly coreGeo = new THREE.SphereGeometry(0.56, 22, 16);
  private readonly shellGeo = new THREE.SphereGeometry(0.92, 24, 18);
  private readonly ringGeo = new THREE.TorusGeometry(0.92, 0.032, 10, 40);
  private readonly moteGeo = new THREE.OctahedronGeometry(0.068, 0);

  private readonly coreMat = new THREE.MeshBasicMaterial({
    color: '#9BEBFF',
    transparent: true,
    opacity: 0,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  private readonly shellMat = new THREE.MeshBasicMaterial({
    color: '#2584FF',
    transparent: true,
    opacity: 0,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  private readonly ringAMat = new THREE.MeshBasicMaterial({
    color: '#63D6FF',
    transparent: true,
    opacity: 0,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  private readonly ringBMat = new THREE.MeshBasicMaterial({
    color: '#3B82F6',
    transparent: true,
    opacity: 0,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  private readonly moteMat = new THREE.MeshBasicMaterial({
    color: '#BEEFFF',
    transparent: true,
    opacity: 0,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });

  private readonly coreMesh: THREE.Mesh;
  private readonly shellMesh: THREE.Mesh;
  private readonly ringA: THREE.Mesh;
  private readonly ringB: THREE.Mesh;
  private readonly motes: Array<{
    mesh: THREE.Mesh;
    phase: number;
    elev: number;
    speed: number;
  }> = [];

  private spinTime = 0;

  constructor() {
    this.group.visible = false;

    this.coreMesh = new THREE.Mesh(this.coreGeo, this.coreMat);
    this.shellMesh = new THREE.Mesh(this.shellGeo, this.shellMat);
    this.ringA = new THREE.Mesh(this.ringGeo, this.ringAMat);
    this.ringB = new THREE.Mesh(this.ringGeo, this.ringBMat);
    this.ringA.rotation.x = Math.PI * 0.34;
    this.ringB.rotation.set(-Math.PI * 0.28, Math.PI * 0.25, 0);

    this.group.add(this.shellMesh, this.coreMesh, this.ringA, this.ringB);

    for (let i = 0; i < 14; i++) {
      const mesh = new THREE.Mesh(this.moteGeo, this.moteMat);
      this.group.add(mesh);
      this.motes.push({
        mesh,
        phase: (i / 14) * Math.PI * 2,
        elev: ((i % 7) - 3) * 0.24,
        speed: 2.2 + (i % 4) * 0.45,
      });
    }
  }

  public hide(): void {
    this.group.visible = false;
  }

  public update(
    mode: 'spawn' | 'death',
    progress01: number,
    dt: number,
    centerX: number,
    centerY: number,
    centerZ: number,
  ): void {
    const t = THREE.MathUtils.clamp(progress01, 0, 1);
    if (t >= 1) {
      this.group.visible = false;
      return;
    }

    this.group.visible = true;
    this.group.position.set(centerX, centerY, centerZ);
    this.spinTime += Math.min(dt, 0.05);

    // Opposite envelopes:
    // - spawn (materialization): orb starts full & radiant (u = 1), contracts inward as hero materializes (u -> 0)
    // - death (dissolution): orb grows outward from core (u = 0 -> 1), absorbing hero, peaking & dispersing at t = 1
    const u = mode === 'spawn' ? 1 - t : t;
    const sizeCurve = mode === 'spawn' ? easeInOutQuad(u) : easeOutCubic(u);
    const orbScale = 0.08 + 1.12 * sizeCurve;

    // Visibility fade so neither end pops abruptly
    const endFade =
      mode === 'spawn'
        ? Math.sin(Math.min(1, t * 4.5) * Math.PI * 0.5) * Math.pow(1 - t, 0.68)
        : Math.sin(Math.min(1, t * 4.2) * Math.PI * 0.5) *
          (t > 0.78 ? 1 - (t - 0.78) / 0.22 : 1);

    const pulse = 1 + Math.sin(this.spinTime * 9.5) * 0.055;
    this.coreMesh.scale.setScalar(orbScale * pulse);
    this.shellMesh.scale.setScalar(orbScale * (1.04 + Math.cos(this.spinTime * 7.2) * 0.04));

    this.coreMat.opacity = 0.88 * endFade;
    this.shellMat.opacity = 0.44 * endFade;

    const ringScale = orbScale * (1.06 + (1 - sizeCurve) * 0.14);
    this.ringA.scale.setScalar(ringScale);
    this.ringB.scale.setScalar(ringScale * 0.9);
    const spinDir = mode === 'spawn' ? 1 : -1;
    this.ringA.rotation.z = this.spinTime * 2.8 * spinDir;
    this.ringA.rotation.y = this.spinTime * 1.4 * spinDir;
    this.ringB.rotation.z = -this.spinTime * 2.3 * spinDir;
    this.ringB.rotation.x = -Math.PI * 0.28 + Math.sin(this.spinTime * 2.0) * 0.22;

    this.ringAMat.opacity = 0.72 * endFade;
    this.ringBMat.opacity = 0.54 * endFade;

    this.moteMat.opacity = 0.92 * endFade;
    const moteRadiusBase = 0.16 + 1.24 * Math.pow(u, 0.85);
    for (let i = 0; i < this.motes.length; i++) {
      const m = this.motes[i];
      const ang = m.phase + this.spinTime * m.speed * spinDir;
      const r = moteRadiusBase * (0.86 + 0.22 * Math.sin(this.spinTime * 4 + i));
      const yOff = m.elev * (0.4 + 0.75 * u) + Math.sin(this.spinTime * 3.5 + i) * 0.09;
      m.mesh.position.set(Math.cos(ang) * r, yOff, Math.sin(ang) * r);
      m.mesh.rotation.set(this.spinTime * 3 + i, ang, 0);
      m.mesh.scale.setScalar((0.65 + 0.5 * u) * Math.max(0.2, endFade));
    }
  }

  public dispose(): void {
    this.coreGeo.dispose();
    this.shellGeo.dispose();
    this.ringGeo.dispose();
    this.moteGeo.dispose();
    this.coreMat.dispose();
    this.shellMat.dispose();
    this.ringAMat.dispose();
    this.ringBMat.dispose();
    this.moteMat.dispose();
  }
}
