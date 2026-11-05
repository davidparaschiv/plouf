// Monotonic browser clock: zero is the end of the five-second countdown.
export class ResponseClock {
  constructor(now = () => performance.now()) {
    this.now = now;
    this.reset();
  }
  reset() {
    this.key = null;
    this.startedAt = null;
  }
  arm(key, millisecondsUntilZero) {
    if (key === this.key) return;
    this.key = key;
    this.startedAt = this.now() + millisecondsUntilZero;
  }
  elapsed() {
    return this.startedAt === null ? null : Math.max(0, Math.round(this.now() - this.startedAt));
  }
}
