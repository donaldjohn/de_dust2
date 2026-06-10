// Minimap - 右上角俯视图小地图
// 渲染: 玩家(绿/箭头) / T 队友(红) / CT 敌人(蓝) / A/B 包点(黄圈) / 玩家视角锥
//
// 位置: 来自 Bot.bodyGroup.position, Player.position, Map.sites
// 朝向: 玩家 yaw (转视野锥)
import { Team, BombSite } from '../types';
import type { Map as DustMap } from '../scene/Map';

interface BotInfo { id: string; team: Team; x: number; z: number; alive: boolean; }
interface SiteInfo { center: [number, number, number]; radius: number; name: BombSite; }
interface PlayerInfo { x: number; z: number; yaw: number; alive: boolean; team: Team; }

const SIZE = 200;            // 小地图像素
const PADDING = 4;
const COORD_SCALE = 0.55;    // 1 世界单位 = 0.55 像素 (让 dust2 ~210m 缩进 SIZE)
const WORLD_RADIUS = SIZE / 2 / COORD_SCALE;  // 缩放后的世界半径

export class Minimap {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private parent: HTMLElement;
  private map: DustMap;

  constructor(parent: HTMLElement, map: DustMap) {
    this.parent = parent;
    this.map = map;
    this.canvas = document.createElement('canvas');
    this.canvas.width = SIZE;
    this.canvas.height = SIZE;
    this.canvas.style.cssText = `
      position: fixed; top: 12px; right: 12px;
      width: ${SIZE}px; height: ${SIZE}px;
      background: rgba(15, 20, 28, 0.78);
      border: 2px solid rgba(220, 220, 220, 0.35);
      border-radius: 4px;
      pointer-events: none; z-index: 25;
    `;
    parent.appendChild(this.canvas);
    this.ctx = this.canvas.getContext('2d')!;
  }

  /**
   * 渲染一帧小地图
   * @param player  玩家位置 + 朝向
   * @param bots    所有 Bot
   */
  render(player: PlayerInfo, bots: BotInfo[]) {
    const c = this.ctx;
    c.clearRect(0, 0, SIZE, SIZE);

    // 玩家永远在中心, 世界跟着玩家平移
    const cx = SIZE / 2;
    const cy = SIZE / 2;

    // ---- 1) 画 colliders (简单方块, 帮助识别) ----
    c.strokeStyle = 'rgba(160, 160, 160, 0.5)';
    c.lineWidth = 1;
    c.beginPath();
    for (const a of this.map.colliders) {
      const wx1 = a.min[0] - player.x;
      const wz1 = a.min[2] - player.z;
      const wx2 = a.max[0] - player.x;
      const wz2 = a.max[2] - player.z;
      // 视口剪裁: 离玩家 200m 内的
      if (Math.max(Math.abs(wx1), Math.abs(wx2)) > 100) continue;
      if (Math.max(Math.abs(wz1), Math.abs(wz2)) > 100) continue;
      const x1 = cx + wx1 * COORD_SCALE;
      const y1 = cy + wz1 * COORD_SCALE;
      const x2 = cx + wx2 * COORD_SCALE;
      const y2 = cy + wz2 * COORD_SCALE;
      c.rect(
        Math.min(x1, x2), Math.min(y1, y2),
        Math.abs(x2 - x1), Math.abs(y2 - y1)
      );
    }
    c.stroke();

    // ---- 2) A / B 包点 ----
    for (const site of this.map.sites) {
      const dx = site.center[0] - player.x;
      const dz = site.center[2] - player.z;
      const sx = cx + dx * COORD_SCALE;
      const sy = cy + dz * COORD_SCALE;
      const r = site.radius * COORD_SCALE;
      c.beginPath();
      c.arc(sx, sy, Math.max(8, r), 0, Math.PI * 2);
      c.fillStyle = site.name === BombSite.A ? 'rgba(255, 220, 80, 0.25)' : 'rgba(80, 200, 255, 0.25)';
      c.fill();
      c.lineWidth = 2;
      c.strokeStyle = site.name === BombSite.A ? '#FFD060' : '#60C8FF';
      c.stroke();
      // 字母
      c.fillStyle = '#FFFFFF';
      c.font = 'bold 18px Arial';
      c.textAlign = 'center';
      c.textBaseline = 'middle';
      c.fillText(site.name === BombSite.A ? 'A' : 'B', sx, sy);
    }

    // ---- 3) 玩家视野锥 (半透明扇形) ----
    // yaw=0 -> forward = (0, -1) (朝地图 -Z)
    // 屏幕 forward 与世界 forward 一致 (canvas Y 朝下, 世界 -Z 也朝屏幕下)
    const fovDeg = 90;  // 视角锥 ~90 度
    const a0 = player.yaw - (fovDeg * Math.PI / 180) / 2 - Math.PI / 2;  // canvas 角度
    const a1 = player.yaw + (fovDeg * Math.PI / 180) / 2 - Math.PI / 2;
    c.beginPath();
    c.moveTo(cx, cy);
    c.arc(cx, cy, WORLD_RADIUS * COORD_SCALE * 1.2, a0, a1);
    c.closePath();
    c.fillStyle = player.team === Team.T ? 'rgba(255, 60, 60, 0.18)' : 'rgba(60, 130, 255, 0.18)';
    c.fill();

    // ---- 4) 玩家 (中心绿点 + 朝向箭头) ----
    c.beginPath();
    c.arc(cx, cy, player.alive ? 5 : 3, 0, Math.PI * 2);
    c.fillStyle = player.alive ? '#5BFF6B' : '#FF4040';
    c.fill();
    c.lineWidth = 1.5;
    c.strokeStyle = '#FFFFFF';
    c.stroke();
    // 朝向箭头 (yaw 方向, +12 px)
    const arrowX = cx + Math.cos(-player.yaw - Math.PI / 2) * 12;
    const arrowY = cy + Math.sin(-player.yaw - Math.PI / 2) * 12;
    c.beginPath();
    c.moveTo(arrowX, arrowY);
    c.lineTo(cx, cy);
    c.lineWidth = 2;
    c.strokeStyle = '#FFFFFF';
    c.stroke();

    // ---- 5) Bot 点 ----
    for (const bot of bots) {
      if (!bot.alive) continue;
      const dx = bot.x - player.x;
      const dz = bot.z - player.z;
      // 太远跳过 (避免大点群)
      if (Math.hypot(dx, dz) > WORLD_RADIUS) continue;
      const sx = cx + dx * COORD_SCALE;
      const sy = cy + dz * COORD_SCALE;
      c.beginPath();
      c.arc(sx, sy, 3.5, 0, Math.PI * 2);
      c.fillStyle = bot.team === Team.T ? '#FF5050' : '#4F9BFF';
      c.fill();
      c.lineWidth = 1;
      c.strokeStyle = '#FFFFFF';
      c.stroke();
    }

    // ---- 6) 边框 + 标题 ----
    c.strokeStyle = 'rgba(255, 255, 255, 0.7)';
    c.lineWidth = 1;
    c.strokeRect(0.5, 0.5, SIZE - 1, SIZE - 1);
    c.fillStyle = 'rgba(255, 255, 255, 0.85)';
    c.font = 'bold 10px Arial';
    c.textAlign = 'left';
    c.textBaseline = 'top';
    c.fillText('雷达', 4, 4);
  }

  dispose() {
    this.canvas.remove();
  }
}
