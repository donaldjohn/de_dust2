// 核心类型定义 - 供整个项目共享

export enum Team {
  T = 'T',
  CT = 'CT'
}

export enum RoundPhase {
  // 比赛未开始 / 回合间隙
  Warmup = 'warmup',
  // 买枪时间 (15s)
  BuyTime = 'buy',
  // 比赛时间 (1:55)
  Live = 'live',
  // 回合结算
  End = 'end',
  // 比赛结束
  MatchOver = 'matchover'
}

export enum WeaponId {
  Knife = 'knife',
  Glock = 'glock',
  USP = 'usp',
  DesertEagle = 'deagle',
  AK47 = 'ak47',
  M4A4 = 'm4a4',
  AWP = 'awp'
}

export enum BombSite {
  A = 'A',
  B = 'B',
  None = 'none'
}

export interface WeaponStats {
  id: WeaponId;
  name: string;
  price: number;          // 0 = 免费 (刀)
  damage: number;         // 单发基础伤害
  headshotMultiplier: number;
  fireRate: number;       // 每分钟发射数
  magazineSize: number;
  reserveAmmo: number;    // 初始备弹
  reloadTime: number;     // 秒
  range: number;          // 子弹最大飞行距离
  spread: number;         // 基础散布 (弧度)
  recoil: number;         // 后坐力 (1.0 = 标准)
  killReward: number;     // 击杀奖励
  team: Team | 'both';    // 谁可以买
  automatic: boolean;
  zoomFOV?: number;       // 瞄准时 FOV
}

export interface WeaponInstance {
  stats: WeaponStats;
  ammoInMag: number;
  reserveAmmo: number;
  lastFireTime: number;
  reloading: boolean;
  reloadStart: number;
}

export interface PlayerState {
  id: string;
  name: string;
  team: Team;
  alive: boolean;
  health: number;
  armor: number;
  helmet: boolean;
  money: number;
  position: [number, number, number];
  rotation: number;       // 水平旋转 (yaw)
  pitch: number;          // 垂直旋转
  weapons: WeaponInstance[];
  activeWeaponIndex: number;
  kills: number;
  deaths: number;
  assists: number;
  // 仅 Bot 用
  isBot?: boolean;
  hasBomb?: boolean;
}

export interface BulletHit {
  shooterId: string;
  victimId: string;
  weaponId: WeaponId;
  damage: number;
  headshot: boolean;
  position: [number, number, number];
}

export interface MatchScore {
  T: number;
  CT: number;
}

export interface RoundResult {
  winner: Team;
  reason:
    | 'elimination'      // 全歼
    | 'bomb_explode'     // 炸弹爆炸
    | 'bomb_defuse'      // 拆包成功
    | 'time_out'         // 时间到 (CT 胜)
    | 'target_saved';    // 时间到 T 未埋包
}

// 简易事件总线
export type GameEvent =
  | { type: 'round_start'; phase: RoundPhase; roundNumber: number }
  | { type: 'round_end'; result: RoundResult; score: MatchScore }
  | { type: 'player_kill'; kill: BulletHit; killer: string; victim: string }
  | { type: 'bomb_planted'; site: BombSite; planter: string }
  | { type: 'bomb_explode'; site: BombSite }
  | { type: 'bomb_defuse'; defuser: string }
  | { type: 'bomb_pickup'; playerId: string }
  | { type: 'match_over'; winner: Team; score: MatchScore };

// 碰撞体 - AABB 盒子 (xz 平面, y 范围)
export interface AABB {
  min: [number, number, number];
  max: [number, number, number];
  // 用于标记
  tag?: string;
}

// 包点定义
export interface BombSiteDef {
  name: BombSite;
  center: [number, number, number];
  radius: number;          // 允许埋/拆的范围
  bounds: AABB;
}

// 出生点
export interface SpawnPoint {
  team: Team;
  position: [number, number, number];
  facing: number;          // 初始朝向
}

// 共享配置常量
export const CONFIG = {
  TICK_RATE: 60,
  ROUNDS_TO_WIN: 8,
  BUY_TIME: 15,
  ROUND_TIME: 115,         // 1:55
  BOMB_TIME: 40,           // 埋下后 40s 爆炸
  DEFUSE_TIME: 10,         // 拆包时间
  FAST_DEFUSE_TIME: 5,     // 有钳子 5s 拆
  PLANT_TIME: 3.2,         // 埋包时间
  RESPAWN_DELAY: 3000,     // 死亡后毫秒
  MOVE_SPEED: 5.0,         // 单位/秒
  SPRINT_MULT: 1.4,
  JUMP_VELOCITY: 6.0,
  GRAVITY: 18.0,
  PLAYER_HEIGHT: 1.7,
  PLAYER_RADIUS: 0.4,
  MOUSE_SENSITIVITY: 0.0022,
  HEAD_HEIGHT: 1.55,       // 头部中心
  CHEST_HEIGHT: 1.1,       // 胸部中心
  STOMACH_HEIGHT: 0.8,
  FEET_HEIGHT: 0.1,
  // 经济
  START_MONEY: 800,
  KILL_REWARD_PISTOL: 300,
  KILL_REWARD_RIFLE: 300,
  KILL_REWARD_AWP: 100,
  KILL_REWARD_KNIFE: 1500,
  LOSS_BONUS_BASE: 1400,
  LOSS_BONUS_INC: 500,     // 连败递增上限 4 次
  LOSS_BONUS_MAX: 3400,
  WIN_BONUS: 3250,

  // ---- 上帝模式 (赵总要求) ----
  // 玩家无敌: 9999 血 + 9999 甲, 几乎不可能死
  GOD_HEALTH: 9999,
  GOD_ARMOR: 9999,
  // 每次重生 (respawnLocalPlayer) 把弹匣装满, 备弹 100000 发
  GOD_MAG_AMMO: 100000,
  GOD_RESERVE_AMMO: 100000
} as const;
