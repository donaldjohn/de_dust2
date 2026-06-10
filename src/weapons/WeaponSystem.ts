// WeaponSystem - 玩家武器 + 发射逻辑
// 第一人称视角下, 屏幕中心发射, 击中目标/墙/地面有效果
// 视图模型通过 ctx.viewmodelGroup 提供, 本类只负责 mount 武器 + 动画 + 后坐力 + 弹药
import * as THREE from 'three';
import {
  WeaponInstance, WeaponStats, WeaponId, BulletHit, AABB, Team
} from '../types';
import { bus } from '../utils/events';
import { clamp, lerp, rand } from '../utils/util';
import { buildWeaponModel, positionForViewmodel } from './WeaponModels';
import { TracerManager } from './Tracer';

/** 局部类型别名: 位置三元组 (Vec3 在 types 中未显式导出, 这里用元组等价) */
type Vec3 = [number, number, number];

/** 可被击中的目标描述 (供 update 阶段做射线检测) */
export interface ShootTarget {
  id: string;
  team: Team;
  headPos: THREE.Vector3;
  chestPos: THREE.Vector3;
  feetPos: THREE.Vector3;
  alive: boolean;
  helmet?: boolean; // 头盔减伤
}

/** 单次 update 调用所需的上下文 */
export interface ShootContext {
  camera: THREE.PerspectiveCamera;
  colliders: AABB[];
  playerTargets: ShootTarget[];
  ignoreId: string;
  viewmodelGroup: THREE.Group;
}

/** 射线检测命中结果 (target=null 表示击中墙体) */
interface RaycastHit {
  position: THREE.Vector3;
  target: ShootTarget | null;
  headshot: boolean;
  distance: number;
}

const HIT_RADIUS_HEAD = 0.18;
const HIT_RADIUS_CHEST = 0.28;
const HIT_RADIUS_FEET = 0.22;
const SWITCH_ANIM_MS = 300;
const AUTO_RELOAD_DELAY_S = 1.2;
const HIT_FALLOFF_MIN = 0.5; // 距离衰减下限
const DEFAULT_FOV = 75;        // 正常 FOV (CONFIG.ZOOM_FOV 不存在, 此处本地定义)
const ZOOM_FOV = 50;           // 切枪后默认 zoom (非 AWP 武器)

export class WeaponSystem {
  weapons: WeaponInstance[] = [];
  activeIndex = -1;

  // 状态
  isFiring = false;
  isReloading = false;
  isAiming = false;
  spread = 0;
  recoilPitch = 0;
  recoilYaw = 0;

  // 事件回调
  onFire?: (weaponId: WeaponId, origin: Vec3, dir: Vec3) => void;
  onReload?: () => void;
  onEmpty?: () => void;
  onHit?: (hit: BulletHit) => void;

  // 内部状态
  private _lastFireTime = 0;
  private _emptyFireTime = 0;
  private _reloadStart = 0;
  private _switchStart = 0;
  private _switching = false;

  // 视图模型
  private _currentModel: THREE.Group | null = null;
  private _tracer: TracerManager;

  // 视觉位移基准 (idle 时为 0)
  private _idleBase = new THREE.Vector3();
  private _moveBobX = 0;
  private _moveBobY = 0;
  private _movePhase = 0;
  private _previousMoveAxisX = 0;
  private _previousMoveAxisY = 0;

  // 临时向量, 避免重复分配
  private static _tmpVec = new THREE.Vector3();

  constructor() {
    this._tracer = new TracerManager();
  }

  // ---------------------------------------------------------------------------
  // 初始化
  // ---------------------------------------------------------------------------

  /**
   * 用传入的武器列表初始化系统 (通常开局自带刀+手枪)
   */
  init(weapons: WeaponInstance[]): void {
    this.weapons = weapons.slice();
    this.activeIndex = this.weapons.length > 0 ? 0 : -1;
    this.spread = 0;
    this.recoilPitch = 0;
    this.recoilYaw = 0;
    this.isFiring = false;
    this.isReloading = false;
    this.isAiming = false;
  }

  /**
   * 买枪/拾枪时, 添加一把新武器
   * 同 id 已存在则补充备弹
   */
  addWeapon(stats: WeaponStats): void {
    const existing = this.weapons.find(w => w.stats.id === stats.id);
    if (existing) {
      // 合并备弹, 不超过 reserveAmmo 上限 2 倍
      existing.reserveAmmo = Math.min(
        existing.reserveAmmo + stats.reserveAmmo,
        stats.reserveAmmo * 3
      );
      return;
    }
    this.weapons.push({
      stats,
      ammoInMag: stats.magazineSize,
      reserveAmmo: stats.reserveAmmo,
      lastFireTime: 0,
      reloading: false,
      reloadStart: 0
    });
    bus.emit('weapon_pickup', { weaponId: stats.id });
  }

  /**
   * 切到指定 index, 触发换枪动画
   */
  switchTo(index: number): void {
    if (index < 0 || index >= this.weapons.length) return;
    if (index === this.activeIndex) return;
    if (this._switching) return;
    this.activeIndex = index;
    this._switching = true;
    this._switchStart = performance.now();
    this.isFiring = false;
    this.isReloading = false;
    this.spread = 0;
    this.recoilPitch = 0;
    this.recoilYaw = 0;
    bus.emit('weapon_switch', { weaponId: this.weapons[index].stats.id });
  }

  cycleNext(): void {
    if (this.weapons.length === 0) return;
    const next = (this.activeIndex + 1) % this.weapons.length;
    this.switchTo(next);
  }

  cyclePrev(): void {
    if (this.weapons.length === 0) return;
    const prev = (this.activeIndex - 1 + this.weapons.length) % this.weapons.length;
    this.switchTo(prev);
  }

  /**
   * 按 G 丢枪, 刀不能丢
   */
  takeWeapon(id: WeaponId): boolean {
    if (id === WeaponId.Knife) return false;
    const idx = this.weapons.findIndex(w => w.stats.id === id);
    if (idx < 0) return false;
    if (idx === this.activeIndex) return false; // 当前拿着的不能丢
    this.weapons.splice(idx, 1);
    bus.emit('weapon_drop', { weaponId: id });
    return true;
  }

  // ---------------------------------------------------------------------------
  // 控制
  // ---------------------------------------------------------------------------

  startFire(): void {
    this.isFiring = true;
  }

  stopFire(): void {
    this.isFiring = false;
  }

  reload(): void {
    const w = this.current();
    if (!w) return;
    if (w.reloading) return;
    if (w.ammoInMag >= w.stats.magazineSize) return;
    if (w.reserveAmmo <= 0) return;
    w.reloading = true;
    w.reloadStart = performance.now();
    this.isReloading = true;
    this._reloadStart = w.reloadStart;
    this.onReload?.();
    bus.emit('weapon_reload', { weaponId: w.stats.id });
  }

  setAiming(aiming: boolean): void {
    this.isAiming = aiming;
  }

  // ---------------------------------------------------------------------------
  // 查询
  // ---------------------------------------------------------------------------

  current(): WeaponInstance | null {
    if (this.activeIndex < 0 || this.activeIndex >= this.weapons.length) return null;
    return this.weapons[this.activeIndex];
  }

  hasWeapon(id: WeaponId): boolean {
    return this.weapons.some(w => w.stats.id === id);
  }

  // ---------------------------------------------------------------------------
  // 视图模型挂载
  // ---------------------------------------------------------------------------

  /**
   * 玩家 Game 启动时调用, 一次性挂载 tracer group 到场景
   * viewmodelGroup 必须在 ctx 中持续提供
   */
  attachViewmodel(viewmodelGroup: THREE.Group): void {
    if (this._tracer.group.parent !== null) {
      this._tracer.group.parent.remove(this._tracer.group);
    }
    // tracer 直接加到 viewmodelGroup 之外的 scene 才行, 但 ctx 只给 viewmodelGroup
    // 这里添加到 viewmodelGroup (会被相机一起渲染, 不影响位置)
    viewmodelGroup.add(this._tracer.group);
  }

  /**
   * 把当前武器的视图模型挂到 ctx.viewmodelGroup 上
   * 切枪时自动卸载旧模型
   */
  private _mountCurrentModel(viewmodelGroup: THREE.Group): void {
    const w = this.current();
    if (!w) {
      if (this._currentModel) {
        viewmodelGroup.remove(this._currentModel);
        this._currentModel = null;
      }
      return;
    }
    // 检查当前挂载的模型是否就是当前武器
    const expectedName = `WeaponModel_${w.stats.id}`;
    if (this._currentModel && this._currentModel.name === expectedName) return;
    // 卸旧
    if (this._currentModel) {
      viewmodelGroup.remove(this._currentModel);
      this._currentModel = null;
    }
    // 装新
    const m = buildWeaponModel(w.stats);
    this._currentModel = m;
    viewmodelGroup.add(m);
    this._idleBase.set(0, 0, 0);
  }

  // ---------------------------------------------------------------------------
  // 主循环 update
  // ---------------------------------------------------------------------------

  update(dt: number, ctx: ShootContext): void {
    const w = this.current();
    // 视图模型挂载
    this._mountCurrentModel(ctx.viewmodelGroup);

    // 换枪动画计时
    if (this._switching) {
      const elapsed = performance.now() - this._switchStart;
      if (elapsed >= SWITCH_ANIM_MS) {
        this._switching = false;
      }
    }

    // 换弹完成
    if (this.isReloading && w) {
      const now = performance.now();
      if (now - this._reloadStart >= w.stats.reloadTime * 1000) {
        this._finishReload(w);
      }
    }

    // 自动换弹 (弹匣空 + isFiring 持续)
    if (this.isFiring && w && !w.reloading && w.ammoInMag === 0 && w.reserveAmmo > 0) {
      const now = performance.now();
      if (this._emptyFireTime === 0) this._emptyFireTime = now;
      if (now - this._emptyFireTime >= AUTO_RELOAD_DELAY_S * 1000) {
        this.reload();
        this._emptyFireTime = 0;
      }
    } else if (w && w.ammoInMag > 0) {
      this._emptyFireTime = 0;
    }

    // 散布/后坐力恢复
    this._decayRecoil(dt, w);

    // 发射逻辑
    if (this.isFiring && w && !w.reloading) {
      const now = performance.now();
      const interval = 60000 / w.stats.fireRate;
      if (now - w.lastFireTime >= interval) {
        if (w.stats.id === WeaponId.Knife) {
          // 刀: 不消耗弹药, 间隔略大
          this._doFire(w, ctx, now);
        } else if (w.ammoInMag > 0) {
          this._doFire(w, ctx, now);
        } else {
          this._doEmpty(w);
        }
      }
    } else if (w && w.stats.automatic === false) {
      // 单发: 松开鼠标时清空 fire 状态由调用方负责 (stopFire)
    }

    // FOV 过渡
    this._updateFov(dt, w);

    // 视图模型动画
    this._animateViewmodel(dt, w, ctx);
  }

  // ---------------------------------------------------------------------------
  // 内部: 发射
  // ---------------------------------------------------------------------------

  private _doFire(w: WeaponInstance, ctx: ShootContext, now: number): void {
    // 1. 计算 origin/dir (从相机)
    const cam = ctx.camera;
    const origin = new THREE.Vector3();
    cam.getWorldPosition(origin);
    const dir = new THREE.Vector3();
    cam.getWorldDirection(dir);

    // 2. 应用散布
    const effectiveSpread = this.spread + w.stats.spread;
    if (effectiveSpread > 0) {
      const yaw = rand(-effectiveSpread, effectiveSpread);
      const pitch = rand(-effectiveSpread, effectiveSpread);
      // 绕世界 up 旋转 (yaw) 和 right 旋转 (pitch)
      const up = new THREE.Vector3(0, 1, 0);
      const right = new THREE.Vector3().crossVectors(dir, up).normalize();
      dir.applyAxisAngle(up, yaw);
      dir.applyAxisAngle(right, pitch);
      dir.normalize();
    }

    // 3. 计算飞行距离
    const range = w.stats.range;

    // 4. 射线检测: 玩家 + 墙体
    const hit = this._raycast(ctx, origin, dir, range, w);

    // 5. 显示曳光弹
    const tracerEnd = hit
      ? hit.position
      : origin.clone().add(dir.clone().multiplyScalar(range));
    this._tracer.fire(
      [origin.x, origin.y, origin.z],
      [dir.x, dir.y, dir.z],
      tracerEnd.clone().sub(origin).length()
    );

    // 6. 应用伤害
    if (hit) {
      this._applyHit(w, ctx, hit);
    }

    // 7. 消耗弹药
    if (w.stats.id !== WeaponId.Knife) {
      w.ammoInMag = Math.max(0, w.ammoInMag - 1);
    }
    w.lastFireTime = now;

    // 8. 后坐力
    this.spread += w.stats.recoil * 0.05;
    this.recoilPitch += rand(0.01, 0.03) * w.stats.recoil;
    this.recoilYaw += rand(-0.01, 0.01) * w.stats.recoil;

    // 9. 回调
    this.onFire?.(w.stats.id, [origin.x, origin.y, origin.z], [dir.x, dir.y, dir.z]);
    bus.emit('weapon_fire', { weaponId: w.stats.id });
  }

  private _doEmpty(w: WeaponInstance): void {
    this.onEmpty?.();
    bus.emit('weapon_empty', { weaponId: w.stats.id });
    if (this._emptyFireTime === 0) this._emptyFireTime = performance.now();
    // 即使点射也要清掉 fireTime, 避免下一发无间隔
    w.lastFireTime = performance.now();
  }

  // ---------------------------------------------------------------------------
  // 内部: 射线检测
  // ---------------------------------------------------------------------------

  private _raycast(
    ctx: ShootContext,
    origin: THREE.Vector3,
    dir: THREE.Vector3,
    range: number,
    _w: WeaponInstance
  ): RaycastHit | null {
    let best: RaycastHit | null = null;

    // 玩家身体近似为 3 个点 + 半径 (简化)
    for (const t of ctx.playerTargets) {
      if (!t.alive) continue;
      if (t.id === ctx.ignoreId) continue;
      // 头
      const dHead = this._intersectSphere(origin, dir, t.headPos, HIT_RADIUS_HEAD);
      if (dHead !== null && dHead <= range) {
        if (!best || dHead < best.distance) {
          const pos = origin.clone().add(dir.clone().multiplyScalar(dHead));
          best = { position: pos, target: t, headshot: true, distance: dHead };
        }
        continue;
      }
      // 胸/腹
      const dChest = this._intersectSphere(origin, dir, t.chestPos, HIT_RADIUS_CHEST);
      if (dChest !== null && dChest <= range) {
        if (!best || dChest < best.distance) {
          const pos = origin.clone().add(dir.clone().multiplyScalar(dChest));
          best = { position: pos, target: t, headshot: false, distance: dChest };
        }
        continue;
      }
      // 脚
      const dFeet = this._intersectSphere(origin, dir, t.feetPos, HIT_RADIUS_FEET);
      if (dFeet !== null && dFeet <= range) {
        if (!best || dFeet < best.distance) {
          const pos = origin.clone().add(dir.clone().multiplyScalar(dFeet));
          best = { position: pos, target: t, headshot: false, distance: dFeet };
        }
      }
    }

    // 墙 (AABB)
    if (best === null) {
      const wallHit = this._intersectAABB(origin, dir, range, ctx.colliders);
      if (wallHit) {
        return wallHit;
      }
    } else {
      // 进一步检测: 在最佳玩家命中之前是否撞墙
      const wall = this._intersectAABB(origin, dir, best.distance, ctx.colliders);
      if (wall) return wall;
    }

    return best;
  }

  /**
   * 射线和 AABB 列表求交, 返回最近命中
   * AABB 用 [min, max] 三维盒
   */
  private _intersectAABB(
    origin: THREE.Vector3,
    dir: THREE.Vector3,
    maxDist: number,
    colliders: AABB[]
  ): RaycastHit | null {
    let bestT = Infinity;
    let bestPos: THREE.Vector3 | null = null;
    const inv = new THREE.Vector3(
      dir.x === 0 ? 1e30 : 1 / dir.x,
      dir.y === 0 ? 1e30 : 1 / dir.y,
      dir.z === 0 ? 1e30 : 1 / dir.z
    );
    for (const a of colliders) {
      const t1 = (a.min[0] - origin.x) * inv.x;
      const t2 = (a.max[0] - origin.x) * inv.x;
      const t3 = (a.min[1] - origin.y) * inv.y;
      const t4 = (a.max[1] - origin.y) * inv.y;
      const t5 = (a.min[2] - origin.z) * inv.z;
      const t6 = (a.max[2] - origin.z) * inv.z;
      const tmin = Math.max(Math.min(t1, t2), Math.min(t3, t4), Math.min(t5, t6));
      const tmax = Math.min(Math.max(t1, t2), Math.max(t3, t4), Math.max(t5, t6));
      if (tmax < 0 || tmin > tmax) continue;
      const tHit = tmin >= 0 ? tmin : tmax;
      if (tHit < 0 || tHit > maxDist) continue;
      if (tHit < bestT) {
        bestT = tHit;
        bestPos = origin.clone().add(dir.clone().multiplyScalar(tHit));
      }
    }
    if (bestPos) {
      return { position: bestPos, target: null, headshot: false, distance: bestT };
    }
    return null;
  }

  /**
   * 射线和球求交
   */
  private _intersectSphere(
    origin: THREE.Vector3,
    dir: THREE.Vector3,
    center: THREE.Vector3,
    radius: number
  ): number | null {
    const oc = new THREE.Vector3().subVectors(origin, center);
    const a = dir.dot(dir);
    const b = 2 * oc.dot(dir);
    const c = oc.dot(oc) - radius * radius;
    const disc = b * b - 4 * a * c;
    if (disc < 0) return null;
    const sq = Math.sqrt(disc);
    const t1 = (-b - sq) / (2 * a);
    const t2 = (-b + sq) / (2 * a);
    if (t1 >= 0) return t1;
    if (t2 >= 0) return t2;
    return null;
  }

  // ---------------------------------------------------------------------------
  // 内部: 伤害应用
  // ---------------------------------------------------------------------------

  private _applyHit(
    w: WeaponInstance,
    ctx: ShootContext,
    hit: RaycastHit
  ): void {
    if (!hit.target) {
      // 击中环境: 发出命中环境事件
      bus.emit('bullet_impact', {
        position: [hit.position.x, hit.position.y, hit.position.z] as [number, number, number],
        normal: null,
        weaponId: w.stats.id
      });
      return;
    }

    const t = hit.target;
    let damage = w.stats.damage;
    if (hit.headshot) {
      damage *= w.stats.headshotMultiplier;
      // 头盔: 80% 减伤, 20% 透到身体
      if (t.helmet) {
        const reduced = damage * 0.2;
        damage = damage * 0.8 * 0.2 + reduced; // = 0.36 * damage
      }
    } else {
      // 腿/脚判定: 用 y 距离头部太远 => 算腿
      // 简化: 当击中球不在胸/腹范围但 hit 落点 y 偏低, 算腿
      // 这里统一按胸处理
      // 距离衰减
      const distFactor = Math.max(HIT_FALLOFF_MIN, 1 - (hit.distance / w.stats.range) * 0.5);
      damage *= distFactor;
      // 腿减伤: 如果命中球是脚位
      const feetDist = originToDist(hit.position, t.feetPos);
      if (feetDist < HIT_RADIUS_FEET) {
        damage *= 0.7;
      }
    }

    damage = Math.max(0, Math.round(damage));

    const payload: BulletHit = {
      shooterId: ctx.ignoreId,
      victimId: t.id,
      weaponId: w.stats.id,
      damage,
      headshot: hit.headshot,
      position: [hit.position.x, hit.position.y, hit.position.z]
    };
    bus.emit('player_hit', payload);
    this.onHit?.(payload);
  }

  // ---------------------------------------------------------------------------
  // 内部: 换弹完成
  // ---------------------------------------------------------------------------

  private _finishReload(w: WeaponInstance): void {
    const need = w.stats.magazineSize - w.ammoInMag;
    const take = Math.min(need, w.reserveAmmo);
    w.ammoInMag += take;
    w.reserveAmmo -= take;
    w.reloading = false;
    this.isReloading = false;
    this._emptyFireTime = 0;
    bus.emit('weapon_reload_done', { weaponId: w.stats.id });
  }

  // ---------------------------------------------------------------------------
  // 内部: 后坐力 / 散布恢复
  // ---------------------------------------------------------------------------

  private _decayRecoil(dt: number, w: WeaponInstance | null): void {
    const target = w ? w.stats.spread : 0;
    // 目标 spread 包含 (基础 + 后坐力), 我们用 lerp 让当前 spread 回到基础
    const decay = 4.0; // 衰减速度 (单位/秒)
    this.spread = lerp(this.spread, target, clamp(dt * decay, 0, 1));
    this.recoilPitch = lerp(this.recoilPitch, 0, clamp(dt * decay * 1.2, 0, 1));
    this.recoilYaw = lerp(this.recoilYaw, 0, clamp(dt * decay * 1.2, 0, 1));
  }

  // ---------------------------------------------------------------------------
  // 内部: FOV
  // ---------------------------------------------------------------------------

  private _updateFov(dt: number, w: WeaponInstance | null): void {
    if (!w || !w.stats.zoomFOV) {
      this._targetFov = DEFAULT_FOV;
    } else {
      this._targetFov = this.isAiming ? w.stats.zoomFOV : ZOOM_FOV;
    }
    const cam = this._cachedCamera;
    if (cam) {
      cam.fov = lerp(cam.fov, this._targetFov, clamp(dt * 8, 0, 1));
      cam.updateProjectionMatrix();
    }
  }
  private _targetFov = DEFAULT_FOV;
  private _cachedCamera: THREE.PerspectiveCamera | null = null;

  // ---------------------------------------------------------------------------
  // 内部: 视图模型动画
  // ---------------------------------------------------------------------------

  private _animateViewmodel(dt: number, w: WeaponInstance | null, ctx: ShootContext): void {
    if (!this._currentModel) return;
    this._cachedCamera = ctx.camera;
    const m = this._currentModel;
    const isAwp = w?.stats.id === WeaponId.AWP;

    // 切枪动画
    if (this._switching) {
      const elapsed = performance.now() - this._switchStart;
      const t = clamp(elapsed / SWITCH_ANIM_MS, 0, 1);
      // 0 -> 1: 武器从下方出现
      const yOff = (1 - t) * -0.3;
      // 同时透明/小一点
      m.scale.setScalar(lerp(0.7, 1, t));
      m.rotation.x = (1 - t) * 0.5;
      this._idleBase.set(0, yOff, 0);
    } else {
      // 正常 idle: 用 positionForViewmodel 设基础位置
      positionForViewmodel(m, this.isAiming, isAwp);
      this._idleBase.copy(m.position);
      m.scale.setScalar(1);
      m.rotation.x = 0;

      // 换弹动作: x 旋转 30° 摇摆
      if (this.isReloading && w) {
        const elapsed = performance.now() - this._reloadStart;
        const rt = w.stats.reloadTime * 1000;
        const t = clamp(elapsed / rt, 0, 1);
        // 第一段: 抬起 (0~0.3)
        // 第二段: 保持抬起 (0.3~0.7)
        // 第三段: 落下 (0.7~1.0)
        let rotX = 0;
        if (t < 0.3) {
          rotX = (t / 0.3) * (Math.PI / 6);
        } else if (t < 0.7) {
          rotX = Math.PI / 6;
        } else {
          rotX = (1 - (t - 0.7) / 0.3) * (Math.PI / 6);
        }
        m.rotation.x = rotX;
      }

      // 移动时晃动
      // 通过判断 camera 横向移动估算 (这里我们用 isAiming 等其他输入简化)
      // 实际游戏中, Game 层会传入 input; 这里做基础 bob 用 time + isMoving
      // 由于 ctx 没有 input, 用一个内部相位 + 后坐力余震
      this._movePhase += dt * 5.0;
      const bobY = Math.sin(this._movePhase) * 0.01;
      const bobX = Math.cos(this._movePhase * 0.5) * 0.005;
      m.position.y += bobY;
      m.position.x += bobX;

      // 后坐力余震
      m.position.y += this.recoilPitch * 0.5;
      m.position.x += this.recoilYaw * 0.5;
    }
  }
}

function originToDist(p: THREE.Vector3, c: THREE.Vector3): number {
  return p.distanceTo(c);
}
