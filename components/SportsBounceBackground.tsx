import React, { useEffect, useRef } from 'react';

type SportKind = 'basketball' | 'baseball' | 'football';

interface BallState {
  kind: SportKind;
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
}

const MIN_SPEED = 1.1;
const MAX_SPEED = 2.2;

const randomBetween = (min: number, max: number) => min + Math.random() * (max - min);

const randomVelocity = () => {
  const angle = randomBetween(0, Math.PI * 2);
  const speed = randomBetween(MIN_SPEED, MAX_SPEED);
  return {
    vx: Math.cos(angle) * speed,
    vy: Math.sin(angle) * speed,
  };
};

const keepSpeedInRange = (ball: BallState) => {
  const speed = Math.hypot(ball.vx, ball.vy) || MIN_SPEED;
  const target = Math.min(MAX_SPEED, Math.max(MIN_SPEED, speed));
  ball.vx = (ball.vx / speed) * target;
  ball.vy = (ball.vy / speed) * target;
};

const drawBasketball = (ctx: CanvasRenderingContext2D, ball: BallState) => {
  ctx.beginPath();
  ctx.arc(ball.x, ball.y, ball.r, 0, Math.PI * 2);
  ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(ball.x, ball.y - ball.r);
  ctx.lineTo(ball.x, ball.y + ball.r);
  ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(ball.x - ball.r, ball.y);
  ctx.lineTo(ball.x + ball.r, ball.y);
  ctx.stroke();

  ctx.beginPath();
  ctx.arc(ball.x, ball.y, ball.r * 0.66, -Math.PI / 2, Math.PI / 2);
  ctx.stroke();

  ctx.beginPath();
  ctx.arc(ball.x, ball.y, ball.r * 0.66, Math.PI / 2, -Math.PI / 2);
  ctx.stroke();
};

const drawBaseball = (ctx: CanvasRenderingContext2D, ball: BallState) => {
  ctx.beginPath();
  ctx.arc(ball.x, ball.y, ball.r, 0, Math.PI * 2);
  ctx.stroke();

  ctx.beginPath();
  ctx.arc(ball.x - ball.r * 0.35, ball.y, ball.r * 0.95, -0.95, 0.95);
  ctx.stroke();

  ctx.beginPath();
  ctx.arc(ball.x + ball.r * 0.35, ball.y, ball.r * 0.95, Math.PI - 0.95, Math.PI + 0.95);
  ctx.stroke();
};

const drawFootball = (ctx: CanvasRenderingContext2D, ball: BallState) => {
  ctx.save();
  ctx.translate(ball.x, ball.y);
  ctx.rotate(Math.PI / 6);

  ctx.beginPath();
  ctx.ellipse(0, 0, ball.r * 1.2, ball.r * 0.72, 0, 0, Math.PI * 2);
  ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(-ball.r * 0.45, 0);
  ctx.lineTo(ball.r * 0.45, 0);
  ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(-ball.r * 0.08, -ball.r * 0.2);
  ctx.lineTo(-ball.r * 0.08, ball.r * 0.2);
  ctx.moveTo(ball.r * 0.08, -ball.r * 0.2);
  ctx.lineTo(ball.r * 0.08, ball.r * 0.2);
  ctx.moveTo(-ball.r * 0.24, -ball.r * 0.14);
  ctx.lineTo(-ball.r * 0.24, ball.r * 0.14);
  ctx.moveTo(ball.r * 0.24, -ball.r * 0.14);
  ctx.lineTo(ball.r * 0.24, ball.r * 0.14);
  ctx.stroke();

  ctx.restore();
};

const drawBall = (ctx: CanvasRenderingContext2D, ball: BallState) => {
  if (ball.kind === 'basketball') drawBasketball(ctx, ball);
  if (ball.kind === 'baseball') drawBaseball(ctx, ball);
  if (ball.kind === 'football') drawFootball(ctx, ball);
};

export const SportsBounceBackground: React.FC = () => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const balls: BallState[] = [];
    const color = (
      getComputedStyle(document.documentElement).getPropertyValue('--color-drafting-orange').trim() || '#ff5f1f'
    );

    let raf = 0;
    let width = 0;
    let height = 0;
    let dpr = 1;
    let lastTime = performance.now();

    const initializeBalls = () => {
      const kinds: SportKind[] = ['basketball', 'baseball', 'football'];
      balls.length = 0;
      kinds.forEach((kind, idx) => {
        const r = randomBetween(28, 42);
        const section = (idx + 1) / (kinds.length + 1);
        const x = width * section;
        const y = randomBetween(r + 16, Math.max(r + 16, height - r - 16));
        const velocity = randomVelocity();
        balls.push({ kind, x, y, r, vx: velocity.vx, vy: velocity.vy });
      });
    };

    const resize = () => {
      dpr = Math.max(1, window.devicePixelRatio || 1);
      width = window.innerWidth;
      height = window.innerHeight;
      canvas.width = Math.floor(width * dpr);
      canvas.height = Math.floor(height * dpr);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.scale(dpr, dpr);
      if (balls.length === 0) initializeBalls();
      balls.forEach((ball) => {
        ball.x = Math.min(width - ball.r, Math.max(ball.r, ball.x));
        ball.y = Math.min(height - ball.r, Math.max(ball.r, ball.y));
      });
    };

    const collideBalls = () => {
      for (let i = 0; i < balls.length; i += 1) {
        for (let j = i + 1; j < balls.length; j += 1) {
          const a = balls[i];
          const b = balls[j];
          const dx = b.x - a.x;
          const dy = b.y - a.y;
          const dist = Math.hypot(dx, dy) || 0.0001;
          const minDist = a.r + b.r;
          if (dist >= minDist) continue;

          const nx = dx / dist;
          const ny = dy / dist;
          const overlap = minDist - dist;

          // Separate overlap first to prevent sticking.
          a.x -= nx * overlap * 0.5;
          a.y -= ny * overlap * 0.5;
          b.x += nx * overlap * 0.5;
          b.y += ny * overlap * 0.5;

          const aN = a.vx * nx + a.vy * ny;
          const bN = b.vx * nx + b.vy * ny;
          const p = aN - bN;

          a.vx -= p * nx;
          a.vy -= p * ny;
          b.vx += p * nx;
          b.vy += p * ny;

          keepSpeedInRange(a);
          keepSpeedInRange(b);
        }
      }
    };

    const handlePointerDown = (event: PointerEvent) => {
      const rect = canvas.getBoundingClientRect();
      const x = event.clientX - rect.left;
      const y = event.clientY - rect.top;
      for (let i = balls.length - 1; i >= 0; i -= 1) {
        const ball = balls[i];
        const dx = x - ball.x;
        const dy = y - ball.y;
        const dist = Math.hypot(dx, dy);
        if (dist > ball.r) continue;

        const currentSpeed = Math.hypot(ball.vx, ball.vy) || MIN_SPEED;
        const nextSpeed = Math.min(MAX_SPEED + 0.45, currentSpeed + 0.45);
        let angle = Math.atan2(ball.y - y, ball.x - x);
        if (!Number.isFinite(angle)) angle = randomBetween(0, Math.PI * 2);
        angle += randomBetween(-0.45, 0.45);
        ball.vx = Math.cos(angle) * nextSpeed;
        ball.vy = Math.sin(angle) * nextSpeed;
        break;
      }
    };

    const step = (time: number) => {
      const dt = Math.min(1.6, (time - lastTime) / 16.67 || 1);
      lastTime = time;

      ctx.clearRect(0, 0, width, height);
      ctx.lineWidth = 2;
      ctx.strokeStyle = color;
      ctx.globalAlpha = 0.34;

      balls.forEach((ball) => {
        ball.x += ball.vx * dt;
        ball.y += ball.vy * dt;

        if (ball.x <= ball.r) {
          ball.x = ball.r;
          ball.vx = Math.abs(ball.vx);
        } else if (ball.x >= width - ball.r) {
          ball.x = width - ball.r;
          ball.vx = -Math.abs(ball.vx);
        }

        if (ball.y <= ball.r) {
          ball.y = ball.r;
          ball.vy = Math.abs(ball.vy);
        } else if (ball.y >= height - ball.r) {
          ball.y = height - ball.r;
          ball.vy = -Math.abs(ball.vy);
        }
      });

      collideBalls();
      balls.forEach((ball) => drawBall(ctx, ball));
      raf = window.requestAnimationFrame(step);
    };

    resize();
    window.addEventListener('resize', resize);
    canvas.addEventListener('pointerdown', handlePointerDown);
    raf = window.requestAnimationFrame(step);

    return () => {
      window.cancelAnimationFrame(raf);
      window.removeEventListener('resize', resize);
      canvas.removeEventListener('pointerdown', handlePointerDown);
    };
  }, []);

  return (
    <div className="absolute inset-0 z-0 overflow-hidden" aria-hidden="true">
      <canvas ref={canvasRef} className="h-full w-full" />
    </div>
  );
};

export default SportsBounceBackground;
