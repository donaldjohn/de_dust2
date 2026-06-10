// Pathfinder.ts - 简易 Waypoint 导航
// 用 BFS 在 waypoint 导航图上找最短路径

import * as THREE from 'three';

export interface NavEdge {
  from: number;
  to: number;
}

export class Pathfinder {
  // 邻接表: waypoint index -> 邻接 waypoint index[]
  private adj: Map<number, number[]> = new Map();

  /**
   * 用 edges 构建邻接表。
   * 自动加双向边, 这样无向图也能用。
   */
  build(waypoints: THREE.Vector3[], edges: { from: number; to: number }[]): void {
    this.adj.clear();
    for (let i = 0; i < waypoints.length; i++) {
      this.adj.set(i, []);
    }
    for (const e of edges) {
      if (e.from < 0 || e.to < 0) continue;
      if (e.from >= waypoints.length || e.to >= waypoints.length) continue;
      const a = this.adj.get(e.from);
      const b = this.adj.get(e.to);
      if (a && !a.includes(e.to)) a.push(e.to);
      if (b && !b.includes(e.from)) b.push(e.from);
    }
  }

  /** 找离 pos 最近的 waypoint 索引 (在 maxDist 半径内), 没找到返回 -1 */
  findNearest(pos: THREE.Vector3, waypoints: THREE.Vector3[], maxDist = Infinity): number {
    let best = -1;
    let bestD2 = maxDist * maxDist;
    for (let i = 0; i < waypoints.length; i++) {
      const wp = waypoints[i];
      const dx = wp.x - pos.x;
      const dz = wp.z - pos.z;
      const d2 = dx * dx + dz * dz;
      if (d2 < bestD2) {
        bestD2 = d2;
        best = i;
      }
    }
    return best;
  }

  /**
   * 在导航图上 BFS 找 fromIdx -> toIdx 的最短路径 (节点 index 列表)
   * 找不到返回 []
   */
  findPathIdx(fromIdx: number, toIdx: number): number[] {
    if (fromIdx === toIdx) return fromIdx >= 0 ? [fromIdx] : [];
    if (fromIdx < 0 || toIdx < 0) return [];

    const visited = new Set<number>();
    const parent = new Map<number, number>();
    const queue: number[] = [fromIdx];
    visited.add(fromIdx);

    while (queue.length > 0) {
      const cur = queue.shift()!;
      const neighbors = this.adj.get(cur) ?? [];
      for (const n of neighbors) {
        if (visited.has(n)) continue;
        visited.add(n);
        parent.set(n, cur);
        if (n === toIdx) {
          // 重建路径
          const path: number[] = [n];
          let p = cur;
          while (p !== fromIdx) {
            path.unshift(p);
            const pp = parent.get(p);
            if (pp === undefined) return [];
            p = pp;
          }
          path.unshift(fromIdx);
          return path;
        }
        queue.push(n);
      }
    }
    return [];
  }

  /**
   * 从 pos 找一条到 target 的路径 (Vector3 列表, 不含起点)
   * 先用 findNearest + findPathIdx, 再把节点 index 翻译成 Vector3
   */
  findPath(
    pos: THREE.Vector3,
    target: THREE.Vector3,
    waypoints: THREE.Vector3[]
  ): THREE.Vector3[] {
    const fromIdx = this.findNearest(pos, waypoints);
    const toIdx = this.findNearest(target, waypoints);
    if (fromIdx < 0 || toIdx < 0) return [];
    if (fromIdx === toIdx) return [target.clone()];

    const idxPath = this.findPathIdx(fromIdx, toIdx);
    if (idxPath.length === 0) {
      // 找不到图上的路径, 退化到直接走过去
      return [target.clone()];
    }
    // 跳过起点节点 (我们已经在它附近)
    const out: THREE.Vector3[] = [];
    for (let i = 1; i < idxPath.length; i++) {
      out.push(waypoints[idxPath[i]].clone());
    }
    out.push(target.clone());
    return out;
  }

  /**
   * 给 bot 当前 pos + 目标 target, 返回下一步要去的点 (含简单的方向修正)
   * 内部维护 bot 的 currentPath, 跨帧调用更高效
   */
  getNextWaypoint(
    botPos: THREE.Vector3,
    target: THREE.Vector3,
    waypoints: THREE.Vector3[],
    cachedPath: number[],
    arrivalDist = 1.0
  ): { next: THREE.Vector3; path: number[]; done: boolean } {
    // 计算离 bot 最近的 waypoint, 判断是否需要重算路径
    const nearestIdx = this.findNearest(botPos, waypoints, 4.0);

    let path = cachedPath;
    if (path.length === 0) {
      const fromIdx = nearestIdx >= 0 ? nearestIdx : -1;
      const toIdx = this.findNearest(target, waypoints);
      if (toIdx < 0) {
        return { next: target.clone(), path: [], done: true };
      }
      if (fromIdx < 0) {
        // 找不到起点, 直接朝目标走
        return { next: target.clone(), path: [], done: false };
      }
      path = this.findPathIdx(fromIdx, toIdx);
    }

    if (path.length === 0) {
      return { next: target.clone(), path: [], done: false };
    }

    // 跳过已经走过的中间点
    while (path.length > 1) {
      const head = waypoints[path[1]];
      if (!head) break;
      const dx = head.x - botPos.x;
      const dz = head.z - botPos.z;
      if (dx * dx + dz * dz <= arrivalDist * arrivalDist) {
        path = path.slice(1);
      } else {
        break;
      }
    }

    const headIdx = path[1] ?? path[0];
    if (headIdx === undefined) {
      return { next: target.clone(), path: [], done: true };
    }
    return {
      next: waypoints[headIdx].clone(),
      path,
      done: false
    };
  }
}
