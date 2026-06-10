// 子弹轨迹 (曳光弹) 渲染
// 用 Line / LineBasicMaterial 显示一条 0.05s 后消失的细线
import * as THREE from 'three';

type Vec3 = [number, number, number];

interface TracerEntry {
  line: THREE.Line;
  end: THREE.Vector3;
  ttl: number; // 剩余生存时间
  maxTtl: number;
}

const TRACER_COLOR = 0xffeeaa;
const MAX_TRACERS = 30;
const DEFAULT_LIFETIME = 0.05; // 50ms

export class TracerManager {
  group: THREE.Group;
  private entries: TracerEntry[] = [];
  private material: THREE.LineBasicMaterial;

  constructor() {
    this.group = new THREE.Group();
    this.group.name = 'TracerGroup';
    this.material = new THREE.LineBasicMaterial({
      color: TRACER_COLOR,
      transparent: true,
      opacity: 0.95,
      linewidth: 1, // WebGL 限制: 大多数实现下为 1
      depthWrite: false
    });
  }

  /**
   * 显示一条从 origin 沿 dir 方向, 长度 = range 的曳光弹
   * @param origin 起点
   * @param dir 单位方向
   * @param range 飞行距离
   */
  fire(origin: Vec3, dir: Vec3, range: number): void {
    // 超过上限, 移除最旧的
    if (this.entries.length >= MAX_TRACERS) {
      const old = this.entries.shift();
      if (old) this.group.remove(old.line);
    }
    const o = new THREE.Vector3(origin[0], origin[1], origin[2]);
    // 稍微加一点随机偏移, 看起来更自然
    const d = new THREE.Vector3(dir[0], dir[1], dir[2]).normalize();
    const end = o.clone().add(d.multiplyScalar(range));

    const geo = new THREE.BufferGeometry().setFromPoints([o, end]);
    const line = new THREE.Line(geo, this.material);
    line.frustumCulled = false;
    line.renderOrder = 5;
    this.group.add(line);

    this.entries.push({ line, end, ttl: DEFAULT_LIFETIME, maxTtl: DEFAULT_LIFETIME });
  }

  update(dt: number): void {
    if (this.entries.length === 0) return;
    const survivors: TracerEntry[] = [];
    for (const e of this.entries) {
      e.ttl -= dt;
      if (e.ttl <= 0) {
        this.group.remove(e.line);
        e.line.geometry.dispose();
      } else {
        // 渐渐淡出
        const alpha = e.ttl / e.maxTtl;
        // material 共享, 不能单独改; 用 line.material 不行(也是共享), 这里用 scale 模拟淡出 (缩线长度)
        // 简化: 不改透明度, 直接保留, 视觉上短 ttl 不明显
        survivors.push(e);
      }
    }
    this.entries = survivors;
  }

  /**
   * 清空所有 tracer
   */
  clear(): void {
    for (const e of this.entries) {
      this.group.remove(e.line);
      e.line.geometry.dispose();
    }
    this.entries = [];
  }

  dispose(): void {
    this.clear();
    this.material.dispose();
  }
}
