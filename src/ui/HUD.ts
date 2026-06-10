// HUD 抬头显示 - 血量/弹药/比分/计时/击杀通知/计分板/回合结果
// 所有 DOM 通过 position: fixed 覆盖在 canvas 上, 全部 pointer-events: none

import {
  MatchScore,
  RoundPhase,
  PlayerState,
  WeaponId,
  Team,
  WeaponInstance,
  CONFIG
} from '../types';
import { bus } from '../utils/events';
import { formatTime } from '../utils/util';

// 只读快照 - HUD 拿到的是浅拷贝
export interface MatchInfo {
  score: MatchScore;
  round: number;
  phase: RoundPhase;
  timeLeft: number;          // 秒
  bombPlanted: boolean;
  bombTime: number;          // 0 = 未埋
  bombSite: 'A' | 'B' | 'none';
  planting: boolean;
  defusing: boolean;
  plantProgress: number;     // 0-1
  defuseProgress: number;
}

const PHASE_LABEL: Record<RoundPhase, string> = {
  [RoundPhase.Warmup]: '热身',
  [RoundPhase.BuyTime]: '购买',
  [RoundPhase.Live]: '战斗中',
  [RoundPhase.End]: '回合结束',
  [RoundPhase.MatchOver]: '比赛结束'
};

// 把 weaponId 缩短成 kill feed 中显示的标签
function weaponTag(id: WeaponId): string {
  switch (id) {
    case WeaponId.Knife: return '刀';
    case WeaponId.Glock: return '格洛克';
    case WeaponId.USP: return 'USP';
    case WeaponId.DesertEagle: return '沙鹰';
    case WeaponId.AK47: return 'AK-47';
    case WeaponId.M4A4: return 'M4A4';
    case WeaponId.AWP: return 'AWP';
    default: return '?';
  }
}

function reasonText(reason: string): string {
  switch (reason) {
    case 'elimination':   return '歼灭敌人';
    case 'bomb_explode':  return '炸弹爆炸';
    case 'bomb_defuse':   return '炸弹被拆';
    case 'time_out':      return '目标保存';
    case 'target_saved':  return '目标保存';
    case 'MATCH OVER':    return '比赛结束';
    default:              return reason;
  }
}

export class HUD {
  private root: HTMLElement;
  private localPlayer: PlayerState | null = null;
  private match: MatchInfo | null = null;

  // 缓存 DOM
  private elScoreboard!: HTMLDivElement;
  private elTScore!: HTMLSpanElement;
  private elCTScore!: HTMLSpanElement;
  private elRound!: HTMLSpanElement;
  private elTimer!: HTMLSpanElement;
  private elPhase!: HTMLSpanElement;

  private elHealth!: HTMLDivElement;
  private elHp!: HTMLSpanElement;
  private elArmor!: HTMLSpanElement;
  private elHelmet!: HTMLSpanElement;

  private elAmmo!: HTMLDivElement;
  private elWeaponName!: HTMLSpanElement;
  private elMag!: HTMLSpanElement;
  private elReserve!: HTMLSpanElement;
  private elReloadBar!: HTMLDivElement;
  private elReloadFill!: HTMLDivElement;

  private elMoney!: HTMLDivElement;
  private elKda!: HTMLSpanElement;

  private elKillfeed!: HTMLDivElement;
  private elTabBoard!: HTMLDivElement;
  private elRoundBanner!: HTMLDivElement;
  private elRoundTitle!: HTMLDivElement;
  private elRoundReason!: HTMLDivElement;

  private elActionStatus!: HTMLDivElement;
  private elActionLabel!: HTMLSpanElement;
  private elPlantBar!: HTMLDivElement;
  private elPlantFill!: HTMLDivElement;

  private elCenterMsg!: HTMLDivElement;

  private elBomb!: HTMLDivElement;
  private elDamageVignette!: HTMLDivElement;
  private elClickToPlay!: HTMLDivElement;

  private buyMenuOpen: boolean = false;
  private pointerLocked: boolean = false;

  // damage flash 计时
  private damageFlashTimer: number | null = null;
  private centerMsgTimer: number | null = null;
  private roundBannerTimer: number | null = null;
  private hitTimer: number | null = null;

  constructor(root: HTMLElement) {
    this.root = root;
    this.buildDom();
    this.bindBus();
  }

  // ============== DOM 构造 ==============
  private buildDom() {
    const mk = <K extends keyof HTMLElementTagNameMap>(
      tag: K,
      cls: string,
      parent: HTMLElement
    ): HTMLElementTagNameMap[K] => {
      const el = document.createElement(tag);
      el.className = cls;
      parent.appendChild(el);
      return el;
    };

    // 顶部比分板
    this.elScoreboard = mk('div', 'hud-scoreboard', this.root);
    this.elScoreboard.innerHTML = `
      <div class="team-score t"><span class="label">T</span><span class="num" data-t>0</span></div>
      <div class="center">
        <span class="round" data-round>Round 1/${CONFIG.ROUNDS_TO_WIN * 2 - 1}</span>
        <span class="timer" data-timer>0:00</span>
        <span class="phase live" data-phase>WARMUP</span>
      </div>
      <div class="team-score ct"><span class="num" data-ct>0</span><span class="label">CT</span></div>
    `;
    this.elTScore  = this.elScoreboard.querySelector('[data-t]')!;
    this.elCTScore = this.elScoreboard.querySelector('[data-ct]')!;
    this.elRound   = this.elScoreboard.querySelector('[data-round]')!;
    this.elTimer   = this.elScoreboard.querySelector('[data-timer]')!;
    this.elPhase   = this.elScoreboard.querySelector('[data-phase]')!;

    // 顶部装饰条
    const stripeT  = mk('div', 'hud-top-stripe t', this.root);
    const stripeCt = mk('div', 'hud-top-stripe ct', this.root);
    stripeT.style.display = 'block';
    stripeCt.style.display = 'block';

    // 左下 血量
    this.elHealth = mk('div', 'hud-health', this.root);
    this.elHealth.innerHTML = `
      <span class="hp" data-hp>100</span>
      <span class="plus">+</span>
      <span class="armor" data-armor>0</span>
      <span class="helmet" data-helmet title="Kevlar + Helmet"></span>
    `;
    this.elHp     = this.elHealth.querySelector('[data-hp]')!;
    this.elArmor  = this.elHealth.querySelector('[data-armor]')!;
    this.elHelmet = this.elHealth.querySelector('[data-helmet]')!;

    // 底部中央 弹药
    this.elAmmo = mk('div', 'hud-ammo', this.root);
    this.elAmmo.innerHTML = `
      <div class="weapon-name" data-name>Knife</div>
      <div class="counts">
        <span class="mag" data-mag>0</span>
        <span class="sep">/</span>
        <span class="reserve" data-reserve>0</span>
      </div>
      <div class="reload-bar" data-rbar><div data-rfill></div></div>
    `;
    this.elWeaponName = this.elAmmo.querySelector('[data-name]')!;
    this.elMag        = this.elAmmo.querySelector('[data-mag]')!;
    this.elReserve    = this.elAmmo.querySelector('[data-reserve]')!;
    this.elReloadBar  = this.elAmmo.querySelector('[data-rbar]')!;
    this.elReloadFill = this.elAmmo.querySelector('[data-rfill]')!;

    // 右下 钱 / KDA
    this.elMoney = mk('div', 'hud-money', this.root);
    this.elMoney.innerHTML = `
      <div class="amount" data-money>$800</div>
      <div class="kda">
        <span class="k" data-k>0</span> /
        <span class="d" data-d>0</span> /
        <span class="a" data-a>0</span>
      </div>
    `;
    this.elKda = this.elMoney.querySelector('.kda')!;
    // 复用 querySelector on full subtree
    const moneyEl = this.elMoney.querySelector('[data-money]')!;
    const kEl = this.elMoney.querySelector('[data-k]')!;
    const dEl = this.elMoney.querySelector('[data-d]')!;
    const aEl = this.elMoney.querySelector('[data-a]')!;
    this.elMoney.dataset.moneyEl = '1';
    // 简单存引用
    (this as any)._moneyEl = moneyEl;
    (this as any)._kEl = kEl;
    (this as any)._dEl = dEl;
    (this as any)._aEl = aEl;

    // 左上 kill feed
    this.elKillfeed = mk('div', 'hud-killfeed', this.root);

    // 右上计分板 (Tab)
    this.elTabBoard = mk('div', 'hud-tab-board', this.root);

    // 中央回合结果横幅
    this.elRoundBanner = mk('div', 'round-banner', this.root);
    this.elRoundBanner.innerHTML = `
      <div class="title" data-rb-title>恐怖分子胜利</div>
      <div class="reason" data-rb-reason>歼灭</div>
    `;
    this.elRoundTitle  = this.elRoundBanner.querySelector('[data-rb-title]')!;
    this.elRoundReason = this.elRoundBanner.querySelector('[data-rb-reason]')!;

    // 中央动作状态 + 进度条
    this.elActionStatus = mk('div', 'action-status', this.root);
    this.elActionStatus.innerHTML = `
      <div class="label" data-act-label>正在埋包</div>
      <div class="plant-progress" data-pbar><div data-pfill></div></div>
    `;
    this.elActionLabel = this.elActionStatus.querySelector('[data-act-label]')!;
    this.elPlantBar    = this.elActionStatus.querySelector('[data-pbar]')!;
    this.elPlantFill   = this.elActionStatus.querySelector('[data-pfill]')!;

    // 中央小消息
    this.elCenterMsg = mk('div', 'center-message', this.root);

    // 炸弹倒计时 (右上)
    this.elBomb = mk('div', 'bomb-indicator', this.root);

    // 受伤 vignette
    this.elDamageVignette = (document.getElementById('damage-vignette') as HTMLDivElement | null)
      ?? (() => {
        const el = mk('div', '', document.body) as HTMLDivElement;
        el.id = 'damage-vignette';
        return el;
      })();

    // 未锁定时点击进入
    this.elClickToPlay = mk('div', 'click-to-play', this.root);
    this.elClickToPlay.innerHTML = 'CLICK TO PLAY';
  }

  // ============== 事件订阅 ==============
  private bindBus() {
    bus.on('round_end', (e: any) => {
      const result = e.result;
      const winner = result.winner;
      const reason = reasonText(result.reason);
      this.showRoundResult(winner, reason);
    });

    bus.on('match_over', (e: any) => {
      this.showRoundResult(e.winner, 'MATCH OVER');
    });

    bus.on('player_kill', (e: any) => {
      const kill = e.kill;
      this.showKillFeed(
        e.killer || kill.shooterId,
        this.getKillerTeam(kill.shooterId),
        e.victim || kill.victimId,
        this.getVictimTeam(kill.victimId),
        kill.weaponId,
        kill.headshot
      );
    });
  }

  // 拿到 killer / victim 的队伍 - 通过 localPlayer 的 game 引用 (简化处理)
  private getKillerTeam(id: string): Team {
    if (this.localPlayer && id === this.localPlayer.id) return this.localPlayer.team;
    // 默认假设: 不是 local 那就反一下
    return this.localPlayer?.team === Team.T ? Team.CT : Team.T;
  }
  private getVictimTeam(id: string): Team {
    if (this.localPlayer && id === this.localPlayer.id) return this.localPlayer.team;
    return this.localPlayer?.team === Team.T ? Team.CT : Team.T;
  }

  // ============== 对外接口 ==============
  bind(localPlayer: PlayerState, match: MatchInfo): void {
    this.localPlayer = localPlayer;
    this.match = match;
  }

  update(): void {
    if (!this.localPlayer || !this.match) return;
    this.renderScoreboard();
    this.renderHealth();
    this.renderAmmo();
    this.renderMoney();
    this.renderActionStatus();
    this.renderBomb();
  }

  // ============== 渲染 ==============
  private renderScoreboard() {
    const m = this.match!;
    this.elTScore.textContent  = String(m.score.T);
    this.elCTScore.textContent = String(m.score.CT);
    this.elRound.textContent   = `Round ${m.round}/${CONFIG.ROUNDS_TO_WIN * 2 - 1}`;
    this.elTimer.textContent   = formatTime(m.timeLeft);
    this.elPhase.textContent   = PHASE_LABEL[m.phase];
    this.elPhase.className     = 'phase ' + m.phase;
  }

  private renderHealth() {
    const p = this.localPlayer!;
    // 安全 clamp: 防止任何异常导致显示巨大数字
    const safeHealth = Math.max(0, Math.min(999999, Math.round(p.health || 0)));
    this.elHp.textContent = String(safeHealth);
    this.elHp.className = 'hp' + (safeHealth <= 20 ? ' crit' : safeHealth <= 50 ? ' low' : '');

    const safeArmor = Math.max(0, Math.min(999999, Math.round(p.armor || 0)));
    this.elArmor.textContent = String(safeArmor);
    this.elArmor.className = 'armor' + (safeArmor <= 0 ? ' zero' : '');

    this.elHelmet.className = 'helmet' + (p.helmet ? '' : ' none');
    this.elHelmet.title = p.helmet ? '防弹衣 + 头盔' : '无头盔';
  }

  private renderAmmo() {
    const p = this.localPlayer!;
    const w = p.weapons[p.activeWeaponIndex];
    if (!w) {
      this.elWeaponName.textContent = '—';
      this.elMag.textContent = '0';
      this.elReserve.textContent = '0';
      this.elReloadFill.style.width = '0%';
      return;
    }
    this.elWeaponName.textContent = w.stats.name;
    // 刀的弹药是 999/0, 视觉上不友好, 隐藏
    if (w.stats.id === WeaponId.Knife) {
      this.elMag.textContent = '∞';
      this.elReserve.textContent = '—';
    } else {
      this.elMag.textContent = String(w.ammoInMag);
      this.elReserve.textContent = String(w.reserveAmmo);
    }

    this.elMag.className = 'mag' + (w.ammoInMag === 0 && w.stats.id !== WeaponId.Knife ? ' empty' : '');

    if (w.reloading) {
      const elapsed = (performance.now() - w.reloadStart) / 1000;
      const t = Math.min(1, elapsed / w.stats.reloadTime);
      this.elReloadFill.style.width = (t * 100) + '%';
      this.elMag.classList.add('reloading');
    } else {
      this.elReloadFill.style.width = '0%';
    }
  }

  private renderMoney() {
    const p = this.localPlayer!;
    const moneyEl: HTMLElement = (this as any)._moneyEl;
    const kEl: HTMLElement = (this as any)._kEl;
    const dEl: HTMLElement = (this as any)._dEl;
    const aEl: HTMLElement = (this as any)._aEl;
    moneyEl.textContent = '$' + p.money;
    kEl.textContent = String(p.kills);
    dEl.textContent = String(p.deaths);
    aEl.textContent = String(p.assists);
  }

  private renderActionStatus() {
    const m = this.match!;
    if (m.planting) {
      this.elActionStatus.classList.add('show');
      this.elActionLabel.textContent = '正在埋包';
      this.elPlantBar.classList.remove('defuse');
      this.elPlantFill.style.width = (m.plantProgress * 100).toFixed(1) + '%';
    } else if (m.defusing) {
      this.elActionStatus.classList.add('show');
      this.elActionLabel.textContent = 'DEFUSING';
      this.elPlantBar.classList.add('defuse');
      this.elPlantFill.style.width = (m.defuseProgress * 100).toFixed(1) + '%';
    } else {
      this.elActionStatus.classList.remove('show');
      this.elPlantFill.style.width = '0%';
    }
  }

  private renderBomb() {
    const m = this.match!;
    if (m.bombPlanted && m.bombTime > 0) {
      this.elBomb.classList.add('show');
      this.elBomb.textContent = `BOMB ${formatTime(m.bombTime)} [${m.bombSite}]`;
    } else {
      this.elBomb.classList.remove('show');
    }
  }

  // ============== 触发性显示 ==============
  showKillFeed(
    killer: string,
    killerTeam: Team,
    victim: string,
    victimTeam: Team,
    weapon: WeaponId,
    headshot: boolean
  ): void {
    const row = document.createElement('div');
    row.className = 'kill-row ' + (killerTeam === Team.CT ? 'ct' : 't');
    row.innerHTML = `
      <span class="killer ${killerTeam === Team.T ? 't' : 'ct'}">${escape(killer)}</span>
      <span class="weapon-icon">${weaponTag(weapon)}${headshot ? ' ★' : ''}</span>
      <span class="victim ${victimTeam === Team.T ? 't' : 'ct'}">${escape(victim)}</span>
    `;
    this.elKillfeed.appendChild(row);

    // 5 秒后移除
    setTimeout(() => row.remove(), 5200);

    // hitmarker
    this.flashHitmarker();
  }

  showMessage(text: string, duration: number = 1800): void {
    this.elCenterMsg.textContent = text;
    this.elCenterMsg.classList.add('show');
    if (this.centerMsgTimer !== null) {
      clearTimeout(this.centerMsgTimer);
      this.centerMsgTimer = null;
    }
    // duration 用 Infinity 表示永久 (死亡提示用, 直到 setPlayerDead(false))
    if (duration === Infinity || duration > 100000000) return;
    this.centerMsgTimer = window.setTimeout(() => {
      this.elCenterMsg.classList.remove('show');
      this.centerMsgTimer = null;
    }, duration);
  }

  /** 玩家死亡状态: 显示半透明遮罩, 锁定死亡提示 */
  setPlayerDead(dead: boolean): void {
    if (dead) {
      this.elCenterMsg.classList.add('show', 'dead');
    } else {
      this.elCenterMsg.classList.remove('show', 'dead');
      if (this.centerMsgTimer !== null) {
        clearTimeout(this.centerMsgTimer);
        this.centerMsgTimer = null;
      }
    }
  }

  showRoundResult(winner: Team, reason: string): void {
    this.elRoundBanner.classList.remove('t', 'ct');
    this.elRoundBanner.classList.add(winner === Team.T ? 't' : 'ct');
    this.elRoundTitle.textContent =
      winner === Team.T ? '恐怖分子胜利' : '反恐精英胜利';
    this.elRoundReason.textContent = reason;
    this.elRoundBanner.classList.add('show');

    if (this.roundBannerTimer !== null) {
      clearTimeout(this.roundBannerTimer);
    }
    this.roundBannerTimer = window.setTimeout(() => {
      this.elRoundBanner.classList.remove('show');
      this.roundBannerTimer = null;
    }, 3000);
  }

  showScoreboard(scores: { T: number; CT: number }, round: number, players: PlayerState[]): void {
    // 分两组
    const ts = players.filter(p => p.team === Team.T);
    const cts = players.filter(p => p.team === Team.CT);

    const tRows = ts.map(p => this.tabRow(p)).join('');
    const cRows = cts.map(p => this.tabRow(p)).join('');

    this.elTabBoard.innerHTML = `
      <h3 class="t">恐怖分子  ${scores.T}</h3>
      <table>
        <thead><tr>
          <th>玩家</th><th>杀</th><th>死</th><th>助</th><th>血</th><th>$</th>
        </tr></thead>
        <tbody>${tRows}</tbody>
      </table>
      <h3 class="ct" style="margin-top:12px">反恐精英  ${scores.CT}</h3>
      <table>
        <thead><tr>
          <th>玩家</th><th>杀</th><th>死</th><th>助</th><th>血</th><th>$</th>
        </tr></thead>
        <tbody>${cRows}</tbody>
      </table>
      <div style="margin-top:10px;font-size:11px;color:#666;text-align:center;letter-spacing:1.5px;">
        ROUND ${round} / ${CONFIG.ROUNDS_TO_WIN * 2 - 1}
      </div>
    `;
  }

  private tabRow(p: PlayerState): string {
    const isLocal = this.localPlayer && p.id === this.localPlayer.id;
    return `<tr class="${isLocal ? 'local' : ''} ${p.alive ? '' : 'dead'}">
      <td>${escape(p.name)}${p.hasBomb ? ' [B]' : ''}</td>
      <td>${p.kills}</td>
      <td>${p.deaths}</td>
      <td>${p.assists}</td>
      <td>${p.alive ? Math.round(p.health) : '—'}</td>
      <td>$${p.money}</td>
    </tr>`;
  }

  // ============== 状态切换 ==============
  setBuyMenuOpen(open: boolean): void {
    this.buyMenuOpen = open;
  }

  setPointerLocked(locked: boolean): void {
    this.pointerLocked = locked;
    if (locked) {
      this.elClickToPlay.classList.remove('show');
    } else if (!this.buyMenuOpen) {
      this.elClickToPlay.classList.add('show');
    }
  }

  // ============== 受伤效果 ==============
  flashDamage(): void {
    const el = this.elDamageVignette;
    el.classList.add('flash');
    if (this.damageFlashTimer !== null) {
      clearTimeout(this.damageFlashTimer);
    }
    this.damageFlashTimer = window.setTimeout(() => {
      el.classList.remove('flash');
      this.damageFlashTimer = null;
    }, 600);
  }

  private flashHitmarker(): void {
    const hit = document.getElementById('hitmarker');
    if (!hit) return;
    hit.classList.remove('show');
    // force reflow
    void (hit as any).offsetWidth;
    hit.classList.add('show');
    if (this.hitTimer !== null) {
      clearTimeout(this.hitTimer);
    }
    this.hitTimer = window.setTimeout(() => {
      hit.classList.remove('show');
      this.hitTimer = null;
    }, 280);
  }
}

function escape(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
