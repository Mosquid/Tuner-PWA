// Confirm a string before displaying it, then smooth in cents (log frequency).
export class PitchTracker {
  constructor() { this.reset(); }

  reset() {
    this.index = null;
    this.pending = [];
    this.readings = [];
    this.cents = null;
    this.lastAcceptedAt = null;
    this.lastInputAt = null;
  }

  update(frequency, targets, selectedIndex, now) {
    if (this.lastAcceptedAt !== null && now - this.lastAcceptedAt > 700) this.reset();
    // Slow analysis is not silence; use the same expiry as the held reading.
    if (this.lastInputAt !== null && now - this.lastInputAt > 700) this.pending = [];
    this.lastInputAt = now;
    if (!Number.isFinite(frequency) || frequency <= 0) {
      this.pending = [];
      return null;
    }
    const offsets = targets.map((target) => 1200 * Math.log2(frequency / target));
    const index = selectedIndex ?? offsets.reduce((best, cents, i) =>
      Math.abs(cents) < Math.abs(offsets[best]) ? i : best, 0);
    const cents = offsets[index];
    if (Math.abs(cents) > (selectedIndex === null ? 175 : 250)) {
      this.pending = [];
      return null;
    }

    if (index !== this.index) {
      const previous = this.pending.at(-1);
      if (previous && (previous.index !== index || Math.abs(previous.cents - cents) > 35)) this.pending = [];
      this.pending.push({ index, cents, now });
      // About 100 ms at the analysis cadence: reject brief harmonics/attacks.
      if (this.pending.length < 3 || now - this.pending[0].now < 90) return null;
      this.index = index;
      this.readings = this.pending.slice(-3).map((reading) => reading.cents);
      this.cents = null;
    } else {
      this.readings.push(cents);
      if (this.readings.length > 3) this.readings.shift();
    }
    this.pending = [];
    const sorted = [...this.readings].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)];
    const elapsed = this.lastAcceptedAt === null ? 48 : Math.min(120, now - this.lastAcceptedAt);
    // Steady near the target; faster while the tuning peg is moving.
    const timeConstant = this.cents !== null && Math.abs(median - this.cents) > 12 ? 80 : 160;
    const alpha = 1 - Math.exp(-elapsed / timeConstant);
    this.cents = this.cents === null ? median : this.cents + alpha * (median - this.cents);
    this.lastAcceptedAt = now;
    return { index, cents: this.cents, frequency: targets[index] * 2 ** (this.cents / 1200) };
  }
}
