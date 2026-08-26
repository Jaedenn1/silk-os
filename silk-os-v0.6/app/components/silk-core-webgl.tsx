"use client";

import { useEffect, useRef, useState } from "react";

export type SilkCoreState =
  | "idle"
  | "retrieving"
  | "searching"
  | "calendar"
  | "routing"
  | "thinking"
  | "speaking"
  | "syncing"
  | "approval"
  | "error";

type Props = {
  state: SilkCoreState;
  label: string;
  compact?: boolean;
};

const STATE_COLORS: Record<SilkCoreState, [number, number, number]> = {
  idle: [0.22, 0.88, 1],
  retrieving: [0.41, 0.76, 1],
  searching: [0.58, 0.55, 1],
  calendar: [0.31, 0.68, 1],
  routing: [0.73, 0.51, 1],
  thinking: [0.34, 0.96, 0.82],
  speaking: [0.45, 1, 0.68],
  syncing: [0.34, 0.94, 0.86],
  approval: [1, 0.75, 0.32],
  error: [1, 0.31, 0.43],
};

const VERTEX_SHADER = `
attribute vec3 aPosition;
uniform float uTime;
uniform float uAspect;
uniform float uEnergy;
uniform vec2 uPointer;
uniform float uPointSize;
varying float vDepth;

mat2 rotate2d(float angle) {
  float s = sin(angle);
  float c = cos(angle);
  return mat2(c, -s, s, c);
}

void main() {
  vec3 p = aPosition;
  float drift = uTime * (0.09 + uEnergy * 0.08);
  p.xz = rotate2d(drift + uPointer.x * 0.18) * p.xz;
  p.yz = rotate2d(-drift * 0.62 + uPointer.y * 0.14) * p.yz;
  float breathe = 1.0 + sin(uTime * (1.0 + uEnergy * 1.7) + length(p) * 2.0) * (0.014 + uEnergy * 0.018);
  p *= breathe;
  float cameraZ = 4.4 + p.z;
  gl_Position = vec4((p.x / cameraZ) * 3.25 / uAspect, (p.y / cameraZ) * 3.25, (cameraZ - 3.3) / 2.8, 1.0);
  gl_PointSize = uPointSize * (5.2 / cameraZ) * (0.85 + uEnergy * 0.35);
  vDepth = clamp((p.z + 1.8) / 3.6, 0.0, 1.0);
}`;

const FRAGMENT_SHADER = `
precision mediump float;
uniform vec3 uColor;
uniform float uAlpha;
uniform float uPointMode;
varying float vDepth;

void main() {
  float alpha = uAlpha * (0.48 + vDepth * 0.72);
  if (uPointMode > 0.5) {
    vec2 center = gl_PointCoord - vec2(0.5);
    float radius = length(center);
    if (radius > 0.5) discard;
    alpha *= smoothstep(0.5, 0.05, radius);
  }
  gl_FragColor = vec4(uColor, alpha);
}`;

function compileShader(gl: WebGLRenderingContext, type: number, source: string) {
  const shader = gl.createShader(type);
  if (!shader) throw new Error("WebGL shader could not be created.");
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const detail = gl.getShaderInfoLog(shader) || "Unknown shader error";
    gl.deleteShader(shader);
    throw new Error(detail);
  }
  return shader;
}

function createProgram(gl: WebGLRenderingContext) {
  const program = gl.createProgram();
  if (!program) throw new Error("WebGL program could not be created.");
  const vertex = compileShader(gl, gl.VERTEX_SHADER, VERTEX_SHADER);
  const fragment = compileShader(gl, gl.FRAGMENT_SHADER, FRAGMENT_SHADER);
  gl.attachShader(program, vertex);
  gl.attachShader(program, fragment);
  gl.linkProgram(program);
  gl.deleteShader(vertex);
  gl.deleteShader(fragment);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    throw new Error(gl.getProgramInfoLog(program) || "WebGL program could not link.");
  }
  return program;
}

function spherePoints(count: number, radius: number) {
  const values: number[] = [];
  const golden = Math.PI * (3 - Math.sqrt(5));
  for (let index = 0; index < count; index += 1) {
    const y = 1 - (index / (count - 1)) * 2;
    const ringRadius = Math.sqrt(Math.max(0, 1 - y * y));
    const theta = golden * index;
    const jitter = 1 + Math.sin(index * 12.9898) * 0.035;
    values.push(
      Math.cos(theta) * ringRadius * radius * jitter,
      y * radius * jitter,
      Math.sin(theta) * ringRadius * radius * jitter,
    );
  }
  return values;
}

function ringLines(radius: number, axis: 0 | 1 | 2, segments = 96, phase = 0) {
  const values: number[] = [];
  for (let index = 0; index < segments; index += 1) {
    const a = phase + (index / segments) * Math.PI * 2;
    const b = phase + ((index + 1) / segments) * Math.PI * 2;
    const point = (angle: number) => {
      const x = Math.cos(angle) * radius;
      const y = Math.sin(angle) * radius;
      if (axis === 0) return [0, x, y];
      if (axis === 1) return [x, 0, y];
      return [x, y, 0];
    };
    values.push(...point(a), ...point(b));
  }
  return values;
}

function filamentLines() {
  const values: number[] = [];
  for (let strand = 0; strand < 14; strand += 1) {
    const longitude = (strand / 14) * Math.PI * 2;
    for (let index = 0; index < 25; index += 1) {
      const a = -Math.PI / 2 + (index / 25) * Math.PI;
      const b = -Math.PI / 2 + ((index + 1) / 25) * Math.PI;
      const point = (latitude: number) => {
        const bend = longitude + Math.sin(latitude * 2 + strand) * 0.1;
        const radius = 1.03 + Math.sin(latitude * 4 + strand) * 0.025;
        return [
          Math.cos(latitude) * Math.cos(bend) * radius,
          Math.sin(latitude) * radius,
          Math.cos(latitude) * Math.sin(bend) * radius,
        ];
      };
      values.push(...point(a), ...point(b));
    }
  }
  return values;
}

export function SilkCoreWebGL({ state, label, compact = false }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stateRef = useRef(state);
  const pointerRef = useRef<[number, number]>([0, 0]);
  const [fallback, setFallback] = useState(false);

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const gl = canvas.getContext("webgl", {
      alpha: true,
      antialias: true,
      depth: false,
      powerPreference: "high-performance",
    });
    if (!gl) {
      queueMicrotask(() => setFallback(true));
      return;
    }

    let disposed = false;
    let visible = true;
    let animationFrame = 0;
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    try {
      const program = createProgram(gl);
      const positionLocation = gl.getAttribLocation(program, "aPosition");
      const uniforms = {
        time: gl.getUniformLocation(program, "uTime"),
        aspect: gl.getUniformLocation(program, "uAspect"),
        energy: gl.getUniformLocation(program, "uEnergy"),
        pointer: gl.getUniformLocation(program, "uPointer"),
        pointSize: gl.getUniformLocation(program, "uPointSize"),
        color: gl.getUniformLocation(program, "uColor"),
        alpha: gl.getUniformLocation(program, "uAlpha"),
        pointMode: gl.getUniformLocation(program, "uPointMode"),
      };

      const pointValues = spherePoints(compact ? 520 : 900, 0.82);
      for (let index = 0; index < (compact ? 80 : 150); index += 1) {
        const angle = index * 2.39996;
        const radius = 1.18 + (index % 9) * 0.035;
        pointValues.push(
          Math.cos(angle) * radius,
          Math.sin(index * 1.723) * 0.78,
          Math.sin(angle) * radius,
        );
      }
      const lineValues = [
        ...ringLines(1.06, 0),
        ...ringLines(1.18, 1, 96, 0.25),
        ...ringLines(1.34, 2, 112, 0.5),
        ...filamentLines(),
      ];

      const pointBuffer = gl.createBuffer();
      const lineBuffer = gl.createBuffer();
      if (!pointBuffer || !lineBuffer) throw new Error("WebGL buffers could not be created.");
      gl.bindBuffer(gl.ARRAY_BUFFER, pointBuffer);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(pointValues), gl.STATIC_DRAW);
      gl.bindBuffer(gl.ARRAY_BUFFER, lineBuffer);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(lineValues), gl.STATIC_DRAW);
      gl.useProgram(program);
      gl.enableVertexAttribArray(positionLocation);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE);
      gl.disable(gl.DEPTH_TEST);

      const resize = () => {
        const rect = canvas.getBoundingClientRect();
        const dpr = Math.min(window.devicePixelRatio || 1, compact ? 1.5 : 2);
        const width = Math.max(1, Math.round(rect.width * dpr));
        const height = Math.max(1, Math.round(rect.height * dpr));
        if (canvas.width !== width || canvas.height !== height) {
          canvas.width = width;
          canvas.height = height;
        }
        gl.viewport(0, 0, width, height);
      };

      const energyFor = (value: SilkCoreState) => {
        if (value === "idle") return 0.16;
        if (value === "error") return 0.88;
        if (value === "approval") return 0.62;
        if (value === "speaking") return 0.74;
        return 0.52;
      };

      const started = performance.now();
      const draw = (time: number) => {
        if (disposed) return;
        resize();
        if (visible) {
          const elapsed = reduceMotion ? 2.5 : (time - started) / 1000;
          const currentState = stateRef.current;
          const color = STATE_COLORS[currentState];
          const energy = energyFor(currentState);
          gl.clearColor(0, 0, 0, 0);
          gl.clear(gl.COLOR_BUFFER_BIT);
          gl.useProgram(program);
          gl.uniform1f(uniforms.time, elapsed);
          gl.uniform1f(uniforms.aspect, canvas.width / Math.max(1, canvas.height));
          gl.uniform1f(uniforms.energy, energy);
          gl.uniform2f(uniforms.pointer, pointerRef.current[0], pointerRef.current[1]);
          gl.uniform3f(uniforms.color, color[0], color[1], color[2]);

          gl.bindBuffer(gl.ARRAY_BUFFER, lineBuffer);
          gl.vertexAttribPointer(positionLocation, 3, gl.FLOAT, false, 0, 0);
          gl.uniform1f(uniforms.pointMode, 0);
          gl.uniform1f(uniforms.alpha, 0.19 + energy * 0.15);
          gl.uniform1f(uniforms.pointSize, 1);
          gl.drawArrays(gl.LINES, 0, lineValues.length / 3);

          gl.bindBuffer(gl.ARRAY_BUFFER, pointBuffer);
          gl.vertexAttribPointer(positionLocation, 3, gl.FLOAT, false, 0, 0);
          gl.uniform1f(uniforms.pointMode, 1);
          gl.uniform1f(uniforms.alpha, 0.44 + energy * 0.25);
          gl.uniform1f(uniforms.pointSize, compact ? 2.1 : 2.5);
          gl.drawArrays(gl.POINTS, 0, pointValues.length / 3);
        }
        animationFrame = requestAnimationFrame(draw);
      };

      const resizeObserver = new ResizeObserver(resize);
      resizeObserver.observe(canvas);
      const intersectionObserver = new IntersectionObserver(([entry]) => {
        visible = entry.isIntersecting;
      }, { threshold: 0.01 });
      intersectionObserver.observe(canvas);
      const pointerMove = (event: PointerEvent) => {
        const rect = canvas.getBoundingClientRect();
        pointerRef.current = [
          ((event.clientX - rect.left) / Math.max(1, rect.width) - 0.5) * 2,
          ((event.clientY - rect.top) / Math.max(1, rect.height) - 0.5) * -2,
        ];
      };
      const pointerLeave = () => { pointerRef.current = [0, 0]; };
      const contextLost = (event: Event) => {
        event.preventDefault();
        setFallback(true);
      };
      canvas.addEventListener("pointermove", pointerMove);
      canvas.addEventListener("pointerleave", pointerLeave);
      canvas.addEventListener("webglcontextlost", contextLost);
      animationFrame = requestAnimationFrame(draw);

      return () => {
        disposed = true;
        cancelAnimationFrame(animationFrame);
        resizeObserver.disconnect();
        intersectionObserver.disconnect();
        canvas.removeEventListener("pointermove", pointerMove);
        canvas.removeEventListener("pointerleave", pointerLeave);
        canvas.removeEventListener("webglcontextlost", contextLost);
        gl.deleteBuffer(pointBuffer);
        gl.deleteBuffer(lineBuffer);
        gl.deleteProgram(program);
      };
    } catch (error) {
      console.error("SILK Core WebGL initialization failed", error);
      queueMicrotask(() => setFallback(true));
    }
  }, [compact]);

  return (
    <div className={`silk-webgl-core state-${state} ${compact ? "compact" : ""}`}>
      {!fallback && <canvas ref={canvasRef} aria-hidden="true" />}
      {fallback && (
        <div className="silk-core-fallback" aria-hidden="true">
          <span />
          <span />
          <span />
          <i />
        </div>
      )}
      <div className="silk-core-center" aria-hidden="true"><b>S</b></div>
      <div className="silk-core-readout" aria-live="polite">
        <span>{state.toUpperCase()}</span>
        <strong>{label}</strong>
      </div>
    </div>
  );
}
