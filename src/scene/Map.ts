// Low-poly de_dust2 map for CS2-style 5v5 FPS.
// Builds geometry, colliders, spawns, sites, and a navigation graph.
//
// Coordinate system:
//   X = east (+) / west (-)
//   Y = up
//   Z = south (+) / north (-)
// Center of map (0, 0, 0) sits near Mid cross.
// T spawn = south-west (low X, high Z)
// CT spawn = north-east (high X, low Z)
// A site = south-east (high X, high Z)
// B site = north-west (low X, low Z)

import * as THREE from 'three';
import type { AABB, SpawnPoint, BombSiteDef } from '../types';
import { Team, BombSite } from '../types';
import { sandGround, sandWall, darkStone, woodCrate, roofTile } from './textures';

// ----------------------------------------------------------------------------
// Dust2 layout constants
// ----------------------------------------------------------------------------
export const MAP_W = 240; // total X
export const MAP_H = 220; // total Z

// Palette (low-poly, flat-ish colors)
const COLOR = {
  ground: 0xC2A26B,
  wall: 0xB89968,
  wallDark: 0x7A6346,
  roof: 0x8C6E47,
  wood: 0x6B4226,
  woodDark: 0x4F2E18,
  sandbag: 0xD9B97A,
  metal: 0x6E6E6E,
  cactus: 0x4E6E2B,
  cactusDark: 0x35501E,
  tire: 0x1A1A1A,
  barrel: 0x8A4A1E,
  barrelRust: 0x6B3712,
  concrete: 0xB0A78B,
  concreteDark: 0x7E7660,
  rock: 0x6F5A3C,
  siteA: 0xFF2D5C, // red neon
  siteB: 0x2D8CFF, // blue neon
  accent: 0xE2B14A,
  shadow: 0x2A2418,
  fog: 0xC2A26B
} as const;

// ----------------------------------------------------------------------------
// AABB helpers
// ----------------------------------------------------------------------------
function aabb(x: number, z: number, w: number, h: number, y0 = 0, y1?: number, tag?: string): AABB {
  const height = y1 !== undefined ? y1 : h;
  return {
    min: [x - w / 2, y0, z - h / 2],
    max: [x + w / 2, height, z + h / 2],
    tag
  };
}

function wallH(x: number, z: number, w: number, h: number, y1: number, tag?: string): AABB {
  return aabb(x, z, w, h, 0, y1, tag);
}

// ----------------------------------------------------------------------------
// Layout interface
// ----------------------------------------------------------------------------
export interface Dust2Layout {
  waypoints: THREE.Vector3[];
  paths: { from: number; to: number }[];
}

// ----------------------------------------------------------------------------
// Map class
// ----------------------------------------------------------------------------
export class Map {
  scene: THREE.Scene;
  colliders: AABB[] = [];
  spawns: SpawnPoint[] = [];
  sites: BombSiteDef[] = [];
  layout: Dust2Layout;

  private group: THREE.Group;
  private textures: { ground: THREE.Texture; wall: THREE.Texture; wallDark: THREE.Texture; wood: THREE.Texture; roof: THREE.Texture };

  // Cached materials
  private matGround: THREE.Material;
  private matWall: THREE.Material;
  private matWallDark: THREE.Material;
  private matRoof: THREE.Material;
  private matWood: THREE.Material;
  private matConcrete: THREE.Material;

  // Waypoint nodes (also reused as navigation)
  private waypoints: THREE.Vector3[] = [];
  private paths: { from: number; to: number }[] = [];

  // InstancedMeshes
  private crateMesh: THREE.InstancedMesh | null = null;
  private cactusMesh: THREE.InstancedMesh | null = null;
  private barrelMesh: THREE.InstancedMesh | null = null;
  private tireMesh: THREE.InstancedMesh | null = null;
  private sandbagMesh: THREE.InstancedMesh | null = null;

  constructor() {
    this.scene = new THREE.Scene();
    this.group = new THREE.Group();
    this.scene.add(this.group);

    // Sandstorm fog
    this.scene.fog = new THREE.FogExp2(COLOR.fog, 0.0035);
    this.scene.background = new THREE.Color(COLOR.fog);

    // Textures
    this.textures = {
      ground: sandGround(),
      wall: sandWall(),
      wallDark: darkStone(),
      wood: woodCrate(),
      roof: roofTile()
    };

    this.matGround = new THREE.MeshLambertMaterial({ map: this.textures.ground });
    this.matWall = new THREE.MeshLambertMaterial({ map: this.textures.wall });
    this.matWallDark = new THREE.MeshLambertMaterial({ map: this.textures.wallDark, color: 0x9C845C });
    this.matRoof = new THREE.MeshLambertMaterial({ map: this.textures.roof, color: 0xA8855A });
    this.matWood = new THREE.MeshLambertMaterial({ map: this.textures.wood });
    this.matConcrete = new THREE.MeshLambertMaterial({ color: COLOR.concrete });

    this.layout = { waypoints: [], paths: [] };
  }

  // --------------------------------------------------------------------------
  // build
  // --------------------------------------------------------------------------
  build(): void {
    this.addGround();
    this.addSkydome();

    // Skybox (light fog tint via background already)
    // Major structural blocks
    this.buildTSpawn();
    this.buildCTSpawn();
    this.buildASite();
    this.buildBSite();
    this.buildMid();
    this.buildLongA();
    this.buildShortA();
    this.buildBTunnels();
    this.buildMidDoors();
    this.buildConnectingBlocks();

    // Decoration (instanced)
    this.addDecorations();

    // Spawns, sites, waypoints
    this.buildSpawns();
    this.buildSites();
    this.buildWaypoints();

    this.layout = { waypoints: this.waypoints, paths: this.paths };
  }

  update(_dt: number): void {
    // Reserved for animated elements (bombsite lights, etc.)
  }

  // ==========================================================================
  // GROUND
  // ==========================================================================
  private addGround(): void {
    const geo = new THREE.PlaneGeometry(MAP_W, MAP_H, 1, 1);
    const mesh = new THREE.Mesh(geo, this.matGround);
    mesh.rotation.x = -Math.PI / 2;
    mesh.receiveShadow = true;
    this.group.add(mesh);

    // Far edge filler plane (so fog has something behind)
    const farGeo = new THREE.PlaneGeometry(MAP_W * 2, MAP_H * 2, 1, 1);
    const far = new THREE.Mesh(farGeo, this.matGround);
    far.rotation.x = -Math.PI / 2;
    far.position.y = -0.05;
    far.receiveShadow = true;
    this.group.add(far);
  }

  // Skydome: subtle gradient
  private addSkydome(): void {
    const skyGeo = new THREE.SphereGeometry(800, 16, 8);
    const skyMat = new THREE.MeshBasicMaterial({
      color: 0xD8B98A,
      side: THREE.BackSide,
      fog: false
    });
    const sky = new THREE.Mesh(skyGeo, skyMat);
    this.scene.add(sky);
  }

  // ==========================================================================
  // Building primitives
  // ==========================================================================
  private box(
    x: number, y: number, z: number,
    w: number, h: number, d: number,
    material: THREE.Material,
    castShadow = true, receiveShadow = true
  ): THREE.Mesh {
    const geo = new THREE.BoxGeometry(w, h, d);
    const mesh = new THREE.Mesh(geo, material);
    mesh.position.set(x, y, z);
    mesh.castShadow = castShadow;
    mesh.receiveShadow = receiveShadow;
    this.group.add(mesh);
    return mesh;
  }

  private wall(
    x: number, z: number, w: number, d: number, h: number,
    material = this.matWall, tag?: string
  ): void {
    this.box(x, h / 2, z, w, h, d, material, true, true);
    this.colliders.push(wallH(x, z, w, d, h, tag ?? 'wall'));
  }

  // Pyramid roof
  private pyramidRoof(x: number, y: number, z: number, w: number, d: number, h: number): void {
    const geo = new THREE.ConeGeometry(Math.max(w, d) * 0.72, h, 4);
    const mesh = new THREE.Mesh(geo, this.matRoof);
    mesh.position.set(x, y + h / 2, z);
    mesh.rotation.y = Math.PI / 4;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    this.group.add(mesh);
  }

  // Flat roof
  private flatRoof(x: number, y: number, z: number, w: number, d: number, h = 0.4): void {
    this.box(x, y, z, w, h, d, this.matConcrete, true, true);
  }

  // Building helper: rectangular enclosed structure with optional roof
  private building(
    cx: number, cz: number,
    w: number, d: number, h: number,
    options: {
      mat?: THREE.Material;
      roof?: 'flat' | 'pyramid' | 'none';
      tag?: string;
      openings?: { x: number; z: number; w: number; d: number }[]; // gaps for doors
    } = {}
  ): void {
    const mat = options.mat ?? this.matWall;
    const tag = options.tag ?? 'building';
    const openings = options.openings ?? [];

    const hw = w / 2, hd = d / 2;
    const t = 1.0; // wall thickness

    // North wall (z = cz - hd)
    this.makeWallWithOpenings(cx, cz - hd, w, t, h, 'z', mat, openings, tag);
    // South wall (z = cz + hd)
    this.makeWallWithOpenings(cx, cz + hd, w, t, h, 'z', mat, openings, tag);
    // West wall (x = cx - hw)
    this.makeWallWithOpenings(cx - hw, cz, t, d, h, 'x', mat, openings, tag);
    // East wall (x = cx + hw)
    this.makeWallWithOpenings(cx + hw, cz, t, d, h, 'x', mat, openings, tag);

    // Floor (slight extension, no collider for player movement)
    const floorGeo = new THREE.PlaneGeometry(w, d);
    const floor = new THREE.Mesh(floorGeo, this.matGround);
    floor.rotation.x = -Math.PI / 2;
    floor.position.set(cx, 0.01, cz);
    floor.receiveShadow = true;
    this.group.add(floor);

    if (options.roof === 'flat') this.flatRoof(cx, h, cz, w, d, 0.4);
    else if (options.roof === 'pyramid') this.pyramidRoof(cx, h, cz, w, d, 1.4);
  }

  private makeWallWithOpenings(
    px: number, pz: number,
    w: number, d: number, h: number,
    axis: 'x' | 'z',
    mat: THREE.Material,
    openings: { x: number; z: number; w: number; d: number }[],
    tag: string
  ): void {
    // For each opening that overlaps this wall, slice the wall into segments.
    const wallOpenings = openings.filter(o => {
      // Opening must intersect wall plane
      if (axis === 'z') {
        return Math.abs(o.z - pz) < 1.5 && o.w > 0 && o.d > 0 &&
          o.x + o.w / 2 > px - w / 2 && o.x - o.w / 2 < px + w / 2;
      } else {
        return Math.abs(o.x - px) < 1.5 && o.w > 0 && o.d > 0 &&
          o.z + o.d / 2 > pz - d / 2 && o.z - o.d / 2 < pz + d / 2;
      }
    });

    // Compute remaining segments along wall
    type Seg = { start: number; end: number };
    let segs: Seg[];
    if (axis === 'z') {
      segs = [{ start: px - w / 2, end: px + w / 2 }];
    } else {
      segs = [{ start: pz - d / 2, end: pz + d / 2 }];
    }

    for (const op of wallOpenings) {
      const a = axis === 'z' ? op.x - op.w / 2 : op.z - op.d / 2;
      const b = axis === 'z' ? op.x + op.w / 2 : op.z + op.d / 2;
      // Clamp to wall
      const wallStart = axis === 'z' ? px - w / 2 : pz - d / 2;
      const wallEnd = axis === 'z' ? px + w / 2 : pz + d / 2;
      const oa = Math.max(a, wallStart);
      const ob = Math.min(b, wallEnd);
      if (ob <= oa) continue;
      // Subtract [oa, ob] from segs
      const next: Seg[] = [];
      for (const s of segs) {
        if (ob <= s.start || oa >= s.end) {
          next.push(s);
          continue;
        }
        if (oa > s.start) next.push({ start: s.start, end: oa });
        if (ob < s.end) next.push({ start: ob, end: s.end });
      }
      segs = next;
    }

    for (const s of segs) {
      if (s.end - s.start < 0.05) continue;
      if (axis === 'z') {
        const segW = s.end - s.start;
        const cx = (s.start + s.end) / 2;
        this.box(cx, h / 2, pz, segW, h, d, mat, true, true);
        this.colliders.push(wallH(cx, pz, segW, d, h, tag));
      } else {
        const segD = s.end - s.start;
        const cz = (s.start + s.end) / 2;
        this.box(px, h / 2, cz, w, h, segD, mat, true, true);
        this.colliders.push(wallH(px, cz, w, segD, h, tag));
      }
    }
  }

  // Simple stack of crates as a cover
  private crateStack(cx: number, cz: number, layout: number[][]): void {
    for (let yi = 0; yi < layout.length; yi++) {
      const row = layout[yi];
      for (let xi = 0; xi < row.length; xi++) {
        if (row[xi] === 0) continue;
        this.box(cx + xi, 0.5 + yi, cz, 1, 1, 1, this.matWood, true, true);
        this.colliders.push(aabb(cx + xi, cz, 1, 1, yi, yi + 1, 'crate'));
      }
    }
  }

  // Sandbag row
  private sandbagRow(cx: number, cz: number, length: number, axis: 'x' | 'z', y = 1): void {
    const bagW = 1.1, bagH = 0.55, bagD = 0.6;
    const count = Math.max(1, Math.floor(length));
    for (let i = 0; i < count; i++) {
      const off = i - (count - 1) / 2;
      const bx = axis === 'x' ? cx + off : cx;
      const bz = axis === 'z' ? cz + off : cz;
      const geo = new THREE.BoxGeometry(bagW, bagH, bagD);
      const mat = new THREE.MeshLambertMaterial({ color: COLOR.sandbag });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(bx, y * bagH, bz);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      this.group.add(mesh);
      this.colliders.push(aabb(bx, bz, bagW, bagD, 0, y * bagH + bagH, 'sandbag'));
    }
  }

  // ==========================================================================
  // T SPAWN (south-west)
  // ==========================================================================
  private buildTSpawn(): void {
    // Spawn courtyard walls
    this.wall(-100, 95, 18, 1.5, 5, this.matWall, 't_spawn_wall');
    this.wall(-115, 80, 1.5, 20, 5, this.matWall, 't_spawn_wall');
    this.wall(-100, 65, 18, 1.5, 5, this.matWall, 't_spawn_wall');

    // A few cover crates
    this.crateStack(-108, 78, [[1, 1], [1, 0]]);
    this.crateStack(-95, 85, [[1, 1, 1]]);
    this.crateStack(-92, 75, [[1], [1]]);

    // A "T side building" two-story block
    this.building(-110, 90, 14, 12, 6, { roof: 'flat', tag: 't_bldg' });

    // B tunnel entrance building (south-west corner)
    this.building(-115, 100, 10, 10, 5, {
      roof: 'flat',
      tag: 't_b_tunnel_entry',
      openings: [{ x: -115, z: 96, w: 4, d: 1.5 }]
    });
  }

  // ==========================================================================
  // CT SPAWN (north-east)
  // ==========================================================================
  private buildCTSpawn(): void {
    // Spawn area walls
    this.wall(120, -75, 18, 1.5, 5, this.matWall, 'ct_spawn_wall');
    this.wall(105, -90, 1.5, 20, 5, this.matWall, 'ct_spawn_wall');
    this.wall(120, -105, 18, 1.5, 5, this.matWall, 'ct_spawn_wall');

    // Crate covers
    this.crateStack(110, -82, [[1, 1]]);
    this.crateStack(115, -90, [[1], [1, 1]]);
    this.crateStack(112, -98, [[1, 1, 1]]);

    // CT base building
    this.building(110, -100, 12, 10, 6, { roof: 'flat', tag: 'ct_bldg' });
  }

  // ==========================================================================
  // A SITE (south-east)
  // ==========================================================================
  private buildASite(): void {
    // Open area defined by perimeter walls
    // North wall
    this.wall(75, 55, 22, 1.5, 5, this.matWall, 'a_site_n');
    // West wall (with gap leading to short/ramp)
    this.makeWallWithOpenings(55, 65, 1.5, 22, 5, 'x', this.matWall,
      [{ x: 60, z: 65, w: 4, d: 1.5 }], 'a_site_w');
    // South wall
    this.wall(75, 80, 24, 1.5, 5, this.matWall, 'a_site_s');
    // East wall (with A long entrance)
    this.makeWallWithOpenings(85, 65, 1.5, 25, 5, 'x', this.matWall,
      [{ x: 85, z: 70, w: 1.5, d: 4 }], 'a_site_e');

    // A site elevated platform (default plant)
    this.box(70, 0.5, 70, 8, 1, 8, this.matConcrete, true, true);
    this.colliders.push(aabb(70, 70, 8, 8, 0, 1, 'a_platform'));

    // Pyramid roof gazebo / "default plant" cover
    this.box(70, 1.4, 70, 1.4, 0.6, 1.4, this.matWood, true, true);
    this.colliders.push(aabb(70, 70, 1.4, 1.4, 1, 1.6, 'a_planter'));

    // Scaffolding / large building to the east (CT "goose" / default)
    this.building(85, 50, 12, 12, 7, { roof: 'flat', tag: 'a_goose' });

    // Stack of crates in pit
    this.crateStack(60, 75, [[1, 1, 1], [0, 1, 0]]);

    // Sandbag row from long entrance
    this.sandbagRow(82, 70, 4, 'z', 1);
    this.sandbagRow(80, 67, 3, 'x', 1);

    // Wood box cover near short
    this.crateStack(58, 70, [[1, 1], [1, 0]]);
  }

  // ==========================================================================
  // B SITE (north-west)
  // ==========================================================================
  private buildBSite(): void {
    // Open area defined by walls
    this.wall(-75, -55, 22, 1.5, 5, this.matWall, 'b_site_n');
    this.makeWallWithOpenings(-55, -65, 1.5, 22, 5, 'x', this.matWall,
      [{ x: -55, z: -70, w: 4, d: 1.5 }], 'b_site_e');
    this.wall(-75, -80, 24, 1.5, 5, this.matWall, 'b_site_s');
    this.makeWallWithOpenings(-85, -65, 1.5, 25, 5, 'x', this.matWall,
      [{ x: -85, z: -68, w: 1.5, d: 4 }], 'b_site_w');

    // B site platform (default plant)
    this.box(-70, 0.5, -70, 8, 1, 8, this.matConcrete, true, true);
    this.colliders.push(aabb(-70, -70, 8, 8, 0, 1, 'b_platform'));

    // Boxes / cover
    this.box(-70, 1.4, -70, 1.4, 0.6, 1.4, this.matWood, true, true);
    this.colliders.push(aabb(-70, -70, 1.4, 1.4, 1, 1.6, 'b_planter'));

    this.crateStack(-60, -75, [[1, 1, 1]]);
    this.crateStack(-65, -60, [[1, 1], [1, 0]]);

    // Back wall building (CT side)
    this.building(-85, -50, 12, 10, 6, { roof: 'flat', tag: 'b_ct_house' });

    // Sandbags near doors
    this.sandbagRow(-78, -68, 4, 'z', 1);
  }

  // ==========================================================================
  // MID (center)
  // ==========================================================================
  private buildMid(): void {
    // Mid corridor walls forming a narrow chokepoint
    // West side wall (with gap for mid doors)
    this.makeWallWithOpenings(-10, 0, 1.5, 60, 6, 'x', this.matWallDark,
      [{ x: -10, z: -5, w: 1.5, d: 6 }], 'mid_w_wall');
    // East side wall (with gap to A short and B)
    this.makeWallWithOpenings(10, 0, 1.5, 60, 6, 'x', this.matWallDark,
      [{ x: 10, z: 5, w: 1.5, d: 6 }], 'mid_e_wall');

    // North cap of mid
    this.wall(0, -30, 22, 1.5, 6, this.matWallDark, 'mid_n_cap');
    // South cap of mid (with gap to T ramp)
    this.makeWallWithOpenings(0, 30, 22, 1.5, 6, 'z', this.matWallDark,
      [{ x: 0, z: 30, w: 6, d: 1.5 }], 'mid_s_cap');

    // Mid "window" / sniper box (center)
    this.box(0, 3, 0, 3, 3, 3, this.matWood, true, true);
    this.colliders.push(aabb(0, 0, 3, 3, 0, 6, 'mid_sniper_box'));

    // Crate covers along mid
    this.crateStack(-6, 15, [[1, 1]]);
    this.crateStack(6, -15, [[1, 1]]);
    this.crateStack(-5, -20, [[1, 1], [0, 1]]);
  }

  // ==========================================================================
  // LONG A
  // ==========================================================================
  private buildLongA(): void {
    // A long is a wide corridor from T spawn to A site along +X axis.
    // Walls:
    //   North wall (z = 30) - long
    //   South wall (z = 60) - long
    // We carve it from x = -60 to x = 55

    // North wall
    this.wall(0, 30, 130, 1.5, 5, this.matWall, 'long_a_n');
    // South wall (with gaps to mid and T spawn side)
    this.makeWallWithOpenings(0, 60, 130, 1.5, 5, 'z', this.matWall,
      [
        { x: -55, z: 60, w: 4, d: 1.5 }, // T spawn side
        { x: 30, z: 60, w: 4, d: 1.5 }   // connection to A short pit
      ],
      'long_a_s');

    // Double-decker / elevated walkway at far end (T side) – A long "pit"
    this.box(-40, 0.6, 45, 14, 1.2, 14, this.matConcrete, true, true);
    this.colliders.push(aabb(-40, 45, 14, 14, 0, 1.2, 'long_a_pit'));

    // Stairs to pit (ramp) - approximated as inclined boxes
    for (let i = 0; i < 4; i++) {
      const sx = -30 + i;
      const sz = 39 - i;
      this.box(sx, 0.3 + i * 0.3, sz, 1.2, 0.4, 1.2, this.matWood, true, true);
    }
    // A blue barrel on the pit
    this.box(-43, 1.2, 48, 1.2, 1.2, 1.2, this.matWood, true, true);
    this.colliders.push(aabb(-43, 48, 1.2, 1.2, 0, 1.8, 'long_a_barrel'));

    // Two-story building at the T-side of long (T spawn watch)
    this.building(-55, 45, 10, 10, 6, { roof: 'flat', tag: 'long_a_tower' });
    // Floor for second story (visible walkway)
    this.flatRoof(-55, 6, 45, 9, 9, 0.3);

    // Cars / obstacles (long A is wide)
    this.crateStack(-25, 50, [[1, 1, 1]]);
    this.crateStack(-15, 40, [[1, 1], [1, 0]]);
    this.crateStack(0, 50, [[1], [1]]);
    this.crateStack(15, 40, [[1, 1]]);
    this.crateStack(30, 50, [[1, 1, 1], [0, 1, 0]]);
    this.crateStack(45, 40, [[1, 1]]);

    // Sandbag cover near A site
    this.sandbagRow(50, 60, 3, 'x', 1);
  }

  // ==========================================================================
  // A SHORT (Catwalk)
  // ==========================================================================
  private buildShortA(): void {
    // Short A is a raised catwalk running from Mid to A site.
    // Implemented as elevated platforms with side rails.

    // Catwalk segments: ramp start at mid, climb to A short pit, then to A site
    // Ramp
    for (let i = 0; i < 6; i++) {
      const sx = 12 + i * 1.2;
      const sz = 30 + i;
      const yh = 0.3 + i * 0.5;
      this.box(sx, yh, sz, 1.4, yh, 1.4, this.matWood, true, true);
    }

    // Elevated catwalk
    this.box(20, 3, 36, 6, 0.4, 6, this.matConcrete, true, true);
    this.colliders.push(aabb(20, 36, 6, 6, 2.6, 3.0, 'short_a_walk'));

    // Second segment
    this.box(28, 3, 40, 6, 0.4, 6, this.matConcrete, true, true);
    this.colliders.push(aabb(28, 40, 6, 6, 2.6, 3.0, 'short_a_walk'));

    // Third segment closer to A
    this.box(36, 3, 45, 6, 0.4, 6, this.matConcrete, true, true);
    this.colliders.push(aabb(36, 45, 6, 6, 2.6, 3.0, 'short_a_walk'));

    // End cap before A
    this.box(44, 3, 50, 6, 0.4, 6, this.matConcrete, true, true);
    this.colliders.push(aabb(44, 50, 6, 6, 2.6, 3.0, 'short_a_walk'));

    // Side rails (low walls along catwalk)
    this.wall(20, 33, 6, 0.3, 1.2, this.matWood, 'short_a_rail');
    this.wall(20, 39, 6, 0.3, 1.2, this.matWood, 'short_a_rail');
    this.wall(28, 37, 6, 0.3, 1.2, this.matWood, 'short_a_rail');
    this.wall(28, 43, 6, 0.3, 1.2, this.matWood, 'short_a_rail');
    this.wall(36, 42, 6, 0.3, 1.2, this.matWood, 'short_a_rail');
    this.wall(36, 48, 6, 0.3, 1.2, this.matWood, 'short_a_rail');
    this.wall(44, 47, 6, 0.3, 1.2, this.matWood, 'short_a_rail');
    this.wall(44, 53, 6, 0.3, 1.2, this.matWood, 'short_a_rail');

    // Small building to the side (CT boost box building)
    this.building(50, 35, 8, 8, 5, { roof: 'flat', tag: 'short_a_bldg' });
  }

  // ==========================================================================
  // B TUNNELS
  // ==========================================================================
  private buildBTunnels(): void {
    // Tunnel entrance from T spawn (south side, west)
    // Tunnel goes from (-115, 100) up to B doors area
    // Build it as a covered corridor.

    // Outer building entry
    this.building(-115, 100, 10, 10, 5, { roof: 'flat', tag: 'b_tunnel_entry' });

    // Tunnel segments (underground / dark)
    // Wall pair going north
    const segments = [
      { cx: -110, cz: 75, len: 30 },
      { cx: -105, cz: 50, len: 30 },
      { cx: -95, cz: 25, len: 30 },
      { cx: -85, cz: 0, len: 25 },
      { cx: -75, cz: -25, len: 25 },
      { cx: -70, cz: -45, len: 25 }
    ];

    for (const seg of segments) {
      this.wall(seg.cx - 4, seg.cz, 1.5, seg.len, 4.5, this.matWallDark, 'b_tunnel_w');
      this.wall(seg.cx + 4, seg.cz, 1.5, seg.len, 4.5, this.matWallDark, 'b_tunnel_e');
      this.wall(seg.cx, seg.cz - seg.len / 2, 8, 1.5, 4.5, this.matWallDark, 'b_tunnel_n');
      this.wall(seg.cx, seg.cz + seg.len / 2, 8, 1.5, 4.5, this.matWallDark, 'b_tunnel_s');
    }

    // B doors area (junction near B site)
    this.building(-65, -55, 10, 8, 5, {
      roof: 'flat',
      tag: 'b_doors',
      openings: [{ x: -65, z: -52, w: 4, d: 1.5 }]
    });
  }

  // ==========================================================================
  // MID DOORS
  // ==========================================================================
  private buildMidDoors(): void {
    // The iconic double doors at mid (CT side)
    // Two tall door frames on either side of the chokepoint
    this.wall(-13, -5, 1.5, 6, 6, this.matWall, 'mid_door_frame_l');
    this.wall(-7, -5, 1.5, 6, 6, this.matWall, 'mid_door_frame_r');

    // Top lintel
    this.box(-10, 6, -5, 8, 0.4, 1.5, this.matWall, true, true);
    this.colliders.push(aabb(-10, -5, 8, 1.5, 0, 6.4, 'mid_door_top'));

    // The actual doors (closed, two leaves)
    const doorMat = new THREE.MeshLambertMaterial({ color: 0x6B4226 });
    this.box(-11, 3, -5, 3, 6, 0.3, doorMat, true, true);
    this.box(-9, 3, -5, 3, 6, 0.3, doorMat, true, true);
    this.colliders.push(aabb(-11, -5, 3, 0.3, 0, 6, 'mid_door_l'));
    this.colliders.push(aabb(-9, -5, 3, 0.3, 0, 6, 'mid_door_r'));

    // Sandbag cover near mid doors (CT side)
    this.sandbagRow(-5, -10, 3, 'x', 1);
  }

  // ==========================================================================
  // CONNECTING / MISC BLOCKS (back walls, long B, etc.)
  // ==========================================================================
  private buildConnectingBlocks(): void {
    // Outer perimeter (low walls to feel like a contained map)
    // North edge
    this.wall(0, -110, MAP_W, 1.5, 4, this.matWallDark, 'border_n');
    // South edge
    this.wall(0, 110, MAP_W, 1.5, 4, this.matWallDark, 'border_s');
    // West edge
    this.wall(-120, 0, 1.5, MAP_H, 4, this.matWallDark, 'border_w');
    // East edge
    this.wall(120, 0, 1.5, MAP_H, 4, this.matWallDark, 'border_e');

    // B "back" (CT-to-B) corridor from CT spawn to B
    this.wall(80, -55, 1.5, 30, 5, this.matWall, 'ct_b_path_w');
    this.wall(95, -55, 1.5, 30, 5, this.matWall, 'ct_b_path_e');

    // A back / CT-to-A path
    this.wall(100, 50, 1.5, 35, 5, this.matWall, 'ct_a_path_w');
    this.wall(115, 50, 1.5, 35, 5, this.matWall, 'ct_a_path_e');

    // Mid-to-B upper tunnel
    this.wall(40, -50, 30, 1.5, 5, this.matWall, 'upper_b_n');
    this.wall(40, -65, 30, 1.5, 5, this.matWall, 'upper_b_s');

    // Decorative building (Long A double)
    this.building(15, 80, 12, 12, 7, { roof: 'flat', tag: 'long_a_double' });

    // Some random cover buildings (souks)
    this.building(-30, 90, 10, 8, 4, { roof: 'flat', tag: 'souk' });
    this.building(40, 90, 10, 8, 4, { roof: 'flat', tag: 'souk' });

    // Mid-to-T spawn wall connector (palace-style structure)
    this.building(-30, 60, 14, 12, 5, { roof: 'flat', tag: 'palace' });

    // B "car / truck" block
    this.box(-65, 1, -55, 4, 2, 8, new THREE.MeshLambertMaterial({ color: 0x5A4A2C }), true, true);
    this.colliders.push(aabb(-65, -55, 4, 8, 0, 2, 'b_truck'));

    // CT-mid connector
    this.building(80, 0, 10, 14, 5, { roof: 'flat', tag: 'ct_mid' });
  }

  // ==========================================================================
  // DECORATIONS (InstancedMesh)
  // ==========================================================================
  private addDecorations(): void {
    // Cactus geometry (saguaro)
    const cactusGeo = new THREE.CylinderGeometry(0.3, 0.35, 2.2, 6);
    const cactusMat = new THREE.MeshLambertMaterial({ color: COLOR.cactus });

    // Barrel
    const barrelGeo = new THREE.CylinderGeometry(0.5, 0.5, 1.2, 12);
    const barrelMat = new THREE.MeshLambertMaterial({ color: COLOR.barrel });

    // Tire
    const tireGeo = new THREE.TorusGeometry(0.45, 0.18, 8, 16);
    const tireMat = new THREE.MeshLambertMaterial({ color: COLOR.tire });

    // Sandbag
    const bagGeo = new THREE.BoxGeometry(1.1, 0.55, 0.6);
    const bagMat = new THREE.MeshLambertMaterial({ color: COLOR.sandbag });

    // Crate
    const crateGeo = new THREE.BoxGeometry(1, 1, 1);
    const crateMat = this.matWood;

    // Cactus positions (decorative, sparse, in open areas)
    const cactusPositions: [number, number][] = [
      [-90, 30], [-70, 20], [-30, -50], [30, -80], [60, -10],
      [90, 40], [-110, 50], [0, 95], [50, 95], [-50, 95],
      [100, -10], [-100, -10], [70, -95], [-70, 95],
      [20, 70], [-20, 70]
    ];

    // Barrel positions
    const barrelPositions: [number, number][] = [
      [-110, 88], [115, -85], [-65, -55], [60, 60],
      [-30, 80], [40, 80], [10, 10], [-10, -10],
      [70, 0], [-70, 0]
    ];

    // Tire positions
    const tirePositions: [number, number][] = [
      [-108, 70], [113, -95], [78, 78], [-78, -78],
      [50, 0], [-50, 0]
    ];

    // Sandbag decoration clusters
    const sandbagPositions: [number, number][] = [
      [-100, 75], [110, -80], [80, 60], [-80, -60],
      [20, 35], [-20, -35], [60, -45]
    ];

    // Cacti
    this.cactusMesh = new THREE.InstancedMesh(cactusGeo, cactusMat, cactusPositions.length);
    const dummy = new THREE.Object3D();
    cactusPositions.forEach(([x, z], i) => {
      dummy.position.set(x, 1.1, z);
      dummy.rotation.set(0, Math.random() * Math.PI, 0);
      dummy.updateMatrix();
      this.cactusMesh!.setMatrixAt(i, dummy.matrix);
    });
    this.cactusMesh.castShadow = true;
    this.cactusMesh.receiveShadow = true;
    this.group.add(this.cactusMesh);

    // Barrels
    this.barrelMesh = new THREE.InstancedMesh(barrelGeo, barrelMat, barrelPositions.length);
    barrelPositions.forEach(([x, z], i) => {
      dummy.position.set(x, 0.6, z);
      dummy.rotation.set(0, Math.random() * Math.PI * 2, 0);
      dummy.updateMatrix();
      this.barrelMesh!.setMatrixAt(i, dummy.matrix);
    });
    this.barrelMesh.castShadow = true;
    this.barrelMesh.receiveShadow = true;
    this.group.add(this.barrelMesh);

    // Tires
    this.tireMesh = new THREE.InstancedMesh(tireGeo, tireMat, tirePositions.length);
    tirePositions.forEach(([x, z], i) => {
      dummy.position.set(x, 0.4, z);
      dummy.rotation.set(Math.PI / 2, 0, Math.random() * Math.PI * 2);
      dummy.updateMatrix();
      this.tireMesh!.setMatrixAt(i, dummy.matrix);
    });
    this.tireMesh.castShadow = true;
    this.tireMesh.receiveShadow = true;
    this.group.add(this.tireMesh);

    // Sandbags
    this.sandbagMesh = new THREE.InstancedMesh(bagGeo, bagMat, sandbagPositions.length);
    sandbagPositions.forEach(([x, z], i) => {
      dummy.position.set(x, 0.28, z);
      dummy.rotation.set(0, Math.random() * Math.PI, 0);
      dummy.updateMatrix();
      this.sandbagMesh!.setMatrixAt(i, dummy.matrix);
    });
    this.sandbagMesh.castShadow = true;
    this.sandbagMesh.receiveShadow = true;
    this.group.add(this.sandbagMesh);

    // Stray crates (extra cover, instanced)
    const cratePositions: [number, number, number][] = [
      [-95, 0, 70], [-85, 0, 75], [100, 0, -75], [105, 0, -85],
      [70, 0, 50], [-70, 0, -50], [50, 0, 60], [-50, 0, -60],
      [0, 0, 50], [0, 0, -50], [30, 0, 30], [-30, 0, -30],
      [60, 0, 0], [-60, 0, 0], [90, 0, 30], [-90, 0, -30],
      [80, 0, -90], [-80, 0, 90], [20, 0, 90], [-20, 0, -90]
    ];
    this.crateMesh = new THREE.InstancedMesh(crateGeo, crateMat, cratePositions.length);
    cratePositions.forEach(([x, y, z], i) => {
      dummy.position.set(x, y + 0.5, z);
      dummy.rotation.set(0, Math.random() * Math.PI * 2, 0);
      dummy.updateMatrix();
      this.crateMesh!.setMatrixAt(i, dummy.matrix);
    });
    this.crateMesh.castShadow = true;
    this.crateMesh.receiveShadow = true;
    this.group.add(this.crateMesh);
    // Add colliders for these (smaller subset to limit collision count)
    for (const [x, y, z] of cratePositions) {
      this.colliders.push(aabb(x, z, 1, 1, y, y + 1, 'crate_inst'));
    }

    // A site beacon (red glowing pillar)
    this.addSiteBeacon(70, 0.1, 70, COLOR.siteA);
    // B site beacon (blue)
    this.addSiteBeacon(-70, 0.1, -70, COLOR.siteB);
  }

  private addSiteBeacon(x: number, y: number, z: number, color: number): void {
    // Tall thin emissive pillar
    const geo = new THREE.CylinderGeometry(0.15, 0.15, 5, 8);
    const mat = new THREE.MeshBasicMaterial({ color });
    const beam = new THREE.Mesh(geo, mat);
    beam.position.set(x, 2.5, z);
    this.group.add(beam);

    // Ring on ground
    const ringGeo = new THREE.RingGeometry(3.5, 4.0, 32);
    const ringMat = new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide, transparent: true, opacity: 0.6 });
    const ring = new THREE.Mesh(ringGeo, ringMat);
    ring.position.set(x, y + 0.02, z);
    ring.rotation.x = -Math.PI / 2;
    this.group.add(ring);
  }

  // ==========================================================================
  // SPAWNS
  // ==========================================================================
  private buildSpawns(): void {
    // 5 T spawns at south-west, facing north-east (toward center)
    // facing = 0 is +X, PI/2 is +Z (south).  To face north-east we want
    // direction pointing to (+x, -z), so angle = atan2(-z, +x) but the
    // convention used by PlayerController is yaw rotation around Y, with
    // standard THREE orientation: yaw=0 faces +X.  So we want yaw such that
    // forward vector (cos(yaw), 0, -sin(yaw)) points toward (positive X, negative Z).
    // That gives yaw = atan2(z_offset, x_offset) where offset is desired dir.
    // For "facing center" from T spawn (-100, 80) toward (0, 0): dx=100, dz=-80
    // yaw = atan2(-(-80), 100) = atan2(80, 100) ~ 0.674 rad
    const tBaseAngle = Math.atan2(80, 100); // ~0.674 rad (NE direction)

    const tSpawnPositions: [number, number][] = [
      [-100, 80],
      [-103, 82],
      [-97, 82],
      [-103, 78],
      [-97, 78]
    ];
    tSpawnPositions.forEach(([x, z], i) => {
      this.spawns.push({
        team: Team.T,
        position: [x, 1.0, z],
        facing: tBaseAngle
      });
    });
    // Mark the bomb carrier (first T)
    this.spawns[0].position = [this.spawns[0].position[0], 1.0, this.spawns[0].position[2]];

    // 5 CT spawns at north-east, facing south-west
    const ctBaseAngle = Math.atan2(-80, -100) + Math.PI; // facing SW
    const ctSpawnPositions: [number, number][] = [
      [100, -80],
      [103, -82],
      [97, -82],
      [103, -78],
      [97, -78]
    ];
    ctSpawnPositions.forEach(([x, z]) => {
      this.spawns.push({
        team: Team.CT,
        position: [x, 1.0, z],
        facing: ctBaseAngle
      });
    });
  }

  // ==========================================================================
  // SITES
  // ==========================================================================
  private buildSites(): void {
    this.sites.push({
      name: BombSite.A,
      center: [70, 0.1, 70],
      radius: 4,
      bounds: {
        min: [55, 0, 55],
        max: [85, 4, 85],
        tag: 'site_a_bounds'
      }
    });
    this.sites.push({
      name: BombSite.B,
      center: [-70, 0.1, -70],
      radius: 4,
      bounds: {
        min: [-85, 0, -85],
        max: [-55, 4, -55],
        tag: 'site_b_bounds'
      }
    });
  }

  // ==========================================================================
  // WAYPOINTS & PATHS
  // ==========================================================================
  private buildWaypoints(): void {
    // Add a navigation waypoint and return its index.
    const add = (x: number, z: number): number => {
      this.waypoints.push(new THREE.Vector3(x, 1.0, z));
      return this.waypoints.length - 1;
    };

    const link = (a: number, b: number) => {
      if (a === b) return;
      // Add both directions if not already there
      const exists = this.paths.some(p => p.from === a && p.to === b);
      if (!exists) this.paths.push({ from: a, to: b });
      const exists2 = this.paths.some(p => p.from === b && p.to === a);
      if (!exists2) this.paths.push({ from: b, to: a });
    };

    // T side
    const tSpawn = add(-100, 80);
    const tLongEntry = add(-95, 70);
    const tMidEntry = add(-85, 50);
    const tBTunnelEntry = add(-110, 90);

    // Long A path
    const longAStart = add(-70, 45);
    const longAMid = add(-30, 45);
    const longAEnd = add(20, 50);
    const longAPit = add(-40, 45);

    // A site area
    const aShortPit = add(20, 35);
    const aShortEnd = add(50, 55);
    const aSite = add(70, 70);
    const aRamp = add(55, 65);

    // Mid
    const midDoors = add(-10, -5);
    const midCenter = add(0, 5);
    const midCross = add(0, 0);
    const midTExit = add(0, 25);

    // B tunnel
    const bTunnel1 = add(-100, 60);
    const bTunnel2 = add(-90, 30);
    const bTunnel3 = add(-80, 0);
    const bTunnelExit = add(-70, -45);
    const bDoors = add(-65, -55);

    // B site
    const bSite = add(-70, -70);
    const bRamp = add(-75, -60);

    // CT side
    const ctSpawn = add(100, -80);
    const ctToA = add(100, 50);
    const ctToB = add(90, -60);
    const ctToMid = add(80, 0);

    // Linking
    // T spawn paths
    link(tSpawn, tLongEntry);
    link(tSpawn, tMidEntry);
    link(tSpawn, tBTunnelEntry);

    // T -> Long A
    link(tLongEntry, longAStart);
    link(longAStart, longAPit);
    link(longAStart, longAMid);
    link(longAMid, longAEnd);
    link(longAEnd, aRamp);
    link(aRamp, aSite);

    // T -> Mid
    link(tMidEntry, midTExit);
    link(midTExit, midCenter);
    link(midCenter, midCross);
    link(midCross, midDoors);
    link(midCross, aShortPit);
    link(aShortPit, aShortEnd);
    link(aShortEnd, aSite);

    // T -> B tunnels
    link(tBTunnelEntry, bTunnel1);
    link(bTunnel1, bTunnel2);
    link(bTunnel2, bTunnel3);
    link(bTunnel3, bTunnelExit);
    link(bTunnelExit, bDoors);
    link(bDoors, bSite);
    link(bDoors, bRamp);
    link(bRamp, bSite);

    // CT paths
    link(ctSpawn, ctToA);
    link(ctSpawn, ctToB);
    link(ctSpawn, ctToMid);
    link(ctToA, aSite);
    link(ctToB, bSite);
    link(ctToMid, midDoors);
    link(midDoors, midCross);

    // Mark bomb carrier by setting first T spawn's position is already there
    // (hasBomb flag is on PlayerState, not SpawnPoint, so nothing extra to do)
  }
}
