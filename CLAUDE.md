# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目

**de_dust2 — Three.js 5v5 对战 FPS**。CS2 风格 de_dust2 地图的低多边形重制，玩家 T 阵营 vs 9 个 Bot（4 队友 T + 5 敌人 CT）。回合制比赛、买枪系统、C4 埋/拆包、完整 HUD、汉化 UI、击杀反馈（飘字 + hit marker + 血条）、程序化合成音效、上帝模式。

技术栈：Vite 5 + TypeScript 5 + three.js 0.160（无 React/Vue，无 Tailwind）。

## 常用命令

```bash
npm install                              # 装依赖
npm run dev                              # 启动 Vite dev server (http://localhost:5173)
npm run build                            # tsc 类型检查 + vite 打包
npm run preview                          # 预览构建产物
npx tsc --noEmit                         # 仅类型检查，不输出文件
```

无测试框架（Vitest/Jest 都没装）。E2E 验证靠 Chrome DevTools MCP 实际跑游戏。

## 架构

单页应用，无路由、无状态管理库。`src/main.ts` → `new Game(canvas)` → 帧循环。

### 顶层模块依赖（Game.ts 是整合器）

```
main.ts
└── Game.ts                                    ─ 整合器: 帧循环 / 事件路由 / 资源管理
    ├── scene/Map.ts                           ─ 地图: colliders[]/spawns[]/sites[]/layout.waypoints
    ├── scene/Lighting.ts                      ─ 阳光 + 半球光
    ├── scene/Sky.ts                           ─ 球形天空盒 ShaderMaterial
    ├── player/Player.ts                       ─ 第一人称控制 + 死亡后 noclip 上帝模式
    ├── player/Controls.ts                     ─ Input 类: 键鼠状态、pointer lock
    ├── player/Collision.ts                    ─ 静态方法: AABB swept-capsule 碰撞 (按轴分离)
    ├── weapons/WeaponSystem.ts                ─ 玩家武器管理: 散布/后坐力/换弹/弹道/命中
    ├── weapons/WeaponModels.ts                ─ 程序化 Box+Cylinder 拼的 7 把枪模型
    ├── weapons/Tracer.ts                      ─ 曳光弹 line (MAX_TRACERS=30, 50ms ttl)
    ├── weapons/weapons.db.ts                  ─ 武器静态数据库 (伤害/价格/射速, 中文 name)
    ├── weapons/HitFeedback.ts                 ─ 3D 飘字 + 屏幕 hit marker (CSS div)
    ├── gameplay/Match.ts                      ─ 回合状态机: Warmup→BuyTime→Live→End→... + 经济
    ├── gameplay/Bot.ts                        ─ Bot AI: FSM + 死后侧倒 (±π/2 随机)
    ├── gameplay/Pathfinder.ts                 ─ Waypoint BFS 寻路
    ├── gameplay/HealthBar.ts                  ─ Bot 头顶 3D 血条 (Plane + BasicMaterial, 朝相机)
    ├── ui/HUD.ts                              ─ 所有 HUD DOM, 订阅 bus 事件, 中文文案
    ├── ui/BuyMenu.ts                          ─ 买枪菜单
    ├── audio/AudioManager.ts                  ─ WebAudio 程序化合成音效 (无音频文件)
    └── utils/events.ts                        ─ 全局 EventBus (bus.on / bus.emit)
```

### 关键共享

- **`src/types/index.ts`**：枚举（Team/WeaponId/RoundPhase/BombSite）、CONFIG（移动速度/重力/经济/**上帝模式**）、所有 interface
- **`src/utils/events.ts`**：`bus` 单例。模块间松耦合通信：`bus.emit('player_kill', {...})`，`bus.on('round_end', ...)`
- **`src/utils/util.ts`**：clamp/lerp/formatTime/vec3ToArr 等

## Game.ts 帧循环

```ts
// update(dt) 分三段：
//  1) 玩家控制 (alive): primaryAttack -> weapons.startFire; 死了强制 stopFire 走 noclip
//  2) 永远跑的部分: 埋/拆进度、Bots、Match、HUD、Bot 血条 lookAt(camera)、HitFeedback.update
//  3) 最后调 input.update() 清零 mouseDX/DY/scrollDelta (放最后是关键, 之前放开头导致鼠标失效)
// render(): sky.update 跟随相机 + renderer.render
```

## 跨模块通信模式

1. **回调（高频/低延迟）**：`onShoot`/`onHit`/`onMove`/`onPlantStart`/`onShoot`/`onFire`/`onHit` 直接传函数
2. **事件总线（异步/广播）**：
   - 战斗: `player_hit` `player_hit_hurt` `player_kill` `player_died`
   - 武器: `weapon_fire` `weapon_reload` `weapon_pickup` `weapon_drop` `weapon_switch` `weapon_reload_done` `weapon_empty` `bullet_impact`
   - 比赛: `round_start` `round_end` `match_over` `bomb_planted` `bomb_explode` `bomb_defuse`
   - UI: `buy_weapon` `player_buy_pressed` `player_drop_pressed` `ui_buy_open` `ui_buy_close`
3. **状态快照（每帧）**：`buildWorldSnapshot()` 喂给 `Match.update` / `Bot.update`

### 事件格式约束（重要！避免之前死循环 bug）
- `player_kill` payload **必须是** `{ killer, victim, hs, weapon }` — Game listener 期望这 4 个字段
- 之前 `Match.onPlayerKilled` 和 `Bot.takeDamage` 各自 emit `player_kill` + Game listener 监听 = 死循环
- 修法: `Match.onPlayerKilled` 不再 emit, 统一由 Game 层 `handleHit` 调 `match.onPlayerKilled` + emit

## 上帝模式（赵总专用开关）

`CONFIG.GOD_HEALTH = 9999` / `CONFIG.GOD_ARMOR = 9999` / `CONFIG.GOD_MAG_AMMO = 100000` / `CONFIG.GOD_RESERVE_AMMO = 100000`

- `Player.respawn` 直接设 `state.health/armor = 9999`
- `Game.respawnLocalPlayer` 设 9999 血 + 弹匣满 + 备弹 10 万
- `Game.makeDefaultWeapons` 初始备弹就用 10 万
- 死亡后玩家进入 **noclip 上帝模式** (无重力, 无碰撞, forward 含 pitch 可飞, 跳出死亡状态前一直持续)

## 死亡后行为 (两个模式)

| 状态 | 视角 | 移动 | 武器 |
|---|---|---|---|
| 活着 (alive) | pointerLocked 时跟鼠标 | 物理 (重力/碰撞) | 正常 |
| 死亡 (isDead) | pointerLocked 时跟鼠标 | **noclip** (无重力, 无碰撞, 可飞出地图) | stopFire |
| 复活 | 重置 yaw=spawn.facing | 物理 | 重置 ammo + reserve |

- `isDead` 是 Player private 字段, `state.alive` 仍 false (UI/Bot 看到死亡)
- 复活点 respawn 时 `isDead=false` 走回正常物理
- Game.update 死亡时仍跑 `player.update` (拿视角) + 跑 `weapons.stopFire()` 不开火
- main.ts click 触发 `game.respawnLocalPlayer()` 后继续 lock

## 重要约束 / 已知坑

- **地面 (y=0) 无 AABB 碰撞体**。`Player.update` 末尾有 `if (position.y < 0) clamp` 兜底。**改重力/跳跃时不要删这个兜底**。
- **出生点 y=0**（不要改回 1.0，否则玩家会悬空 1m）。
- **Map 自带 skydome**（`addSkydome` 用的 `MeshBasicMaterial` 球），会被 `Sky.ts` 的 shader 球覆盖。Game.ts 的 `setupModules` 里显式过滤掉了 `SphereGeometry + MeshBasicMaterial`，不要去掉那行。
- **相机 far plane = 2000**。如果改小，天空球（半径 800）会被裁掉。
- **Pointer lock 失败时游戏会用 `updateWithoutLook` 让 WASD 仍可移动**。`Controls.ts` 键监听挂在 `document`（不是 `window`），保证任何焦点都能收到。
- **mousemove 同时挂 canvas + document**（line 64-65），且 mousedown/mouseup 也在 document——某些浏览器 pointer lock 期间不发到 canvas。
- **Bot 的 `_getPos()` 每次返回新 `Vector3`**，导致 `Bot.update` 内部 `moveToward` 计算的位移丢失。**Game.ts 的 `driveBotTowardTarget` 直接基于 `bodyGroup.position` 自己推位置**，绕开这个 bug。
- **`Map` 内的 `dust2` 几何 + 碰撞体在 `build()` 时构建**，跑过就缓存。运行时调 `Map.build()` 会重建。
- **HUD 血量数字 clamp 0~999999**（`renderHealth` 已做），`p.health || 0` 兜 NaN。9999 血能正常显示。
- **input.update() 必须在帧末尾**清零 mouseDX/DY/scrollDelta，不能放帧头（之前放帧头导致鼠标失效）。

## 击中反馈 (HitFeedback)

- `HitFeedback.spawnDamageNumber(pos, dmg, headshot)` 创建 3D Sprite "−24" / "−96 HS"，1秒内上升+淡出
- `HitFeedback.flashHitMarker(headshot)` 显示屏幕中心 X，爆头变红，130ms 后消失
- 玩家打中目标: 屏幕 hit marker + 飘字
- 玩家被打: HUD 红闪 + 飘字在玩家位置
- **必须每帧调 `hitFeedback.update(dt)`** 否则飘字不消失不上升

## 音频 (AudioManager)

- `WebAudio` 程序化合成 (Oscillator + Noise buffer), 0 文件依赖
- 第一次用户交互 (点击 PLAY) 必须 `audio.init()` (浏览器 AudioContext 策略)
- API: `playFire(weaponId)` / `playHit(hs)` / `playKill` / `playHurt` / `playDeath` / `playReload` / `playBuy` / `playBombPlant` / `playBombBeep(isLast10)` / `playBombExplode` / `playRoundStart` / `playRoundEnd(win)`
- 不同武器开火声不同 (AWP/步枪/手枪/刀)

## 操作提示

- **DevTools MCP 测不动 pointer lock**，所以自动测试时玩家无法转视角。手动玩需要点 PLAY 后真用户手势触发。
- 想让 Bot 动起来 / Match 推进，**`Game.update` 永远跑，不依赖 pointer lock**。
- Bot 血条朝相机: `bot.healthBar.group.lookAt(camera.position)` 在 Game.update 末尾每帧调用
- 加新功能：先看 `CONTRACTS.md`（旧的并行开发契约，仍是模块边界的参考），再写新类型到 `types/index.ts`，最后在 `Game.ts` 整合。
- **不要改 `node_modules/`、不要 import 任何不在 `src/` 的模块**。
- **`npx tsc --noEmit` 是最快的回归测试**——零类型错误基本就过。
- **commit 规范**：feat/fix/refactor + 简短中文描述
- **UI 文案默认中文**，新增 message/label 写中文
