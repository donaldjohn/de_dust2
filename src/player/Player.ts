// 玩家控制器 - FPS 视角 + 移动 + 射击触发
//
// 行为概览:
//   - 接收 Input 状态, 算速度, 调用 Collision 修正位置
//   - 把 yaw/pitch 同步到 camera (YXZ 欧拉序, 避免万向锁)
//   - 主武器开火通过 onShoot 回调让 Game 走弹道
//   - 受伤 / 死亡通过 bus 事件通知 UI 与 Game
//
// 重要: 此模块不引入具体武器实现, 只持有 WeaponInstance[] (持有引用)
import * as THREE from 'three';
import {
  AABB,
  PlayerState,
  Team,
  WeaponInstance,
  CONFIG
} from '../types';
import { Input } from './Controls';
import { Collision } from './Collision';
import { bus } from '../utils/events';

export type Vec3 = [number, number, number];

export interface PlayerControllerOptions {
  onShoot?: (origin: Vec3, dir: Vec3) => void;
  onPlantStart?: () => void;
  onReloadStart?: () => void;
}

export class PlayerController {
  // 暴露给外部读
  position: THREE.Vector3;     // 脚底位置
  velocity: THREE.Vector3;
  yaw: number;
  pitch: number;
  isGrounded: boolean;
  camera: THREE.PerspectiveCamera;

  // 完整玩家状态 - 用于 UI
  state: PlayerState;

  // 回调 - 由 Game 在创建时注入
  onShoot?: (origin: Vec3, dir: Vec3) => void;
  onPlantStart?: () => void;
  onReloadStart?: () => void;

  // 内部
  private id: string;
  private team: Team;
  private radius: number;
  private height: number;
  private readonly tmpForward = new THREE.Vector3();
  private readonly tmpRight = new THREE.Vector3();
  private readonly tmpMove = new THREE.Vector3();

  constructor(camera: THREE.PerspectiveCamera, team: Team, name: string) {
    this.camera = camera;
    this.team = team;
    this.id = `player-${name}-${Math.random().toString(36).slice(2, 8)}`;

    this.position = new THREE.Vector3(0, 0, 0);
    this.velocity = new THREE.Vector3();
    this.yaw = 0;
    this.pitch = 0;
    this.isGrounded = false;
    this.radius = CONFIG.PLAYER_RADIUS;
    this.height = CONFIG.PLAYER_HEIGHT;

    this.state = {
      id: this.id,
      name,
      team,
      alive: true,
      health: 100,
      armor: 100,
      helmet: true,
      money: CONFIG.START_MONEY,
      position: [0, 0, 0],
      rotation: 0,
      pitch: 0,
      weapons: [],
      activeWeaponIndex: 0,
      kills: 0,
      deaths: 0,
      assists: 0
    };
  }

  // ---- 武器管理 ----

  setWeapons(weapons: WeaponInstance[]): void {
    this.state.weapons = weapons;
    this.state.activeWeaponIndex = weapons.length > 0 ? 0 : -1;
  }

  setActiveWeaponIndex(i: number): void {
    if (i < 0 || i >= this.state.weapons.length) return;
    this.state.activeWeaponIndex = i;
  }

  getActiveWeapon(): WeaponInstance | null {
    const i = this.state.activeWeaponIndex;
    if (i < 0 || i >= this.state.weapons.length) return null;
    return this.state.weapons[i];
  }

  // ---- 出生 / 重生 ----

  respawn(position: [number, number, number], facing: number): void {
    this.position.set(position[0], position[1], position[2]);
    this.velocity.set(0, 0, 0);
    this.yaw = facing;
    this.pitch = 0;
    this.isGrounded = false;

    this.state.alive = true;
    this.state.health = 100;
    this.state.armor = 100;
    this.state.helmet = true;
    this.state.position = [position[0], position[1], position[2]];
    this.state.rotation = facing;
    this.state.pitch = 0;

    // 同步到 camera
    this.syncCamera();
  }

  // ---- 受伤 ----

  applyDamage(dmg: number, hitPos?: Vec3, headshot?: boolean): void {
    if (!this.state.alive) return;
    const helmet = headshot ? this.state.helmet : false;
    let final = dmg;
    // 简化版伤害结算:
    //   无甲 -> 全额
    //   有甲 -> 头: 头盔抵消 1 发 (CS 规则: 头盔满血吃一发 AWP/ak 仍死, 此处简化)
    //   这里采用经典: 头->甲*0.5+血*0.5; 身体->甲*0.66+血*0.34
    if (this.state.armor > 0) {
      if (headshot) {
        if (helmet) {
          // 头有头盔: dmg 一半分给甲, 一半分给血
          const toArmor = final * 0.5;
          const toHealth = final * 0.5;
          this.state.armor = Math.max(0, this.state.armor - toArmor);
          this.state.health = Math.max(0, this.state.health - toHealth);
        } else {
          // 头无头盔: 头一枪更疼, 这里按全额血
          this.state.health = Math.max(0, this.state.health - final);
        }
      } else {
        // 身体: 2/3 给甲, 1/3 给血
        const toArmor = final * (2 / 3);
        const toHealth = final * (1 / 3);
        this.state.armor = Math.max(0, this.state.armor - toArmor);
        this.state.health = Math.max(0, this.state.health - toHealth);
      }
    } else {
      // 无甲: 全额血
      this.state.health = Math.max(0, this.state.health - final);
    }

    if (this.state.health <= 0) {
      this.die();
    }
  }

  private die(): void {
    if (!this.state.alive) return;
    this.state.alive = false;
    this.state.deaths += 1;
    bus.emit('player_died', {
      id: this.state.id,
      team: this.state.team,
      position: [this.position.x, this.position.y, this.position.z]
    });
  }

  // ---- 帧更新 ----

  update(dt: number, input: Input, colliders: AABB[]): void {
    // 死亡时不更新控制
    if (!this.state.alive) {
      this.syncState();
      return;
    }

    // ---- 1) 视角 (yaw / pitch) ----
    if (input.pointerLocked) {
      this.yaw -= input.mouseDX * CONFIG.MOUSE_SENSITIVITY;
      this.pitch -= input.mouseDY * CONFIG.MOUSE_SENSITIVITY;
      // 限制 pitch 范围 ±PI/2 - 留一点点余量避免 look-up / look-down 卡边界
      const limit = Math.PI / 2 - 0.001;
      if (this.pitch > limit) this.pitch = limit;
      if (this.pitch < -limit) this.pitch = -limit;
    }

    // ---- 2) 移动方向 (基于 yaw) ----
    // forward = (-sin(yaw), 0, -cos(yaw))
    // right   = ( cos(yaw), 0, -sin(yaw))
    this.tmpForward.set(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    this.tmpRight.set(Math.cos(this.yaw), 0, -Math.sin(this.yaw));

    // 水平速度 (XZ 平面)
    let mvx = 0, mvz = 0;
    if (input.forward) {
      mvx += this.tmpForward.x;
      mvz += this.tmpForward.z;
    }
    if (input.back) {
      mvx -= this.tmpForward.x;
      mvz -= this.tmpForward.z;
    }
    if (input.right) {
      mvx += this.tmpRight.x;
      mvz += this.tmpRight.z;
    }
    if (input.left) {
      mvx -= this.tmpRight.x;
      mvz -= this.tmpRight.z;
    }

    // 归一化避免对角线加速
    const horizLen = Math.hypot(mvx, mvz);
    if (horizLen > 0) {
      mvx /= horizLen;
      mvz /= horizLen;
    }

    // sprint 加成
    const speedMul = input.sprint ? CONFIG.SPRINT_MULT : 1.0;
    const moveSpeed = CONFIG.MOVE_SPEED * speedMul;

    this.velocity.x = mvx * moveSpeed;
    this.velocity.z = mvz * moveSpeed;

    // ---- 3) 跳跃 (仅 grounded) ----
    if (input.jump && this.isGrounded) {
      this.velocity.y = CONFIG.JUMP_VELOCITY;
      this.isGrounded = false;  // 跳起后立刻离开地面
    }

    // ---- 4) 重力 ----
    this.velocity.y -= CONFIG.GRAVITY * dt;
    // 防止速度爆炸 (简单终端速度)
    const TERMINAL = -50;
    if (this.velocity.y < TERMINAL) this.velocity.y = TERMINAL;

    // ---- 5) 碰撞修正 ----
    const result = Collision.resolveMove(
      this.position,
      this.velocity,
      this.radius,
      this.height,
      colliders,
      dt
    );
    this.position.copy(result.position);
    this.isGrounded = result.grounded;

    // 地面兜底: 地面 (y=0) 不在 AABB 列表里, 玩家可能穿过; 强制不能低于地面
    if (this.position.y < 0) {
      this.position.y = 0;
      this.velocity.y = 0;
      this.isGrounded = true;
    }

    // ---- 6) 一次性按键 (R / B / E / G / 数字切枪 / 滚轮) ----
    this.handleOneShots(input, dt);

    // ---- 7) 同步 camera 与 state ----
    this.syncCamera();
    this.syncState();
  }

  /**
   * 不依赖 pointer lock 的简化 update: 只算 XZ 移动, 不改 yaw/pitch
   * 用于: pointer lock 偶尔失败/丢失时, 玩家仍能用 WASD 移动, 避免完全卡死
   */
  updateWithoutLook(dt: number, input: Input, colliders: AABB[]): void {
    if (!this.state.alive) return;

    // ---- 移动方向 ----
    this.tmpForward.set(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    this.tmpRight.set(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
    let mvx = 0, mvz = 0;
    if (input.forward) { mvx += this.tmpForward.x; mvz += this.tmpForward.z; }
    if (input.back)    { mvx -= this.tmpForward.x; mvz -= this.tmpForward.z; }
    if (input.right)   { mvx += this.tmpRight.x;   mvz += this.tmpRight.z; }
    if (input.left)    { mvx -= this.tmpRight.x;   mvz -= this.tmpRight.z; }
    const horizLen = Math.hypot(mvx, mvz);
    if (horizLen > 0) { mvx /= horizLen; mvz /= horizLen; }
    const speedMul = input.sprint ? CONFIG.SPRINT_MULT : 1.0;
    const moveSpeed = CONFIG.MOVE_SPEED * speedMul;
    this.velocity.x = mvx * moveSpeed;
    this.velocity.z = mvz * moveSpeed;

    // 重力
    this.velocity.y -= CONFIG.GRAVITY * dt;
    if (this.velocity.y < -50) this.velocity.y = -50;

    // 碰撞
    const result = Collision.resolveMove(
      this.position, this.velocity,
      this.radius, this.height, colliders, dt
    );
    this.position.copy(result.position);
    this.isGrounded = result.grounded;
    if (this.position.y < 0) {
      this.position.y = 0;
      this.velocity.y = 0;
      this.isGrounded = true;
    }

    // 同步 camera 位置 (旋转不变)
    this.camera.position.set(
      this.position.x,
      this.position.y + CONFIG.HEAD_HEIGHT,
      this.position.z
    );
    this.syncState();
  }

  /** 同步 camera 位置 + 旋转 */
  private syncCamera(): void {
    // camera 位置 = 脚底 + (0, HEAD_HEIGHT, 0)
    this.camera.position.set(
      this.position.x,
      this.position.y + CONFIG.HEAD_HEIGHT,
      this.position.z
    );
    // 旋转顺序 YXZ 避免万向锁
    this.camera.rotation.order = 'YXZ';
    this.camera.rotation.y = this.yaw;
    this.camera.rotation.x = this.pitch;
    this.camera.rotation.z = 0;
  }

  /** 同步 state (供 UI 读取) */
  private syncState(): void {
    this.state.position = [this.position.x, this.position.y, this.position.z];
    this.state.rotation = this.yaw;
    this.state.pitch = this.pitch;
  }

  // ---- 一次性输入处理 ----

  private handleOneShots(input: Input, dt: number): void {
    // R: 换弹
    if (input.consumeKey('KeyR')) {
      if (this.onReloadStart) this.onReloadStart();
    }
    // E: 拆 / 埋 / 拾取 -> 由 Game 决定具体动作
    if (input.consumeKey('KeyE')) {
      if (this.onPlantStart) this.onPlantStart();
    }
    // B / G 等暂时只发事件, Game 决定处理
    if (input.consumeKey('KeyB')) {
      bus.emit('player_buy_pressed', { id: this.state.id });
    }
    if (input.consumeKey('KeyG')) {
      bus.emit('player_drop_pressed', { id: this.state.id });
    }

    // 数字键 1-5 切武器
    for (let i = 1; i <= 5; i++) {
      const code = `Digit${i}`;
      if (input.consumeKey(code)) {
        if (i - 1 < this.state.weapons.length) {
          this.setActiveWeaponIndex(i - 1);
        }
      }
    }

    // 滚轮切武器
    if (input.scrollDelta !== 0) {
      const n = this.state.weapons.length;
      if (n > 0) {
        const dir = input.scrollDelta > 0 ? 1 : -1;
        let idx = (this.state.activeWeaponIndex + dir + n) % n;
        if (idx < 0) idx += n;
        this.setActiveWeaponIndex(idx);
      }
    }

    // 主武器开火 (按住的持续键 -> 由 Game 的 WeaponSystem 控制冷却)
    if (input.primaryAttack && this.onShoot) {
      const origin = this.getMuzzleOrigin();
      const dir = this.getAimDir();
      this.onShoot(origin, dir);
    }
  }

  // ---- 枪口 / 朝向辅助 ----

  /** 枪口起点 = 相机位置 (第一人称) */
  getMuzzleOrigin(): Vec3 {
    return [
      this.camera.position.x,
      this.camera.position.y,
      this.camera.position.z
    ];
  }

  /** 瞄准方向 = 相机正前方 */
  getAimDir(): Vec3 {
    const dir = new THREE.Vector3(0, 0, -1);
    dir.applyEuler(this.camera.rotation);
    return [dir.x, dir.y, dir.z];
  }

  /** 取当前 yaw / pitch 的前向 (XZ 平面) */
  getForwardXZ(): Vec3 {
    return [-Math.sin(this.yaw), 0, -Math.cos(this.yaw)];
  }
}
