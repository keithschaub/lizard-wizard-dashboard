export class Engine {
  // onStatus({text, stage, got, total}) for loading progress; onFatal(message, stage) for errors outside a call.
  constructor(onStatus, onFatal) {
    this.seq = 0;
    this.waiting = new Map();
    this.dead = null;
    this.onFatal = onFatal;
    this.worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
    this.worker.onmessage = (ev) => {
      const m = ev.data;
      if (m.type === 'status') { onStatus?.(m); return; }
      if (m.type === 'fatal') { this.fail(m.error, m.stage); return; }
      const cb = this.waiting.get(m.id);
      if (cb) { this.waiting.delete(m.id); cb(JSON.parse(m.out)); }
    };
    this.worker.onerror = (e) => { e.preventDefault?.(); this.fail(e.message || 'the engine worker failed to start', 'worker'); };
    this.worker.onmessageerror = () => this.fail('a message from the engine worker could not be read', 'worker');
  }
  fail(error, stage) {
    if (!this.dead) this.dead = { error, stage };
    for (const [, cb] of this.waiting) cb({ ok: false, error, stage });
    this.waiting.clear();
    this.onFatal?.(error, stage);
  }
  call(fn, args = {}) {
    if (this.dead) return Promise.resolve({ ok: false, error: this.dead.error, stage: this.dead.stage });
    const id = ++this.seq;
    return new Promise((resolve) => {
      this.waiting.set(id, resolve);
      this.worker.postMessage({ id, fn, args });
    });
  }
  async init(env) {
    const r = await this.call('__init__', env);
    if (!r.ok) { const e = new Error(r.error); e.stage = r.stage; throw e; }
  }
  terminate() { this.worker.terminate(); this.fail('stopped', 'retry'); }
}
