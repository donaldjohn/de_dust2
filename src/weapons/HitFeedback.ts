// HitFeedback - 击中视觉反馈
// 1) 3D 飘字: 击中点附近显示 "−24" 或 "−96 HS" 飘字
// 2) 屏幕 hit marker: 击中时屏幕中心一个 X 标记短暂出现
//
// 用法:
//   const fb = new HitFeedback(scene);
//   每帧 fb.update(dt);
//   fb.spawnDamageNumber(position, damage, headshot);
//   fb.flashHitMarker(headshot);
import * as THREE from 'three';

interface FloatingText {
  sprite: THREE.Sprite;
  bornAt: number;
  lifeMs: number;
  startY: number;
  endY: number;
}

export class HitFeedback {
  private scene: THREE.Scene;
  private parent: THREE.Group;          // 所有飘字挂在这
  private texts: FloatingText[] = [];
  private maxTexts = 30;
  private hitMarkerEl: HTMLDivElement;
  private hitMarkerTimer: number | null = null;

  constructor(scene: THREE.Scene) {
    this.scene = scene;
    this.parent = new THREE.Group();
    this.parent.name = 'HitFeedbackGroup';
    scene.add(this.parent);

    // 屏幕 hit marker (CSS)
    this.hitMarkerEl = document.createElement('div');
    this.hitMarkerEl.id = 'hit-marker';
    this.hitMarkerEl.style.cssText = `
      position: fixed; top: 50%; left: 50%;
      transform: translate(-50%, -50%);
      width: 40px; height: 40px;
      pointer-events: none; opacity: 0; z-index: 30;
      transition: opacity 0.08s ease-out;
    `;
    // 4 短线段 X
    this.hitMarkerEl.innerHTML = `
      <svg width="40" height="40" viewBox="0 0 40 40" xmlns="http://www.w3.org/2000/svg">
        <line x1="8"  y1="8"  x2="16" y2="16" stroke="white" stroke-width="2.5" stroke-linecap="round" />
        <line x1="32" y1="8"  x2="24" y2="16" stroke="white" stroke-width="2.5" stroke-linecap="round" />
        <line x1="8"  y1="32" x2="16" y2="24" stroke="white" stroke-width="2.5" stroke-linecap="round" />
        <line x1="32" y1="32" x2="24" y2="24" stroke="white" stroke-width="2.5" stroke-linecap="round" />
      </svg>
    `;
    document.body.appendChild(this.hitMarkerEl);
  }

  /** 击中时屏幕中心 X 一闪 */
  flashHitMarker(headshot: boolean) {
    if (this.hitMarkerTimer !== null) {
      clearTimeout(this.hitMarkerTimer);
    }
    // 爆头用红色, 普通用白色
    const color = headshot ? '#FF4040' : '#FFFFFF';
    this.hitMarkerEl.querySelectorAll('line').forEach((l) => (l as SVGElement).setAttribute('stroke', color));
    this.hitMarkerEl.style.opacity = '0.95';
    this.hitMarkerTimer = window.setTimeout(() => {
      this.hitMarkerEl.style.opacity = '0';
      this.hitMarkerTimer = null;
    }, 130);
  }

  /** 在世界坐标生成飘字 "−24" 或 "−96 HS" */
  spawnDamageNumber(worldPos: THREE.Vector3 | [number, number, number], damage: number, headshot: boolean) {
    // 限制同时飘字数
    if (this.texts.length >= this.maxTexts) {
      const old = this.texts.shift();
      if (old) this.parent.remove(old.sprite);
    }
    const pos = worldPos instanceof THREE.Vector3
      ? worldPos
      : new THREE.Vector3(worldPos[0], worldPos[1], worldPos[2]);

    // canvas 画数字
    const canvas = document.createElement('canvas');
    canvas.width = 256; canvas.height = 96;
    const ctx = canvas.getContext('2d')!;
    const text = headshot ? `−${damage}  HS` : `−${damage}`;
    ctx.font = 'bold 64px Arial';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    // 黑色描边
    ctx.lineWidth = 6;
    ctx.strokeStyle = '#000000';
    ctx.strokeText(text, 128, 48);
    // 文字颜色
    ctx.fillStyle = headshot ? '#FF4040' : '#FFE060';
    ctx.fillText(text, 128, 48);

    const tex = new THREE.CanvasTexture(canvas);
    tex.minFilter = THREE.LinearFilter;
    tex.magFilter = THREE.LinearFilter;
    const mat = new THREE.SpriteMaterial({
      map: tex,
      depthTest: false,
      depthWrite: false,
      transparent: true
    });
    const sprite = new THREE.Sprite(mat);
    sprite.scale.set(0.9, 0.35, 1);
    sprite.position.set(pos.x, pos.y + 0.4, pos.z);
    sprite.renderOrder = 998;
    this.parent.add(sprite);

    this.texts.push({
      sprite,
      bornAt: performance.now(),
      lifeMs: 900,
      startY: pos.y + 0.4,
      endY: pos.y + 1.4
    });
  }

  update(dt: number) {
    if (this.texts.length === 0) return;
    const now = performance.now();
    const survivors: FloatingText[] = [];
    for (const t of this.texts) {
      const t01 = Math.min(1, (now - t.bornAt) / t.lifeMs);
      // 上升 + 淡出
      t.sprite.position.y = t.startY + (t.endY - t.startY) * t01;
      (t.sprite.material as THREE.SpriteMaterial).opacity = 1 - t01 * t01;
      if (t01 >= 1) {
        this.parent.remove(t.sprite);
        t.sprite.material.map?.dispose();
        t.sprite.material.dispose();
      } else {
        survivors.push(t);
      }
    }
    this.texts = survivors;
  }

  dispose() {
    for (const t of this.texts) {
      this.parent.remove(t.sprite);
      t.sprite.material.map?.dispose();
      t.sprite.material.dispose();
    }
    this.texts = [];
    if (this.hitMarkerTimer !== null) clearTimeout(this.hitMarkerTimer);
    this.hitMarkerEl.remove();
    this.scene.remove(this.parent);
  }
}
