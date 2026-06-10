// Bot.ts - 5v5 FPS Bot AI
// 状态机: Idle -> Patrol/Chase/Attack/Plant/Defuse/Retreat

import * as THREE from 'three';
import {
  PlayerState, Team, WeaponInstance, WeaponId, BombSite,
  AABB, CONFIG
} from '../types';
import { bus } from '../utils/events';
import { clamp, choice, dist2 } from '../utils/util';
import { Pathfinder } from './Pathfinder';
import { HealthBar } from './HealthBar';

// Vec3 别名 (用 tuple 表示以便和 PlayerState.position 兼容)
type Vec3 = THREE.Vector3 | [number, number, number];

function toVec3(v: Vec3): THREE.Vector3 {
  if (v instanceof THREE.Vector3) return v;
  return new THREE.Vector3(v[0], v[1], v[2]);
}

function copyToArray(v: THREE.Vector3): [number, number, number] {
  return [v.x, v.y, v.z];
}

// Bot AI 状态
export enum BotState {
  Idle = 'idle',
  Patrol = 'patrol',
  Chase = 'chase',
  Attack = 'attack',
  Plant = 'plant',
  Defuse = 'defuse',
  Retreat = 'retreat'
}

export interface BotWorld {
  dt: number;
  colliders: AABB[];
  waypoints: THREE.Vector3[];
  paths: { from: number; to: number }[];

  // 视野内的其他实体 (Bot 和真人)
  visible: Array<{
    id: string;
    team: Team;
    position: THREE.Vector3;   // 脚底
    headPos: THREE.Vector3;
    alive: boolean;
  }>;

  // 友方/敌方的可见性
  knownEnemyId: string | null;       // 上次看到的敌人 id
  knownEnemyPos: THREE.Vector3 | null;

  // 比赛状态
  phase: 'buy' | 'live' | 'end';
  bombPlanted: boolean;
  bombSite: BombSite;
  bombPos: THREE.Vector3 | null;
  hasBomb: boolean;            // 自己是 T 且携带炸弹

  // 包点
  siteACenter: THREE.Vector3;
  siteBCenter: THREE.Vector3;
  siteARadius: number;
  siteBRadius: number;

  // 自定义
  isPlayerOnMyTeam: (id: string) => boolean;
  canSee: (from: Vec3, to: Vec3) => boolean;

  // 出生点
  spawns: { T: THREE.Vector3[]; CT: THREE.Vector3[] };
}

export class Bot {
  state: PlayerState;
  isBot = true;

  // AI 状态
  aiState: BotState = BotState.Idle;
  currentWaypoint: number = -1;
  path: number[] = [];                // waypoint 路径 (idx)
  patrolTimer: number = 0;
  reactionTime: number = 0.4;         // 0.2-0.6s
  accuracy: number = 0.5;             // 0.4-0.85
  aggression: number = 0.5;           // 0-1
  lastSawEnemyAt: number = 0;
  lastFireTime: number = 0;
  targetEnemyId: string | null = null;
  plantStartTime: number = 0;
  defuseStartTime: number = 0;
  decidedSite: BombSite = BombSite.A;
  stuckTimer: number = 0;             // 多久没动就重选路径

  // 视觉
  bodyGroup: THREE.Group;
  private _modelRoot: THREE.Group;    // 内部 root, bodyGroup 只是公开入口
  healthBar: HealthBar;               // 头顶血条 (Bot 自带, Game 调 .setRatio)

  // 简易寻路
  private pathfinder: Pathfinder = new Pathfinder();
  private waypointsBuilt: boolean = false;
  private difficulty: 'easy' | 'normal' | 'hard' | 'expert' = 'normal';

  // 内部速度
  private _moveSpeed: number = CONFIG.MOVE_SPEED;
  private _bodyRadius: number = CONFIG.PLAYER_RADIUS;
  private _height: number = CONFIG.PLAYER_HEIGHT;

  // 回调
  onShoot?: (origin: Vec3, dir: Vec3) => void;
  onMove?: (bot: Bot, newPos: Vec3) => void;
  onPlantStart?: () => void;
  onDefuseStart?: () => void;
  onWeaponChange?: (idx: number) => void;

  constructor(state: PlayerState, model: THREE.Group) {
    this.state = state;
    state.isBot = true;

    // 构建第三人称模型 (3 段 box: 头/身/腿)
    this._modelRoot = new THREE.Group();
    this._modelRoot.name = `BotBody_${state.id}`;

    const isT = state.team === Team.T;
    const headColor = isT ? 0x222222 : 0x4a5a7a;
    const bodyColor = isT ? 0x3a3a3a : 0x5a7aa8;
    const legColor = isT ? 0x1a1a1a : 0x2a3a4a;
    const accentColor = isT ? 0xb85a3a : 0x6a9ad8;

    // 头
    const head = new THREE.Mesh(
      new THREE.BoxGeometry(0.32, 0.32, 0.32),
      new THREE.MeshLambertMaterial({ color: headColor })
    );
    head.position.y = 1.5;
    head.castShadow = true;
    head.name = 'head';
    this._modelRoot.add(head);

    // 头带 (T 红色 / CT 蓝色) 标识阵营
    const band = new THREE.Mesh(
      new THREE.BoxGeometry(0.34, 0.08, 0.34),
      new THREE.MeshLambertMaterial({ color: accentColor })
    );
    band.position.y = 1.5;
    this._modelRoot.add(band);

    // 身
    const torso = new THREE.Mesh(
      new THREE.BoxGeometry(0.55, 0.7, 0.32),
      new THREE.MeshLambertMaterial({ color: bodyColor })
    );
    torso.position.y = 1.05;
    torso.castShadow = true;
    torso.name = 'torso';
    this._modelRoot.add(torso);

    // 腿
    const legs = new THREE.Mesh(
      new THREE.BoxGeometry(0.5, 0.85, 0.3),
      new THREE.MeshLambertMaterial({ color: legColor })
    );
    legs.position.y = 0.45;
    legs.castShadow = true;
    legs.name = 'legs';
    this._modelRoot.add(legs);

    // 武器 (简单一个 box)
    const gun = new THREE.Mesh(
      new THREE.BoxGeometry(0.12, 0.12, 0.6),
      new THREE.MeshLambertMaterial({ color: 0x111111 })
    );
    gun.position.set(0.35, 1.15, 0.3);
    gun.name = 'gun';
    this._modelRoot.add(gun);

    // 用传入的 model 作为公开 bodyGroup (把子节点加进去)
    model.add(this._modelRoot);
    this.bodyGroup = model;

    // 头顶血条 (挂在 bodyGroup, 跟随移动; Game.update 里让它朝相机)
    this.healthBar = new HealthBar();
    this.bodyGroup.add(this.healthBar.group);
    this.healthBar.setRatio(1.0);
  }

  /** 设置难度 */
  setDifficulty(level: 'easy' | 'normal' | 'hard' | 'expert'): void {
    this.difficulty = level;
    switch (level) {
      case 'easy':
        this.reactionTime = 0.6;
        this.accuracy = 0.3;
        this.aggression = 0.3;
        break;
      case 'normal':
        this.reactionTime = 0.4;
        this.accuracy = 0.5;
        this.aggression = 0.5;
        break;
      case 'hard':
        this.reactionTime = 0.25;
        this.accuracy = 0.7;
        this.aggression = 0.65;
        break;
      case 'expert':
        this.reactionTime = 0.15;
        this.accuracy = 0.85;
        this.aggression = 0.8;
        break;
    }
  }

  /** 取得当前生效武器 (activeWeaponIndex 处) */
  private getActiveWeapon(): WeaponInstance | null {
    const idx = this.state.activeWeaponIndex;
    const w = this.state.weapons[idx];
    return w ?? null;
  }

  /** 找第一把能开枪的武器索引 (没有就拿刀) */
  private pickBestWeaponIdx(): number {
    const ws = this.state.weapons;
    if (ws.length === 0) return -1;
    // 优先 rifle/awp, 然后 pistol
    const order: WeaponId[] = [
      WeaponId.AK47, WeaponId.M4A4, WeaponId.AWP,
      WeaponId.DesertEagle, WeaponId.Glock, WeaponId.USP, WeaponId.Knife
    ];
    for (const id of order) {
      const idx = ws.findIndex(w => w.stats.id === id && w.ammoInMag > 0);
      if (idx >= 0) return idx;
    }
    // 没弹的, 选 rifle 准备换弹
    for (const id of order) {
      const idx = ws.findIndex(w => w.stats.id === id);
      if (idx >= 0) return idx;
    }
    return 0;
  }

  /** 切换武器 (如有需要) */
  private maybeSwitchWeapon(engaging: boolean): void {
    if (!engaging) return;
    const w = this.getActiveWeapon();
    if (!w) return;
    if (w.ammoInMag <= 0 && w.stats.id !== WeaponId.Knife) {
      // 没弹切到下一个有弹的
      const next = this.pickBestWeaponIdx();
      if (next >= 0 && next !== this.state.activeWeaponIndex) {
        this.state.activeWeaponIndex = next;
        this.onWeaponChange?.(next);
      }
    }
  }

  // -------------------- 寻路 --------------------

  private ensureWaypointsBuilt(world: BotWorld): void {
    if (this.waypointsBuilt) return;
    if (world.waypoints && world.waypoints.length > 0) {
      this.pathfinder.build(world.waypoints, world.paths);
      this.waypointsBuilt = true;
    }
  }

  /** 朝 target 移动, 内部用 AABB vs 圆柱做碰撞, 返回是否到达 */
  private moveToward(
    target: THREE.Vector3,
    world: BotWorld,
    arrivalDist: number
  ): { arrived: boolean; moved: boolean } {
    const dt = world.dt;
    const pos = this._getPos();
    const dx = target.x - pos.x;
    const dz = target.z - pos.z;
    const d = Math.hypot(dx, dz);
    if (d <= arrivalDist) {
      return { arrived: true, moved: false };
    }
    const inv = 1 / Math.max(d, 1e-6);
    const ndx = dx * inv;
    const ndz = dz * inv;
    const step = this._moveSpeed * dt;
    const moveX = ndx * step;
    const moveZ = ndz * step;

    // 尝试 X 方向
    let nx = pos.x + moveX;
    let nz = pos.z;
    if (this.collidesAABB(nx, nz, world.colliders)) {
      nx = pos.x;
    }
    if (!this.collidesAABB(nx, nz, world.colliders)) {
      pos.x = nx;
    }
    // 尝试 Z 方向
    nz = pos.z + moveZ;
    if (this.collidesAABB(pos.x, nz, world.colliders)) {
      nz = pos.z;
    }
    if (!this.collidesAABB(pos.x, nz, world.colliders)) {
      pos.z = nz;
    }

    // 更新朝向 (yaw 朝移动方向)
    const yaw = Math.atan2(ndx, ndz);
    this.state.rotation = yaw;

    const moved = (pos.x !== this._lastX || pos.z !== this._lastZ);
    this._lastX = pos.x;
    this._lastZ = pos.z;
    return { arrived: false, moved };
  }
  private _lastX: number = NaN;
  private _lastZ: number = NaN;

  /** 简易 AABB vs 圆柱 (xz 平面) */
  private collidesAABB(x: number, z: number, colliders: AABB[]): boolean {
    const r = this._bodyRadius;
    for (const c of colliders) {
      const cx = (c.min[0] + c.max[0]) * 0.5;
      const cz = (c.min[2] + c.max[2]) * 0.5;
      const hx = (c.max[0] - c.min[0]) * 0.5;
      const hz = (c.max[2] - c.min[2]) * 0.5;
      // 圆-盒最近点
      const px = clamp(x, cx - hx, cx + hx);
      const pz = clamp(z, cz - hz, cz + hz);
      const dx = x - px;
      const dz = z - pz;
      if (dx * dx + dz * dz < r * r) return true;
    }
    return false;
  }

  private _getPos(): THREE.Vector3 {
    const [x, y, z] = this.state.position;
    return _tmpVec.set(x, y, z);
  }

  private _setPos(v: THREE.Vector3): void {
    this.state.position = copyToArray(v);
    if (this._modelRoot) {
      this._modelRoot.position.set(v.x, v.y, v.z);
    }
  }

  // -------------------- 决策 --------------------

  private pickTargetSite(world: BotWorld): BombSite {
    // 简单: 优先包点 (T 选 A, CT 选包点防守)
    // 引入少量随机避免所有人扎堆
    if (this.decidedSite !== BombSite.None && this.decidedSite !== BombSite.A && this.decidedSite !== BombSite.B) {
      this.decidedSite = Math.random() < 0.5 ? BombSite.A : BombSite.B;
    } else if (this.decidedSite === BombSite.A || this.decidedSite === BombSite.B) {
      // 保留决定 (不再随机)
    } else {
      this.decidedSite = Math.random() < 0.5 ? BombSite.A : BombSite.B;
    }
    return this.decidedSite;
  }

  private getSiteCenter(site: BombSite, world: BotWorld): THREE.Vector3 {
    return site === BombSite.A ? world.siteACenter : world.siteBCenter;
  }

  private getSiteRadius(site: BombSite, world: BotWorld): number {
    return site === BombSite.A ? world.siteARadius : world.siteBRadius;
  }

  // -------------------- 视野 / 目标 --------------------

  /** 在可见列表里找最近的敌人 (非己方) */
  private pickVisibleEnemy(world: BotWorld): {
    id: string; position: THREE.Vector3; headPos: THREE.Vector3;
  } | null {
    let best: {
      id: string; position: THREE.Vector3; headPos: THREE.Vector3;
    } | null = null;
    let bestD2 = Infinity;
    for (const e of world.visible) {
      if (!e.alive) continue;
      if (e.id === this.state.id) continue;
      if (e.team === this.state.team) continue;
      const d2 = dist2(e.position.x, e.position.z, this._getPos().x, this._getPos().z);
      if (d2 < bestD2) {
        bestD2 = d2;
        best = { id: e.id, position: e.position, headPos: e.headPos };
      }
    }
    return best;
  }

  /** 朝某点瞄准 (更新 pitch/yaw) */
  private aimAt(target: THREE.Vector3, targetHead: boolean, world: BotWorld): void {
    const pos = this._getPos();
    const aimY = targetHead ? (target.y + CONFIG.HEAD_HEIGHT) : (target.y + CONFIG.CHEST_HEIGHT);
    const dx = target.x - pos.x;
    const dy = aimY - (pos.y + CONFIG.HEAD_HEIGHT);
    const dz = target.z - pos.z;
    const yaw = Math.atan2(dx, dz);
    const horiz = Math.hypot(dx, dz);
    const pitch = -Math.atan2(dy, horiz); // 注意 three 的 pitch 向上为负 (跟 Controls 一致)
    // 平滑过渡, 简化: 直接设
    this.state.rotation = yaw;
    this.state.pitch = clamp(pitch, -Math.PI / 2, Math.PI / 2);
  }

  // -------------------- 射击 --------------------

  private tryShoot(world: BotWorld, target: { position: THREE.Vector3; headPos: THREE.Vector3 }): void {
    if (!this.onShoot) return;
    const w = this.getActiveWeapon();
    if (!w) return;
    if (w.ammoInMag <= 0) return;
    if (w.reloading) return;
    const now = performance.now() / 1000;
    const fireInterval = 60 / Math.max(1, w.stats.fireRate);
    if (now - this.lastFireTime < fireInterval) return;
    this.lastFireTime = now;

    // 决定打头还是身体 (bot 命中率 1/4 打头)
    const aimHead = Math.random() < 0.25;
    // 命中率 (距离衰减)
    const dx = target.position.x - this._getPos().x;
    const dz = target.position.z - this._getPos().z;
    const dist = Math.hypot(dx, dz);
    const distFactor = clamp(1 - dist / Math.max(1, w.stats.range), 0, 1);
    const hitChance = clamp(this.accuracy * 0.5 + distFactor * 0.5, 0, 1);

    // 计算方向
    const aimY = aimHead ? target.headPos.y : (target.position.y + CONFIG.CHEST_HEIGHT);
    const origin = new THREE.Vector3(
      this._getPos().x,
      this._getPos().y + CONFIG.HEAD_HEIGHT * 0.95,
      this._getPos().z
    );
    const desired = new THREE.Vector3(
      target.position.x,
      aimY,
      target.position.z
    ).sub(origin).normalize();

    // 散布 = 基础散布 + (1-accuracy) 衰减
    const spread = w.stats.spread + (1 - this.accuracy) * 0.04;
    // 加散布 (yaw / pitch 偏一点)
    const spreadYaw = (Math.random() - 0.5) * 2 * spread;
    const spreadPitch = (Math.random() - 0.5) * 2 * spread;
    const dir = desired.clone();
    // 在水平面上转 spreadYaw
    const cs = Math.cos(spreadYaw), sn = Math.sin(spreadYaw);
    const x2 = dir.x * cs - dir.z * sn;
    const z2 = dir.x * sn + dir.z * cs;
    dir.x = x2; dir.z = z2;
    // pitch
    const horiz = Math.hypot(dir.x, dir.z);
    const newPitch = Math.atan2(-dir.y, horiz) + spreadPitch;
    dir.y = -Math.sin(newPitch) * Math.hypot(dir.x, dir.z);
    dir.x = Math.cos(newPitch) * dir.x;
    dir.z = Math.cos(newPitch) * dir.z;
    dir.normalize();

    // 消耗子弹
    w.ammoInMag -= 1;
    w.lastFireTime = now;

    // 触发回调
    this.onShoot(origin, dir);
    // 注意: 命中判定由 Game 层根据 canSee + 散布方向处理; 这里只传方向
    // 但我们也用 hitChance 决定是否真的"打中": 假阴性 = 子弹直接打偏; 不在 bot 内处理命中
  }

  // -------------------- 主更新 --------------------

  update(world: BotWorld): void {
    if (!this.state.alive) return;
    if (world.phase === 'end') {
      this.aiState = BotState.Idle;
      return;
    }
    const dt = world.dt;
    if (dt <= 0) return;

    this.ensureWaypointsBuilt(world);
    const pos = this._getPos();

    // 更新模型世界位置
    this._modelRoot.position.set(pos.x, pos.y, pos.z);

    // 0. 决策: 找当前能看到的敌人
    const seen = this.pickVisibleEnemy(world);
    if (seen) {
      this.targetEnemyId = seen.id;
      this.lastSawEnemyAt = performance.now() / 1000;
    } else if (this.targetEnemyId) {
      // 看不到目标, 但已知位置还在, 2 秒内不放弃
      const now = performance.now() / 1000;
      if (now - this.lastSawEnemyAt > 2.0) {
        this.targetEnemyId = null;
        this.path = [];
        this.currentWaypoint = -1;
      }
    }

    // 1. 选 AI state
    this.transitionState(world, seen);

    // 2. 执行 state
    switch (this.aiState) {
      case BotState.Attack: this.tickAttack(world, seen); break;
      case BotState.Chase:  this.tickChase(world); break;
      case BotState.Plant:  this.tickPlant(world); break;
      case BotState.Defuse: this.tickDefuse(world); break;
      case BotState.Retreat:this.tickRetreat(world); break;
      case BotState.Patrol: this.tickPatrol(world); break;
      case BotState.Idle:   /* 啥也不做 */ break;
    }

    // 3. 通知 Game 更新位置
    if (this.onMove) {
      this.onMove(this, copyToArray(pos));
    }

    // 4. 简单巡逻 timer
    this.patrolTimer += dt;
  }

  // -------------------- 状态转换 --------------------

  private transitionState(
    world: BotWorld,
    seen: { id: string; position: THREE.Vector3; headPos: THREE.Vector3 } | null
  ): void {
    // 看到敌人 -> 攻击优先
    if (seen) {
      this.aiState = BotState.Attack;
      return;
    }
    // 血量低 -> retreat (CT 优先 retreat)
    if (this.state.health < 30 && this.state.team === Team.CT) {
      this.aiState = BotState.Retreat;
      return;
    }
    // 包已埋, CT 立刻去拆
    if (world.bombPlanted && this.state.team === Team.CT && world.bombPos) {
      this.aiState = BotState.Defuse;
      return;
    }
    // T 携弹到达 site -> plant
    if (this.state.team === Team.T && this.state.hasBomb) {
      const site = this.decidedSite;
      const center = this.getSiteCenter(site, world);
      const radius = this.getSiteRadius(site, world);
      const d = Math.hypot(center.x - this._getPos().x, center.z - this._getPos().z);
      if (d <= radius + 0.5) {
        this.aiState = BotState.Plant;
        return;
      }
    }
    // 有已知敌人位置但没看到 -> 追击
    if (this.targetEnemyId && (world.knownEnemyPos || (this.path.length > 0))) {
      this.aiState = BotState.Chase;
      return;
    }
    // 默认巡逻
    this.aiState = BotState.Patrol;
  }

  // -------------------- State tick --------------------

  private tickAttack(
    world: BotWorld,
    seen: { id: string; position: THREE.Vector3; headPos: THREE.Vector3 } | null
  ): void {
    this.maybeSwitchWeapon(true);
    if (seen) {
      // 停下, 瞄准射击
      this.aimAt(seen.position, true, world);
      this.tryShoot(world, seen);
    } else {
      // 没看到, 退到 Chase
      this.aiState = BotState.Chase;
    }
  }

  private tickChase(world: BotWorld): void {
    if (!world.knownEnemyPos) {
      this.aiState = BotState.Patrol;
      return;
    }
    const target = world.knownEnemyPos.clone();
    // 走到敌人最后已知位置附近
    const r = this.moveToward(target, world, 1.5);
    if (r.arrived) {
      this.targetEnemyId = null;
      this.path = [];
      this.aiState = BotState.Patrol;
    } else if (!r.moved) {
      this.stuckTimer += world.dt;
      if (this.stuckTimer > 1.5) {
        this.path = [];
        this.stuckTimer = 0;
        this.aiState = BotState.Patrol;
      }
    } else {
      this.stuckTimer = 0;
    }
    this.aimAt(target, false, world);
  }

  private tickPatrol(world: BotWorld): void {
    // 决定目标: T -> 选 A/B; CT -> 防守 A/B
    const site = this.decidedSite !== BombSite.None
      ? this.decidedSite
      : (this.decidedSite = this.pickTargetSite(world));
    const target = this.getSiteCenter(site, world).clone();
    // 走 waypoint 路径
    this.followPathTo(target, world, 1.5);
    this.aimAt(target, false, world);
  }

  private tickPlant(world: BotWorld): void {
    // 停下开始埋
    const site = this.decidedSite;
    const center = this.getSiteCenter(site, world);
    const d = Math.hypot(center.x - this._getPos().x, center.z - this._getPos().z);
    if (d > this.getSiteRadius(site, world) + 1.0) {
      // 偏离了, 重走过去
      this.followPathTo(center.clone(), world, 0.8);
      return;
    }
    if (this.plantStartTime <= 0) {
      this.plantStartTime = performance.now() / 1000;
      this.onPlantStart?.();
    }
    const elapsed = performance.now() / 1000 - this.plantStartTime;
    if (elapsed >= CONFIG.PLANT_TIME) {
      // 通知 Game 层完成埋包
      bus.emit('bomb_planted', { site, planter: this.state.id });
      this.plantStartTime = 0;
      // 切回 idle / 攻击
      this.aiState = BotState.Attack;
    }
  }

  private tickDefuse(world: BotWorld): void {
    if (!world.bombPos) {
      this.aiState = BotState.Patrol;
      return;
    }
    const target = world.bombPos.clone();
    const d = Math.hypot(target.x - this._getPos().x, target.z - this._getPos().z);
    if (d > 1.0) {
      this.followPathTo(target, world, 0.8);
      return;
    }
    if (this.defuseStartTime <= 0) {
      this.defuseStartTime = performance.now() / 1000;
      this.onDefuseStart?.();
    }
    const elapsed = performance.now() / 1000 - this.defuseStartTime;
    if (elapsed >= CONFIG.DEFUSE_TIME) {
      bus.emit('bomb_defuse', { defuser: this.state.id });
      this.defuseStartTime = 0;
      this.aiState = BotState.Patrol;
    }
  }

  private tickRetreat(world: BotWorld): void {
    // 退到己方 spawn 方向
    const spawns = this.state.team === Team.T ? world.spawns.T : world.spawns.CT;
    if (spawns.length === 0) {
      this.aiState = BotState.Patrol;
      return;
    }
    const target = toVec3(choice(spawns));
    const r = this.moveToward(target, world, 1.5);
    if (r.arrived) {
      this.aiState = BotState.Patrol;
    }
    // 边退边打: 若有 knownEnemyPos, 仍朝敌人方向瞄准
    if (world.knownEnemyPos) {
      this.aimAt(world.knownEnemyPos, false, world);
    }
  }

  // -------------------- 寻路辅助 --------------------

  /** 沿 waypoint 走到 target, 内部维护 path (idx 数组) */
  private followPathTo(target: THREE.Vector3, world: BotWorld, arrivalDist: number): void {
    if (!world.waypoints || world.waypoints.length === 0) {
      // 没 waypoint, 直接走过去
      this.moveToward(target, world, arrivalDist);
      return;
    }
    const pos = this._getPos();

    // 重算路径的时机: 没有路径 / 目标变化大
    const needRepath =
      this.path.length === 0 ||
      this._lastTarget === null ||
      this._lastTarget.distanceToSquared(target) > 4.0;

    if (needRepath) {
      const fromIdx = this.pathfinder.findNearest(pos, world.waypoints);
      const toIdx = this.pathfinder.findNearest(target, world.waypoints);
      if (fromIdx >= 0 && toIdx >= 0) {
        this.path = this.pathfinder.findPathIdx(fromIdx, toIdx);
      } else {
        this.path = [];
      }
      this._lastTarget = target.clone();
    }

    if (this.path.length > 0) {
      const { next, path, done } = this.pathfinder.getNextWaypoint(
        pos, target, world.waypoints, this.path, 1.2
      );
      this.path = path;
      if (done) {
        this.moveToward(target, world, arrivalDist);
        return;
      }
      const r = this.moveToward(next, world, 1.0);
      if (r.arrived || !r.moved) {
        this.stuckTimer += world.dt;
        if (this.stuckTimer > 1.0) {
          this.path = [];
          this.stuckTimer = 0;
        }
      } else {
        this.stuckTimer = 0;
      }
    } else {
      // 没有图路径, 直走
      this.moveToward(target, world, arrivalDist);
    }
  }
  private _lastTarget: THREE.Vector3 | null = null;

  // -------------------- 受伤 / 重生 --------------------

  takeDamage(dmg: number, attackerId: string, hitPos: Vec3): void {
    if (!this.state.alive) return;
    this.state.health -= dmg;
    // 更新头顶血条
    this.healthBar.setRatio(Math.max(0, this.state.health) / 100);
    if (this.state.health <= 0) {
      this.state.health = 0;
      this.state.alive = false;
      this.healthBar.setVisible(false);  // 死了隐藏血条
      // 事件格式与 Game.ts line 400 listener 一致: { killer, victim, hs, weapon }
      bus.emit('player_kill', {
        killer: attackerId,
        victim: this.state.id,
        hs: false,
        weapon: this.getActiveWeapon()?.stats.id ?? WeaponId.Knife
      });
    }
  }

  respawn(pos: [number, number, number], facing: number): void {
    this.state.position = [pos[0], pos[1], pos[2]];
    this.state.rotation = facing;
    this.state.pitch = 0;
    this.state.health = 100;
    this.state.armor = 0;
    this.state.alive = true;
    this.healthBar.setRatio(1.0);  // 血条回满
    this.healthBar.setVisible(true);
    this.aiState = BotState.Idle;
    this.path = [];
    this.targetEnemyId = null;
    this.plantStartTime = 0;
    this.defuseStartTime = 0;
    this.stuckTimer = 0;
    // 血满后切回巡逻
    setTimeout(() => {
      if (this.state.alive) this.aiState = BotState.Patrol;
    }, 300);
  }
}

// 全局临时变量避免每帧 alloc
const _tmpVec = new THREE.Vector3();
