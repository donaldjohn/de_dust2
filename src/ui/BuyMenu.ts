// 买枪菜单 - B 键打开, Esc / 再次按 B 关闭
// 列出本阵营可买武器, 标记已拥有, 价格不够标红

import { WeaponId, Team } from '../types';
import { WEAPONS, BUY_LIST } from '../weapons/weapons.db';
import { bus } from '../utils/events';

export class BuyMenu {
  isOpen: boolean = false;
  onBuy?: (id: WeaponId) => void;
  onClose?: () => void;

  private root: HTMLElement;
  private elMenu!: HTMLDivElement;
  private elTitle!: HTMLHeadingElement;
  private elGrid!: HTMLDivElement;
  private elMoney!: HTMLSpanElement;
  private elTeam: Team = Team.T;
  private currentMoney: number = 0;
  private owned: Set<WeaponId> = new Set();

  // 按键事件解绑
  private onKeyDown = (e: KeyboardEvent) => {
    if (!this.isOpen) return;
    if (e.code === 'Escape' || e.code === 'KeyB') {
      e.preventDefault();
      this.close();
    }
  };

  constructor(root: HTMLElement) {
    this.root = root;
    this.buildDom();
    window.addEventListener('keydown', this.onKeyDown);
  }

  private buildDom() {
    this.elMenu = document.createElement('div');
    this.elMenu.className = 'buy-menu';
    this.elMenu.innerHTML = `
      <h2 data-title>BUY MENU</h2>
      <div class="hint" data-hint>Press B or ESC to close</div>
      <div class="grid" data-grid></div>
      <div class="footer">
        <span>FUNDS</span>
        <span class="money" data-money>$0</span>
      </div>
    `;
    this.root.appendChild(this.elMenu);

    this.elTitle = this.elMenu.querySelector('[data-title]')!;
    this.elGrid  = this.elMenu.querySelector('[data-grid]')!;
    this.elMoney = this.elMenu.querySelector('[data-money]')!;
  }

  open(money: number, team: Team, owned: WeaponId[]): void {
    this.currentMoney = money;
    this.elTeam = team;
    this.owned = new Set(owned);
    this.render();
    this.elMenu.classList.add('open');
    this.isOpen = true;
    bus.emit('ui_buy_open');
  }

  close(): void {
    this.elMenu.classList.remove('open');
    this.isOpen = false;
    bus.emit('ui_buy_close');
    this.onClose?.();
  }

  toggle(money: number, team: Team, owned: WeaponId[]): void {
    if (this.isOpen) this.close();
    else this.open(money, team, owned);
  }

  // ============== 渲染 ==============
  private render(): void {
    this.elTitle.textContent = this.elTeam === Team.T
      ? 'TERRORIST  BUY  MENU'
      : 'COUNTER-TERRORIST  BUY  MENU';

    this.elMoney.textContent = '$' + this.currentMoney;

    const ids = BUY_LIST[this.elTeam] || [];
    this.elGrid.innerHTML = '';

    for (const id of ids) {
      const stats = WEAPONS[id];
      if (!stats) continue;
      const owned = this.owned.has(id);
      const cant = stats.price > this.currentMoney;
      const free = stats.price === 0;

      const btn = document.createElement('div');
      btn.className = 'item' + (owned ? ' owned' : cant ? ' cant-afford' : '');

      const priceText = free ? 'FREE' : '$' + stats.price;
      const checkMark = owned ? '<span class="check">✓</span>' : '';

      btn.innerHTML = `
        <span class="name">${escape(stats.name)}</span>
        <span class="price">${priceText}${checkMark}</span>
      `;

      if (!owned && !cant) {
        btn.addEventListener('click', () => {
          this.handleBuy(id);
        });
      }

      this.elGrid.appendChild(btn);
    }
  }

  private handleBuy(id: WeaponId): void {
    if (this.owned.has(id)) return;
    const stats = WEAPONS[id];
    if (!stats) return;
    if (stats.price > this.currentMoney) return;
    bus.emit('buy_weapon', { id });
    this.onBuy?.(id);
    // 关闭菜单 (CS 风格)
    this.close();
  }
}

function escape(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
