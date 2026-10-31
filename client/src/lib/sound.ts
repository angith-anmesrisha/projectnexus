let ctx: AudioContext | null = null;

/** A soft two-note ping, synthesised so there is no audio file to load. */
export function ping() {
  try {
    ctx ??= new AudioContext();
    const now = ctx.currentTime;
    [880, 1320].forEach((freq, i) => {
      const osc = ctx!.createOscillator();
      const gain = ctx!.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0, now + i * 0.09);
      gain.gain.linearRampToValueAtTime(0.08, now + i * 0.09 + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + i * 0.09 + 0.25);
      osc.connect(gain).connect(ctx!.destination);
      osc.start(now + i * 0.09);
      osc.stop(now + i * 0.09 + 0.3);
    });
  } catch {
    // Audio may be blocked until the user interacts with the page.
  }
}
