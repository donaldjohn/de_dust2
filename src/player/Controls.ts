// 玩家输入管理 - 键盘 / 鼠标 / 滚轮 / PointerLock
//
// 设计要点:
// - 持续状态 (forward/back/...) 反映按键是否按住
// - consumeKey 提供一次性触发 (按下瞬间返回 true, 之后清零)
// - mouseDX/mouseDY 在 update() 里被读取后清零
// - scrollDelta 同上
// - pointerLocked 反映当前是否被 pointer lock

export class Input {
  // 持续按键状态
  forward = false;      // W
  back = false;         // S
  left = false;         // A
  right = false;        // D
  jump = false;         // Space
  reload = false;       // R
  buy = false;          // B
  use = false;          // E (拆/埋/拾取)
  drop = false;         // G
  sprint = false;       // Shift
  primaryAttack = false;   // 鼠标左键
  secondaryAttack = false; // 鼠标右键 (瞄准)

  // 鼠标增量 (每帧清零)
  mouseDX = 0;
  mouseDY = 0;

  // 滚轮 (切武器)
  scrollDelta = 0;

  // 一次性触发队列
  private oneShot = new Set<string>();

  pointerLocked = false;

  private domElement: HTMLElement;
  private onContextMenu: (e: MouseEvent) => void;
  private onMouseMove: (e: MouseEvent) => void;
  private onMouseDown: (e: MouseEvent) => void;
  private onMouseUp: (e: MouseEvent) => void;
  private onWheel: (e: WheelEvent) => void;
  private onKeyDown: (e: KeyboardEvent) => void;
  private onKeyUp: (e: KeyboardEvent) => void;
  private onPointerLockChange: () => void;

  constructor(domElement: HTMLElement) {
    this.domElement = domElement;

    this.onContextMenu = (e) => e.preventDefault();
    this.onMouseMove = (e) => this.handleMouseMove(e);
    this.onMouseDown = (e) => this.handleMouseDown(e);
    this.onMouseUp = (e) => this.handleMouseUp(e);
    this.onWheel = (e) => this.handleWheel(e);
    this.onKeyDown = (e) => this.handleKeyDown(e);
    this.onKeyUp = (e) => this.handleKeyUp(e);
    this.onPointerLockChange = () => this.handlePointerLockChange();

    // 禁止右键菜单 (影响键位)
    this.domElement.addEventListener('contextmenu', this.onContextMenu);
    this.domElement.addEventListener('mousemove', this.onMouseMove);
    this.domElement.addEventListener('mousedown', this.onMouseDown);
    this.domElement.addEventListener('mouseup', this.onMouseUp);
    this.domElement.addEventListener('wheel', this.onWheel, { passive: false });
    // 键监听放 document, 无论焦点在哪儿都能收到
    document.addEventListener('keydown', this.onKeyDown);
    document.addEventListener('keyup', this.onKeyUp);
    document.addEventListener('pointerlockchange', this.onPointerLockChange);
  }

  /** 一次性消费按键: 按下瞬间返回 true, 之后清零 */
  consumeKey(code: string): boolean {
    if (this.oneShot.has(code)) {
      this.oneShot.delete(code);
      return true;
    }
    return false;
  }

  /** 帧结束由 Player 调用, 把增量归零 */
  update(): void {
    this.mouseDX = 0;
    this.mouseDY = 0;
    this.scrollDelta = 0;
  }

  // ---- 事件处理 ----

  private codeToKey(code: string): keyof Input | null {
    switch (code) {
      case 'KeyW': case 'ArrowUp':    return 'forward';
      case 'KeyS': case 'ArrowDown':  return 'back';
      case 'KeyA': case 'ArrowLeft':  return 'left';
      case 'KeyD': case 'ArrowRight': return 'right';
      case 'Space':          return 'jump';
      case 'KeyR':           return 'reload';
      case 'KeyB':           return 'buy';
      case 'KeyE':           return 'use';
      case 'KeyG':           return 'drop';
      case 'ShiftLeft':
      case 'ShiftRight':     return 'sprint';
      default: return null;
    }
  }

  private isDigitWeaponSwitch(code: string): boolean {
    return code === 'Digit1' || code === 'Digit2' || code === 'Digit3' ||
           code === 'Digit4' || code === 'Digit5';
  }

  private handleKeyDown(e: KeyboardEvent) {
    const key = this.codeToKey(e.code);
    if (key) {
      // 避免按住自动重复时反复触发: 只在首次按下时记入 oneShot 队列
      if (!(this as any)[key]) {
        this.oneShot.add(e.code);
      }
      (this as any)[key] = true;
      // 阻止方向键 / 空格滚动页面
      if (e.code === 'Space' || e.code.startsWith('Arrow')) e.preventDefault();
    } else if (this.isDigitWeaponSwitch(e.code)) {
      // 数字键切武器: 一次性触发
      this.oneShot.add(e.code);
    }
  }

  private handleKeyUp(e: KeyboardEvent) {
    const key = this.codeToKey(e.code);
    if (key) {
      (this as any)[key] = false;
    }
  }

  private handleMouseMove(e: MouseEvent) {
    if (!this.pointerLocked) return;
    this.mouseDX += e.movementX || 0;
    this.mouseDY += e.movementY || 0;
  }

  private handleMouseDown(e: MouseEvent) {
    if (e.button === 0) this.primaryAttack = true;
    else if (e.button === 2) this.secondaryAttack = true;
  }

  private handleMouseUp(e: MouseEvent) {
    if (e.button === 0) this.primaryAttack = false;
    else if (e.button === 2) this.secondaryAttack = false;
  }

  private handleWheel(e: WheelEvent) {
    // 即使没锁也允许 (有时滚轮切武器不在锁定时也用)
    e.preventDefault();
    // 归一化: 各浏览器 deltaMode 不同
    let d = e.deltaY;
    if (e.deltaMode === 1) d *= 16;        // LINE
    else if (e.deltaMode === 2) d *= 100;  // PAGE
    this.scrollDelta += d;
  }

  private handlePointerLockChange() {
    this.pointerLocked =
      document.pointerLockElement === this.domElement;
    // 失锁时清掉所有按键状态, 防止卡键
    if (!this.pointerLocked) {
      this.forward = this.back = this.left = this.right = false;
      this.jump = this.reload = this.buy = this.use = this.drop = false;
      this.sprint = false;
      this.primaryAttack = this.secondaryAttack = false;
    }
  }

  /** 释放资源 (页面卸载 / 模块销毁) */
  dispose() {
    this.domElement.removeEventListener('contextmenu', this.onContextMenu);
    this.domElement.removeEventListener('mousemove', this.onMouseMove);
    this.domElement.removeEventListener('mousedown', this.onMouseDown);
    this.domElement.removeEventListener('mouseup', this.onMouseUp);
    this.domElement.removeEventListener('wheel', this.onWheel);
    document.removeEventListener('keydown', this.onKeyDown);
    document.removeEventListener('keyup', this.onKeyUp);
    document.removeEventListener('pointerlockchange', this.onPointerLockChange);
  }
}
