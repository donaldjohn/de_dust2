// AudioManager - WebAudio 程序化合成音效
// 不用音频文件, 直接用 OscillatorNode + GainNode 合成
// 优点: 0 依赖, 0 网络, 任何浏览器都能跑
//
// API:
//   - playFire(weaponId)        开火声
//   - playHit(headshot)         击中声
//   - playKill()                击杀声 (短促胜利音)
//   - playHurt()                玩家受伤声
//   - playDeath()               玩家死亡声
//   - playPickup()              拾枪声
//   - playReload()              换弹声
//   - playBombPlant()           埋包声
//   - playBombBeep(isLast10)   拆/倒计时滴答
//   - playBombExplode()         爆炸
//   - playRoundStart()          回合开始
//   - playRoundEnd(win)         回合结束 (胜/负)
//   - playBuy()                 买枪
//   - setMasterVolume(v)
//   - mute() / unmute()
//
// 用法:
//   import { audio } from './audio/AudioManager';
//   audio.init();         // 第一次用户交互后调
//   audio.playFire(WeaponId.AK47);

import { WeaponId } from '../types';

export class AudioManager {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private muted = false;
  private masterVolume = 0.5;

  /** 必须在第一次用户交互后调一次 (浏览器策略) */
  init(): void {
    if (this.ctx) return;
    const Ctx = (window.AudioContext || (window as any).webkitAudioContext) as typeof AudioContext;
    this.ctx = new Ctx();
    this.masterGain = this.ctx.createGain();
    this.masterGain.gain.value = this.masterVolume;
    this.masterGain.connect(this.ctx.destination);
  }

  setMasterVolume(v: number) {
    this.masterVolume = Math.max(0, Math.min(1, v));
    if (this.masterGain) this.masterGain.gain.value = this.muted ? 0 : this.masterVolume;
  }
  mute() { this.muted = true; if (this.masterGain) this.masterGain.gain.value = 0; }
  unmute() { this.muted = false; if (this.masterGain) this.masterGain.gain.value = this.masterVolume; }
  isMuted() { return this.muted; }

  private osc(freq: number, type: OscillatorType, dur: number, vol: number, attack = 0.005, release = 0.05) {
    if (!this.ctx || !this.masterGain) return;
    const t0 = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(vol, t0 + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(g).connect(this.masterGain);
    osc.start(t0);
    osc.stop(t0 + dur + release);
  }

  private noise(dur: number, vol: number, filterFreq = 1500) {
    if (!this.ctx || !this.masterGain) return;
    const t0 = this.ctx.currentTime;
    const buf = this.ctx.createBuffer(1, this.ctx.sampleRate * dur, this.ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = filterFreq;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(vol, t0 + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(filter).connect(g).connect(this.masterGain);
    src.start(t0);
    src.stop(t0 + dur);
  }

  // -------- 武器/战斗 --------

  /** 开火: 按武器类型不同 */
  playFire(weaponId: WeaponId) {
    if (!this.ctx) return;
    if (weaponId === WeaponId.Knife) {
      // 刀: 短促"嗖"声
      this.osc(1800, 'square', 0.06, 0.18, 0.001, 0.04);
      this.osc(900, 'sawtooth', 0.05, 0.12, 0.001, 0.04);
    } else if (weaponId === WeaponId.AWP) {
      // AWP: 巨大轰鸣 + 噪声
      this.osc(80, 'sine', 0.18, 0.45, 0.002, 0.1);
      this.noise(0.25, 0.35, 800);
    } else if (weaponId === WeaponId.AK47 || weaponId === WeaponId.M4A4) {
      // 步枪: 较重中频
      this.osc(180, 'square', 0.07, 0.32, 0.002, 0.04);
      this.noise(0.08, 0.18, 2000);
    } else if (weaponId === WeaponId.Glock || weaponId === WeaponId.USP) {
      // 手枪: 短清脆
      this.osc(280, 'square', 0.05, 0.28, 0.002, 0.03);
      this.noise(0.05, 0.12, 2400);
    } else {
      // 默认
      this.osc(200, 'square', 0.06, 0.25, 0.002, 0.04);
      this.noise(0.06, 0.12, 2000);
    }
  }

  /** 击中: 短高频滴声 */
  playHit(headshot: boolean) {
    if (!this.ctx) return;
    if (headshot) {
      this.osc(2200, 'square', 0.04, 0.32, 0.001, 0.02);
      this.osc(1100, 'sine', 0.06, 0.22, 0.001, 0.04);
    } else {
      this.osc(1400, 'square', 0.03, 0.22, 0.001, 0.02);
    }
  }

  /** 击杀: 上行扫频 */
  playKill() {
    if (!this.ctx) return;
    const t0 = this.ctx!.currentTime;
    const osc = this.ctx!.createOscillator();
    const g = this.ctx!.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(440, t0);
    osc.frequency.exponentialRampToValueAtTime(880, t0 + 0.12);
    g.gain.setValueAtTime(0.2, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.18);
    osc.connect(g).connect(this.masterGain!);
    osc.start(t0);
    osc.stop(t0 + 0.2);
  }

  /** 玩家受伤: 低沉冲击 */
  playHurt() {
    if (!this.ctx) return;
    this.osc(120, 'sawtooth', 0.12, 0.4, 0.001, 0.08);
    this.noise(0.1, 0.18, 400);
  }

  /** 玩家死亡: 下滑音 */
  playDeath() {
    if (!this.ctx) return;
    const t0 = this.ctx!.currentTime;
    const osc = this.ctx!.createOscillator();
    const g = this.ctx!.createGain();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(440, t0);
    osc.frequency.exponentialRampToValueAtTime(80, t0 + 0.5);
    g.gain.setValueAtTime(0.3, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.55);
    osc.connect(g).connect(this.masterGain!);
    osc.start(t0);
    osc.stop(t0 + 0.6);
  }

  // -------- 其它 --------

  playPickup() {
    this.osc(600, 'square', 0.05, 0.2, 0.001, 0.02);
    setTimeout(() => this.osc(800, 'square', 0.06, 0.22, 0.001, 0.03), 50);
  }
  playReload() {
    this.osc(300, 'square', 0.04, 0.18, 0.001, 0.02);
    setTimeout(() => this.osc(500, 'square', 0.05, 0.18, 0.001, 0.03), 90);
  }
  playBuy() {
    this.osc(800, 'sine', 0.08, 0.22, 0.001, 0.05);
  }
  playBombPlant() {
    this.osc(220, 'square', 0.15, 0.3, 0.001, 0.1);
    setTimeout(() => this.osc(330, 'square', 0.18, 0.3, 0.001, 0.12), 100);
  }
  /** 拆/倒计时滴答 */
  playBombBeep(isLast10: boolean) {
    this.osc(isLast10 ? 1200 : 800, 'sine', 0.05, 0.25, 0.001, 0.03);
  }
  playBombExplode() {
    if (!this.ctx) return;
    // 巨大轰鸣
    this.osc(60, 'sine', 0.7, 0.7, 0.001, 0.3);
    this.noise(0.8, 0.6, 400);
  }
  playRoundStart() {
    if (!this.ctx) return;
    [440, 660, 880].forEach((f, i) => {
      setTimeout(() => this.osc(f, 'sine', 0.12, 0.3, 0.001, 0.08), i * 100);
    });
  }
  playRoundEnd(win: boolean) {
    if (!this.ctx) return;
    if (win) {
      [523, 659, 784, 1047].forEach((f, i) => {
        setTimeout(() => this.osc(f, 'sine', 0.15, 0.3, 0.001, 0.1), i * 80);
      });
    } else {
      [440, 330, 220].forEach((f, i) => {
        setTimeout(() => this.osc(f, 'sine', 0.18, 0.3, 0.001, 0.1), i * 100);
      });
    }
  }
}

// 单例
export const audio = new AudioManager();
