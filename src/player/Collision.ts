// 玩家与 AABB 碰撞检测 (简化版 swept capsule vs AABB)
//
// 模型:
//   玩家: XZ 平面是半径 r 的圆 + 高度 h 的胶囊
//   Y 方向: 胶囊从 feet (y=0) 延伸到 y=h
//   AABB  : min/max 立方体 (xz 平面, y 范围)
//
// 实现策略 (按轴分离轴, 避免斜角穿墙):
//   1) 先算 Y 位移 -> 临时 pos + Y -> 检测 vs 胶囊 Y 段 -> 修正 Y, 记 grounded
//   2) 再算 X 位移 -> 检测 -> 修正
//   3) 再算 Z 位移 -> 检测 -> 修正
//
// 碰撞条件 (XZ 圆 vs AABB 矩形):
//   找到矩形上离圆心最近的点, 若距离 < 半径 -> 相交
//   把圆心拉回到 (radius) 距离的位置即可
import * as THREE from 'three';
import { AABB } from '../types';

interface ResolveResult {
  position: THREE.Vector3;
  grounded: boolean;
}

type Axis = 'x' | 'y' | 'z';

export class Collision {
  /**
   * 沿 velocity 推进 dt 秒, 修正碰撞. 返回修正后的位置 + 是否着地.
   * 注意: 此函数不会修改 pos 和 velocity 本身, 返回新对象.
   * 调用方需把结果写回 state.
   */
  static resolveMove(
    pos: THREE.Vector3,
    velocity: THREE.Vector3,
    radius: number,
    height: number,
    colliders: AABB[],
    dt: number
  ): ResolveResult {
    const out = pos.clone();
    let grounded = false;

    // ---- Y 轴 ----
    const dy = velocity.y * dt;
    if (dy !== 0) {
      out.y += dy;
      const correction = this.snapToSurface(out, 'y', dy > 0, radius, height, colliders);
      if (correction !== null) {
        out.y = correction;
        if (dy < 0) {
          // 向下, 撞到地面 -> 着地
          grounded = true;
        }
        velocity.y = 0;
      }
    }

    // ---- X 轴 ----
    const dx = velocity.x * dt;
    if (dx !== 0) {
      out.x += dx;
      const correction = this.snapToSurface(out, 'x', dx > 0, radius, height, colliders);
      if (correction !== null) {
        out.x = correction;
        velocity.x = 0;
      }
    }

    // ---- Z 轴 ----
    const dz = velocity.z * dt;
    if (dz !== 0) {
      out.z += dz;
      const correction = this.snapToSurface(out, 'z', dz > 0, radius, height, colliders);
      if (correction !== null) {
        out.z = correction;
        velocity.z = 0;
      }
    }

    // 安全网: 如果当前位置已经在某个 collider 内部 (例如被刷出 / 几何重叠)
    // 找最近的面, 把它拉回表面外
    for (let i = 0; i < colliders.length; i++) {
      const c = colliders[i];
      if (this.capsuleIntersectsAABB(out, radius, height, c)) {
        const push = this.pushOutOfAABB(out, radius, height, c);
        if (push) {
          out.copy(push.pos);
          if (push.axis === 'y' && push.normalY < 0) grounded = true;
        }
      }
    }

    return { position: out, grounded };
  }

  // ---- 内部: 单轴方向检测 + 修正 ----

  /**
   * 检测 pos 处的胶囊是否与 colliders 任意一个相交.
   * 如果是, 沿 axis 方向 (positive = +X/+Y/+Z) 把它拉回到该面 + 半径 (XZ) / 端 (Y) 外.
   * 返回修正后的轴坐标, 或 null 表示没碰撞.
   */
  private static snapToSurface(
    pos: THREE.Vector3,
    axis: Axis,
    positive: boolean,
    radius: number,
    height: number,
    colliders: AABB[]
  ): number | null {
    for (let i = 0; i < colliders.length; i++) {
      const c = colliders[i];
      if (!this.capsuleIntersectsAABB(pos, radius, height, c)) continue;

      // 决定推回方向:
      // X / Z: 沿运动反方向的面, 让圆心与该面相距 radius
      // Y:     向下 -> a.min[1] (脚底贴地); 向上 -> a.max[1] - height (头顶贴天花板)
      let newVal: number;
      if (axis === 'y') {
        if (positive) {
          // 向上运动 -> 撞到顶面
          newVal = c.max[1] - height;
        } else {
          // 向下运动 -> 撞到底面 (脚)
          newVal = c.min[1];
        }
      } else if (axis === 'x') {
        newVal = positive ? c.max[0] + radius : c.min[0] - radius;
      } else {
        newVal = positive ? c.max[2] + radius : c.min[2] - radius;
      }
      return newVal;
    }
    return null;
  }

  /** 胶囊(在 pos 位置)是否与 aabb 相交 (XZ 圆 + Y 段) */
  private static capsuleIntersectsAABB(
    pos: THREE.Vector3,
    radius: number,
    height: number,
    a: AABB
  ): boolean {
    // Y 段必须重叠
    const yOverlap =
      pos.y + height > a.min[1] && pos.y < a.max[1];
    if (!yOverlap) return false;

    // XZ 圆 vs AABB 矩形
    const cx = clamp(pos.x, a.min[0], a.max[0]);
    const cz = clamp(pos.z, a.min[2], a.max[2]);
    const dx = pos.x - cx;
    const dz = pos.z - cz;
    return dx * dx + dz * dz < radius * radius;
  }

  /**
   * 已经在 aabb 内部 -> 找"最近的"6 个面中代价最小的一个推出.
   * 用于起点在内部 / 数值误差导致压入的情况.
   */
  private static pushOutOfAABB(
    pos: THREE.Vector3,
    radius: number,
    height: number,
    a: AABB
  ): { pos: THREE.Vector3; axis: Axis; normalY: number } | null {
    type Cand = { axis: Axis; newPos: THREE.Vector3; normalY: number; cost: number };
    const cands: Cand[] = [];

    // -X 推出
    {
      const np = pos.clone();
      np.x = a.min[0] - radius;
      cands.push({ axis: 'x', newPos: np, normalY: 0, cost: Math.abs(np.x - pos.x) });
    }
    // +X 推出
    {
      const np = pos.clone();
      np.x = a.max[0] + radius;
      cands.push({ axis: 'x', newPos: np, normalY: 0, cost: Math.abs(np.x - pos.x) });
    }
    // -Z 推出
    {
      const np = pos.clone();
      np.z = a.min[2] - radius;
      cands.push({ axis: 'z', newPos: np, normalY: 0, cost: Math.abs(np.z - pos.z) });
    }
    // +Z 推出
    {
      const np = pos.clone();
      np.z = a.max[2] + radius;
      cands.push({ axis: 'z', newPos: np, normalY: 0, cost: Math.abs(np.z - pos.z) });
    }
    // -Y 推出 (落到 a.min[1] -> 着地)
    {
      const np = pos.clone();
      np.y = a.min[1];
      cands.push({ axis: 'y', newPos: np, normalY: -1, cost: Math.abs(np.y - pos.y) });
    }
    // +Y 推出 (顶到 a.max[1])
    {
      const np = pos.clone();
      np.y = a.max[1] - height;
      cands.push({ axis: 'y', newPos: np, normalY: +1, cost: Math.abs(np.y - pos.y) });
    }

    cands.sort((p, q) => p.cost - q.cost);
    const best = cands[0];
    return { pos: best.newPos, axis: best.axis, normalY: best.normalY };
  }

  // ---- 公开: 简易单点圆形检测 (供其它模块用) ----

  /** 圆 (x, z, r) 是否与 aabb 相交 (XZ 平面) */
  static circleVsAABB(x: number, z: number, r: number, a: AABB): boolean {
    const cx = clamp(x, a.min[0], a.max[0]);
    const cz = clamp(z, a.min[2], a.max[2]);
    const dx = x - cx;
    const dz = z - cz;
    return dx * dx + dz * dz < r * r;
  }
}

// 内联 clamp 避免再 import
function clamp(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, v));
}
