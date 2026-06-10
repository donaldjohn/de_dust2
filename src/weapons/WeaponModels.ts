// 程序化低多边形武器模型
// 用 BoxGeometry / CylinderGeometry 拼出第一/第三人称武器
// 第一人称视角下武器在屏幕右下角, 由 positionForViewmodel 控制
import * as THREE from 'three';
import { WeaponStats, WeaponId } from '../types';

const COLOR_METAL_DARK = 0x222222;
const COLOR_METAL_GREY = 0x4a4a4a;
const COLOR_METAL_LIGHT = 0x9a9a9a;
const COLOR_SILVER = 0xcfd2d6;
const COLOR_WOOD = 0x6b3a1c;
const COLOR_WOOD_DARK = 0x4a2a14;
const COLOR_BLACK = 0x111111;
const COLOR_GRIP = 0x222222;

type Part = THREE.Mesh;

// 通用材质缓存 (避免重复创建)
function mat(color: number, opts: { metal?: number; rough?: number } = {}): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    color,
    metalness: opts.metal ?? 0.6,
    roughness: opts.rough ?? 0.4
  });
}

// --- 各武器构造 ------------------------------------------------------------

function buildKnife(): THREE.Group {
  const g = new THREE.Group();
  // 刀刃: 细长方块
  const blade = new THREE.Mesh(
    new THREE.BoxGeometry(0.04, 0.06, 0.55),
    mat(COLOR_SILVER, { metal: 0.9, rough: 0.15 })
  );
  blade.position.set(0, 0, -0.28);
  g.add(blade);
  // 刀尖
  const tip = new THREE.Mesh(
    new THREE.ConeGeometry(0.03, 0.12, 4),
    mat(COLOR_SILVER, { metal: 0.9, rough: 0.15 })
  );
  tip.rotation.x = -Math.PI / 2;
  tip.position.set(0, 0, -0.6);
  g.add(tip);
  // 护手
  const guard = new THREE.Mesh(
    new THREE.BoxGeometry(0.08, 0.08, 0.04),
    mat(COLOR_METAL_LIGHT, { metal: 0.8, rough: 0.2 })
  );
  guard.position.set(0, 0, 0);
  g.add(guard);
  // 握把: 圆柱
  const grip = new THREE.Mesh(
    new THREE.CylinderGeometry(0.025, 0.03, 0.18, 8),
    mat(COLOR_GRIP, { metal: 0.3, rough: 0.7 })
  );
  grip.position.set(0, -0.06, 0.1);
  g.add(grip);
  return g;
}

function buildGlock(): THREE.Group {
  const g = new THREE.Group();
  // 套筒
  const slide = new THREE.Mesh(
    new THREE.BoxGeometry(0.05, 0.06, 0.32),
    mat(COLOR_METAL_DARK, { metal: 0.7, rough: 0.3 })
  );
  slide.position.set(0, 0.03, -0.05);
  g.add(slide);
  // 握把
  const grip = new THREE.Mesh(
    new THREE.BoxGeometry(0.05, 0.16, 0.09),
    mat(COLOR_BLACK, { metal: 0.3, rough: 0.8 })
  );
  grip.position.set(0, -0.08, 0.04);
  g.add(grip);
  grip.rotation.x = -0.18;
  // 枪管 (小)
  const barrel = new THREE.Mesh(
    new THREE.CylinderGeometry(0.012, 0.012, 0.08, 8),
    mat(COLOR_METAL_GREY, { metal: 0.9, rough: 0.2 })
  );
  barrel.rotation.x = Math.PI / 2;
  barrel.position.set(0, 0.03, -0.24);
  g.add(barrel);
  return g;
}

function buildUSP(): THREE.Group {
  const g = new THREE.Group();
  // 比 Glock 粗一点
  const slide = new THREE.Mesh(
    new THREE.BoxGeometry(0.055, 0.065, 0.34),
    mat(COLOR_METAL_GREY, { metal: 0.7, rough: 0.3 })
  );
  slide.position.set(0, 0.03, -0.05);
  g.add(slide);
  // 消音器 (前端小方块)
  const suppressor = new THREE.Mesh(
    new THREE.CylinderGeometry(0.022, 0.022, 0.12, 10),
    mat(COLOR_BLACK, { metal: 0.5, rough: 0.5 })
  );
  suppressor.rotation.x = Math.PI / 2;
  suppressor.position.set(0, 0.03, -0.27);
  g.add(suppressor);
  // 握把
  const grip = new THREE.Mesh(
    new THREE.BoxGeometry(0.055, 0.17, 0.095),
    mat(COLOR_METAL_DARK, { metal: 0.4, rough: 0.7 })
  );
  grip.position.set(0, -0.08, 0.04);
  grip.rotation.x = -0.18;
  g.add(grip);
  return g;
}

function buildDeagle(): THREE.Group {
  const g = new THREE.Group();
  // 粗壮方形套筒
  const slide = new THREE.Mesh(
    new THREE.BoxGeometry(0.07, 0.08, 0.4),
    mat(COLOR_METAL_LIGHT, { metal: 0.85, rough: 0.18 })
  );
  slide.position.set(0, 0.04, -0.05);
  g.add(slide);
  // 枪管
  const barrel = new THREE.Mesh(
    new THREE.CylinderGeometry(0.018, 0.018, 0.14, 8),
    mat(COLOR_METAL_GREY, { metal: 0.95, rough: 0.15 })
  );
  barrel.rotation.x = Math.PI / 2;
  barrel.position.set(0, 0.04, -0.32);
  g.add(barrel);
  // 大握把
  const grip = new THREE.Mesh(
    new THREE.BoxGeometry(0.065, 0.22, 0.12),
    mat(COLOR_BLACK, { metal: 0.3, rough: 0.8 })
  );
  grip.position.set(0, -0.1, 0.05);
  grip.rotation.x = -0.25;
  g.add(grip);
  // 弹匣底板
  const base = new THREE.Mesh(
    new THREE.BoxGeometry(0.07, 0.025, 0.05),
    mat(COLOR_METAL_GREY, { metal: 0.7, rough: 0.3 })
  );
  base.position.set(0, -0.22, 0.08);
  g.add(base);
  return g;
}

function buildAK47(): THREE.Group {
  const g = new THREE.Group();
  // 枪身主体
  const body = new THREE.Mesh(
    new THREE.BoxGeometry(0.06, 0.07, 0.45),
    mat(COLOR_BLACK, { metal: 0.6, rough: 0.5 })
  );
  body.position.set(0, 0.04, -0.05);
  g.add(body);
  // 木质护木 (棕色方块)
  const handguard = new THREE.Mesh(
    new THREE.BoxGeometry(0.055, 0.06, 0.32),
    mat(COLOR_WOOD, { metal: 0.1, rough: 0.85 })
  );
  handguard.position.set(0, 0.005, -0.32);
  g.add(handguard);
  // 长枪管
  const barrel = new THREE.Mesh(
    new THREE.CylinderGeometry(0.014, 0.014, 0.5, 8),
    mat(COLOR_METAL_DARK, { metal: 0.85, rough: 0.2 })
  );
  barrel.rotation.x = Math.PI / 2;
  barrel.position.set(0, 0.02, -0.62);
  g.add(barrel);
  // 弯曲弹匣
  const mag = new THREE.Mesh(
    new THREE.BoxGeometry(0.04, 0.22, 0.07),
    mat(COLOR_BLACK, { metal: 0.4, rough: 0.6 })
  );
  mag.position.set(0, -0.13, -0.05);
  mag.rotation.x = 0.18;
  g.add(mag);
  // 木质枪托
  const stock = new THREE.Mesh(
    new THREE.BoxGeometry(0.05, 0.08, 0.22),
    mat(COLOR_WOOD_DARK, { metal: 0.1, rough: 0.85 })
  );
  stock.position.set(0, 0.0, 0.18);
  stock.rotation.x = 0.08;
  g.add(stock);
  // 握把
  const grip = new THREE.Mesh(
    new THREE.BoxGeometry(0.05, 0.16, 0.08),
    mat(COLOR_BLACK, { metal: 0.3, rough: 0.7 })
  );
  grip.position.set(0, -0.1, 0.05);
  grip.rotation.x = -0.25;
  g.add(grip);
  return g;
}

function buildM4A4(): THREE.Group {
  const g = new THREE.Group();
  // 枪身
  const body = new THREE.Mesh(
    new THREE.BoxGeometry(0.055, 0.065, 0.46),
    mat(COLOR_METAL_DARK, { metal: 0.7, rough: 0.3 })
  );
  body.position.set(0, 0.04, -0.05);
  g.add(body);
  // 灰色塑料护木 (比 AK 直)
  const handguard = new THREE.Mesh(
    new THREE.BoxGeometry(0.055, 0.065, 0.34),
    mat(COLOR_METAL_GREY, { metal: 0.3, rough: 0.6 })
  );
  handguard.position.set(0, 0.005, -0.32);
  g.add(handguard);
  // 枪管
  const barrel = new THREE.Mesh(
    new THREE.CylinderGeometry(0.012, 0.012, 0.42, 8),
    mat(COLOR_METAL_DARK, { metal: 0.85, rough: 0.2 })
  );
  barrel.rotation.x = Math.PI / 2;
  barrel.position.set(0, 0.02, -0.6);
  g.add(barrel);
  // 直弹匣
  const mag = new THREE.Mesh(
    new THREE.BoxGeometry(0.04, 0.2, 0.07),
    mat(COLOR_BLACK, { metal: 0.4, rough: 0.6 })
  );
  mag.position.set(0, -0.12, -0.05);
  g.add(mag);
  // 枪托 (可伸缩样式: 细管)
  const stock = new THREE.Mesh(
    new THREE.BoxGeometry(0.045, 0.06, 0.22),
    mat(COLOR_METAL_DARK, { metal: 0.5, rough: 0.4 })
  );
  stock.position.set(0, 0.0, 0.18);
  g.add(stock);
  // 握把
  const grip = new THREE.Mesh(
    new THREE.BoxGeometry(0.05, 0.16, 0.08),
    mat(COLOR_BLACK, { metal: 0.3, rough: 0.7 })
  );
  grip.position.set(0, -0.1, 0.05);
  grip.rotation.x = -0.25;
  g.add(grip);
  // 提把 (顶部)
  const carry = new THREE.Mesh(
    new THREE.BoxGeometry(0.04, 0.03, 0.18),
    mat(COLOR_BLACK, { metal: 0.4, rough: 0.5 })
  );
  carry.position.set(0, 0.09, 0.0);
  g.add(carry);
  return g;
}

function buildAWP(): THREE.Group {
  const g = new THREE.Group();
  // 粗壮枪身
  const body = new THREE.Mesh(
    new THREE.BoxGeometry(0.075, 0.085, 0.6),
    mat(COLOR_METAL_DARK, { metal: 0.7, rough: 0.4 })
  );
  body.position.set(0, 0.04, -0.05);
  g.add(body);
  // 长枪管
  const barrel = new THREE.Mesh(
    new THREE.CylinderGeometry(0.018, 0.018, 0.7, 10),
    mat(COLOR_METAL_DARK, { metal: 0.9, rough: 0.18 })
  );
  barrel.rotation.x = Math.PI / 2;
  barrel.position.set(0, 0.02, -0.7);
  g.add(barrel);
  // 枪管护罩
  const shroud = new THREE.Mesh(
    new THREE.CylinderGeometry(0.025, 0.025, 0.32, 8),
    mat(COLOR_BLACK, { metal: 0.4, rough: 0.6 })
  );
  shroud.rotation.x = Math.PI / 2;
  shroud.position.set(0, 0.02, -0.55);
  g.add(shroud);
  // 大瞄准镜
  const scope = new THREE.Mesh(
    new THREE.CylinderGeometry(0.04, 0.04, 0.22, 12),
    mat(COLOR_BLACK, { metal: 0.5, rough: 0.4 })
  );
  scope.rotation.x = Math.PI / 2;
  scope.position.set(0, 0.11, -0.05);
  g.add(scope);
  // 瞄准镜前环
  const ringFront = new THREE.Mesh(
    new THREE.TorusGeometry(0.045, 0.008, 6, 16),
    mat(COLOR_METAL_GREY, { metal: 0.8, rough: 0.2 })
  );
  ringFront.rotation.y = Math.PI / 2;
  ringFront.position.set(0, 0.11, -0.16);
  g.add(ringFront);
  // 瞄准镜后环
  const ringBack = new THREE.Mesh(
    new THREE.TorusGeometry(0.045, 0.008, 6, 16),
    mat(COLOR_METAL_GREY, { metal: 0.8, rough: 0.2 })
  );
  ringBack.rotation.y = Math.PI / 2;
  ringBack.position.set(0, 0.11, 0.06);
  g.add(ringBack);
  // 弹匣
  const mag = new THREE.Mesh(
    new THREE.BoxGeometry(0.045, 0.18, 0.08),
    mat(COLOR_BLACK, { metal: 0.4, rough: 0.6 })
  );
  mag.position.set(0, -0.11, -0.05);
  mag.rotation.x = 0.12;
  g.add(mag);
  // 枪托
  const stock = new THREE.Mesh(
    new THREE.BoxGeometry(0.06, 0.09, 0.26),
    mat(COLOR_METAL_DARK, { metal: 0.5, rough: 0.4 })
  );
  stock.position.set(0, 0.0, 0.22);
  g.add(stock);
  // 握把
  const grip = new THREE.Mesh(
    new THREE.BoxGeometry(0.055, 0.17, 0.085),
    mat(COLOR_BLACK, { metal: 0.3, rough: 0.7 })
  );
  grip.position.set(0, -0.1, 0.05);
  grip.rotation.x = -0.25;
  g.add(grip);
  return g;
}

// --- 入口 ------------------------------------------------------------------

export function buildWeaponModel(stats: WeaponStats): THREE.Group {
  const group = new THREE.Group();
  group.name = `WeaponModel_${stats.id}`;
  let model: THREE.Group;
  switch (stats.id) {
    case WeaponId.Knife:       model = buildKnife(); break;
    case WeaponId.Glock:       model = buildGlock(); break;
    case WeaponId.USP:         model = buildUSP(); break;
    case WeaponId.DesertEagle: model = buildDeagle(); break;
    case WeaponId.AK47:        model = buildAK47(); break;
    case WeaponId.M4A4:        model = buildM4A4(); break;
    case WeaponId.AWP:         model = buildAWP(); break;
    default:                   model = buildKnife();
  }
  // 武器几何中心在 (0,0,0), z 负方向为枪口
  group.add(model);
  // 投阴影 (提高真实感)
  group.traverse(o => {
    const m = o as THREE.Mesh;
    if (m.isMesh) {
      m.castShadow = false; // 第一人称武器不需要投阴影
    }
  });
  return group;
}

/**
 * 把武器放到第一/第三人称合适位置
 * - 屏幕右下角, 略微向内 (z 负方向 = 前方)
 * - 瞄准时, 拉近 + 抬高到屏幕中央
 */
export function positionForViewmodel(group: THREE.Group, aiming: boolean, isAwp: boolean): void {
  // 基础位置 (非瞄准): 右下角
  // 调整量已根据 AWP 体积较大做了适配
  const baseX = isAwp ? 0.18 : 0.22;
  const baseY = isAwp ? -0.22 : -0.28;
  const baseZ = isAwp ? -0.42 : -0.38;
  if (aiming) {
    // 瞄准: 推到屏幕中心
    group.position.set(0.0, isAwp ? -0.05 : -0.08, -0.32);
    // 武器相对自身中心稍向下偏移 (枪管朝前)
    // 额外旋转让 AWP 居中
  } else {
    group.position.set(baseX, baseY, baseZ);
  }
  // 角度: 微微向下倾斜
  group.rotation.set(isAwp ? 0 : 0.04, isAwp ? 0 : 0.02, 0);
}
