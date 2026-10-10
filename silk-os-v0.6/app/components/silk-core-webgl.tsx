"use client";

import { useEffect, useRef, useState } from "react";
import styles from "./silk-core-webgl.module.css";

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

type Palette = {
  a: [number, number, number];
  b: [number, number, number];
  accent: [number, number, number];
  energy: number;
};

const PALETTES: Record<SilkCoreState, Palette> = {
  idle: {
    a: [0.24, 0.64, 1.0],
    b: [0.52, 0.36, 1.0],
    accent: [0.72, 0.9, 1.0],
    energy: 0.16,
  },
  retrieving: {
    a: [0.22, 0.74, 1.0],
    b: [0.42, 0.48, 1.0],
    accent: [0.72, 0.95, 1.0],
    energy: 0.34,
  },
  searching: {
    a: [0.35, 0.58, 1.0],
    b: [0.66, 0.34, 1.0],
    accent: [0.83, 0.76, 1.0],
    energy: 0.5,
  },
  calendar: {
    a: [0.19, 0.7, 1.0],
    b: [0.36, 0.5, 0.98],
    accent: [0.78, 0.94, 1.0],
    energy: 0.38,
  },
  routing: {
    a: [0.42, 0.5, 1.0],
    b: [0.68, 0.34, 1.0],
    accent: [0.88, 0.75, 1.0],
    energy: 0.56,
  },
  thinking: {
    a: [0.22, 0.79, 1.0],
    b: [0.56, 0.37, 1.0],
    accent: [0.75, 0.98, 1.0],
    energy: 0.66,
  },
  speaking: {
    a: [0.2, 0.86, 0.92],
    b: [0.39, 0.61, 1.0],
    accent: [0.77, 1.0, 0.96],
    energy: 0.72,
  },
  syncing: {
    a: [0.18, 0.77, 0.94],
    b: [0.36, 0.55, 1.0],
    accent: [0.7, 1.0, 0.96],
    energy: 0.44,
  },
  approval: {
    a: [1.0, 0.57, 0.3],
    b: [0.68, 0.39, 1.0],
    accent: [1.0, 0.84, 0.57],
    energy: 0.54,
  },
  error: {
    a: [1.0, 0.28, 0.4],
    b: [0.72, 0.22, 0.66],
    accent: [1.0, 0.66, 0.72],
    energy: 0.72,
  },
};

const VERTEX_SHADER = `
attribute vec2 aPosition;
varying vec2 vUv;

void main() {
  vUv = aPosition * 0.5 + 0.5;
  gl_Position = vec4(aPosition, 0.0, 1.0);
}`;

const FRAGMENT_SHADER = `
precision highp float;

varying vec2 vUv;
uniform float uTime;
uniform float uEnergy;
uniform float uAspect;
uniform vec2 uPointer;
uniform vec3 uColorA;
uniform vec3 uColorB;
uniform vec3 uAccent;

float hash21(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = hash21(i);
  float b = hash21(i + vec2(1.0, 0.0));
  float c = hash21(i + vec2(0.0, 1.0));
  float d = hash21(i + vec2(1.0, 1.0));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

float fbm(vec2 p) {
  float value = 0.0;
  float amplitude = 0.52;
  mat2 rot = mat2(0.80, -0.60, 0.60, 0.80);
  for (int i = 0; i < 4; i++) {
    value += noise(p) * amplitude;
    p = rot * p * 2.03 + vec2(7.1, 3.7);
    amplitude *= 0.5;
  }
  return value;
}

void main() {
  vec2 p = (vUv - 0.5) * 2.0;
  p.x *= uAspect;

  float radius = length(p);
  float outside = max(radius - 1.0, 0.0);
  float halo = exp(-outside * 10.0) * smoothstep(1.32, 0.98, radius);
  float sphereMask = smoothstep(1.015, 0.975, radius);

  if (sphereMask <= 0.001) {
    vec3 haloColor = mix(uColorA, uColorB, 0.45) * halo * 0.055;
    gl_FragColor = vec4(haloColor, halo * 0.12);
    return;
  }

  float z = sqrt(max(0.0, 1.0 - radius * radius));
  vec3 normal = normalize(vec3(p, z));
  float fresnel = pow(1.0 - z, 2.35);
  float t = uTime * (0.11 + uEnergy * 0.22);

  vec2 pointerWarp = uPointer * (0.05 + uEnergy * 0.035);
  vec2 flowP = p * 1.72 + pointerWarp;
  float n1 = fbm(flowP + vec2(t * 0.72, -t * 0.38));
  float n2 = fbm(flowP * 1.82 + vec2(-t * 0.61, t * 0.54) + 3.7);
  float n3 = fbm(flowP * 3.05 + vec2(t * 0.24, t * 0.31) + 8.2);

  float ribbonWave = sin(
    p.y * 5.6 +
    p.x * 1.65 +
    n1 * 3.2 -
    n2 * 1.7 +
    t * (1.25 + uEnergy)
  ) * 0.5 + 0.5;
  float ribbons = smoothstep(0.46, 0.92, ribbonWave);
  float liquid = clamp(n1 * 0.54 + n2 * 0.31 + n3 * 0.15, 0.0, 1.0);

  vec3 darkGlass = vec3(0.006, 0.009, 0.024);
  vec3 flowColor = mix(uColorA, uColorB, smoothstep(0.18, 0.88, liquid));
  vec3 color = mix(darkGlass, flowColor, 0.11 + liquid * 0.14);
  color += flowColor * ribbons * (0.08 + uEnergy * 0.11);

  float innerCloud = smoothstep(0.88, 0.18, radius) * smoothstep(0.22, 0.86, n2);
  color += mix(uColorB, uColorA, 0.35) * innerCloud * (0.035 + uEnergy * 0.035);

  float caustic = pow(
    max(0.0, sin((p.x * 1.45 - p.y * 1.1 + n1 * 0.46) * 9.3 + t * 1.7)),
    8.0
  );
  color += mix(uAccent, vec3(1.0), 0.45) * caustic * (0.08 + uEnergy * 0.075);

  vec3 keyLight = normalize(vec3(-0.48, 0.64, 0.62));
  vec3 fillLight = normalize(vec3(0.72, -0.28, 0.62));
  float keySpec = pow(max(dot(normal, keyLight), 0.0), 38.0);
  float fillSpec = pow(max(dot(normal, fillLight), 0.0), 18.0);
  color += vec3(0.96, 0.985, 1.0) * keySpec * 0.78;
  color += uColorB * fillSpec * 0.12;

  float rimBand = smoothstep(0.34, 0.98, fresnel);
  color += uAccent * rimBand * (0.16 + uEnergy * 0.075);

  float glassShade = 0.76 + z * 0.34;
  color *= glassShade;

  float micro = (hash21(gl_FragCoord.xy + uTime) - 0.5) * 0.012;
  color += micro;

  float alpha = sphereMask * (0.82 + fresnel * 0.14);
  gl_FragColor = vec4(color, alpha);
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
      premultipliedAlpha: false,
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
        energy: gl.getUniformLocation(program, "uEnergy"),
        aspect: gl.getUniformLocation(program, "uAspect"),
        pointer: gl.getUniformLocation(program, "uPointer"),
        colorA: gl.getUniformLocation(program, "uColorA"),
        colorB: gl.getUniformLocation(program, "uColorB"),
        accent: gl.getUniformLocation(program, "uAccent"),
      };

      const quad = gl.createBuffer();
      if (!quad) throw new Error("WebGL buffer could not be created.");
      gl.bindBuffer(gl.ARRAY_BUFFER, quad);
      gl.bufferData(
        gl.ARRAY_BUFFER,
        new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]),
        gl.STATIC_DRAW,
      );

      gl.useProgram(program);
      gl.enableVertexAttribArray(positionLocation);
      gl.vertexAttribPointer(positionLocation, 2, gl.FLOAT, false, 0, 0);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
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

      const started = performance.now();
      const draw = (time: number) => {
        if (disposed) return;
        resize();

        if (visible) {
          const elapsed = reduceMotion ? 5.0 : (time - started) / 1000;
          const palette = PALETTES[stateRef.current];
          const aspect = canvas.width / Math.max(1, canvas.height);

          gl.clearColor(0, 0, 0, 0);
          gl.clear(gl.COLOR_BUFFER_BIT);
          gl.useProgram(program);
          gl.uniform1f(uniforms.time, elapsed);
          gl.uniform1f(uniforms.energy, palette.energy);
          gl.uniform1f(uniforms.aspect, aspect);
          gl.uniform2f(uniforms.pointer, pointerRef.current[0], pointerRef.current[1]);
          gl.uniform3f(uniforms.colorA, palette.a[0], palette.a[1], palette.a[2]);
          gl.uniform3f(uniforms.colorB, palette.b[0], palette.b[1], palette.b[2]);
          gl.uniform3f(uniforms.accent, palette.accent[0], palette.accent[1], palette.accent[2]);
          gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
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
      const pointerLeave = () => {
        pointerRef.current = [0, 0];
      };
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
        gl.deleteBuffer(quad);
        gl.deleteProgram(program);
      };
    } catch (error) {
      console.error("SILK Core WebGL initialization failed", error);
      queueMicrotask(() => setFallback(true));
    }
  }, [compact]);

  return (
    <div
      className={`${styles.root} silk-webgl-core state-${state} ${compact ? `compact ${styles.compact}` : ""}`}
      data-silk-core={state}
    >
      {!fallback && <canvas ref={canvasRef} aria-hidden="true" />}
      {fallback && <div className={styles.fallback} aria-hidden="true" />}
      <span className={styles.status} aria-live="polite">
        SILK {state}. {label}
      </span>
    </div>
  );
}
