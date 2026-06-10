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
      <h1 class="title">DE_DUST2</h1>
      <p class="subtitle">Three.js · Low-poly · 5v5</p>
      <button id="play-btn" class="play-btn">▶ PLAY (T SIDE)</button>
      <div class="controls">
        <h3>CONTROLS</h3>
        <p><b>WASD</b> Move · <b>Mouse</b> Look · <b>Click</b> Shoot</p>
        <p><b>Right-click</b> Aim · <b>R</b> Reload · <b>B</b> Buy (buy time)</p>
        <p><b>Space</b> Jump · <b>E</b> Plant/Defuse · <b>G</b> Drop weapon</p>
        <p><b>1-5</b> Switch weapon · <b>Tab</b> Scoreboard</p>
        <p><b>Esc</b> Release mouse</p>
        <h3>OBJECTIVE</h3>
        <p>As <span class="t-color">T</span>: plant the bomb at A or B site</p>
        <p>As <span class="ct-color">CT</span>: prevent planting or defuse</p>
        <p>First to 8 round wins wins the match</p>
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
        <h1 class="title">PAUSED</h1>
        <p class="subtitle">Click PLAY to resume</p>
        <button id="resume-btn" class="play-btn">▶ RESUME</button>
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
    // 锁成功: 隐藏菜单 (包括 PAUSED overlay)
    if (started) menu.style.display = 'none';
  } else if (started) {
    showPauseOverlay();
  }
});

// 点击 canvas 重新请求 pointer lock (失锁后用户想再玩直接点屏幕即可)
canvas.addEventListener('click', () => {
  if (started && document.pointerLockElement !== canvas) {
    requestPointerLock();
  }
});

buildStartMenu();
