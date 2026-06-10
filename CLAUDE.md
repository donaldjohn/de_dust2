# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目

**de_dust2 — Three.js 5v5 对战 FPS**。CS2 风格 de_dust2 地图的低多边形重制，玩家 T 阵营 vs 9 个 Bot（4 队友 T + 5 敌人 CT）。回合制比赛、买枪系统、C4 埋/拆包、完整 HUD。

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
Game.ts
├── scene/Map.ts        ─ 地图: colliders[]/spawns[]/sites[]/layout.waypoints
├── scene/Lighting.ts   ─ 阳光 + 半球光
├── scene/Sky.ts        ─ 球形天空盒 ShaderMaterial
├── player/Player.ts    ─ 第一人称控制: position/velocity/yaw/pitch, 同步 camera
├── player/Controls.ts  ─ Input 类: 键鼠状态、pointer lock
├── player/Collision.ts ─ 静态方法: AABB swept-capsule 碰撞
├── weapons/WeaponSystem.ts ─ 玩家武器管理: 散布/后坐力/换弹/弹道/命中
├── weapons/WeaponModels.ts ─ 程序化 Box+Cylinder 拼的 7 把枪模型
├── weapons/Tracer.ts   ─ 曳光弹 line
├── weapons/weapons.db.ts ─ 武器静态数据库 (伤害/价格/射速)
├── gameplay/Match.ts   ─ 回合状态机: Warmup→BuyTime→Live→End→... + 经济
├── gameplay/Bot.ts     ─ Bot AI: FSM (Idle/Patrol/Chase/Attack/Plant/Defuse)
├── gameplay/Pathfinder.ts ─ Waypoint BFS 寻路
├── ui/HUD.ts           ─ 所有 HUD DOM, 订阅 bus 事件
├── ui/BuyMenu.ts       ─ 买枪菜单
└── utils/events.ts     ─ 全局 EventBus (bus.on / bus.emit)
```

### 关键共享

- **`src/types/index.ts`**：枚举（Team/WeaponId/RoundPhase/BombSite）、CONFIG（移动速度/重力/经济数值）、所有 interface
- **`src/utils/events.ts`**：`bus` 单例。模块间松耦合通信：`bus.emit('player_kill', {...})`，`bus.on('round_end', ...)`
- **`src/utils/util.ts`**：clamp/lerp/formatTime/vec3ToArr 等

## Game.ts 帧循环

```ts
// update(dt) 分两段：
//  1) 玩家控制：pointerLocked 时走 player.update；否则走 player.updateWithoutLook (无相机控制但 WASD 仍可用)
//  2) 永远跑的部分：埋/拆进度、Bot、Match、HUD
// render(): sky.update 跟随相机 + renderer.render
```

## 跨模块通信模式

1. **回调（高频/低延迟）**：`onShoot`/`onHit`/`onMove`/`onPlantStart` 直接传函数
2. **事件总线（异步/广播）**：`bus.emit('round_end' | 'player_kill' | 'bomb_planted' | 'bomb_defuse' | 'bomb_explode' | 'match_over' | 'player_died' | 'player_hit')`
3. **状态快照（每帧）**：`buildWorldSnapshot()` 喂给 `Match.update` / `Bot.update`

## 重要约束 / 已知坑

- **地面 (y=0) 无 AABB 碰撞体**。`Player.update` 末尾有 `if (position.y < 0) clamp` 兜底。**改重力/跳跃时不要删这个兜底**。
- **出生点 y=0**（不要改回 1.0，否则玩家会悬空 1m）。
- **Map 自带 skydome**（`addSkydome` 用的 `MeshBasicMaterial` 球），会被 `Sky.ts` 的 shader 球覆盖。Game.ts 的 `setupModules` 里显式过滤掉了 `SphereGeometry + MeshBasicMaterial`，不要去掉那行。
- **相机 far plane = 2000**。如果改小，天空球（半径 800）会被裁掉。
- **`Player.update` 需要 pointer lock**。pointer lock 失败时游戏会用 `updateWithoutLook` 让 WASD 仍可移动。`Controls.ts` 键监听挂在 `document`（不是 `window`），保证任何焦点都能收到。
- **Bot 的 `_getPos()` 每次返回新 `Vector3`**，导致 `Bot.update` 内部 `moveToward` 计算的位移丢失。**Game.ts 的 `driveBotTowardTarget` 直接基于 `bodyGroup.position` 自己推位置**，绕开这个 bug。
- **`Map` 内的 `dust2` 几何 + 碰撞体在 `build()` 时构建**，跑过就缓存。运行时调 `Map.build()` 会重建。
- **HUD 数字必须 clamp 0~999**（`renderHealth` 已经做了），`p.health || 0` 兜 NaN。

## 操作提示

- **DevTools MCP 测不动 pointer lock**，所以自动测试时玩家无法转视角。手动玩需要点 PLAY 后真用户手势触发。
- 想让 Bot 动起来 / Match 推进，**`Game.update` 永远跑，不依赖 pointer lock**。这块改过。
- 加新功能：先看 `CONTRACTS.md`（旧的并行开发契约，仍是模块边界的参考），再写新类型到 `types/index.ts`，最后在 `Game.ts` 整合。
- **不要改 `node_modules/`、不要 import 任何不在 `src/` 的模块**。
- **`npx tsc --noEmit` 是最快的回归测试**——零类型错误基本就过。
- **commit 规范**：feat/fix/refactor + 简短中文描述
