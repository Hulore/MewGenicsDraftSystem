import { useEffect, useRef, useState } from "react";
import Matter from "matter-js";

interface DiceCanvasProps {
  value: number | null;
  token: string;
  active: boolean;
}

export function DiceCanvas({ value, token, active }: DiceCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [settledValue, setSettledValue] = useState<number | null>(value);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || value === null) {
      setSettledValue(value);
      return;
    }

    setSettledValue(null);

    const engine = Matter.Engine.create();
    engine.gravity.y = 1.2;

    const render = Matter.Render.create({
      canvas,
      engine,
      options: {
        width: 220,
        height: 160,
        wireframes: false,
        background: "transparent",
        pixelRatio: window.devicePixelRatio
      }
    });

    const die = Matter.Bodies.rectangle(48, 24, 58, 58, {
      restitution: 0.72,
      friction: 0.16,
      frictionAir: 0.014,
      angle: Math.random() * Math.PI,
      render: {
        fillStyle: "#f8f1dc",
        strokeStyle: "#1a1712",
        lineWidth: 3
      }
    });
    const floor = Matter.Bodies.rectangle(110, 155, 250, 18, { isStatic: true });
    const leftWall = Matter.Bodies.rectangle(-8, 80, 16, 180, { isStatic: true });
    const rightWall = Matter.Bodies.rectangle(228, 80, 16, 180, { isStatic: true });

    Matter.Body.setVelocity(die, {
      x: 7 + Math.random() * 3,
      y: -2 - Math.random() * 3
    });
    Matter.Body.setAngularVelocity(die, 0.34 + Math.random() * 0.18);
    Matter.Composite.add(engine.world, [die, floor, leftWall, rightWall]);

    const runner = Matter.Runner.create();
    Matter.Render.run(render);
    Matter.Runner.run(runner, engine);

    const timeout = window.setTimeout(() => {
      setSettledValue(value);
      Matter.Render.stop(render);
      Matter.Runner.stop(runner);
      Matter.Engine.clear(engine);
      render.canvas.getContext("2d")?.clearRect(0, 0, 220, 160);
    }, 1450);

    return () => {
      window.clearTimeout(timeout);
      Matter.Render.stop(render);
      Matter.Runner.stop(runner);
      Matter.Engine.clear(engine);
    };
  }, [value, token]);

  return (
    <div className={`dice-stage ${active ? "is-active" : ""}`}>
      <canvas ref={canvasRef} width={220} height={160} />
      <div className={`dice-face ${settledValue ? "is-settled" : ""}`}>
        {settledValue ?? "?"}
      </div>
    </div>
  );
}

