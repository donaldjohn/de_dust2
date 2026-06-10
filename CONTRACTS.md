# 模块契约 - 各 subagent 遵守的接口约定

所有 subagent 必须阅读 `src/types/index.ts` 了解共享类型。

## 命名与导入
- 不要 import 任何尚未存在的文件 (除非是 `types/` 或 `utils/`)
- 你的模块只导出你负责的接口, 不要修改别人的文件
- 在 `src/<你的模块>/` 下工作

## 公共共享 (在 src/types/ 和 src/utils/)
- `src/types/index.ts` - 全部类型与 CONFIG
- `src/utils/util.ts` - clamp, lerp, dist2, rand, formatTime 等
- `src/utils/events.ts` - 事件总线 `bus`
- `src/weapons/weapons.db.ts` - 武器数据库 (WEAPONS, BUY_LIST)

## 模块 1: 场景地图 (src/scene/)
**导出**:
- `class Map { scene: THREE.Scene; colliders: AABB[]; spawns: SpawnPoint[]; sites: BombSiteDef[]; waypoints: Vec3[]; build(): void; update(dt): void; }`
- 静态导出 `DUST2_LAYOUT` - 玩家和 Bot 共享的地图信息
- 命名空间: `Map` 类
- 颜色: 沙漠色调 (米黄/沙土/锈红)

## 模块 2: 玩家控制 (src/player/)
**导出**:
- `class PlayerController { update(dt, input, colliders): void; get position(): Vec3; get velocity(): Vec3; get yaw/pitch: number; get isGrounded: bool; applyDamage(dmg): void; get state: PlayerState; }`
- 需要从外部 `Game` 拿到武器发射回调

## 模块 3: 武器 (src/weapons/)
**导出**:
- `class WeaponSystem { weapons: WeaponInstance[]; activeIndex; fire(): void; reload(): void; switchTo(idx): void; addWeapon(stats): void; update(dt, camera, input): void; onHit?: (hit: BulletHit) => void; }`

## 模块 4: 比赛/回合 (src/gameplay/Match.ts)
**导出**:
- `class Match { phase: RoundPhase; timeLeft: number; score: MatchScore; round: number; players: Map<string, PlayerState>; start(): void; update(dt, players): void; buy(uid, wid): void; plant(uid, site): void; defuse(uid): void; }`

## 模块 5: Bot AI (src/gameplay/Bot.ts)
**导出**:
- `class Bot { update(dt, world): void; fire(): void; takeDamage(dmg, hitPos): void; state: PlayerState; }`
- `world` 包含其他玩家位置, 地图 waypoints, 可见性检测函数

## 模块 6: UI (src/ui/)
**导出**:
- `class HUD { bind(match, player): void; update(): void; showKill(killer, victim, hs): void; showMessage(text): void; }`
- `class BuyMenu { open(money, team): void; close(): void; onBuy?: (id) => void; }`
- 所有 DOM 写入都集中在这里, 其他模块通过 bus 通信

## 模块 7: 灯光天空 (src/scene/Lighting.ts)
**导出**:
- `class Lighting { group: THREE.Group; build(scene): void; update(dt): void; }`

## 总入口 (src/Game.ts, src/main.ts) - 我亲自写
所有模块的整合在主入口完成。subagent 不要碰 main.ts, Game.ts, 也不要 import 其它 subagent 的文件。
如果你的模块需要触发事件,用 `import { bus } from '../utils/events'; bus.emit('xxx', payload)`
