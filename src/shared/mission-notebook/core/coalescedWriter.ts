/** Bounded draft I/O: serialize writes and replace pending intermediate values.
 * An in-flight older write always finishes before the newest value (or clear). */
export class CoalescedWriter<T> {
  private desired!: T;
  private version = 0;
  private saved = 0;
  private running?: Promise<void>;
  private timer?: ReturnType<typeof setTimeout>;
  constructor(private write: (value: T) => Promise<unknown>, private onError: (error: unknown) => void, private interval = 180) {}
  set(value: T) {
    this.desired = value;
    this.version++;
    // Throttle rather than reset the timer on every key: long typing sessions
    // still leave a recent recoverable checkpoint on disk.
    if (!this.timer) this.timer = setTimeout(() => { this.timer = undefined; void this.flush().catch(this.onError); }, this.interval);
  }
  async flush(): Promise<void> {
    clearTimeout(this.timer); this.timer = undefined;
    if (this.running) {
      await this.running;
      if (this.saved < this.version) return this.flush();
      return;
    }
    this.running = (async () => {
      while (this.saved < this.version) {
        const version = this.version, value = this.desired;
        await this.write(value);
        this.saved = version;
      }
    })().finally(() => { this.running = undefined; });
    return this.running;
  }
}
