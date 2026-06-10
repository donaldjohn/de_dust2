# 荒漠迷城 - de_dust2 (Three.js 5v5 FPS)

CS2 经典地图 de_dust2 的低多边形重制版。基于 Vite + TypeScript + three.js 实现，**5v5 玩家 vs 9 个 Bot AI**，支持完整回合制、买枪系统、C4 埋/拆包、击杀反馈、音效、计分板。

## 🎮 游戏规则

### 阵营

| 阵营 | 名称 | 目标 | 角色 |
|---|---|---|---|
| 🔴 T (Terrorists) | 恐怖分子 | 在 A 点或 B 点埋下炸弹 | 1 个本地玩家 + 4 个 Bot 队友 |
| 🔵 CT (Counter-Terrorists) | 反恐精英 | 阻止埋包 / 拆除已埋的炸弹 | 5 个 Bot 敌人 |

**本地玩家 = T 阵营。** 比赛时队友红衣，敌人蓝衣，头顶有 **"ALLY T"** / **"ENEMY CT"** 标签，敌方头顶有血条实时显示。

### 回合流程

1. **购买阶段 (BUY, 15 秒)**：用 $ 买武器，按 `B` 打开买枪菜单
2. **战斗中 (LIVE, 1 分 55 秒)**：
   - T 阵营：冲 A 点 / B 点埋包（在 bomb site 内按 `E` 持续 3.2 秒）
   - CT 阵营：防守 / 在 T 埋包后按 `E` 拆包（10 秒，需有 kit 时 5 秒）
3. **回合结束 (5 秒)**：展示 "恐怖分子胜利 / 反恐精英胜利" + 回合原因
4. 下一回合自动重置，继续打到 **8 回合胜**

### 胜负判定

- **T 胜利**：CT 全部歼灭 / 时间到但包没拆 / 炸弹爆炸
- **CT 胜利**：T 全部歼灭 / 时间到未埋包 / 拆弹成功

### 经济系统

- 起始 $800（买枪时间）
- 击杀奖励：手枪 $300 / 步枪 $300 / AWP $100 / 刀 $1500
- 胜利奖励：$3250
- 失败奖励：$1400 + 连败递增（最多 $3400）
- 死亡不会掉钱

## ⌨️ 操作说明

| 按键 | 作用 |
|---|---|
| `WASD` | 移动 |
| `鼠标移动` | 视角 (需先点击 PLAY 锁鼠标) |
| `左键` | 射击 |
| `右键` | 瞄准 (zoom in) |
| `R` | 换弹 |
| `B` | 打开买枪菜单 (仅购买阶段) |
| `空格` | 跳跃 |
| `E` | 埋包 / 拆包 (在 bomb site 内 / bomb 旁) |
| `G` | 丢枪 (当前手持) |
| `1-5` | 切换武器 |
| `滚轮` | 切武器 |
| `Tab` | 计分板 (K/D/A) |
| `Esc` | 释放鼠标 |

## 🛡️ 上帝模式

**为方便测试，本地玩家当前默认开启上帝模式：**

- ❤️ 血量 **9999** + 护甲 **9999** + 头盔
- 🔫 初始备弹 **10 万发**，弹匣自动装满
- 💀 死亡后**仍可自由飞**（noclip）：鼠标看视角，WASD 移动，Space 上升，Shift 加速
- 🎯 死亡后**仍可看击杀飘字和血条变化**

复活：点击屏幕 → 自动复活到 T 出生点并补满弹药。

## 🚀 如何运行

### 环境要求

- Node.js ≥ 18
- npm (或 pnpm / yarn)

### 启动开发服务器

```bash
# 1) 装依赖
npm install

# 2) 启动 dev server (默认 http://localhost:5173)
npm run dev
```

打开浏览器访问 `http://localhost:5173` 即可游玩。

> 如果 5173 端口被占用，Vite 会自动尝试 5174 / 5175 / ... 端口，浏览器会自动打开新端口。

### 构建生产版本

```bash
# tsc 类型检查 + vite 打包到 dist/
npm run build

# 本地预览 dist/
npm run preview
```

### 仅类型检查

```bash
npx tsc --noEmit
```

> 这是最快的回归测试，零类型错误基本就过。

## 🏗️ 技术栈

- **Vite 5** - 开发服务器 / 打包
- **TypeScript 5** - 类型安全
- **three.js 0.160** - 3D 渲染
- **无 React / Vue / Tailwind** - 纯 vanilla TS + DOM

## 📁 项目结构

```
src/
├── main.ts                      入口 (菜单 + pointer lock)
├── Game.ts                      整合器: 帧循环 / 事件路由
├── types/index.ts               枚举 / CONFIG / interface
├── scene/                       地图 / 灯光 / 天空
├── player/                      玩家控制 + 碰撞
├── weapons/                     武器系统 / 弹道 / 击中反馈
├── gameplay/                    比赛状态机 / Bot AI / 血条
├── audio/                       WebAudio 音效合成
├── ui/                          HUD / 买枪菜单 / CSS
└── utils/                       事件总线 / 工具函数
```

完整模块依赖图、事件总线说明、已知坑见 [`CLAUDE.md`](./CLAUDE.md)。

## 🧪 验证 / 调试

- **没有单元测试框架**，E2E 验证靠 **Chrome DevTools MCP** 实跑游戏
- **DevTools MCP 测不动 pointer lock**，自动测试时玩家无法转视角；需真用户手动点击 PLAY 触发
- 浏览器控制台可用 `(window).__game` 访问 Game 实例调试

```js
// 控制台常用调试命令
__game.player.state.health = 9999   // 上帝模式
__game.weapons.current().ammoInMag   // 查看当前弹匣
__game.match.score                   // 当前比分
__game.bots.map(b => b.state.alive)  // Bot 存活状态
```

## 📝 开发规范

- 中文 commit: `feat/fix/refactor + 简短中文描述`
- 加新功能：先看 `CONTRACTS.md`（模块边界契约），再写新类型到 `types/index.ts`，最后在 `Game.ts` 整合
- UI 文案默认中文
- 严禁 import `node_modules/` 之外的任何模块

## 📜 许可

个人学习项目。
