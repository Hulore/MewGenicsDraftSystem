import { useEffect, useRef, useState } from "react";
import Matter from "matter-js";

interface DiceCanvasProps {
  value: number | null;
  token: string;
  active: boolean;
  onSettled?: (token: string) => void;
}

const CANVAS_WIDTH = 220;
const CANVAS_HEIGHT = 160;
const DIE_SIZE = 58;
const ROLL_DURATION_MS = 1680;

export function DiceCanvas({ value, token, active, onSettled }: DiceCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [settledValue, setSettledValue] = useState<number | null>(value);
  const rolling = value !== null && settledValue === null;

  useEffect(() => {
    const canvas = canvasRef.current;

    if (!canvas || value === null) {
      setSettledValue(value);
      clearCanvas(canvas);
      return;
    }

    setSettledValue(null);

    const context = setupCanvas(canvas);
    const engine = Matter.Engine.create();
    engine.gravity.y = 1.45;

    const die = Matter.Bodies.rectangle(randomBetween(34, 72), 24, DIE_SIZE, DIE_SIZE, {
      restitution: 0.82,
      friction: 0.08,
      frictionAir: 0.012,
      angle: randomBetween(-0.8, 0.8),
      chamfer: { radius: 7 }
    });
    const floor = Matter.Bodies.rectangle(CANVAS_WIDTH / 2, 151, CANVAS_WIDTH + 60, 18, {
      isStatic: true,
      restitution: 0.92
    });
    const leftWall = Matter.Bodies.rectangle(-10, CANVAS_HEIGHT / 2, 20, CANVAS_HEIGHT + 40, {
      isStatic: true
    });
    const rightWall = Matter.Bodies.rectangle(CANVAS_WIDTH + 10, CANVAS_HEIGHT / 2, 20, CANVAS_HEIGHT + 40, {
      isStatic: true
    });
    const ceiling = Matter.Bodies.rectangle(CANVAS_WIDTH / 2, -16, CANVAS_WIDTH + 60, 20, {
      isStatic: true
    });

    Matter.Composite.add(engine.world, [die, floor, leftWall, rightWall, ceiling]);
    Matter.Body.setVelocity(die, {
      x: randomBetween(7.8, 11.5),
      y: randomBetween(-7.2, -4.6)
    });
    Matter.Body.setAngularVelocity(die, randomBetween(0.44, 0.72));

    let frame = 0;
    let animationFrame = 0;
    const startedAt = performance.now();

    const draw = (now: number) => {
      const elapsed = now - startedAt;
      const progress = Math.min(1, elapsed / ROLL_DURATION_MS);
      const face = progress < 0.82 ? ((Math.floor(elapsed / 92) + frame) % 6) + 1 : value;

      Matter.Engine.update(engine, 1000 / 60);
      drawScene(context, die, face, progress);
      frame += 1;

      if (elapsed < ROLL_DURATION_MS) {
        animationFrame = requestAnimationFrame(draw);
        return;
      }

      setSettledValue(value);
      onSettled?.(token);
      window.setTimeout(() => clearCanvas(canvas), 180);
      Matter.Engine.clear(engine);
    };

    animationFrame = requestAnimationFrame(draw);

    return () => {
      cancelAnimationFrame(animationFrame);
      Matter.Engine.clear(engine);
      clearCanvas(canvas);
    };
  }, [onSettled, token, value]);

  return (
    <div className={`dice-stage ${active ? "is-active" : ""} ${rolling ? "is-rolling" : ""}`}>
      <canvas ref={canvasRef} width={CANVAS_WIDTH} height={CANVAS_HEIGHT} />
      <div className={`dice-face ${settledValue ? "is-settled" : ""} ${rolling ? "is-hidden" : ""}`}>
        {rolling ? "" : settledValue ?? "?"}
      </div>
    </div>
  );
}

function setupCanvas(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
  const ratio = window.devicePixelRatio || 1;
  canvas.width = CANVAS_WIDTH * ratio;
  canvas.height = CANVAS_HEIGHT * ratio;
  canvas.style.width = `${CANVAS_WIDTH}px`;
  canvas.style.height = `${CANVAS_HEIGHT}px`;

  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("Canvas context is not available.");
  }

  context.setTransform(ratio, 0, 0, ratio, 0, 0);
  return context;
}

function clearCanvas(canvas: HTMLCanvasElement | null): void {
  if (!canvas) {
    return;
  }

  const context = canvas?.getContext("2d");
  context?.clearRect(0, 0, canvas.width, canvas.height);
}

function drawScene(
  context: CanvasRenderingContext2D,
  die: Matter.Body,
  face: number,
  progress: number
): void {
  context.clearRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

  context.save();
  context.globalAlpha = 0.9;
  context.fillStyle = "rgba(255, 243, 218, 0.06)";
  context.fillRect(18, 147, CANVAS_WIDTH - 36, 3);
  context.restore();

  const shadowScale = 1 + Math.max(0, die.position.y - 72) / 140;
  context.save();
  context.translate(die.position.x, 147);
  context.scale(shadowScale, 1);
  context.fillStyle = `rgba(0, 0, 0, ${0.16 + progress * 0.12})`;
  context.beginPath();
  context.ellipse(0, 0, 28, 7, 0, 0, Math.PI * 2);
  context.fill();
  context.restore();

  context.save();
  context.translate(die.position.x, die.position.y);
  context.rotate(die.angle);
  drawDie(context, face);
  context.restore();
}

function drawDie(context: CanvasRenderingContext2D, face: number): void {
  const half = DIE_SIZE / 2;

  context.shadowColor = "rgba(0, 0, 0, 0.34)";
  context.shadowBlur = 12;
  context.shadowOffsetY = 7;
  context.fillStyle = "#fff3da";
  context.strokeStyle = "#1a1712";
  context.lineWidth = 3;
  roundedRect(context, -half, -half, DIE_SIZE, DIE_SIZE, 8);
  context.fill();
  context.stroke();

  context.shadowColor = "transparent";
  context.fillStyle = "#1a1712";
  for (const [x, y] of getPips(face)) {
    context.beginPath();
    context.arc(x, y, 4.2, 0, Math.PI * 2);
    context.fill();
  }
}

function roundedRect(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number
): void {
  context.beginPath();
  context.moveTo(x + radius, y);
  context.arcTo(x + width, y, x + width, y + height, radius);
  context.arcTo(x + width, y + height, x, y + height, radius);
  context.arcTo(x, y + height, x, y, radius);
  context.arcTo(x, y, x + width, y, radius);
  context.closePath();
}

function getPips(face: number): Array<[number, number]> {
  const left = -15;
  const center = 0;
  const right = 15;
  const top = -15;
  const middle = 0;
  const bottom = 15;

  if (face === 1) return [[center, middle]];
  if (face === 2) return [[left, top], [right, bottom]];
  if (face === 3) return [[left, top], [center, middle], [right, bottom]];
  if (face === 4) return [[left, top], [right, top], [left, bottom], [right, bottom]];
  if (face === 5) return [[left, top], [right, top], [center, middle], [left, bottom], [right, bottom]];
  return [[left, top], [right, top], [left, middle], [right, middle], [left, bottom], [right, bottom]];
}

function randomBetween(min: number, max: number): number {
  return min + Math.random() * (max - min);
}
