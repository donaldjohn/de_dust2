// Procedural canvas-based textures for the low-poly dust2 map.
// Avoids external image assets; each function returns a THREE.CanvasTexture.

import * as THREE from 'three';

type Pattern = (ctx: CanvasRenderingContext2D, w: number, h: number) => void;

function makeCanvas(w: number, h: number): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;
  return { canvas, ctx };
}

function fill(ctx: CanvasRenderingContext2D, w: number, h: number, color: string) {
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, w, h);
}

function noise(ctx: CanvasRenderingContext2D, w: number, h: number, alpha = 0.18) {
  const img = ctx.getImageData(0, 0, w, h);
  for (let i = 0; i < img.data.length; i += 4) {
    const n = (Math.random() - 0.5) * 255 * alpha;
    img.data[i] = Math.max(0, Math.min(255, img.data[i] + n));
    img.data[i + 1] = Math.max(0, Math.min(255, img.data[i + 1] + n));
    img.data[i + 2] = Math.max(0, Math.min(255, img.data[i + 2] + n));
  }
  ctx.putImageData(img, 0, 0);
}

function withRepeat(tex: THREE.CanvasTexture, repeatX: number, repeatY: number) {
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(repeatX, repeatY);
  tex.anisotropy = 4;
  tex.needsUpdate = true;
  return tex;
}

export function sandGround(): THREE.CanvasTexture {
  const w = 512, h = 512;
  const { canvas, ctx } = makeCanvas(w, h);
  fill(ctx, w, h, '#C2A26B');
  // Soft dark patches
  for (let i = 0; i < 220; i++) {
    const x = Math.random() * w, y = Math.random() * h;
    const r = 8 + Math.random() * 28;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, `rgba(122,99,70,${0.10 + Math.random() * 0.12})`);
    g.addColorStop(1, 'rgba(122,99,70,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
  // Light patches
  for (let i = 0; i < 120; i++) {
    const x = Math.random() * w, y = Math.random() * h;
    const r = 6 + Math.random() * 18;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, `rgba(232,210,160,${0.08 + Math.random() * 0.12})`);
    g.addColorStop(1, 'rgba(232,210,160,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
  // Pebbles
  for (let i = 0; i < 600; i++) {
    ctx.fillStyle = `rgba(90,72,40,${0.18 + Math.random() * 0.2})`;
    ctx.fillRect(Math.random() * w, Math.random() * h, 1, 1);
  }
  noise(ctx, w, h, 0.10);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return withRepeat(tex, 24, 24);
}

export function sandWall(): THREE.CanvasTexture {
  const w = 256, h = 256;
  const { canvas, ctx } = makeCanvas(w, h);
  fill(ctx, w, h, '#B89968');
  // Brick grid
  const bw = 32, bh = 16;
  ctx.strokeStyle = 'rgba(90,70,40,0.55)';
  ctx.lineWidth = 1;
  for (let y = 0; y <= h; y += bh) {
    ctx.beginPath();
    ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
    const offset = (y / bh) % 2 === 0 ? 0 : bw / 2;
    for (let x = offset; x <= w; x += bw) {
      ctx.beginPath();
      ctx.moveTo(x, y); ctx.lineTo(x, y + bh); ctx.stroke();
    }
  }
  // Discoloration
  for (let i = 0; i < 80; i++) {
    const x = Math.random() * w, y = Math.random() * h;
    const r = 6 + Math.random() * 18;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, `rgba(122,99,70,${0.10 + Math.random() * 0.18})`);
    g.addColorStop(1, 'rgba(122,99,70,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
  noise(ctx, w, h, 0.14);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return withRepeat(tex, 4, 2);
}

export function darkStone(): THREE.CanvasTexture {
  const w = 256, h = 256;
  const { canvas, ctx } = makeCanvas(w, h);
  fill(ctx, w, h, '#7A6346');
  for (let i = 0; i < 40; i++) {
    const x = Math.random() * w, y = Math.random() * h;
    const r = 10 + Math.random() * 30;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, `rgba(50,38,22,${0.15 + Math.random() * 0.2})`);
    g.addColorStop(1, 'rgba(50,38,22,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
  noise(ctx, w, h, 0.20);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return withRepeat(tex, 3, 2);
}

export function woodCrate(): THREE.CanvasTexture {
  const w = 128, h = 128;
  const { canvas, ctx } = makeCanvas(w, h);
  fill(ctx, w, h, '#6B4226');
  // Plank seams
  ctx.fillStyle = 'rgba(35,20,10,0.7)';
  for (let y = 16; y < h; y += 32) {
    ctx.fillRect(0, y, w, 1);
  }
  // Wood grain
  for (let i = 0; i < 200; i++) {
    ctx.strokeStyle = `rgba(40,22,8,${0.05 + Math.random() * 0.1})`;
    ctx.beginPath();
    const y = Math.random() * h;
    ctx.moveTo(0, y);
    ctx.bezierCurveTo(w * 0.3, y + (Math.random() - 0.5) * 4,
                      w * 0.7, y + (Math.random() - 0.5) * 4,
                      w, y);
    ctx.stroke();
  }
  noise(ctx, w, h, 0.18);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return withRepeat(tex, 1, 1);
}

export function roofTile(): THREE.CanvasTexture {
  const w = 256, h = 256;
  const { canvas, ctx } = makeCanvas(w, h);
  fill(ctx, w, h, '#8C6E47');
  // Tile pattern
  for (let y = 0; y < h; y += 24) {
    const offset = (y / 24) % 2 === 0 ? 0 : 32;
    for (let x = -32 + offset; x < w; x += 64) {
      ctx.fillStyle = `rgba(60,42,20,0.35)`;
      ctx.fillRect(x, y, 64, 2);
      ctx.fillStyle = `rgba(180,140,80,0.12)`;
      ctx.fillRect(x + 1, y + 2, 62, 22);
    }
  }
  noise(ctx, w, h, 0.16);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return withRepeat(tex, 4, 4);
}
