// 通用工具
type XYZ = { x: number; y: number; z: number };
type Arr3 = [number, number, number];
type Vec3Like = XYZ | Arr3;

export const clamp = (v: number, lo: number, hi: number) =>
  Math.max(lo, Math.min(hi, v));

export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

// 归一化 Vec3 到三元组 [x, y, z]
export function vec3ToArr(v: Vec3Like): Arr3 {
  if (Array.isArray(v)) return [v[0], v[1], v[2]];
  return [v.x, v.y, v.z];
}

export function vec3ToXYZ(v: Vec3Like): XYZ {
  if (Array.isArray(v)) return { x: v[0], y: v[1], z: v[2] };
  return { x: v.x, y: v.y, z: v.z };
}

// 角度规整到 [-PI, PI]
export const wrapAngle = (a: number) => {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
};

// 距离
export const dist2 = (ax: number, az: number, bx: number, bz: number) => {
  const dx = ax - bx, dz = az - bz;
  return Math.sqrt(dx * dx + dz * dz);
};

// 简单确定性随机 (Mulberry32) - 留作后续种子
export function mulberry32(seed: number) {
  let t = seed >>> 0;
  return function () {
    t = (t + 0x6D2B79F5) >>> 0;
    let r = t;
    r = Math.imul(r ^ (r >>> 15), r | 1);
    r ^= r + Math.imul(r ^ (r >>> 7), r | 61);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

export const rand = (a: number, b: number) => a + Math.random() * (b - a);
export const randInt = (a: number, b: number) =>
  Math.floor(a + Math.random() * (b - a + 1));

export const choice = <T>(arr: T[]): T => arr[Math.floor(Math.random() * arr.length)];

export function formatTime(sec: number): string {
  sec = Math.max(0, Math.ceil(sec));
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}
