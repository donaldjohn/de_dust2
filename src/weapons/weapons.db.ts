// 武器数据库 - 所有武器的静态数据
import { WeaponId, WeaponStats, Team } from '../types';

// CS2 风格数值 (低多边形项目 - 数值向 CS 致敬, 略有调整保证平衡)
export const WEAPONS: Record<WeaponId, WeaponStats> = {
  [WeaponId.Knife]: {
    id: WeaponId.Knife,
    name: '匕首',
    price: 0,
    damage: 40,
    headshotMultiplier: 4.0,
    fireRate: 500,
    magazineSize: 999,
    reserveAmmo: 0,
    reloadTime: 0,
    range: 2.2,
    spread: 0,
    recoil: 0,
    killReward: 1500,
    team: 'both',
    automatic: false
  },
  [WeaponId.Glock]: {
    id: WeaponId.Glock,
    name: '格洛克 18',
    price: 0,           // T 初始免费
    damage: 23,
    headshotMultiplier: 1.5,
    fireRate: 400,
    magazineSize: 20,
    reserveAmmo: 120,
    reloadTime: 2.2,
    range: 60,
    spread: 0.012,
    recoil: 0.6,
    killReward: 300,
    team: Team.T,
    automatic: false
  },
  [WeaponId.USP]: {
    id: WeaponId.USP,
    name: 'USP 消音',
    price: 0,           // CT 初始免费
    damage: 28,
    headshotMultiplier: 1.6,
    fireRate: 350,
    magazineSize: 12,
    reserveAmmo: 24,
    reloadTime: 2.1,
    range: 70,
    spread: 0.008,
    recoil: 0.5,
    killReward: 300,
    team: Team.CT,
    automatic: false
  },
  [WeaponId.DesertEagle]: {
    id: WeaponId.DesertEagle,
    name: '沙漠之鹰',
    price: 700,
    damage: 63,
    headshotMultiplier: 2.0,
    fireRate: 200,
    magazineSize: 7,
    reserveAmmo: 35,
    reloadTime: 2.3,
    range: 100,
    spread: 0.022,
    recoil: 1.6,
    killReward: 300,
    team: 'both',
    automatic: false
  },
  [WeaponId.AK47]: {
    id: WeaponId.AK47,
    name: 'AK-47',
    price: 2700,
    damage: 36,
    headshotMultiplier: 2.0,
    fireRate: 600,
    magazineSize: 30,
    reserveAmmo: 90,
    reloadTime: 2.5,
    range: 130,
    spread: 0.015,
    recoil: 1.3,
    killReward: 300,
    team: Team.T,
    automatic: true
  },
  [WeaponId.M4A4]: {
    id: WeaponId.M4A4,
    name: 'M4A4',
    price: 3100,
    damage: 33,
    headshotMultiplier: 1.8,
    fireRate: 666,
    magazineSize: 30,
    reserveAmmo: 90,
    reloadTime: 3.1,
    range: 130,
    spread: 0.011,
    recoil: 1.0,
    killReward: 300,
    team: Team.CT,
    automatic: true
  },
  [WeaponId.AWP]: {
    id: WeaponId.AWP,
    name: 'AWP',
    price: 4750,
    damage: 115,
    headshotMultiplier: 1.0,   // 身体 1 枪也死
    fireRate: 41,             // ~1.4s 间隔
    magazineSize: 10,
    reserveAmmo: 30,
    reloadTime: 3.5,
    range: 250,
    spread: 0.001,            // 极低散布
    recoil: 2.2,
    killReward: 100,
    team: 'both',
    automatic: false,
    zoomFOV: 25
  }
};

// 买枪阶段可买武器 (按阵营)
export const BUY_LIST: Record<Team, WeaponId[]> = {
  [Team.T]: [
    WeaponId.Glock,
    WeaponId.DesertEagle,
    WeaponId.AK47,
    WeaponId.AWP
  ],
  [Team.CT]: [
    WeaponId.USP,
    WeaponId.DesertEagle,
    WeaponId.M4A4,
    WeaponId.AWP
  ]
};
