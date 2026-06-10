// 简易事件总线
type Listener = (e: any) => void;

export class EventBus {
  private listeners = new Map<string, Set<Listener>>();

  on(type: string, fn: Listener) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type)!.add(fn);
    return () => this.off(type, fn);
  }

  off(type: string, fn: Listener) {
    this.listeners.get(type)?.delete(fn);
  }

  emit(type: string, payload?: any) {
    this.listeners.get(type)?.forEach(fn => {
      try { fn(payload); } catch (e) { console.error(e); }
    });
  }
}

// 单例
export const bus = new EventBus();
