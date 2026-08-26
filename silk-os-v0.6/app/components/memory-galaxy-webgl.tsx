"use client";

import { useEffect, useMemo, useRef, useState } from "react";

type Node = { id: number; label: string; node_type: string; privacy: string; importance: number };
type Edge = { id: number; source: number; target: number; relation: string; weight: number };

const VERTEX = `
attribute vec3 aPosition;
uniform float uTime;
uniform float uAspect;
uniform vec2 uRotation;
uniform float uZoom;
uniform float uPointSize;
varying float vDepth;
mat2 rotate2d(float a){float s=sin(a);float c=cos(a);return mat2(c,-s,s,c);}
void main(){
  vec3 p=aPosition;
  p.xz=rotate2d(uRotation.x+uTime*.025)*p.xz;
  p.yz=rotate2d(uRotation.y)*p.yz;
  float z=uZoom+p.z;
  gl_Position=vec4((p.x/z)*3.2/uAspect,(p.y/z)*3.2,(z-3.2)/3.2,1.0);
  gl_PointSize=uPointSize*(6.0/z);
  vDepth=clamp((p.z+2.0)/4.0,0.0,1.0);
}`;

const FRAGMENT = `
precision mediump float;
uniform vec3 uColor;
uniform float uAlpha;
uniform float uPoints;
varying float vDepth;
void main(){
  float a=uAlpha*(.45+vDepth*.7);
  if(uPoints>.5){vec2 p=gl_PointCoord-vec2(.5);float r=length(p);if(r>.5)discard;a*=smoothstep(.5,.04,r);}
  gl_FragColor=vec4(uColor,a);
}`;

function shader(gl: WebGLRenderingContext, type: number, source: string) {
  const value = gl.createShader(type);
  if (!value) throw new Error("Shader unavailable");
  gl.shaderSource(value, source);
  gl.compileShader(value);
  if (!gl.getShaderParameter(value, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(value) || "Shader error");
  return value;
}

function program(gl: WebGLRenderingContext) {
  const value = gl.createProgram();
  if (!value) throw new Error("Program unavailable");
  const vertex = shader(gl, gl.VERTEX_SHADER, VERTEX);
  const fragment = shader(gl, gl.FRAGMENT_SHADER, FRAGMENT);
  gl.attachShader(value, vertex);
  gl.attachShader(value, fragment);
  gl.linkProgram(value);
  gl.deleteShader(vertex);
  gl.deleteShader(fragment);
  if (!gl.getProgramParameter(value, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(value) || "Program error");
  return value;
}

function positionFor(index: number, total: number, importance: number, category: boolean) {
  if (category) {
    const angle = (index / Math.max(1, total)) * Math.PI * 2;
    return [Math.cos(angle) * 0.64, Math.sin(angle) * 0.64, Math.sin(angle * 2) * 0.16] as const;
  }
  const golden = Math.PI * (3 - Math.sqrt(5));
  const y = total <= 1 ? 0 : 1 - (index / (total - 1)) * 2;
  const radius = Math.sqrt(Math.max(0, 1 - y * y));
  const angle = index * golden;
  const scale = 1.05 + Math.max(0, Math.min(5, importance)) * 0.055;
  return [Math.cos(angle) * radius * scale, y * scale, Math.sin(angle) * radius * scale] as const;
}

export function MemoryGalaxyWebGL({ nodes, edges }: { nodes: Node[]; edges: Edge[] }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rotation = useRef<[number, number]>([0.25, -0.1]);
  const zoom = useRef(4.5);
  const dragging = useRef<{ x: number; y: number } | null>(null);
  const [fallback, setFallback] = useState(false);
  const labels = useMemo(() => nodes.slice(0, 8), [nodes]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !nodes.length) return;
    const gl = canvas.getContext("webgl", { alpha: true, antialias: true, depth: false, powerPreference: "high-performance" });
    if (!gl) {
      queueMicrotask(() => setFallback(true));
      return;
    }
    let frame = 0;
    let disposed = false;
    try {
      const activeProgram = program(gl);
      const positionAttribute = gl.getAttribLocation(activeProgram, "aPosition");
      const uniforms = {
        time: gl.getUniformLocation(activeProgram, "uTime"),
        aspect: gl.getUniformLocation(activeProgram, "uAspect"),
        rotation: gl.getUniformLocation(activeProgram, "uRotation"),
        zoom: gl.getUniformLocation(activeProgram, "uZoom"),
        pointSize: gl.getUniformLocation(activeProgram, "uPointSize"),
        color: gl.getUniformLocation(activeProgram, "uColor"),
        alpha: gl.getUniformLocation(activeProgram, "uAlpha"),
        points: gl.getUniformLocation(activeProgram, "uPoints"),
      };
      const positionMap = new Map<number, readonly [number, number, number]>();
      const categoryNodes = nodes.filter((node) => node.node_type === "category");
      const memoryNodes = nodes.filter((node) => node.node_type !== "category");
      categoryNodes.forEach((node, index) => positionMap.set(Number(node.id), positionFor(index, categoryNodes.length, node.importance, true)));
      memoryNodes.forEach((node, index) => positionMap.set(Number(node.id), positionFor(index, memoryNodes.length, node.importance, false)));
      const memoryValues = memoryNodes.flatMap((node) => [...(positionMap.get(Number(node.id)) || [0, 0, 0])]);
      const categoryValues = categoryNodes.flatMap((node) => [...(positionMap.get(Number(node.id)) || [0, 0, 0])]);
      const lineValues = edges.flatMap((edge) => {
        const source = positionMap.get(Number(edge.source));
        const target = positionMap.get(Number(edge.target));
        return source && target ? [...source, ...target] : [];
      });
      const makeBuffer = (values: number[]) => {
        const buffer = gl.createBuffer();
        if (!buffer) throw new Error("Buffer unavailable");
        gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(values), gl.STATIC_DRAW);
        return buffer;
      };
      const memoryBuffer = makeBuffer(memoryValues);
      const categoryBuffer = makeBuffer(categoryValues);
      const lineBuffer = makeBuffer(lineValues);
      gl.useProgram(activeProgram);
      gl.enableVertexAttribArray(positionAttribute);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE);

      const drawBuffer = (buffer: WebGLBuffer, count: number, mode: number, color: [number, number, number], size: number, alpha: number) => {
        if (!count) return;
        gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
        gl.vertexAttribPointer(positionAttribute, 3, gl.FLOAT, false, 0, 0);
        gl.uniform3f(uniforms.color, ...color);
        gl.uniform1f(uniforms.pointSize, size);
        gl.uniform1f(uniforms.alpha, alpha);
        gl.uniform1f(uniforms.points, mode === gl.POINTS ? 1 : 0);
        gl.drawArrays(mode, 0, count);
      };
      const started = performance.now();
      const draw = (time: number) => {
        if (disposed) return;
        const rect = canvas.getBoundingClientRect();
        const dpr = Math.min(window.devicePixelRatio || 1, 1.75);
        canvas.width = Math.max(1, Math.round(rect.width * dpr));
        canvas.height = Math.max(1, Math.round(rect.height * dpr));
        gl.viewport(0, 0, canvas.width, canvas.height);
        gl.clearColor(0, 0, 0, 0);
        gl.clear(gl.COLOR_BUFFER_BIT);
        gl.useProgram(activeProgram);
        gl.uniform1f(uniforms.time, (time - started) / 1000);
        gl.uniform1f(uniforms.aspect, canvas.width / Math.max(1, canvas.height));
        gl.uniform2f(uniforms.rotation, rotation.current[0], rotation.current[1]);
        gl.uniform1f(uniforms.zoom, zoom.current);
        drawBuffer(lineBuffer, lineValues.length / 3, gl.LINES, [0.25, 0.74, 0.96], 1, 0.2);
        drawBuffer(memoryBuffer, memoryValues.length / 3, gl.POINTS, [0.22, 0.9, 1], 9, 0.9);
        drawBuffer(categoryBuffer, categoryValues.length / 3, gl.POINTS, [0.65, 0.56, 1], 14, 1);
        frame = requestAnimationFrame(draw);
      };
      const down = (event: PointerEvent) => { dragging.current = { x: event.clientX, y: event.clientY }; canvas.setPointerCapture(event.pointerId); };
      const move = (event: PointerEvent) => {
        if (!dragging.current) return;
        rotation.current[0] += (event.clientX - dragging.current.x) * 0.006;
        rotation.current[1] += (event.clientY - dragging.current.y) * 0.006;
        dragging.current = { x: event.clientX, y: event.clientY };
      };
      const up = () => { dragging.current = null; };
      const wheel = (event: WheelEvent) => { event.preventDefault(); zoom.current = Math.min(6.2, Math.max(3.25, zoom.current + event.deltaY * 0.002)); };
      canvas.addEventListener("pointerdown", down);
      canvas.addEventListener("pointermove", move);
      canvas.addEventListener("pointerup", up);
      canvas.addEventListener("pointercancel", up);
      canvas.addEventListener("wheel", wheel, { passive: false });
      frame = requestAnimationFrame(draw);
      return () => {
        disposed = true;
        cancelAnimationFrame(frame);
        canvas.removeEventListener("pointerdown", down);
        canvas.removeEventListener("pointermove", move);
        canvas.removeEventListener("pointerup", up);
        canvas.removeEventListener("pointercancel", up);
        canvas.removeEventListener("wheel", wheel);
        gl.deleteBuffer(memoryBuffer);
        gl.deleteBuffer(categoryBuffer);
        gl.deleteBuffer(lineBuffer);
        gl.deleteProgram(activeProgram);
      };
    } catch (error) {
      console.error("Memory galaxy WebGL initialization failed", error);
      queueMicrotask(() => setFallback(true));
    }
  }, [edges, nodes]);

  if (!nodes.length) return <div className="memory-galaxy-empty">No focused memories match this view.</div>;
  return (
    <div className="memory-galaxy-shell">
      {!fallback ? <canvas ref={canvasRef} aria-label={`Interactive 3D memory map containing ${nodes.length} nodes and ${edges.length} links`} /> : <div className="memory-galaxy-fallback">3D memory view unavailable on this device.</div>}
      <div className="memory-galaxy-hud"><span>{nodes.length} nodes</span><span>{edges.length} links</span><span>Drag to orbit · scroll to zoom</span></div>
      <div className="memory-galaxy-labels">{labels.map((node) => <span key={node.id} className={node.node_type}>{node.label.slice(0, 32)}</span>)}</div>
    </div>
  );
}
