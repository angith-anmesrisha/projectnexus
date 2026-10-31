/** A short, dependency-free confetti burst drawn on a temporary canvas. */
export function burstConfetti() {
  if (document.documentElement.dataset.motion === 'reduced') return;
  const canvas = document.createElement('canvas');
  canvas.className = 'confetti';
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
  document.body.appendChild(canvas);
  const ctx = canvas.getContext('2d')!;
  const style = getComputedStyle(document.documentElement);
  const colors = [style.getPropertyValue('--accent'), style.getPropertyValue('--accent-2'), '#fde047', '#f472b6', '#ffffff'];
  const parts = Array.from({ length: 140 }, () => ({
    x: canvas.width / 2 + (Math.random() - 0.5) * 200,
    y: canvas.height - 120,
    vx: (Math.random() - 0.5) * 16,
    vy: -Math.random() * 18 - 8,
    r: Math.random() * 6 + 3,
    rot: Math.random() * Math.PI,
    vr: (Math.random() - 0.5) * 0.3,
    c: colors[Math.floor(Math.random() * colors.length)].trim() || '#fff',
  }));
  const start = performance.now();
  const frame = (t: number) => {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    for (const p of parts) {
      p.vy += 0.45;
      p.x += p.vx;
      p.y += p.vy;
      p.rot += p.vr;
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      ctx.fillStyle = p.c;
      ctx.fillRect(-p.r, -p.r / 2, p.r * 2, p.r);
      ctx.restore();
    }
    if (t - start < 2200) requestAnimationFrame(frame);
    else canvas.remove();
  };
  requestAnimationFrame(frame);
}
