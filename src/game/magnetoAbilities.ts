import * as THREE from 'three';
import { CombatTargetProbe } from './scarletWitchAbilities';

let cachedPurpleGlowTex: THREE.CanvasTexture | null = null;
let cachedShockwaveRingTex: THREE.CanvasTexture | null = null;

function createPurpleGlowTexture(): THREE.CanvasTexture {
  if (cachedPurpleGlowTex) return cachedPurpleGlowTex;
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const half = size * 0.5;
  const grad = ctx.createRadialGradient(half, half, 2, half, half, half);
  grad.addColorStop(0.0, 'rgba(255, 240, 255, 1)');
  grad.addColorStop(0.28, 'rgba(216, 128, 255, 0.85)');
  grad.addColorStop(0.65, 'rgba(146, 42, 240, 0.35)');
  grad.addColorStop(1.0, 'rgba(70, 12, 130, 0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  cachedPurpleGlowTex = tex;
  return tex;
}

function createShockwaveRingTexture(): THREE.CanvasTexture {
  if (cachedShockwaveRingTex) return cachedShockwaveRingTex;
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const half = size * 0.5;
  const grad = ctx.createRadialGradient(half, half, half * 0.52, half, half, half * 0.98);
  grad.addColorStop(0.0, 'rgba(200, 90, 255, 0)');
  grad.addColorStop(0.6, 'rgba(186, 72, 255, 0.72)');
  grad.addColorStop(0.82, 'rgba(245, 210, 255, 0.96)');
  grad.addColorStop(1.0, 'rgba(120, 20, 195, 0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  cachedShockwaveRingTex = tex;
  return tex;
}

const DEBRIS_WEB_GEO = new THREE.BoxGeometry(0.14, 0.16, 0.76);
const DEBRIS_FLANGE_GEO = new THREE.BoxGeometry(0.32, 0.05, 0.78);
const DEBRIS_PLATE_GEO = new THREE.BoxGeometry(0.56, 0.1, 0.42);
const DEBRIS_RIB_GEO = new THREE.BoxGeometry(0.42, 0.14, 0.14);
const DEBRIS_CHUNK_GEO = new THREE.DodecahedronGeometry(0.24, 0);
const DEBRIS_BOLT_GEO = new THREE.BoxGeometry(0.42, 0.08, 0.1);

function buildMetalDebrisMesh(
  metalMat: THREE.MeshStandardMaterial,
  darkMat: THREE.MeshStandardMaterial,
  kind: number,
): THREE.Group {
  const g = new THREE.Group();
  if (kind % 3 === 0) {
    // Steel I-beam section
    const web = new THREE.Mesh(DEBRIS_WEB_GEO, metalMat);
    const flangeA = new THREE.Mesh(DEBRIS_FLANGE_GEO, darkMat);
    flangeA.position.y = 0.08;
    const flangeB = new THREE.Mesh(DEBRIS_FLANGE_GEO, darkMat);
    flangeB.position.y = -0.08;
    g.add(web, flangeA, flangeB);
  } else if (kind % 3 === 1) {
    // Jagged heavy armor plate
    const plate = new THREE.Mesh(DEBRIS_PLATE_GEO, darkMat);
    const rib = new THREE.Mesh(DEBRIS_RIB_GEO, metalMat);
    g.add(plate, rib);
  } else {
    // Chunky metallic gear/mass
    const chunk = new THREE.Mesh(DEBRIS_CHUNK_GEO, metalMat);
    chunk.scale.set(1.2, 0.65, 1.0);
    const bolt = new THREE.Mesh(DEBRIS_BOLT_GEO, darkMat);
    g.add(chunk, bolt);
  }
  return g;
}

interface MetalProjectile {
  group: THREE.Group;
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  spin: THREE.Vector3;
  age: number;
  maxAge: number;
  arcLine: THREE.Line;
}

interface ImpactBurst {
  group: THREE.Group;
  ring: THREE.Mesh;
  shards: Array<{ mesh: THREE.Object3D; vel: THREE.Vector3; spin: THREE.Vector3 }>;
  age: number;
  duration: number;
  maxRadius: number;
}

interface TornadoDebris {
  mesh: THREE.Group;
  angle: number;
  speed: number;
  radius: number;
  height: number;
  bobPhase: number;
  selfSpin: THREE.Vector3;
}

interface TornadoNpcOrbit {
  angle: number;
  angVel: number;
  radius: number;
  height: number;
  bobPhase: number;
}

interface TornadoMote {
  sprite: THREE.Sprite;
  phase: number;
  speed: number;
  radiusBias: number;
}

export class MagnetoVfxSystem {
  public readonly group = new THREE.Group();

  private readonly glowTex: THREE.CanvasTexture;
  private readonly ringTex: THREE.CanvasTexture;
  private readonly metalMat: THREE.MeshStandardMaterial;
  private readonly darkMetalMat: THREE.MeshStandardMaterial;
  private readonly stoneMainMat: THREE.MeshStandardMaterial;
  private readonly stoneShadeMat: THREE.MeshStandardMaterial;
  private readonly stoneHighlightMat: THREE.MeshStandardMaterial;
  private readonly purpleCoreMat: THREE.MeshBasicMaterial;
  private readonly lightningMat: THREE.LineBasicMaterial;
  private readonly meteorLightningMat: THREE.LineBasicMaterial;

  private readonly projectiles: MetalProjectile[] = [];
  private readonly bursts: ImpactBurst[] = [];
  private readonly impactRingGeo = new THREE.RingGeometry(0.4, 0.9, 32);
  private readonly meteorCoreGeo = new THREE.DodecahedronGeometry(1.02, 1);
  private readonly meteorLobeGeo = new THREE.DodecahedronGeometry(0.56, 0);

  // Shield visual
  private readonly shieldGroup = new THREE.Group();
  private readonly shieldRings: THREE.Mesh[] = [];
  private readonly shieldNodes: THREE.Mesh[] = [];
  private shieldBlend = 0;
  private shieldActive = false;

  // Meteor sequence state
  private meteorState: {
    phase: 'gathering' | 'launching';
    elapsed: number;
    gatherDuration: number;
    coreGroup: THREE.Group;
    boulderGroup: THREE.Group;
    aura: THREE.Sprite;
    shards: Array<{
      mesh: THREE.Object3D;
      startOffset: THREE.Vector3;
      orbitSpeed: number;
    }>;
    bolts: Array<{
      line: THREE.Line;
      baseTheta: number;
      basePhi: number;
      spanTheta: number;
      spanPhi: number;
    }>;
    currentPos: THREE.Vector3;
    startPos: THREE.Vector3;
    targetPos: THREE.Vector3;
    launchSpeed: number;
  } | null = null;

  // Metal tornado state
  private tornadoActive = false;
  private readonly tornadoGroup = new THREE.Group();
  private readonly tornadoDebris: TornadoDebris[] = [];
  private readonly tornadoBolts: THREE.Line[] = [];
  private readonly tornadoRings: THREE.Mesh[] = [];
  private readonly tornadoRibbons: THREE.Line[] = [];
  private readonly tornadoMotes: TornadoMote[] = [];
  private tornadoBlend = 0;
  private tornadoDamageTimer = 0;
  private readonly tornadoOrbits = new Map<string, TornadoNpcOrbit>();
  private readonly tornadoReleasedIds = new Set<string>();

  private readonly _tmpA = new THREE.Vector3();
  private readonly _tmpB = new THREE.Vector3();
  private readonly _tmpPos = new THREE.Vector3();
  private readonly _tmpDir = new THREE.Vector3();
  private readonly _activeIds = new Set<string>();
  private animTime = 0;

  constructor() {
    this.glowTex = createPurpleGlowTexture();
    this.ringTex = createShockwaveRingTexture();

    this.metalMat = new THREE.MeshStandardMaterial({
      color: 0xb6becb,
      roughness: 0.24,
      metalness: 0.92,
    });
    this.darkMetalMat = new THREE.MeshStandardMaterial({
      color: 0x4b5364,
      roughness: 0.38,
      metalness: 0.85,
      emissive: new THREE.Color(0x3a0f5c),
      emissiveIntensity: 0.25,
    });
    // Stylized cartoon boulder palette (warm slate-umber & chiseled highlights)
    this.stoneMainMat = new THREE.MeshStandardMaterial({
      color: 0x6f6866,
      roughness: 0.86,
      metalness: 0.08,
      flatShading: true,
    });
    this.stoneShadeMat = new THREE.MeshStandardMaterial({
      color: 0x4c474a,
      roughness: 0.9,
      metalness: 0.1,
      flatShading: true,
    });
    this.stoneHighlightMat = new THREE.MeshStandardMaterial({
      color: 0x8e8682,
      roughness: 0.8,
      metalness: 0.06,
      flatShading: true,
    });
    this.purpleCoreMat = new THREE.MeshBasicMaterial({
      color: 0xd06bff,
      transparent: true,
      opacity: 0.45,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    this.lightningMat = new THREE.LineBasicMaterial({
      color: 0xe299ff,
      transparent: true,
      opacity: 0.88,
      blending: THREE.AdditiveBlending,
    });
    this.meteorLightningMat = new THREE.LineBasicMaterial({
      color: 0xdc88ff,
      transparent: true,
      opacity: 0.68,
      blending: THREE.AdditiveBlending,
    });

    this.impactRingGeo.rotateX(-Math.PI / 2);
    this.initShieldVisual();
    this.initTornadoVisual();
  }

  private initShieldVisual(): void {
    this.shieldGroup.visible = false;

    // 3 thin rotating orbital magnetic field rings (never obscures character inside)
    const ringGeoA = new THREE.TorusGeometry(1.18, 0.022, 8, 44);
    const ringGeoB = new THREE.TorusGeometry(1.06, 0.018, 8, 40);
    const ringGeoC = new THREE.TorusGeometry(1.26, 0.016, 8, 44);
    const matA = new THREE.MeshBasicMaterial({
      color: 0xd06bff,
      transparent: true,
      opacity: 0.72,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const matB = matA.clone();
    matB.color.setHex(0xf2ccff);
    const matC = matA.clone();
    matC.color.setHex(0x9a3bff);

    const r1 = new THREE.Mesh(ringGeoA, matA);
    r1.rotation.x = Math.PI * 0.42;
    const r2 = new THREE.Mesh(ringGeoB, matB);
    r2.rotation.set(Math.PI * 0.28, Math.PI * 0.32, 0);
    const r3 = new THREE.Mesh(ringGeoC, matC);
    r3.rotation.set(-Math.PI * 0.35, 0, Math.PI * 0.2);

    this.shieldRings.push(r1, r2, r3);
    this.shieldGroup.add(r1, r2, r3);

    // Subtle translucent geodesic magnetic shell
    const domeGeo = new THREE.IcosahedronGeometry(1.18, 1);
    const domeMat = new THREE.MeshBasicMaterial({
      color: 0xc26bff,
      wireframe: true,
      transparent: true,
      opacity: 0.18,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const dome = new THREE.Mesh(domeGeo, domeMat);
    this.shieldRings.push(dome);
    this.shieldGroup.add(dome);

    // Orbiting small metallic rivets on field perimeter
    const rivetGeo = new THREE.OctahedronGeometry(0.065, 0);
    for (let i = 0; i < 6; i++) {
      const m = new THREE.Mesh(rivetGeo, this.metalMat);
      this.shieldNodes.push(m);
      this.shieldGroup.add(m);
    }

    this.group.add(this.shieldGroup);
  }

  private initTornadoVisual(): void {
    this.tornadoGroup.visible = false;

    // 1. Smooth glowing translucent purple magnetic vortex rings at tiered funnel radii
    const ringSpecs: Array<{ r: number; tube: number; y: number; color: number; op: number }> = [
      { r: 1.55, tube: 0.045, y: 0.28, color: 0xbf63ff, op: 0.56 },
      { r: 2.35, tube: 0.052, y: 1.25, color: 0xd98cff, op: 0.52 },
      { r: 3.35, tube: 0.048, y: 2.55, color: 0xe9b8ff, op: 0.46 },
      { r: 4.45, tube: 0.042, y: 3.95, color: 0xa64dff, op: 0.38 },
    ];
    for (const spec of ringSpecs) {
      const geo = new THREE.TorusGeometry(spec.r, spec.tube, 10, 48);
      geo.rotateX(Math.PI * 0.5);
      const mat = new THREE.MeshBasicMaterial({
        color: spec.color,
        transparent: true,
        opacity: spec.op,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      });
      const ring = new THREE.Mesh(geo, mat);
      ring.position.y = spec.y;
      this.tornadoRings.push(ring);
      this.tornadoGroup.add(ring);
    }

    // 2. Two continuous spiraling purple energy ribbons wrapping up the funnel
    for (let r = 0; r < 2; r++) {
      const pts: THREE.Vector3[] = [];
      for (let s = 0; s < 38; s++) pts.push(new THREE.Vector3());
      const geo = new THREE.BufferGeometry().setFromPoints(pts);
      const mat = new THREE.LineBasicMaterial({
        color: r === 0 ? 0xf0ccff : 0xc068ff,
        transparent: true,
        opacity: r === 0 ? 0.65 : 0.48,
        blending: THREE.AdditiveBlending,
      });
      const ribbon = new THREE.Line(geo, mat);
      this.tornadoRibbons.push(ribbon);
      this.tornadoGroup.add(ribbon);
    }

    // 3. Orbiting steel debris (beams, plates, chunks) following smooth tapered funnel
    for (let i = 0; i < 28; i++) {
      const mesh = buildMetalDebrisMesh(this.metalMat, this.darkMetalMat, i);
      const t = i / 28;
      const scale = 0.6 + Math.random() * 0.58;
      mesh.scale.setScalar(scale);
      this.tornadoGroup.add(mesh);
      this.tornadoDebris.push({
        mesh,
        angle: (i * Math.PI * 2) / 5.5 + Math.random() * 0.4,
        speed: 4.2 + (1 - t) * 3.6 + Math.random() * 1.1,
        radius: 1.55 + t * 3.35 + (Math.random() - 0.5) * 0.45,
        height: 0.42 + t * 4.05,
        bobPhase: Math.random() * Math.PI * 2,
        selfSpin: new THREE.Vector3(
          (Math.random() - 0.5) * 5.2,
          (Math.random() - 0.5) * 5.2,
          (Math.random() - 0.5) * 5.2,
        ),
      });
    }

    // 4. 16 luminous rising purple magnetic motes swirling cleanly upward
    for (let m = 0; m < 16; m++) {
      const spMat = new THREE.SpriteMaterial({
        map: this.glowTex,
        color: m % 2 === 0 ? 0xf2c9ff : 0xc166ff,
        transparent: true,
        opacity: 0,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      });
      const sprite = new THREE.Sprite(spMat);
      sprite.scale.setScalar(0.55 + (m % 3) * 0.18);
      this.tornadoGroup.add(sprite);
      this.tornadoMotes.push({
        sprite,
        phase: (m / 16) * Math.PI * 2,
        speed: 0.42 + (m % 4) * 0.08,
        radiusBias: (m % 2 === 0 ? 1 : -1) * 0.25,
      });
    }

    // 5. 8 smooth spiraling purple lightning arcs inside tornado funnel
    for (let b = 0; b < 8; b++) {
      const pts: THREE.Vector3[] = [];
      for (let s = 0; s < 10; s++) pts.push(new THREE.Vector3());
      const geo = new THREE.BufferGeometry().setFromPoints(pts);
      const line = new THREE.Line(geo, this.lightningMat);
      this.tornadoBolts.push(line);
      this.tornadoGroup.add(line);
    }

    this.group.add(this.tornadoGroup);
  }

  public setShieldActive(active: boolean): void {
    this.shieldActive = active;
  }

  public isMeteorBusy(): boolean {
    return this.meteorState !== null;
  }

  public isTornadoActive(): boolean {
    return this.tornadoActive;
  }

  public spawnMetalProjectile(origin: THREE.Vector3, target: THREE.Vector3, indexSeed = 0): void {
    const g = new THREE.Group();
    const chunk = buildMetalDebrisMesh(this.metalMat, this.darkMetalMat, indexSeed);
    chunk.scale.setScalar(0.95);
    g.add(chunk);

    const glow = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: this.glowTex,
        transparent: true,
        opacity: 0.85,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    );
    glow.scale.setScalar(1.05);
    g.add(glow);

    const pts = Array.from({ length: 6 }, () => new THREE.Vector3());
    const arcLine = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints(pts),
      this.lightningMat,
    );
    g.add(arcLine);

    g.position.copy(origin);
    this.group.add(g);

    const dir = this._tmpDir.copy(target).sub(origin);
    if (dir.lengthSq() < 0.001) dir.set(0, 0, -1);
    dir.normalize();

    this.projectiles.push({
      group: g,
      pos: origin.clone(),
      vel: dir.clone().multiplyScalar(31),
      spin: new THREE.Vector3(6.5, 9.2, 4.4),
      age: 0,
      maxAge: 1.4,
      arcLine,
    });
  }

  private buildTwistedMetalFragment(seed: number): THREE.Group {
    const g = new THREE.Group();
    const matA = seed % 2 === 0 ? this.metalMat : this.darkMetalMat;
    const matB = seed % 2 === 0 ? this.darkMetalMat : this.metalMat;

    if (seed % 3 === 0) {
      // Twisted I-beam / girder jutting out with bent tip
      const baseSeg = new THREE.Mesh(DEBRIS_WEB_GEO, matA);
      baseSeg.scale.set(0.85, 0.9, 0.72);
      const bentTip = new THREE.Mesh(DEBRIS_FLANGE_GEO, matB);
      bentTip.position.set(0.06, 0.04, 0.3);
      bentTip.rotation.set(0.32, 0.24, 0.48);
      bentTip.scale.set(0.75, 1.1, 0.55);
      g.add(baseSeg, bentTip);
    } else if (seed % 3 === 1) {
      // Folded / warped armor shard
      const plateA = new THREE.Mesh(DEBRIS_PLATE_GEO, matA);
      plateA.scale.set(0.68, 0.9, 0.64);
      const plateB = new THREE.Mesh(DEBRIS_RIB_GEO, matB);
      plateB.position.set(0.1, 0.05, 0.08);
      plateB.rotation.set(0.28, -0.38, 0.42);
      plateB.scale.set(0.9, 0.85, 1.15);
      g.add(plateA, plateB);
    } else {
      // Jagged rebar / bent rod cluster
      const rodA = new THREE.Mesh(DEBRIS_BOLT_GEO, matA);
      rodA.scale.set(1.15, 0.9, 0.95);
      const rodB = new THREE.Mesh(DEBRIS_BOLT_GEO, matB);
      rodB.position.set(0.14, 0.03, 0.04);
      rodB.rotation.set(0.45, 0.5, -0.35);
      rodB.scale.set(0.82, 0.8, 0.85);
      g.add(rodA, rodB);
    }
    return g;
  }

  public startMeteorSequence(playerPos: THREE.Vector3, aimTargetPos: THREE.Vector3): boolean {
    if (this.meteorState) return false;

    const coreGroup = new THREE.Group();
    const corePos = new THREE.Vector3(playerPos.x, playerPos.y + 4.1, playerPos.z);
    coreGroup.position.copy(corePos);

    // Stylized cartoon boulder composite + randomly sized twisted embedded metal fragments
    const boulderGroup = new THREE.Group();
    const mainRock = new THREE.Mesh(this.meteorCoreGeo, this.stoneMainMat);
    mainRock.scale.set(1.06, 0.95, 1.02);
    boulderGroup.add(mainRock);

    const lobeSpecs: Array<{ pos: [number, number, number]; scale: [number, number, number]; shade: number }> = [
      { pos: [0.56, 0.34, 0.28], scale: [1.05, 0.88, 0.92], shade: 0 },
      { pos: [-0.54, -0.26, 0.36], scale: [0.95, 1.02, 0.85], shade: 1 },
      { pos: [-0.28, 0.52, -0.45], scale: [0.88, 0.78, 0.96], shade: 2 },
      { pos: [0.36, -0.48, -0.42], scale: [0.92, 0.82, 0.9], shade: 1 },
      { pos: [0.05, 0.06, 0.62], scale: [0.84, 0.86, 0.72], shade: 2 },
    ];
    for (const l of lobeSpecs) {
      const mat =
        l.shade === 0
          ? this.stoneHighlightMat
          : l.shade === 1
            ? this.stoneShadeMat
            : this.stoneMainMat;
      const lobe = new THREE.Mesh(this.meteorLobeGeo, mat);
      lobe.position.set(l.pos[0], l.pos[1], l.pos[2]);
      lobe.scale.set(l.scale[0], l.scale[1], l.scale[2]);
      lobe.rotation.set(l.pos[1], l.pos[0], l.pos[2]);
      boulderGroup.add(lobe);
    }

    // 12 randomly sized, twisted metal fragments embedded directly into the stone crust
    const goldenAngle = Math.PI * (3 - Math.sqrt(5));
    for (let f = 0; f < 12; f++) {
      const yNorm = 1 - (f / 11) * 2;
      const rRing = Math.sqrt(Math.max(0.05, 1 - yNorm * yNorm));
      const theta = goldenAngle * f + (Math.random() - 0.5) * 0.45;
      const nx = Math.cos(theta) * rRing;
      const ny = yNorm;
      const nz = Math.sin(theta) * rRing;

      const frag = this.buildTwistedMetalFragment(f);
      const embedDist = 0.72 + Math.random() * 0.24;
      frag.position.set(nx * embedDist, ny * embedDist, nz * embedDist);
      frag.lookAt(nx * 2.5, ny * 2.5, nz * 2.5);
      frag.rotateX((Math.random() - 0.5) * 1.1);
      frag.rotateY((Math.random() - 0.5) * 1.1);
      frag.rotateZ((Math.random() - 0.5) * 1.6);
      const fragScale = 0.55 + Math.random() * 0.88;
      frag.scale.set(
        fragScale * (0.85 + Math.random() * 0.35),
        fragScale * (0.85 + Math.random() * 0.35),
        fragScale * (0.95 + Math.random() * 0.45),
      );
      boulderGroup.add(frag);
    }

    boulderGroup.scale.setScalar(0.18);
    coreGroup.add(boulderGroup);

    // Subtle soft purple magnetic aura around the meteor
    const aura = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: this.glowTex,
        transparent: true,
        opacity: 0.62,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    );
    aura.scale.setScalar(2.45);
    coreGroup.add(aura);

    const shards: Array<{ mesh: THREE.Object3D; startOffset: THREE.Vector3; orbitSpeed: number }> = [];
    for (let i = 0; i < 14; i++) {
      const m = buildMetalDebrisMesh(this.metalMat, this.darkMetalMat, i);
      const ang = (i / 14) * Math.PI * 2;
      const rad = 2.5 + Math.random() * 2.3;
      const startOffset = new THREE.Vector3(
        Math.cos(ang) * rad,
        -3.0 + Math.random() * 1.7,
        Math.sin(ang) * rad,
      );
      m.position.copy(startOffset);
      coreGroup.add(m);
      shards.push({
        mesh: m,
        startOffset,
        orbitSpeed: (i % 2 === 0 ? 1 : -1) * (3.4 + Math.random() * 2.2),
      });
    }

    // 6 subtle animated purple magnetic lightning bolts arcing smoothly across stone surface
    const bolts: Array<{
      line: THREE.Line;
      baseTheta: number;
      basePhi: number;
      spanTheta: number;
      spanPhi: number;
    }> = [];
    for (let b = 0; b < 6; b++) {
      const pts = Array.from({ length: 7 }, () => new THREE.Vector3());
      const line = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints(pts),
        this.meteorLightningMat,
      );
      coreGroup.add(line);
      bolts.push({
        line,
        baseTheta: (b / 6) * Math.PI * 2,
        basePhi: 0.55 + (b % 3) * 0.55,
        spanTheta: 1.05 + (b % 2) * 0.45,
        spanPhi: ((b % 2 === 0 ? 1 : -1) * 0.65),
      });
    }

    this.group.add(coreGroup);

    this.meteorState = {
      phase: 'gathering',
      elapsed: 0,
      gatherDuration: 1.05,
      coreGroup,
      boulderGroup,
      aura,
      shards,
      bolts,
      currentPos: corePos.clone(),
      startPos: corePos.clone(),
      targetPos: new THREE.Vector3(aimTargetPos.x, Math.max(0.45, aimTargetPos.y), aimTargetPos.z),
      launchSpeed: 32,
    };
    return true;
  }

  public setTornadoActive(active: boolean): void {
    this.tornadoActive = active;
    if (active) {
      this.tornadoGroup.visible = true;
    } else {
      this.tornadoGroup.visible = false;
      this.tornadoBlend = 0;
      this.tornadoDamageTimer = 0;
    }
  }

  private spawnImpactBurst(pos: THREE.Vector3, maxRadius: number, shardCount: number): void {
    const g = new THREE.Group();
    g.position.set(pos.x, Math.max(0.08, pos.y), pos.z);

    const ringMat = new THREE.MeshBasicMaterial({
      color: 0xd478ff,
      transparent: true,
      opacity: 0.9,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const ring = new THREE.Mesh(this.impactRingGeo, ringMat);
    g.add(ring);

    const shards: Array<{ mesh: THREE.Object3D; vel: THREE.Vector3; spin: THREE.Vector3 }> = [];
    for (let i = 0; i < shardCount; i++) {
      const m = buildMetalDebrisMesh(this.metalMat, this.darkMetalMat, i);
      m.scale.setScalar(0.55 + Math.random() * 0.55);
      const ang = Math.random() * Math.PI * 2;
      const spd = 4.5 + Math.random() * 7.5;
      g.add(m);
      shards.push({
        mesh: m,
        vel: new THREE.Vector3(Math.cos(ang) * spd, 4.5 + Math.random() * 6.5, Math.sin(ang) * spd),
        spin: new THREE.Vector3(
          (Math.random() - 0.5) * 14,
          (Math.random() - 0.5) * 14,
          (Math.random() - 0.5) * 14,
        ),
      });
    }

    this.group.add(g);
    this.bursts.push({
      group: g,
      ring,
      shards,
      age: 0,
      duration: maxRadius > 3 ? 0.85 : 0.45,
      maxRadius,
    });
  }

  private randomizeLightning(line: THREE.Line, a: THREE.Vector3, b: THREE.Vector3, jitter: number): void {
    const posAttr = line.geometry.getAttribute('position') as THREE.BufferAttribute;
    const count = posAttr.count;
    for (let i = 0; i < count; i++) {
      const t = i / (count - 1);
      const env = Math.sin(t * Math.PI);
      posAttr.setXYZ(
        i,
        THREE.MathUtils.lerp(a.x, b.x, t) + (Math.random() - 0.5) * jitter * env,
        THREE.MathUtils.lerp(a.y, b.y, t) + (Math.random() - 0.5) * jitter * env,
        THREE.MathUtils.lerp(a.z, b.z, t) + (Math.random() - 0.5) * jitter * env,
      );
    }
    posAttr.needsUpdate = true;
  }

  public update(
    dt: number,
    playerPos: THREE.Vector3,
    targets: ReadonlyArray<CombatTargetProbe>,
    callbacks: {
      onProjectileHit: (targetId: string, hitDir: THREE.Vector3, damage: number) => void;
      onMeteorLaunch?: () => void;
      onMeteorImpact: (impactPos: THREE.Vector3) => void;
      onTornadoControl?: (
        id: string,
        pos: THREE.Vector3,
        yaw: number,
        tickDamage: number,
      ) => void;
      onTornadoRelease?: (id: string) => void;
    },
  ): void {
    const safeDt = Math.min(dt, 0.05);
    this.animTime += safeDt;

    // 1. Magnetic Shield around Magneto
    this.shieldBlend = THREE.MathUtils.damp(
      this.shieldBlend,
      this.shieldActive ? 1 : 0,
      14,
      safeDt,
    );
    this.shieldGroup.visible = this.shieldBlend > 0.02;
    if (this.shieldGroup.visible) {
      this.shieldGroup.position.set(playerPos.x, playerPos.y + 1.02, playerPos.z);
      this.shieldGroup.scale.setScalar(0.7 + this.shieldBlend * 0.3);
      if (this.shieldRings[0]) this.shieldRings[0].rotation.z += safeDt * 2.4;
      if (this.shieldRings[1]) this.shieldRings[1].rotation.y -= safeDt * 3.1;
      if (this.shieldRings[2]) this.shieldRings[2].rotation.x += safeDt * 1.9;
      if (this.shieldRings[3]) this.shieldRings[3].rotation.y += safeDt * 0.9;
      for (let i = 0; i < this.shieldNodes.length; i++) {
        const ang = this.animTime * 3.2 + (i * Math.PI * 2) / this.shieldNodes.length;
        const elev = Math.sin(this.animTime * 2.5 + i) * 0.45;
        this.shieldNodes[i].position.set(
          Math.cos(ang) * 1.18,
          elev,
          Math.sin(ang) * 1.18,
        );
        this.shieldNodes[i].rotation.y += safeDt * 4;
      }
    }

    // 2. Metal Projectiles
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const p = this.projectiles[i];
      p.age += safeDt;
      p.pos.addScaledVector(p.vel, safeDt);
      p.group.position.copy(p.pos);
      p.group.children[0].rotation.x += p.spin.x * safeDt;
      p.group.children[0].rotation.y += p.spin.y * safeDt;
      p.group.children[0].rotation.z += p.spin.z * safeDt;

      this._tmpA.set(-0.35, -0.1, -0.35);
      this._tmpB.set(0.35, 0.1, 0.35);
      this.randomizeLightning(p.arcLine, this._tmpA, this._tmpB, 0.38);

      let hitTargetId: string | null = null;
      for (const t of targets) {
        const dx = p.pos.x - t.position.x;
        const dy = p.pos.y - (t.position.y + 1.0);
        const dz = p.pos.z - t.position.z;
        if (dx * dx + dy * dy + dz * dz <= 0.85 * 0.85) {
          hitTargetId = t.id;
          break;
        }
      }

      if (hitTargetId) {
        this._tmpDir.copy(p.vel).setY(0).normalize();
        callbacks.onProjectileHit(hitTargetId, this._tmpDir, 30);
        this.spawnImpactBurst(p.pos, 1.9, 6);
        this.disposeProjectile(p);
        this.projectiles.splice(i, 1);
      } else if (p.pos.y <= 0.14 || p.age >= p.maxAge) {
        this.spawnImpactBurst(p.pos, 1.8, 6);
        this.disposeProjectile(p);
        this.projectiles.splice(i, 1);
      }
    }

    // 3. Magnetic Meteor
    if (this.meteorState) {
      const ms = this.meteorState;
      ms.elapsed += safeDt;
      if (ms.phase === 'gathering') {
        const u = Math.min(1, ms.elapsed / ms.gatherDuration);
        const eased = 1 - Math.pow(1 - u, 2.2);
        const gatherCenter = this._tmpPos.set(playerPos.x, playerPos.y + 4.05, playerPos.z);
        ms.coreGroup.position.copy(gatherCenter);
        const boulderScale = 0.22 + eased * 1.06;
        ms.boulderGroup.scale.setScalar(boulderScale);
        ms.boulderGroup.rotation.y += safeDt * 1.9;
        ms.boulderGroup.rotation.x += safeDt * 0.7;

        ms.aura.scale.setScalar(1.6 + eased * 1.2 + Math.sin(this.animTime * 9) * 0.12);
        (ms.aura.material as THREE.SpriteMaterial).opacity = 0.42 + eased * 0.24;

        for (const s of ms.shards) {
          const rotAng = this.animTime * s.orbitSpeed;
          const shrink = Math.pow(1 - u, 0.8);
          const ox =
            (s.startOffset.x * Math.cos(rotAng) - s.startOffset.z * Math.sin(rotAng)) *
            shrink;
          const oz =
            (s.startOffset.x * Math.sin(rotAng) + s.startOffset.z * Math.cos(rotAng)) *
            shrink;
          const oy = s.startOffset.y * shrink;
          s.mesh.position.set(ox, oy, oz);
          s.mesh.rotation.x += safeDt * 6;
          s.mesh.rotation.y += safeDt * 5;
          s.mesh.scale.setScalar(1 - u * 0.38);
        }

        // Subtle animated purple magnetic arcs crawling softly around the forming boulder
        const surfaceR = 1.15 * boulderScale;
        for (let bi = 0; bi < ms.bolts.length; bi++) {
          const bolt = ms.bolts[bi];
          const posAttr = bolt.line.geometry.getAttribute('position') as THREE.BufferAttribute;
          const count = posAttr.count;
          const tShift = this.animTime * (1.8 + bi * 0.35);
          for (let k = 0; k < count; k++) {
            const p = k / (count - 1);
            const env = Math.sin(p * Math.PI);
            const th = bolt.baseTheta + tShift + p * bolt.spanTheta;
            const ph = bolt.basePhi + Math.sin(tShift * 0.7 + p * 3.1) * 0.25 + p * bolt.spanPhi;
            const r = surfaceR + env * (0.14 + Math.sin(this.animTime * 19 + k * 2.1 + bi) * 0.08);
            const sinP = Math.sin(ph);
            posAttr.setXYZ(
              k,
              Math.cos(th) * sinP * r,
              Math.cos(ph) * r,
              Math.sin(th) * sinP * r,
            );
          }
          posAttr.needsUpdate = true;
        }

        if (u >= 1) {
          ms.phase = 'launching';
          ms.startPos.copy(gatherCenter);
          ms.currentPos.copy(gatherCenter);
          callbacks.onMeteorLaunch?.();
        }
      } else {
        const toTarget = this._tmpDir.copy(ms.targetPos).sub(ms.currentPos);
        const dist = toTarget.length();
        const step = ms.launchSpeed * safeDt;
        ms.boulderGroup.rotation.x += safeDt * 4.8;
        ms.boulderGroup.rotation.y += safeDt * 2.4;
        ms.boulderGroup.rotation.z += safeDt * 3.4;
        ms.aura.scale.setScalar(2.85 + Math.sin(this.animTime * 14) * 0.16);

        // Subtle crackling surface lightning hugging the hurtling stone
        const surfaceR = 1.44;
        for (let bi = 0; bi < ms.bolts.length; bi++) {
          const bolt = ms.bolts[bi];
          const posAttr = bolt.line.geometry.getAttribute('position') as THREE.BufferAttribute;
          const count = posAttr.count;
          const tShift = this.animTime * (3.2 + bi * 0.5);
          for (let k = 0; k < count; k++) {
            const p = k / (count - 1);
            const env = Math.sin(p * Math.PI);
            const th = bolt.baseTheta + tShift + p * bolt.spanTheta;
            const ph = bolt.basePhi + Math.cos(tShift * 0.9 + p * 3.4) * 0.3 + p * bolt.spanPhi;
            const r = surfaceR + env * (0.18 + Math.sin(this.animTime * 24 + k * 2.5 + bi) * 0.1);
            const sinP = Math.sin(ph);
            posAttr.setXYZ(
              k,
              Math.cos(th) * sinP * r,
              Math.cos(ph) * r,
              Math.sin(th) * sinP * r,
            );
          }
          posAttr.needsUpdate = true;
        }

        if (step >= dist || ms.currentPos.y <= 0.55) {
          const impact = this._tmpPos.copy(ms.targetPos);
          impact.y = Math.max(0.1, impact.y);
          this.spawnImpactBurst(impact, 6.2, 22);
          callbacks.onMeteorImpact(impact);
          this.disposeMeteor();
        } else {
          ms.currentPos.addScaledVector(toTarget.normalize(), step);
          ms.coreGroup.position.copy(ms.currentPos);
        }
      }
    }

    // 4. Metal Tornado (Smooth glowing purple energy funnel + swirling metal debris)
    if (this.tornadoActive) {
      this.tornadoBlend = THREE.MathUtils.damp(this.tornadoBlend, 1, 9.5, safeDt);
      this.tornadoGroup.position.copy(playerPos);
      this.tornadoGroup.scale.setScalar(0.35 + this.tornadoBlend * 0.65);

      // Animate smooth purple funnel halo rings with subtle breathing & orbital tilt
      for (let ri = 0; ri < this.tornadoRings.length; ri++) {
        const ring = this.tornadoRings[ri];
        const breath = 1 + Math.sin(this.animTime * 3.4 - ri * 0.9) * 0.06;
        ring.scale.setScalar(breath);
        ring.rotation.y = this.animTime * (2.6 + ri * 0.55) * (ri % 2 === 0 ? 1 : -1);
        ring.rotation.x = Math.sin(this.animTime * 2.1 + ri * 1.4) * 0.08;
        ring.rotation.z = Math.cos(this.animTime * 1.9 + ri * 1.1) * 0.08;
        const mat = ring.material as THREE.MeshBasicMaterial;
        mat.opacity = (0.48 - ri * 0.05 + Math.sin(this.animTime * 5 + ri) * 0.07) * this.tornadoBlend;
      }

      // Animate 2 smooth continuous rising purple energy spiral ribbons
      for (let ri = 0; ri < this.tornadoRibbons.length; ri++) {
        const ribbon = this.tornadoRibbons[ri];
        const posAttr = ribbon.geometry.getAttribute('position') as THREE.BufferAttribute;
        const count = posAttr.count;
        const baseAng = this.animTime * 4.4 + ri * Math.PI;
        for (let k = 0; k < count; k++) {
          const u = k / (count - 1);
          const ang = baseAng + u * Math.PI * 5.2;
          const rad = 1.4 + u * 3.15 + Math.sin(this.animTime * 3.2 - u * 4.0 + ri) * 0.16;
          const y = 0.25 + u * 4.05;
          posAttr.setXYZ(k, Math.cos(ang) * rad, y, Math.sin(ang) * rad);
        }
        posAttr.needsUpdate = true;
      }

      // Smooth debris orbiting & banking along tapered vortex
      for (const d of this.tornadoDebris) {
        d.angle += d.speed * safeDt;
        const bob = Math.sin(this.animTime * 3.2 + d.bobPhase) * 0.22;
        const radialBreath = d.radius + Math.sin(this.animTime * 2.6 + d.bobPhase) * 0.22;
        d.mesh.position.set(
          Math.cos(d.angle) * radialBreath,
          d.height + bob,
          Math.sin(d.angle) * radialBreath,
        );
        d.mesh.rotation.x += d.selfSpin.x * safeDt;
        d.mesh.rotation.y += d.selfSpin.y * safeDt;
        d.mesh.rotation.z += d.selfSpin.z * safeDt;
      }

      // Rising glowing purple magnetic motes circling upward smoothly
      for (let mi = 0; mi < this.tornadoMotes.length; mi++) {
        const m = this.tornadoMotes[mi];
        const cycle = (this.animTime * m.speed + mi * 0.0625) % 1;
        const ang = m.phase + this.animTime * (4.8 - cycle * 1.4);
        const rad = 1.35 + cycle * 3.1 + m.radiusBias;
        m.sprite.position.set(Math.cos(ang) * rad, 0.2 + cycle * 4.1, Math.sin(ang) * rad);
        const fade = Math.sin(cycle * Math.PI);
        (m.sprite.material as THREE.SpriteMaterial).opacity = 0.78 * fade * this.tornadoBlend;
      }

      // Smooth phase-continuous spiraling purple lightning bolts (no harsh static jump)
      for (let b = 0; b < this.tornadoBolts.length; b++) {
        const line = this.tornadoBolts[b];
        const posAttr = line.geometry.getAttribute('position') as THREE.BufferAttribute;
        const count = posAttr.count;
        const a0 = this.animTime * 5.2 + (b * Math.PI * 2) / this.tornadoBolts.length;
        for (let s = 0; s < count; s++) {
          const u = s / (count - 1);
          const env = Math.sin(u * Math.PI);
          const ang = a0 + u * 1.45 + Math.sin(this.animTime * 11 + b * 1.7 + s * 1.9) * 0.16 * env;
          const rad = (1.6 + u * 2.95) + Math.cos(this.animTime * 14 + s * 2.3 + b) * 0.24 * env;
          const y = 0.3 + u * 3.9 + Math.sin(this.animTime * 12 + s * 1.5 + b) * 0.14 * env;
          posAttr.setXYZ(s, Math.cos(ang) * rad, y, Math.sin(ang) * rad);
        }
        posAttr.needsUpdate = true;
      }

      // Continuous pull & orbit damage
      this.tornadoDamageTimer += safeDt;
      const shouldTickDamage = this.tornadoDamageTimer >= 0.6;
      if (shouldTickDamage) {
        this.tornadoDamageTimer -= 0.6;
      }

      this._activeIds.clear();
      for (const t of targets) {
        const distHz = Math.hypot(t.position.x - playerPos.x, t.position.z - playerPos.z);
        if (distHz <= 8.5 || this.tornadoOrbits.has(t.id)) {
          if (distHz <= 9.6) {
            this._activeIds.add(t.id);
            let orb = this.tornadoOrbits.get(t.id);
            if (!orb) {
              orb = {
                angle: Math.atan2(t.position.z - playerPos.z, t.position.x - playerPos.x),
                angVel: (Math.random() > 0.5 ? 1 : -1) * (3.6 + Math.random() * 2.2),
                radius: 2.2 + Math.random() * 2.0,
                height: 0.75 + Math.random() * 1.55,
                bobPhase: Math.random() * Math.PI * 2,
              };
              this.tornadoOrbits.set(t.id, orb);
            }
            orb.angle += orb.angVel * safeDt;
            this._tmpPos.set(
              playerPos.x + Math.cos(orb.angle) * orb.radius,
              orb.height + Math.sin(this.animTime * 5 + orb.bobPhase) * 0.45,
              playerPos.z + Math.sin(orb.angle) * orb.radius,
            );
            callbacks.onTornadoControl?.(
              t.id,
              this._tmpPos,
              orb.angle + Math.PI * 0.5,
              shouldTickDamage ? 8 : 0,
            );
          }
        }
      }

      for (const prevId of this.tornadoOrbits.keys()) {
        if (!this._activeIds.has(prevId)) {
          this.tornadoOrbits.delete(prevId);
          callbacks.onTornadoRelease?.(prevId);
        }
      }
    } else if (this.tornadoOrbits.size > 0) {
      for (const id of this.tornadoOrbits.keys()) {
        callbacks.onTornadoRelease?.(id);
      }
      this.tornadoOrbits.clear();
      this.tornadoReleasedIds.clear();
    }

    // 5. Impact Bursts
    for (let i = this.bursts.length - 1; i >= 0; i--) {
      const b = this.bursts[i];
      b.age += safeDt;
      const p = Math.min(1, b.age / b.duration);
      const r = 0.5 + p * b.maxRadius;
      b.ring.scale.setScalar(r);
      (b.ring.material as THREE.MeshBasicMaterial).opacity = (1 - p) * 0.85;

      for (const s of b.shards) {
        s.vel.y -= 18 * safeDt;
        s.mesh.position.addScaledVector(s.vel, safeDt);
        if (s.mesh.position.y < 0.08) {
          s.mesh.position.y = 0.08;
          s.vel.y *= -0.35;
          s.vel.x *= 0.7;
          s.vel.z *= 0.7;
        }
        s.mesh.rotation.x += s.spin.x * safeDt;
        s.mesh.rotation.y += s.spin.y * safeDt;
        s.mesh.scale.setScalar(Math.max(0.01, (1 - p) * 0.85));
      }

      if (p >= 1) {
        this.disposeBurst(b);
        this.bursts.splice(i, 1);
      }
    }
  }

  private disposeProjectile(p: MetalProjectile): void {
    this.group.remove(p.group);
    p.arcLine.geometry.dispose();
    const glow = p.group.children[1] as THREE.Sprite | undefined;
    if (glow) (glow.material as THREE.Material).dispose();
  }

  private disposeBurst(b: ImpactBurst): void {
    this.group.remove(b.group);
    (b.ring.material as THREE.Material).dispose();
  }

  private disposeMeteor(): void {
    const ms = this.meteorState;
    if (!ms) return;
    this.group.remove(ms.coreGroup);
    (ms.aura.material as THREE.Material).dispose();
    for (const b of ms.bolts) b.line.geometry.dispose();
    this.meteorState = null;
  }

  public clearAll(onReleaseNpc?: (id: string) => void): void {
    this.shieldActive = false;
    this.shieldBlend = 0;
    this.shieldGroup.visible = false;
    this.tornadoActive = false;
    this.tornadoBlend = 0;
    this.tornadoGroup.visible = false;
    if (onReleaseNpc) {
      for (const id of this.tornadoOrbits.keys()) {
        onReleaseNpc(id);
      }
    }
    this.tornadoOrbits.clear();
    this.disposeMeteor();
    for (const p of this.projectiles) this.disposeProjectile(p);
    this.projectiles.length = 0;
    for (const b of this.bursts) this.disposeBurst(b);
    this.bursts.length = 0;
  }

  public dispose(): void {
    this.clearAll();
    this.impactRingGeo.dispose();
    this.meteorCoreGeo.dispose();
    this.meteorLobeGeo.dispose();
    for (const r of this.shieldRings) {
      r.geometry.dispose();
      (r.material as THREE.Material).dispose();
    }
    if (this.shieldNodes[0]) {
      this.shieldNodes[0].geometry.dispose();
    }
    for (const r of this.tornadoRings) {
      r.geometry.dispose();
      (r.material as THREE.Material).dispose();
    }
    for (const rb of this.tornadoRibbons) {
      rb.geometry.dispose();
      (rb.material as THREE.Material).dispose();
    }
    for (const m of this.tornadoMotes) {
      (m.sprite.material as THREE.Material).dispose();
    }
    for (const l of this.tornadoBolts) l.geometry.dispose();
    this.metalMat.dispose();
    this.darkMetalMat.dispose();
    this.stoneMainMat.dispose();
    this.stoneShadeMat.dispose();
    this.stoneHighlightMat.dispose();
    this.purpleCoreMat.dispose();
    this.lightningMat.dispose();
    this.meteorLightningMat.dispose();
  }
}
