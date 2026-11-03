export class Engine {
  constructor(onStatus) {
    this.worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
    this.seq = 0;
    this.waiting = new Map();
    this.worker.onmessage = (ev) => {
      const m = ev.data;
      if (m.type === 'status') { onStatus?.(m.text); return; }
      const cb = this.waiting.get(m.id);
      if (cb) { this.waiting.delete(m.id); cb(JSON.parse(m.out)); }
    };
  }
  call(fn, args = {}) {
    const id = ++this.seq;
    return new Promise((resolve) => {
      this.waiting.set(id, resolve);
      this.worker.postMessage({ id, fn, args });
    });
  }
  async init() {
    const r = await this.call('__init__');
    if (!r.ok) throw new Error(r.error);
  }
}
