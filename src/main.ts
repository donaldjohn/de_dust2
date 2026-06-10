// main.ts - 入口
// 显示主菜单, 点击 PLAY 后启动游戏

import './ui/style.css';
import { Game } from './Game';
import { bus } from './utils/events';

const canvas = document.getElementById('game-canvas') as HTMLCanvasElement;
const menu = document.getElementById('menu') as HTMLDivElement;

let game: Game | null = null;
let started = false;

function buildStartMenu() {
  menu.innerHTML = `
    <div class="main-menu">
      <h1 class="title">荒漠迷城</h1>
      <p class="subtitle">DE_DUST2 · Three.js · 低多边形 · 5v5</p>
      <button id="play-btn" class="play-btn">▶ 开始游戏 (T 阵营)</button>
      <div class="controls">
        <h3>操作说明</h3>
        <p><b>WASD</b> 移动 · <b>鼠标</b> 视角 · <b>左键</b> 射击</p>
        <p><b>右键</b> 瞄准 · <b>R</b> 换弹 · <b>B</b> 买枪 (买枪时间)</p>
        <p><b>空格</b> 跳跃 · <b>E</b> 埋包/拆包 · <b>G</b> 丢枪</p>
        <p><b>1-5</b> 切换武器 · <b>Tab</b> 计分板</p>
        <p><b>Esc</b> 释放鼠标</p>
        <h3>任务目标</h3>
        <p>作为 <span class="t-color">T 阵营</span>: 在 A 点或 B 点埋下炸弹</p>
        <p>作为 <span class="ct-color">CT 阵营</span>: 阻止埋包或拆掉炸弹</p>
        <p>先赢 8 回合者获胜 (上帝模式: 9999 血, 10 万发子弹)</p>
      </div>
    </div>
  `;
  const btn = document.getElementById('play-btn')!;
  btn.addEventListener('click', () => {
    if (started) return;
    started = true;
    menu.style.display = 'none';
    if (!game) game = new Game(canvas);
    // 暴露到 window 以便调试
    (window as any).__game = game;
    // 第一次用户交互 init 音频 (浏览器策略: AudioContext 必须用户手势后才能 resume)
    import('./audio/AudioManager').then(({ audio }) => audio.init());
    game.start();
    // 请求 pointer lock
    requestPointerLock();
  });
}

function requestPointerLock() {
  canvas.requestPointerLock();
}

function showPauseOverlay() {
  if (!started) return;
  if (document.pointerLockElement !== canvas) {
    menu.style.display = 'flex';
    menu.innerHTML = `
      <div class="main-menu">
        <h1 class="title">已暂停</h1>
        <p class="subtitle">点击继续按钮恢复游戏</p>
        <button id="resume-btn" class="play-btn">▶ 继续</button>
      </div>
    `;
    const btn = document.getElementById('resume-btn')!;
    btn.addEventListener('click', () => {
      menu.style.display = 'none';
      requestPointerLock();
    });
  }
}

document.addEventListener('pointerlockchange', () => {
  if (document.pointerLockElement === canvas) {
    // 锁成功: 完全隐藏菜单 + 禁止拦截输入
    if (started) {
      menu.classList.add('hidden');
      menu.style.display = 'none';
    }
  } else if (started) {
    showPauseOverlay();
  }
});

// 点击 canvas: 失锁 -> 重新 pointer lock; 玩家死亡中 -> respawn 后继续观战
// 关键: 死亡后不释放 pointer lock, 玩家点 canvas 触发 respawn 然后继续用鼠标浏览
canvas.addEventListener('click', () => {
  if (started) {
    if (game && !game.isPlayerAlive) {
      game.respawnLocalPlayer();
    }
    if (document.pointerLockElement !== canvas) {
      requestPointerLock();
    }
  }
});

buildStartMenu();
