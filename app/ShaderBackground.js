"use client";

// Animated night-sky background: aurora ribbons over an icy horizon.
// Adapted from "Aurora Veil" in Radiant by Paul Bakaus
// (https://github.com/pbakaus/radiant), MIT License:
//   Permission is hereby granted, free of charge, to any person obtaining a copy
//   of this software... The above copyright notice and this permission notice
//   shall be included in all copies or substantial portions of the Software.
// Changes: recolored from green/magenta to the Voltage Labs blues and violets,
// React wrapper, fills its own section (not always the whole window), lower
// resolution on phones, pauses when the tab is hidden, one still frame for
// reduced motion. Also plays "Voltage Arc" (same library and license, see
// radiantShaders.js) inside the homepage hero box.

import { useEffect, useRef } from "react";
import { voltageArc } from "./radiantShaders";

const VERT = `attribute vec2 a_pos;
void main() { gl_Position = vec4(a_pos, 0.0, 1.0); }`;

const FRAG = `precision highp float;
uniform float u_time;
uniform vec2 u_res;
uniform float u_auroraSpeed;
uniform float u_auroraIntensity;
uniform vec2 u_mouse;

#define PI 3.14159265359
#define NUM_BG_STARS 120

// ── Hash functions ──
float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

float hash1(float n) {
  return fract(sin(n) * 43758.5453123);
}

// ── Smooth value noise ──
float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = hash(i);
  float b = hash(i + vec2(1.0, 0.0));
  float c = hash(i + vec2(0.0, 1.0));
  float d = hash(i + vec2(1.0, 1.0));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

// ── FBM ──
float fbm(vec2 p, float t, int octaves) {
  float val = 0.0;
  float amp = 0.5;
  float freq = 1.0;
  for (int i = 0; i < 6; i++) {
    if (i >= octaves) break;
    val += amp * noise(p * freq + t * 0.1);
    freq *= 2.1;
    amp *= 0.48;
    p += vec2(1.7, 9.2);
  }
  return val;
}

// ── Aurora ribbon function ──
float auroraRibbon(vec2 uv, float t, float ribbonX, float ribbonWidth, float waveFreq, float waveAmp, float phase) {
  // Horizontal position of the ribbon center, slowly drifting
  float centerX = ribbonX + sin(t * 0.15 + phase) * 0.25;

  // The ribbon undulates with wide, dramatic flowing motion
  float wave1 = sin(uv.y * waveFreq + t * 0.9 + phase) * waveAmp;
  float wave2 = sin(uv.y * waveFreq * 2.3 + t * 1.3 + phase * 1.7) * waveAmp * 0.5;
  float wave3 = sin(uv.y * waveFreq * 0.4 + t * 0.35 + phase * 0.6) * waveAmp * 1.2;
  float wave4 = sin(uv.y * waveFreq * 3.7 + t * 1.8 + phase * 2.3) * waveAmp * 0.2;
  float waveOffset = wave1 + wave2 + wave3 + wave4;

  // Distance from ribbon center
  float dx = uv.x - (centerX + waveOffset);

  // Ribbon profile — wide gaussian falloff
  float ribbon = exp(-dx * dx / (ribbonWidth * ribbonWidth));

  // Brightness varies along the ribbon vertically — shimmer and pulse
  float brightBand = 0.5 + 0.5 * sin(uv.y * 2.5 + t * 0.7 + phase * 2.0);
  brightBand *= 0.5 + 0.5 * sin(uv.y * 5.0 - t * 0.9 + phase);

  // Pulsing shimmer effect
  float shimmer = 0.7 + 0.3 * sin(t * 2.5 + phase * 3.0 + uv.y * 8.0);
  shimmer *= 0.8 + 0.2 * sin(t * 1.7 + phase * 1.1 + uv.x * 6.0);

  // Vertical fade: aurora fills the upper half of the sky
  // Strong presence from y=0.0 up to y=0.7, gentle fade at edges
  float verticalFade = smoothstep(-0.35, -0.05, uv.y) * smoothstep(0.75, 0.35, uv.y);

  // Add fine detail using noise
  float detail = noise(vec2(uv.x * 6.0, uv.y * 10.0 + t * 0.5 + phase));
  detail = 0.6 + 0.4 * detail;

  return ribbon * brightBand * verticalFade * detail * shimmer;
}

// ── Background stars ──
float bgStars(vec2 uv, float t) {
  float stars = 0.0;
  for (int i = 0; i < NUM_BG_STARS; i++) {
    float fi = float(i);
    vec2 pos = vec2(
      hash1(fi * 17.31 + 100.0) * 2.8 - 1.4,
      hash1(fi * 11.97 + 200.0) * 1.4 - 0.3
    );
    float d = length(uv - pos);
    // Twinkling with varied speeds
    float twinkleSpeed = 0.5 + hash1(fi * 3.3 + 300.0) * 2.0;
    float twinkle = 0.3 + 0.7 * sin(t * twinkleSpeed + fi * 2.7);
    twinkle = max(twinkle, 0.0);
    twinkle *= twinkle;
    float size = 0.0008 + hash1(fi * 5.5 + 400.0) * 0.002;
    // Brighter stars
    float brightness = 0.4 + hash1(fi * 7.7 + 500.0) * 0.6;
    stars += smoothstep(size, 0.0, d) * twinkle * brightness;
    // Add subtle glow around brighter stars
    if (brightness > 0.7) {
      stars += smoothstep(size * 5.0, 0.0, d) * twinkle * 0.08;
    }
  }
  return stars;
}

// ── Ice crystal pattern (hexagonal frost) ──
float hexDist(vec2 p) {
  p = abs(p);
  return max(p.x + p.y * 0.577350269, p.y * 1.154700538);
}

float crystalPattern(vec2 uv, float t) {
  float scale = 12.0;
  vec2 p = uv * scale;
  vec2 r = vec2(1.0, 1.732);
  vec2 h = r * 0.5;
  vec2 a = mod(p, r) - h;
  vec2 b = mod(p - h, r) - h;
  vec2 gv = (dot(a, a) < dot(b, b)) ? a : b;
  float hd = hexDist(gv);
  float edge = smoothstep(0.45, 0.40, hd) - smoothstep(0.40, 0.35, hd);
  float angle = atan(gv.y, gv.x);
  float branch = abs(sin(angle * 3.0));
  float branchLine = smoothstep(0.04, 0.0, abs(branch - 0.5) * hd);
  branchLine *= smoothstep(0.0, 0.15, hd) * smoothstep(0.45, 0.25, hd);
  float subBranch = abs(sin(angle * 6.0));
  float subLine = smoothstep(0.03, 0.0, abs(subBranch - 0.5) * hd);
  subLine *= smoothstep(0.1, 0.2, hd) * smoothstep(0.4, 0.3, hd);
  float crystal = edge * 0.6 + branchLine * 0.4 + subLine * 0.2;
  float shimmer = 0.7 + 0.3 * sin(t * 0.2 + hash(floor(p / r)) * 6.28);
  crystal *= shimmer;
  return crystal;
}

void main() {
  vec2 uv = (gl_FragCoord.xy - u_res * 0.5) / min(u_res.x, u_res.y);
  if (u_mouse.x > 0.0) {
    vec2 mNorm = (u_mouse - u_res * 0.5) / min(u_res.x, u_res.y);
    uv += (mNorm - uv) * 0.25;
  }
  vec2 screenUV = gl_FragCoord.xy / u_res;
  float t = u_time * u_auroraSpeed;

  // ── Dark sky background ──
  vec3 col = vec3(0.012, 0.010, 0.022);
  // Slight gradient — lighter near horizon
  col += vec3(0.012, 0.010, 0.018) * smoothstep(0.5, -0.3, uv.y);

  // ── Background stars ──
  float starField = bgStars(uv, u_time);
  vec3 starColor = vec3(0.9, 0.88, 0.8);
  col += starColor * starField;

  // ── Aurora ribbons — 7 layers for visual richness ──

  // Ribbon 1: dominant blue curtain, wide and bright
  float r1 = auroraRibbon(uv, t, 0.0, 0.22, 2.5, 0.28, 0.0);
  vec3 r1color = mix(
    vec3(0.30, 0.55, 1.00),
    vec3(0.20, 0.65, 0.95),
    0.5 + 0.5 * sin(uv.y * 3.5 + t * 0.3)
  );
  // Purple at the top edges
  r1color = mix(r1color, vec3(0.55, 0.20, 0.80), smoothstep(0.25, 0.65, uv.y) * 0.4);

  // Ribbon 2: secondary blue, offset to the right
  float r2 = auroraRibbon(uv, t * 0.9, 0.35, 0.18, 2.8, 0.24, 2.1);
  vec3 r2color = mix(
    vec3(0.35, 0.50, 1.00),
    vec3(0.26, 0.38, 0.93),
    0.5 + 0.5 * sin(uv.y * 4.0 - t * 0.4 + 1.0)
  );
  r2color = mix(r2color, vec3(0.65, 0.25, 0.75), smoothstep(0.3, 0.6, uv.y) * 0.35);

  // Ribbon 3: purple-violet curtain on the left
  float r3 = auroraRibbon(uv, t * 0.75, -0.30, 0.16, 3.0, 0.22, 4.3);
  vec3 r3color = mix(
    vec3(0.60, 0.15, 0.70),
    vec3(0.55, 0.30, 0.95),
    0.5 + 0.5 * sin(uv.y * 5.0 + t * 0.2 + 2.0)
  );
  r3color = mix(r3color, vec3(0.20, 0.45, 0.90), smoothstep(0.1, -0.1, uv.y) * 0.3);

  // Ribbon 4: wide background blue wash
  float r4 = auroraRibbon(uv, t * 0.6, 0.15, 0.30, 1.8, 0.35, 1.0);
  vec3 r4color = mix(
    vec3(0.15, 0.30, 0.80),
    vec3(0.10, 0.40, 0.75),
    0.5 + 0.5 * sin(uv.y * 2.0 + t * 0.15)
  );

  // Ribbon 5: thin bright accent ribbon
  float r5 = auroraRibbon(uv, t * 1.1, -0.10, 0.10, 3.5, 0.18, 5.7);
  vec3 r5color = mix(
    vec3(0.40, 0.75, 1.00),
    vec3(0.50, 0.30, 0.90),
    0.5 + 0.5 * sin(uv.y * 6.0 + t * 0.5 + 3.0)
  );

  // Ribbon 6: far right purple veil
  float r6 = auroraRibbon(uv, t * 0.65, 0.55, 0.14, 2.2, 0.20, 3.5);
  vec3 r6color = mix(
    vec3(0.45, 0.10, 0.65),
    vec3(0.50, 0.25, 0.90),
    0.5 + 0.5 * sin(uv.y * 3.0 - t * 0.3 + 1.5)
  );

  // Ribbon 7: wide subtle blue base layer
  float r7 = auroraRibbon(uv, t * 0.5, -0.20, 0.35, 1.5, 0.30, 6.2);
  vec3 r7color = mix(
    vec3(0.12, 0.25, 0.70),
    vec3(0.10, 0.35, 0.65),
    0.5 + 0.5 * sin(uv.y * 2.5 + t * 0.1 + 4.0)
  );

  // Depth-based intensity layering
  float i1 = r1 * 1.4 * u_auroraIntensity;
  float i2 = r2 * 1.1 * u_auroraIntensity;
  float i3 = r3 * 0.9 * u_auroraIntensity;
  float i4 = r4 * 0.5 * u_auroraIntensity;
  float i5 = r5 * 0.8 * u_auroraIntensity;
  float i6 = r6 * 0.6 * u_auroraIntensity;
  float i7 = r7 * 0.35 * u_auroraIntensity;

  // Additive blending of all aurora light
  vec3 auroraLight = r1color * i1 + r2color * i2 + r3color * i3
                   + r4color * i4 + r5color * i5 + r6color * i6 + r7color * i7;

  // Global pulsing intensity — aurora shimmers and breathes
  float pulse = 0.85 + 0.15 * sin(t * 0.8) * sin(t * 0.53 + 1.0);
  auroraLight *= pulse;

  // Add atmospheric glow around the aurora
  float glowY = smoothstep(-0.3, 0.0, uv.y) * smoothstep(0.75, 0.25, uv.y);
  float totalAurora = i1 + i2 + i3 + i4 + i5 + i6 + i7;
  vec3 atmosphericGlow = mix(
    vec3(0.05, 0.07, 0.16),
    vec3(0.10, 0.05, 0.12),
    0.5 + 0.5 * sin(t * 0.15)
  ) * glowY * min(totalAurora, 2.5) * 0.4;

  col += auroraLight + atmosphericGlow;

  // ── Stars dimmed by aurora light ──
  col -= starColor * starField * clamp(totalAurora * 0.5, 0.0, 1.0);

  // ── Ice crystal ground plane (lower portion) ──
  float groundLine = -0.35;
  float groundFade = smoothstep(groundLine + 0.05, groundLine - 0.15, uv.y);

  if (groundFade > 0.001) {
    float perspY = max(0.001, groundLine - uv.y);
    vec2 crystalUV = vec2(uv.x / (perspY * 2.0 + 0.5), 1.0 / (perspY * 3.0));
    crystalUV.x += t * 0.02;
    float crystal = crystalPattern(crystalUV, u_time);
    vec3 iceColor = vec3(0.06, 0.08, 0.12);
    vec3 iceCrystalColor = vec3(0.18, 0.22, 0.32);
    vec3 iceSurface = mix(iceColor, iceCrystalColor, crystal * 0.5);

    // ── Aurora reflection on ice ──
    vec2 reflUV = vec2(uv.x, -uv.y - groundLine * 2.0);
    float rr1 = auroraRibbon(reflUV, t, 0.0, 0.25, 2.5, 0.28, 0.0) * 0.3;
    float rr2 = auroraRibbon(reflUV, t * 0.9, 0.35, 0.20, 2.8, 0.24, 2.1) * 0.2;
    float rr3 = auroraRibbon(reflUV, t * 0.75, -0.30, 0.18, 3.0, 0.22, 4.3) * 0.15;
    vec3 reflectionColor = r1color * rr1 + r2color * rr2 + r3color * rr3;
    reflectionColor *= u_auroraIntensity * pulse;
    float reflStrength = smoothstep(0.25, 0.0, perspY) * 0.6;
    float sparkle = pow(crystal, 3.0) * reflStrength;
    vec3 sparkleColor = vec3(0.9, 0.85, 0.7) * sparkle * 0.3;
    iceSurface += reflectionColor * reflStrength + sparkleColor;
    col = mix(col, iceSurface, groundFade);
  }

  // ── Horizon glow where sky meets ice ──
  float horizonDist = abs(uv.y - groundLine);
  float horizonGlow = exp(-horizonDist * horizonDist / 0.003);
  vec3 horizonColor = mix(
    vec3(0.07, 0.10, 0.22),
    vec3(0.12, 0.08, 0.18),
    0.5 + 0.5 * sin(t * 0.2)
  ) * min(totalAurora, 3.0) * 0.35 + vec3(0.02, 0.03, 0.04);
  col += horizonColor * horizonGlow;

  // ── Vignette ──
  float dist = length(uv * vec2(0.7, 0.9));
  float vignette = 1.0 - smoothstep(0.5, 1.5, dist);
  col *= 0.7 + vignette * 0.3;

  // ── Ensure no negatives ──
  col = max(col, vec3(0.0));

  // ── Subtle tone curve — boost saturation slightly ──
  col = pow(col, vec3(0.92, 0.95, 0.98));

  gl_FragColor = vec4(col, 1.0);
}`;

// Recolors any shader into the Voltage Labs palette by brightness: darkest
// parts become the app background navy, then blue (#4361EE), then violet,
// and the brightest highlights a pale lavender. Added as the last step of each
// Radiant shader below, so their shapes and motion are unchanged.
const BRAND_TONE = `
vec3 vlBrandTone(vec3 c) {
  float l = clamp(dot(c, vec3(0.299, 0.587, 0.114)), 0.0, 1.0);
  vec3 navy   = vec3(0.035, 0.035, 0.09);
  vec3 blue   = vec3(0.26, 0.38, 0.93);
  vec3 violet = vec3(0.55, 0.30, 0.95);
  vec3 pale   = vec3(0.86, 0.87, 1.0);
  vec3 col = mix(navy, blue, smoothstep(0.0, 0.35, l));
  col = mix(col, violet, smoothstep(0.35, 0.7, l));
  col = mix(col, pale, smoothstep(0.7, 1.0, l));
  return col;
}
`;
function brand(frag) {
  return frag
    .replace("void main()", BRAND_TONE + "\nvoid main()")
    .replace(/(gl_FragColor = [^;]+;)/, "$1\n  gl_FragColor.rgb = vlBrandTone(gl_FragColor.rgb);");
}

// Every shader here gets u_time, u_res and u_mouse; these are its other settings.
const SHADERS = {
  aurora:     { frag: FRAG, uniforms: { u_auroraSpeed: 0.5, u_auroraIntensity: 1.0 } },
  voltageArc: { frag: brand(voltageArc), uniforms: { u_arcIntensity: 1.0, u_crackleSpeed: 0.5 } },
};

// `name`: which shader (aurora unless set). `contained`: fill the parent box
// only (e.g. one panel of the homepage) instead of the whole window or
// scrolling area behind the page.
export default function ShaderBackground({ name = "aurora", contained = false }) {
  const canvasRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const gl = canvas.getContext("webgl", { alpha: true, antialias: false, preserveDrawingBuffer: false });
    if (!gl) return; // no WebGL: the CSS background behind stays

    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    function compile(type, src) {
      const s = gl.createShader(type);
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) console.error("Shader compile error:", gl.getShaderInfoLog(s));
      return s;
    }
    const prog = gl.createProgram();
    gl.attachShader(prog, compile(gl.VERTEX_SHADER, VERT));
    const shader = SHADERS[name];
    gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, shader.frag));
    gl.linkProgram(prog);
    gl.useProgram(prog);

    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const aPos = gl.getAttribLocation(prog, "a_pos");
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);

    const uTime = gl.getUniformLocation(prog, "u_time");
    const uRes = gl.getUniformLocation(prog, "u_res");
    const uMouse = gl.getUniformLocation(prog, "u_mouse");
    for (const [k, v] of Object.entries(shader.uniforms)) gl.uniform1f(gl.getUniformLocation(prog, k), v);

    // Cover the nearest scrolling box (e.g. the main area next to the sidebar),
    // or the whole window if there isn't one. Fixed, so it stays put on scroll.
    let scroller = null;
    const box = contained ? canvas.parentElement : null;
    for (let el = box ? document.body : canvas.parentElement; el && el !== document.body; el = el.parentElement) {
      if (/(auto|scroll)/.test(getComputedStyle(el).overflowY)) { scroller = el; break; }
    }

    let rect = { left: 0, top: 0, width: 0, height: 0 };
    let dpr = 1;
    const mouse = { x: -1, y: -1 };

    function resize() {
      const r = box ? box.getBoundingClientRect()
        : scroller
        ? scroller.getBoundingClientRect()
        : { left: 0, top: 0, width: window.innerWidth, height: window.innerHeight };
      rect = { left: r.left, top: r.top, width: Math.round(r.width), height: Math.round(r.height) };
      // Phones render at lower resolution: the glow is soft, so it isn't noticeable
      dpr = rect.width < 768 ? 1 : Math.min(window.devicePixelRatio || 1, 1.5);
      if (!box) {
        canvas.style.left = `${rect.left}px`;
        canvas.style.top = `${rect.top}px`;
      }
      canvas.style.width = `${rect.width}px`;
      canvas.style.height = `${rect.height}px`;
      canvas.width = Math.max(1, Math.round(rect.width * dpr));
      canvas.height = Math.max(1, Math.round(rect.height * dpr));
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.uniform2f(uRes, canvas.width, canvas.height);
      if (reduced) draw(0); // redraw the still frame at the new size
    }

    function draw(seconds) {
      gl.uniform1f(uTime, seconds);
      gl.uniform2f(uMouse, mouse.x, mouse.y);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }

    let frame = 0;
    let running = !document.hidden;
    let onScreen = true; // a contained shader stops drawing when scrolled out of view
    function loop(now) {
      frame = requestAnimationFrame(loop);
      if (running && onScreen) draw(now * 0.001);
    }

    // The canvas ignores clicks, so follow the mouse on the window instead
    const onMove = e => {
      if (box) { const r = box.getBoundingClientRect(); rect.left = r.left; rect.top = r.top; } // the page scrolls
      const x = e.clientX - rect.left, y = e.clientY - rect.top;
      if (x < 0 || y < 0 || x > rect.width || y > rect.height) { mouse.x = -1; mouse.y = -1; return; }
      mouse.x = x * dpr;
      mouse.y = (rect.height - y) * dpr;
    };
    const onLeave = () => { mouse.x = -1; mouse.y = -1; };
    const onVisibility = () => { running = !document.hidden; };

    resize();
    window.addEventListener("resize", resize);
    const watched = box || scroller;
    const ro = watched ? new ResizeObserver(resize) : null;
    if (ro) ro.observe(watched);
    const io = box ? new IntersectionObserver(([en]) => { onScreen = en.isIntersecting; }) : null;
    if (io) io.observe(box);

    if (reduced) {
      draw(0); // one still frame, no motion
    } else {
      window.addEventListener("mousemove", onMove);
      document.addEventListener("mouseleave", onLeave);
      document.addEventListener("visibilitychange", onVisibility);
      frame = requestAnimationFrame(loop);
    }

    return () => {
      cancelAnimationFrame(frame);
      if (ro) ro.disconnect();
      if (io) io.disconnect();
      window.removeEventListener("resize", resize);
      window.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseleave", onLeave);
      document.removeEventListener("visibilitychange", onVisibility);
      gl.getExtension("WEBGL_lose_context")?.loseContext();
    };
  }, [name, contained]);

  return (
    <>
      <canvas key={name} ref={canvasRef} className={contained ? "shader-bg shader-bg-contained" : "shader-bg"} aria-hidden="true" />
    </>
  );
}
