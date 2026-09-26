/* =====================================================================
   Vandana's Midnight Journey - Happy Birthday Ammu
   Three.js r128 + Web Audio. No external assets: every mesh, texture
   and sound is generated at runtime.
   ===================================================================== */
(() => {
  'use strict';

  const $ = (id) => document.getElementById(id);

  function fatal(msg) {
    $('error-screen').classList.remove('hidden');
    if (msg) $('error-text').textContent = msg;
    const sb = $('start-btn');
    if (sb) sb.disabled = true;
  }

  if (typeof THREE === 'undefined') {
    fatal('Three.js could not be loaded. Please check your internet connection and reload.');
    return;
  }

  /* ------------------------------------------------------------------
     Utilities
     ------------------------------------------------------------------ */
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  const damp = (a, b, l, dt) => lerp(a, b, 1 - Math.exp(-l * dt));
  const rand = (a, b) => a + Math.random() * (b - a);
  const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
  const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
  const V3 = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
  const C = (hex) => new THREE.Color(hex);

  const ease = {
    linear: (t) => t,
    inOut: (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2),
    inOutSine: (t) => -(Math.cos(Math.PI * t) - 1) / 2,
    out: (t) => 1 - Math.pow(1 - t, 3),
    in: (t) => t * t * t,
    bounce: (t) => {
      const n1 = 7.5625, d1 = 2.75;
      if (t < 1 / d1) return n1 * t * t;
      if (t < 2 / d1) return n1 * (t -= 1.5 / d1) * t + 0.75;
      if (t < 2.5 / d1) return n1 * (t -= 2.25 / d1) * t + 0.9375;
      return n1 * (t -= 2.625 / d1) * t + 0.984375;
    },
  };

  // Tween system driven by the game clock.
  const tweens = [];
  function tween(dur, fn, e = ease.inOut) {
    return new Promise((res) => tweens.push({ t: 0, dur, fn, e, res }));
  }
  const wait = (s) => tween(s, () => {});
  function updateTweens(dt) {
    for (let i = tweens.length - 1; i >= 0; i--) {
      const tw = tweens[i];
      tw.t += dt;
      const k = Math.min(1, tw.t / tw.dur);
      tw.fn(tw.e(k), k);
      if (k >= 1) { tweens.splice(i, 1); tw.res(); }
    }
  }

  const isTouch = window.matchMedia('(hover: none) and (pointer: coarse)').matches || 'ontouchstart' in window;
  const lowPower = isTouch || (navigator.hardwareConcurrency || 8) <= 4;
  const DENSITY = lowPower ? 0.6 : 1;

  /* ------------------------------------------------------------------
     World layout (the journey runs along -Z)
     ------------------------------------------------------------------ */
  const Z = {
    start: 8,
    paper: -14,
    gate1: -60,
    iceCart: -68,
    iceStop: -67.4,
    riverStart: -100,
    riverEnd: -120,
    bridgeStop: -97.2,
    callSpot: -121.5,
    storm: -123,
    shelter: -134.5,
    shelterStop: -132.8,
    stationLock: -157.4,
    station1: -162,
    canyonStart: -167.5,
    canyonEnd: -262.5,
    station2: -268,
    bike: -282,
    curveStart: -292,
  };
  // The bike ride: a relaxed ~40s scenic drive split into 3 timed zones
  // (Edappally/Metro corridor -> Marine Drive promenade -> Kadamakkudy causeway).
  // Zone lengths are timed, not just distance-thirds, so pacing stays even
  // no matter how the accelerate/cruise/decelerate speed curve bends.
  const RIDE = { T: 42, ta: 6, td: 7, vmax: 19.5, zone1T: 12, zone2T: 15 };
  RIDE.L = RIDE.vmax * (RIDE.T - RIDE.ta / 2 - RIDE.td / 2);
  RIDE.sAt = (t) => (t < RIDE.ta ? 0.5 * RIDE.vmax * t * t / RIDE.ta : t < RIDE.T - RIDE.td ? 0.5 * RIDE.vmax * RIDE.ta + RIDE.vmax * (t - RIDE.ta) : RIDE.L - 0.5 * RIDE.vmax * (RIDE.T - t) * (RIDE.T - t) / RIDE.td);
  RIDE.vAt = (t) => (t < RIDE.ta ? RIDE.vmax * t / RIDE.ta : t < RIDE.T - RIDE.td ? RIDE.vmax : RIDE.vmax * (RIDE.T - t) / RIDE.td);
  Z.rideStart = Z.bike;
  Z.rideFinish = Z.rideStart - RIDE.L;
  Z.metroEnd = Z.rideStart - RIDE.sAt(RIDE.zone1T);
  Z.marineEnd = Z.rideStart - RIDE.sAt(RIDE.zone1T + RIDE.zone2T);
  // The golden-gate finale sits just past where the ride tween ends.
  Z.finalGate = Z.rideFinish - 9;
  Z.plaza = Z.finalGate - 18;
  Z.end = Z.finalGate - 120;
  Z.curveEnd = Z.finalGate + 72;
  Z.waterStart = Z.metroEnd;
  Z.waterEnd = Z.rideFinish - 5;
  // Where the grass/backwater ground gives way to the finale beach ground.
  Z.beachStart = Z.finalGate + 74;

  // Lateral offset of the winding backwater road (0 on straight sections).
  function roadX(z) {
    if (z > Z.curveStart || z < Z.curveEnd) return 0;
    const u = (Z.curveStart - z) / (Z.curveStart - Z.curveEnd);
    return 9 * Math.sin(Math.PI * u) * Math.sin(3 * Math.PI * u);
  }

  /* ------------------------------------------------------------------
     Renderer / scene / camera
     ------------------------------------------------------------------ */
  const canvas = $('scene');
  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: !lowPower, powerPreference: 'high-performance' });
  } catch (e) {
    fatal();
    return;
  }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, lowPower ? 1.5 : 2));
  renderer.setSize(window.innerWidth, window.innerHeight);

  const scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(0xe28a58, 0.012);
  scene.background = new THREE.Color(0xe28a58);

  const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 900);
  camera.position.set(3, 2.4, 16);
  let baseFov = 60, fovBoost = 0;

  let composer = null;
  if (THREE.EffectComposer && THREE.RenderPass && THREE.UnrealBloomPass) {
    try {
      composer = new THREE.EffectComposer(renderer);
      composer.addPass(new THREE.RenderPass(scene, camera));
      composer.addPass(new THREE.UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), lowPower ? 0.7 : 0.85, 0.55, 0.72));
    } catch (e) {
      composer = null;
    }
  }

  function onResize() {
    const w = window.innerWidth, h = window.innerHeight;
    camera.aspect = w / h;
    baseFov = camera.aspect < 0.8 ? 72 : 60;
    camera.fov = baseFov + fovBoost;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h);
    if (composer) composer.setSize(w, h);
  }
  window.addEventListener('resize', onResize);
  onResize();

  /* ------------------------------------------------------------------
     Procedural textures
     ------------------------------------------------------------------ */
  const maxAniso = renderer.capabilities.getMaxAnisotropy ? renderer.capabilities.getMaxAnisotropy() : 1;
  function canvasTex(w, h, draw, repeat) {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    draw(c.getContext('2d'), w, h);
    const t = new THREE.CanvasTexture(c);
    t.anisotropy = Math.min(8, maxAniso);
    if (repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; }
    return t;
  }
  // Text textures are redrawn once web fonts (incl. Malayalam) finish loading.
  const textTextures = [];
  function textTex(w, h, draw) {
    const t = canvasTex(w, h, draw);
    textTextures.push(() => { const g = t.image.getContext('2d'); g.clearRect(0, 0, w, h); draw(g, w, h); t.needsUpdate = true; });
    return t;
  }
  if (document.fonts && document.fonts.load) {
    Promise.all([
      document.fonts.load('700 40px "Noto Sans Malayalam"', 'ചായ'),
      document.fonts.load('700 40px Cinzel'),
      document.fonts.load('600 40px Poppins'),
      document.fonts.load('700 40px "Dancing Script"'),
    ]).then(() => textTextures.forEach((redraw) => redraw())).catch(() => {});
  }
  const ML = '"Noto Sans Malayalam", "Malayalam Sangam MN", "Kartika", sans-serif';
  function fitText(g, text, x, y, maxW, weight, size, family) {
    let s = size;
    g.font = `${weight} ${s}px ${family}`;
    while (s > 10 && g.measureText(text).width > maxW) { s -= 2; g.font = `${weight} ${s}px ${family}`; }
    g.fillText(text, x, y);
  }

  const glowTex = canvasTex(128, 128, (g) => {
    const gr = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    gr.addColorStop(0, 'rgba(255,255,255,1)');
    gr.addColorStop(0.18, 'rgba(255,255,255,0.65)');
    gr.addColorStop(0.45, 'rgba(255,255,255,0.18)');
    gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
  });
  const shadowTex = canvasTex(64, 64, (g) => {
    const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    gr.addColorStop(0, 'rgba(0,0,0,0.75)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
  });
  const smokeTex = canvasTex(128, 128, (g) => {
    for (let i = 0; i < 14; i++) {
      const x = rand(34, 94), y = rand(34, 94), r = rand(18, 40);
      const gr = g.createRadialGradient(x, y, 0, x, y, r);
      gr.addColorStop(0, 'rgba(200,190,210,0.32)'); gr.addColorStop(1, 'rgba(200,190,210,0)');
      g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
    }
  });

  // Asphalt tile = 7 units wide x 14 units long, with lane markings baked in.
  const asphaltTex = canvasTex(256, 512, (g, w, h) => {
    g.fillStyle = '#2a2c31'; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 9000; i++) {
      const v = 30 + Math.random() * 40 | 0;
      g.fillStyle = `rgba(${v},${v},${v + 4},${Math.random() * 0.6})`;
      g.fillRect(Math.random() * w, Math.random() * h, 1.5, 1.5);
    }
    g.fillStyle = 'rgba(225,225,215,0.55)';
    g.fillRect(12, 0, 5, h); g.fillRect(w - 17, 0, 5, h);
    g.fillStyle = 'rgba(240,210,120,0.7)';
    g.fillRect(w / 2 - 4, 30, 8, 200);
  }, true);
  // Roughness map: dark = glossy wet patches.
  const wetTex = canvasTex(256, 512, (g, w, h) => {
    g.fillStyle = 'rgb(150,150,150)'; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 26; i++) {
      const x = Math.random() * w, y = Math.random() * h, r = 20 + Math.random() * 70;
      const gr = g.createRadialGradient(x, y, 0, x, y, r);
      gr.addColorStop(0, 'rgba(40,40,40,0.95)'); gr.addColorStop(1, 'rgba(40,40,40,0)');
      g.fillStyle = gr; g.fillRect(x - r, y - r, r * 2, r * 2);
    }
    g.fillStyle = 'rgba(70,70,70,0.9)';
    g.fillRect(w / 2 - 50, 0, 20, h); g.fillRect(w / 2 + 30, 0, 20, h); // tyre-polished lanes
  }, true);
  const gravelTex = canvasTex(128, 128, (g, w, h) => {
    g.fillStyle = '#4a433b'; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 700; i++) {
      const v = 50 + Math.random() * 70 | 0;
      g.fillStyle = `rgb(${v + 10},${v},${v - 8})`;
      g.beginPath(); g.ellipse(Math.random() * w, Math.random() * h, rand(0.8, 2.6), rand(0.8, 2), Math.random() * 3, 0, Math.PI * 2); g.fill();
    }
  }, true);
  const waterTex = canvasTex(256, 256, (g, w, h) => {
    g.fillStyle = '#0b1b33'; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 260; i++) {
      g.strokeStyle = `rgba(${120 + Math.random() * 100 | 0},${160 + Math.random() * 80 | 0},255,${Math.random() * 0.22})`;
      g.lineWidth = Math.random() * 2 + 0.5;
      g.beginPath();
      const x = Math.random() * w, y = Math.random() * h, l = 8 + Math.random() * 30;
      g.ellipse(x, y, l, l * 0.18, 0, 0, Math.PI * 2);
      g.stroke();
    }
  }, true);
  const mistTex = canvasTex(256, 256, (g, w, h) => {
    for (let i = 0; i < 70; i++) {
      const x = Math.random() * w, y = Math.random() * h, r = 20 + Math.random() * 70;
      const gr = g.createRadialGradient(x, y, 0, x, y, r);
      gr.addColorStop(0, 'rgba(200,210,240,0.22)'); gr.addColorStop(1, 'rgba(200,210,240,0)');
      g.fillStyle = gr; g.fillRect(0, 0, w, h);
    }
  }, true);
  const mistSheetTex = canvasTex(256, 64, (g, w, h) => {
    for (let i = 0; i < 40; i++) {
      const x = rand(40, w - 40), y = rand(20, h - 20), r = rand(14, 34);
      const gr = g.createRadialGradient(x, y, 0, x, y, r);
      gr.addColorStop(0, 'rgba(210,218,245,0.25)'); gr.addColorStop(1, 'rgba(210,218,245,0)');
      g.fillStyle = gr; g.fillRect(0, 0, w, h);
    }
    g.globalCompositeOperation = 'destination-in';
    const m = g.createRadialGradient(w / 2, w / 2, 0, w / 2, w / 2, w / 2);
    m.addColorStop(0, 'rgba(0,0,0,1)'); m.addColorStop(0.6, 'rgba(0,0,0,0.7)'); m.addColorStop(1, 'rgba(0,0,0,0)');
    g.setTransform(1, 0, 0, h / w, 0, 0);
    g.fillStyle = m; g.fillRect(0, 0, w, w);
  });
  const woodTex = canvasTex(128, 512, (g, w, h) => {
    g.fillStyle = '#4b3423'; g.fillRect(0, 0, w, h);
    for (let y = 0; y < h; y += 22) {
      g.fillStyle = `rgb(${60 + Math.random() * 25 | 0},${40 + Math.random() * 15 | 0},${26 + Math.random() * 10 | 0})`;
      g.fillRect(0, y, w, 20);
      g.fillStyle = 'rgba(0,0,0,0.6)'; g.fillRect(0, y + 20, w, 2);
    }
  }, true);
  const stoneTex = canvasTex(256, 256, (g, w, h) => {
    g.fillStyle = '#3a3a40'; g.fillRect(0, 0, w, h);
    for (let row = 0; row < h / 32; row++) {
      const off = (row % 2) * 32;
      for (let x = -64; x < w; x += 64) {
        const v = 48 + Math.random() * 24 | 0;
        g.fillStyle = `rgb(${v + 8},${v},${v - 4})`;
        g.fillRect(x + off + 2, row * 32 + 2, 60, 28);
      }
    }
  }, true);
  // Kerala clay roof tiles
  const tileTex = canvasTex(128, 128, (g, w, h) => {
    g.fillStyle = '#7a3418'; g.fillRect(0, 0, w, h);
    for (let y = 0; y < h; y += 16) {
      for (let x = (y / 16) % 2 ? -8 : 0; x < w; x += 16) {
        const gr = g.createLinearGradient(x, 0, x + 16, 0);
        const b = 150 + Math.random() * 40 | 0;
        gr.addColorStop(0, `rgb(${b - 50},${b / 3.2 | 0},${b / 6 | 0})`);
        gr.addColorStop(0.5, `rgb(${b + 30},${b / 2.3 | 0},${b / 4.5 | 0})`);
        gr.addColorStop(1, `rgb(${b - 60},${b / 3.4 | 0},${b / 6 | 0})`);
        g.fillStyle = gr;
        g.beginPath(); g.moveTo(x, y + 16); g.lineTo(x, y + 3); g.quadraticCurveTo(x + 8, y - 2, x + 16, y + 3); g.lineTo(x + 16, y + 16); g.fill();
      }
    }
  }, true);
  const trunkTex = canvasTex(256, 64, (g, w, h) => {
    g.fillStyle = '#6b5b49'; g.fillRect(0, 0, w, h);
    for (let x = 0; x < w; x += rand(6, 10)) {
      g.fillStyle = `rgba(40,30,22,${rand(0.4, 0.8)})`; g.fillRect(x, 0, rand(1.5, 3), h);
      g.fillStyle = `rgba(150,135,110,${rand(0.1, 0.3)})`; g.fillRect(x + 3, 0, 2, h);
    }
  }, true);
  // Coconut frond: u across the leaf, v along it (tip at canvas top).
  const frondTex = canvasTex(256, 512, (g, w, h) => {
    g.clearRect(0, 0, w, h);
    for (let y = 12; y < h - 4; y += 5) {
      const t = y / h;
      const L = 124 * (0.3 + 0.7 * Math.sin(Math.PI * clamp(1 - t + 0.08, 0, 1)));
      for (const s of [-1, 1]) {
        g.fillStyle = `hsl(${rand(88, 112)},${rand(40, 60)}%,${rand(20, 36)}%)`;
        g.beginPath();
        g.moveTo(w / 2, y - 2);
        g.quadraticCurveTo(w / 2 + s * L * 0.5, y - L * 0.25, w / 2 + s * L, y - L * 0.5);
        g.quadraticCurveTo(w / 2 + s * L * 0.5, y - L * 0.18, w / 2, y + 3);
        g.fill();
      }
    }
    g.fillStyle = '#5a5a24'; g.fillRect(w / 2 - 3, 0, 6, h);
  });
  const bananaTex = canvasTex(128, 512, (g, w, h) => {
    g.clearRect(0, 0, w, h);
    const gr = g.createLinearGradient(0, 0, w, 0);
    gr.addColorStop(0, '#2f6a22'); gr.addColorStop(0.5, '#4f9a34'); gr.addColorStop(1, '#2f6a22');
    g.fillStyle = gr;
    g.beginPath();
    g.moveTo(w / 2, 0);
    g.bezierCurveTo(w * 1.05, h * 0.15, w * 1.05, h * 0.85, w / 2, h);
    g.bezierCurveTo(-w * 0.05, h * 0.85, -w * 0.05, h * 0.15, w / 2, 0);
    g.fill();
    g.strokeStyle = 'rgba(190,230,140,0.25)'; g.lineWidth = 1;
    for (let y = 10; y < h; y += 9) { g.beginPath(); g.moveTo(w / 2, y); g.lineTo(0, y - 18); g.moveTo(w / 2, y); g.lineTo(w, y - 18); g.stroke(); }
    g.fillStyle = '#c8e090'; g.fillRect(w / 2 - 2, 0, 4, h);
    g.globalCompositeOperation = 'destination-out';
    for (let i = 0; i < 7; i++) {
      const y = rand(60, h - 40), s = Math.random() < 0.5 ? -1 : 1;
      g.lineWidth = rand(1.5, 3);
      g.beginPath(); g.moveTo(w / 2 + s * 6, y); g.lineTo(w / 2 + s * w * 0.6, y - 26); g.stroke();
    }
  });
  const beamTex = canvasTex(8, 128, (g, w, h) => {
    const gr = g.createLinearGradient(0, 0, 0, h);
    gr.addColorStop(0, 'rgba(255,245,220,0.95)'); gr.addColorStop(0.35, 'rgba(255,245,220,0.35)'); gr.addColorStop(1, 'rgba(255,245,220,0)');
    g.fillStyle = gr; g.fillRect(0, 0, w, h);
  });

  function makeWindowTextures() {
    const cols = 4 + (Math.random() * 3 | 0), rows = 7 + (Math.random() * 6 | 0);
    const W = 128, H = 256;
    const lit = [];
    for (let i = 0; i < cols * rows; i++) lit.push(Math.random() < 0.22 ? pick(['#ffcf7a', '#ffe2a8', '#ffb86b', '#9fbaff', '#ffd9a0']) : null);
    const wall = pick(['#b7a58a', '#c9b99b', '#a89a86', '#d0c2a4', '#9d8f7c']);
    const draw = (emissive) => (g) => {
      g.fillStyle = emissive ? '#000' : wall;
      g.fillRect(0, 0, W, H);
      const cw = W / cols, rh = H / rows;
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          const l = lit[r * cols + c];
          const x = c * cw + cw * 0.22, y = r * rh + rh * 0.2, ww = cw * 0.56, hh = rh * 0.55;
          if (emissive) {
            if (l) { g.fillStyle = l; g.fillRect(x, y, ww, hh); g.fillStyle = 'rgba(0,0,0,0.35)'; g.fillRect(x + ww * 0.48, y, ww * 0.06, hh); }
          } else {
            g.fillStyle = l || '#22242c'; g.fillRect(x, y, ww, hh);
            g.fillStyle = 'rgba(0,0,0,0.25)'; g.fillRect(x - 2, y + hh, ww + 4, 3);
          }
        }
      }
    };
    return { map: canvasTex(W, H, draw(false)), emissive: canvasTex(W, H, draw(true)) };
  }

  function heartPath(g, cx, cy, s) {
    g.beginPath();
    g.moveTo(cx, cy + s * 0.3);
    g.bezierCurveTo(cx, cy, cx - s * 0.5, cy - s * 0.1, cx - s * 0.5, cy + s * 0.25);
    g.bezierCurveTo(cx - s * 0.5, cy + s * 0.6, cx, cy + s * 0.75, cx, cy + s * 0.95);
    g.bezierCurveTo(cx, cy + s * 0.75, cx + s * 0.5, cy + s * 0.6, cx + s * 0.5, cy + s * 0.25);
    g.bezierCurveTo(cx + s * 0.5, cy - s * 0.1, cx, cy, cx, cy + s * 0.3);
    g.closePath();
  }
  const heartTex = canvasTex(128, 128, (g) => {
    g.shadowColor = 'rgba(255,120,170,0.9)'; g.shadowBlur = 18;
    g.fillStyle = '#ff5f95'; heartPath(g, 64, 18, 96); g.fill();
  });
  const parchmentTex = canvasTex(256, 180, (g, w, h) => {
    const gr = g.createRadialGradient(w / 2, h / 2, 10, w / 2, h / 2, w * 0.6);
    gr.addColorStop(0, '#fff6dc'); gr.addColorStop(0.7, '#f1dcaa'); gr.addColorStop(1, '#b98a4a');
    g.fillStyle = gr; g.fillRect(0, 0, w, h);
    g.strokeStyle = 'rgba(120,70,30,0.45)'; g.lineWidth = 2;
    for (let y = 40; y < h - 30; y += 16) {
      g.beginPath(); g.moveTo(30, y);
      for (let x = 30; x < w - 30; x += 8) g.lineTo(x, y + Math.sin(x * 0.4 + y) * 2);
      g.stroke();
    }
    g.fillStyle = '#b3163f'; heartPath(g, w / 2, h - 44, 38); g.fill();
  });

  /* ------------------------------------------------------------------
     Environment maps (sunset & night) for PBR reflections
     ------------------------------------------------------------------ */
  function genEnv(pm, stops, blob, n) {
    const envScene = new THREE.Scene();
    const tex = canvasTex(512, 256, (g, w, h) => {
      const gr = g.createLinearGradient(0, 0, 0, h);
      [0, 0.44, 0.5, 0.56, 1].forEach((p, i) => gr.addColorStop(p, stops[i]));
      g.fillStyle = gr; g.fillRect(0, 0, w, h);
      for (let i = 0; i < n; i++) {
        const x = Math.random() * w, y = h * 0.5 + (Math.random() - 0.5) * 24, r = 6 + Math.random() * 14;
        const rg = g.createRadialGradient(x, y, 0, x, y, r);
        rg.addColorStop(0, blob); rg.addColorStop(1, 'rgba(0,0,0,0)');
        g.fillStyle = rg; g.fillRect(x - r, y - r, r * 2, r * 2);
      }
    });
    envScene.add(new THREE.Mesh(new THREE.SphereGeometry(10, 32, 16), new THREE.MeshBasicMaterial({ map: tex, side: THREE.BackSide })));
    return pm.fromScene(envScene, 0.02).texture;
  }
  let envNight = null, envSunset = null;
  try {
    const pm = new THREE.PMREMGenerator(renderer);
    envNight = genEnv(pm, ['#03050c', '#141c36', '#1b2238', '#0b0c12', '#040406'], 'rgba(255,200,130,1)', 18);
    envSunset = genEnv(pm, ['#34528f', '#e39060', '#ffb878', '#3a2a22', '#1a1210'], 'rgba(255,215,160,1)', 5);
    pm.dispose();
  } catch (e) {
    envNight = envSunset = null;
  }
  let envIsNight = false;
  const envMats = [];

  /* ------------------------------------------------------------------
     Materials & mesh helpers
     ------------------------------------------------------------------ */
  const std = (o) => new THREE.MeshStandardMaterial(o);
  const envStd = (o) => { const m = std(Object.assign({ envMap: envSunset }, o)); envMats.push(m); return m; };
  function stoneMat(rx, ry, color = 0x8a7f78) {
    const t = stoneTex.clone(); t.needsUpdate = true; t.repeat.set(rx, ry);
    return std({ color, roughness: 0.95, map: t });
  }
  function tileMat(rx, ry) {
    const t = tileTex.clone(); t.needsUpdate = true; t.repeat.set(rx, ry);
    return std({ color: 0xffffff, roughness: 0.8, map: t });
  }
  const MAT = {
    ground: std({ color: 0x141a10, roughness: 1 }),
    sidewalk: std({ color: 0x4a4944, roughness: 0.85 }),
    metalDark: std({ color: 0x1c1e24, roughness: 0.45, metalness: 0.7 }),
    iron: envStd({ color: 0x2a2b31, roughness: 0.5, metalness: 0.8, envMapIntensity: 0.6 }),
    stone: stoneMat(1, 1),
    laterite: stoneMat(40, 1, 0xb0664a),
    rock: std({ color: 0x24262c, roughness: 1, flatShading: true }),
    wood: std({ color: 0xaa8866, roughness: 0.85, map: woodTex }),
    woodDark: std({ color: 0x5a3e2a, roughness: 0.9 }),
    trunk: std({ color: 0xffffff, roughness: 1, map: trunkTex }),
    frond: std({ color: 0xc8d8a8, roughness: 0.85, map: frondTex, alphaTest: 0.45, side: THREE.DoubleSide }),
    banana: std({ color: 0xd8e8c0, roughness: 0.7, map: bananaTex, alphaTest: 0.4, side: THREE.DoubleSide }),
    bananaStem: std({ color: 0x5f7a3a, roughness: 0.9 }),
    bush: std({ color: 0x1d4422, roughness: 1, flatShading: true }),
    gold: envStd({ color: 0xe0b04a, roughness: 0.28, metalness: 0.9, emissive: 0x4a3106, envMapIntensity: 1.6 }),
    marble: std({ color: 0xe9e2d6, roughness: 0.35, metalness: 0.05 }),
    cream: std({ color: 0xd6c9aa, roughness: 0.85 }),
    maroon: std({ color: 0x7a1e28, roughness: 0.7 }),
    hedge: std({ color: 0x173222, roughness: 1, flatShading: true }),
    puddle: envStd({ color: 0x07090e, roughness: 0.03, metalness: 0.95, envMapIntensity: 1.3, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }),
  };
  const addGlow = (color, opacity = 1) => new THREE.SpriteMaterial({ map: glowTex, color, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false });

  function mesh(geo, mat, x = 0, y = 0, z = 0, parent = scene) {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    parent.add(m);
    return m;
  }
  const box = (w, h, d) => new THREE.BoxGeometry(w, h, d);
  const cyl = (rt, rb, h, s = 10) => new THREE.CylinderGeometry(rt, rb, h, s);

  const _q = new THREE.Quaternion(), _e = new THREE.Euler();
  function mat4(px, py, pz, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1) {
    _e.set(rx, ry, rz); _q.setFromEuler(_e);
    return new THREE.Matrix4().compose(V3(px, py, pz), _q.clone(), V3(sx, sy, sz));
  }
  // Merge geometries into one (one draw call per plant).
  function mergeGeos(parts) {
    const pos = [], nor = [], uv = [];
    for (const p of parts) {
      const g = p.g.index ? p.g.toNonIndexed() : p.g.clone();
      if (!g.attributes.normal) g.computeVertexNormals();
      if (p.m) g.applyMatrix4(p.m);
      const a = g.attributes.position.array, n = g.attributes.normal.array, u = g.attributes.uv ? g.attributes.uv.array : null;
      for (let i = 0; i < a.length; i++) { pos.push(a[i]); nor.push(n[i]); }
      const cnt = a.length / 3;
      for (let i = 0; i < cnt; i++) {
        if (p.uv) uv.push(p.uv[0], p.uv[1]);
        else if (u) uv.push(u[i * 2], u[i * 2 + 1]);
        else uv.push(0, 0);
      }
    }
    const out = new THREE.BufferGeometry();
    out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    out.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    out.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    return out;
  }
  // Leaf ribbon along +x: rises, droops, V-folded, u across / v along.
  function leafGeo(len, width, rise, droop, fold = 0.28, segs = 9) {
    const pos = [], uv = [];
    const P = (s, side) => {
      const w = width * Math.sin(Math.PI * Math.min(1, 0.08 + s * 0.95)) * (1 - 0.3 * s);
      return [s * len, s * len * rise - droop * s * s * len - Math.abs(side) * w * fold, side * w];
    };
    for (let i = 0; i < segs; i++) {
      const s0 = i / segs, s1 = (i + 1) / segs;
      for (const [sa, sb] of [[-1, 0], [0, 1]]) {
        const a = P(s0, sa), b = P(s1, sa), c = P(s1, sb), d = P(s0, sb);
        const ua = (sa + 1) / 2, ub = (sb + 1) / 2;
        pos.push(...a, ...b, ...c, ...a, ...c, ...d);
        uv.push(ua, s0, ua, s1, ub, s1, ua, s0, ub, s1, ub, s0);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.computeVertexNormals();
    return g;
  }

  /* ------------------------------------------------------------------
     Lights
     ------------------------------------------------------------------ */
  const hemi = new THREE.HemisphereLight(0xffc9a0, 0x4a3028, 0.95);
  scene.add(hemi);
  const sunDir = V3(0.28, 0.075, -1).normalize();
  const sunLight = new THREE.DirectionalLight(0xffa060, 1.2);
  scene.add(sunLight);
  const moonDir = V3(-0.45, 0.5, -1).normalize();
  const moonLight = new THREE.DirectionalLight(0x8ea8ff, 0);
  moonLight.position.copy(moonDir).multiplyScalar(50);
  scene.add(moonLight);
  const fillLight = new THREE.PointLight(0xa8b8ff, 0.7, 4, 2);
  scene.add(fillLight);

  // Lamp light pool: a handful of real lights hop between the nearest lamps.
  const lamps = [];
  const pool = [];
  const poolMap = [];
  const POOL_SIZE = lowPower ? 4 : 6;
  for (let i = 0; i < POOL_SIZE; i++) {
    const l = new THREE.PointLight(0xffc27a, 0, 15, 2);
    scene.add(l); pool.push(l); poolMap.push(null);
  }

  /* ------------------------------------------------------------------
     Sky dome with sun glow, stars, moon, sun disc
     ------------------------------------------------------------------ */
  const skyGroup = new THREE.Group();
  scene.add(skyGroup);
  const skyMat = new THREE.ShaderMaterial({
    uniforms: {
      top: { value: C(0x2b4585) }, mid: { value: C(0xe28a58) }, bottom: { value: C(0x3a2420) },
      sunDir: { value: sunDir }, sunCol: { value: C(0xffa050) }, sunAmt: { value: 1 },
    },
    vertexShader: 'varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: [
      'uniform vec3 top; uniform vec3 mid; uniform vec3 bottom; uniform vec3 sunDir; uniform vec3 sunCol; uniform float sunAmt; varying vec3 vP;',
      'void main(){',
      '  float h = vP.y;',
      '  vec3 c = h > 0.0 ? mix(mid, top, pow(clamp(h*1.4,0.0,1.0),0.7)) : mix(mid, bottom, clamp(-h*4.0,0.0,1.0));',
      '  float sd = max(dot(normalize(vP), sunDir), 0.0);',
      '  c += sunCol * (pow(sd, 6.0) * 0.45 + pow(sd, 60.0) * 0.9) * sunAmt;',
      '  gl_FragColor = vec4(c, 1.0);',
      '}',
    ].join('\n'),
    side: THREE.BackSide, depthWrite: false, fog: false,
  });
  const skyDome = new THREE.Mesh(new THREE.SphereGeometry(500, 32, 16), skyMat);
  skyDome.renderOrder = -10;
  skyGroup.add(skyDome);

  const starGeo = new THREE.BufferGeometry();
  {
    const N = 1400, pos = new Float32Array(N * 3);
    for (let i = 0; i < N; i++) {
      const th = Math.random() * Math.PI * 2, ph = Math.acos(rand(0.08, 1));
      pos[i * 3] = Math.sin(ph) * Math.cos(th) * 480;
      pos[i * 3 + 1] = Math.cos(ph) * 480;
      pos[i * 3 + 2] = Math.sin(ph) * Math.sin(th) * 480;
    }
    starGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  }
  const starMat = new THREE.PointsMaterial({ color: 0xcfd8ff, size: 1.6, sizeAttenuation: false, transparent: true, opacity: 0, fog: false, depthWrite: false });
  skyGroup.add(new THREE.Points(starGeo, starMat));

  const moonTex = canvasTex(256, 256, (g) => {
    const gr = g.createRadialGradient(110, 110, 10, 128, 128, 100);
    gr.addColorStop(0, '#fffef4'); gr.addColorStop(0.8, '#e6e2cf'); gr.addColorStop(1, '#cfc9b0');
    g.fillStyle = gr; g.beginPath(); g.arc(128, 128, 100, 0, Math.PI * 2); g.fill();
    for (let i = 0; i < 16; i++) {
      g.fillStyle = `rgba(160,150,120,${Math.random() * 0.25})`;
      g.beginPath(); g.arc(60 + Math.random() * 136, 60 + Math.random() * 136, 4 + Math.random() * 16, 0, Math.PI * 2); g.fill();
    }
  });
  const moon = new THREE.Sprite(new THREE.SpriteMaterial({ map: moonTex, depthWrite: false, transparent: true, opacity: 0 }));
  moon.scale.set(28, 28, 1);
  moon.position.copy(moonDir).multiplyScalar(450);
  skyGroup.add(moon);
  const moonHalo = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: 0x8fa6ff, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }));
  moonHalo.scale.set(150, 150, 1);
  moonHalo.position.copy(moon.position).multiplyScalar(1.01);
  skyGroup.add(moonHalo);
  const sunTex = canvasTex(256, 256, (g) => {
    const gr = g.createRadialGradient(128, 128, 0, 128, 128, 128);
    gr.addColorStop(0, 'rgba(255,250,220,1)'); gr.addColorStop(0.28, 'rgba(255,200,120,1)'); gr.addColorStop(0.36, 'rgba(255,140,70,0.5)'); gr.addColorStop(1, 'rgba(255,120,60,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 256, 256);
  });
  const sun = new THREE.Sprite(new THREE.SpriteMaterial({ map: sunTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
  sun.scale.set(70, 70, 1);
  skyGroup.add(sun);
  [sun.material, moon.material, moonHalo.material].forEach((m) => { m.fog = false; });

  /* ------------------------------------------------------------------
     Ground, roads, gravel shoulders, puddles
     ------------------------------------------------------------------ */
  function roadMaterial(repeatV) {
    const tex = asphaltTex.clone(); tex.needsUpdate = true; tex.repeat.set(1, repeatV);
    const wet = wetTex.clone(); wet.needsUpdate = true; wet.repeat.set(1, repeatV);
    return envStd({ color: 0x9a9ca6, map: tex, roughness: 1, roughnessMap: wet, metalness: 0.45, envMapIntensity: 1.0 });
  }
  function addPuddle(x, z) {
    const p = mesh(new THREE.CircleGeometry(1, 20), MAT.puddle, x, 0.012, z);
    p.rotation.x = -Math.PI / 2;
    p.scale.set(rand(0.5, 1.4), rand(0.8, 2.2), 1);
  }
  function roadSegment(z0, z1, opts = {}) {
    const len = z0 - z1, cz = (z0 + z1) / 2;
    const road = mesh(new THREE.PlaneGeometry(7, len), roadMaterial(len / 14), 0, 0, cz);
    road.rotation.x = -Math.PI / 2;
    const g = mesh(new THREE.PlaneGeometry(260, len), MAT.ground, 0, -0.02, cz);
    g.rotation.x = -Math.PI / 2;
    if (opts.gravel) {
      [-1, 1].forEach((s) => {
        const t = gravelTex.clone(); t.needsUpdate = true; t.repeat.set(1, len / 1.6);
        const m = mesh(new THREE.PlaneGeometry(1.7, len), std({ color: 0xffffff, map: t, roughness: 0.95 }), s * 4.35, 0.004, cz);
        m.rotation.x = -Math.PI / 2;
      });
    } else {
      [-1, 1].forEach((s) => mesh(box(1.8, 0.16, len), MAT.sidewalk, s * 4.4, 0.08, cz));
    }
    for (let i = 0; i < Math.floor(len / 9); i++) addPuddle(rand(-2.6, 2.6), rand(z1 + 2, z0 - 2));
  }
  // Ribbon that follows roadX(): used for the winding ride road & shoulders.
  function ribbon(z0, z1, xl, xr, y, mat, vScale, step = 2) {
    const pos = [], uv = [], idx = [];
    let i = 0;
    for (let z = z0; z >= z1 - 0.001; z -= step) {
      const cx = roadX(z);
      pos.push(cx + xl, y, z, cx + xr, y, z);
      const v = (z0 - z) / vScale;
      uv.push(0, v, 1, v);
      if (i > 0) { const a = (i - 1) * 2, b = a + 1, c = a + 2, d = a + 3; idx.push(a, b, c, b, d, c); }
      i++;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx);
    g.computeVertexNormals();
    return mesh(g, mat);
  }
  roadSegment(16, Z.riverStart + 0.5);
  roadSegment(Z.riverEnd - 0.5, Z.canyonStart, { gravel: true });
  {
    ribbon(Z.canyonEnd, Z.end, -3.5, 3.5, 0, roadMaterial(1), 14);
    const gt = gravelTex.clone(); gt.needsUpdate = true;
    const gm = std({ color: 0xffffff, map: gt, roughness: 0.95 });
    ribbon(Z.canyonEnd, Z.end, -5.2, -3.5, 0.004, gm, 1.7);
    ribbon(Z.canyonEnd, Z.end, 3.5, 5.2, 0.004, gm, 1.7);
    for (let z = Z.canyonEnd - 4; z > Z.finalGate + 4; z -= rand(8, 13)) addPuddle(roadX(z) + rand(-2.6, 2.6), z);
    // Ground for the ride: land on the right, backwaters on the left.
    // This grass/backwater ground stops at Z.beachStart - the final stretch
    // beyond that (golden gate onward) gets its own beach ground below.
    const L = Z.canyonEnd - Z.beachStart;
    const gR = mesh(new THREE.PlaneGeometry(160, L), MAT.ground, 56, -0.02, (Z.canyonEnd + Z.beachStart) / 2); gR.rotation.x = -Math.PI / 2;
    [[Z.canyonEnd, Z.waterStart], [Z.waterEnd, Z.beachStart]].forEach(([a, b]) => {
      const gl = mesh(new THREE.PlaneGeometry(140, a - b), MAT.ground, -94, -0.02, (a + b) / 2); gl.rotation.x = -Math.PI / 2;
    });
  }

  /* ------------------------------------------------------------------
     Street lamps (volumetric cones, light pools, wet-road streaks)
     ------------------------------------------------------------------ */
  const LAMP = {
    pole: cyl(0.07, 0.11, 1, 8),
    base: cyl(0.2, 0.26, 0.45, 8),
    arm: box(1.3, 0.07, 0.07),
    shade: new THREE.ConeGeometry(0.34, 0.3, 10),
    bulb: new THREE.SphereGeometry(0.12, 10, 8),
    cone: new THREE.ConeGeometry(2.3, 1, 24, 1, true),
    plane: new THREE.PlaneGeometry(1, 1),
  };
  function lampRecord(pos, color, o = {}) {
    const rec = Object.assign({ pos, color: C(color), intensity: 2.1, flicker: false, onAt: o.always ? -1 : rand(0.3, 0.47), coneBase: 0.035 }, o);
    lamps.push(rec);
    return rec;
  }
  function makeLamp(x, z, color = 0xffc27a, opts = {}) {
    const h = opts.h || 5.2;
    const dir = opts.dir || (x > 0 ? -1 : 1);
    const g = new THREE.Group();
    g.position.set(x, 0, z);
    scene.add(g);
    const pole = mesh(LAMP.pole, MAT.metalDark, 0, h / 2, 0, g); pole.scale.y = h;
    mesh(LAMP.base, MAT.metalDark, 0, 0.22, 0, g);
    mesh(LAMP.arm, MAT.metalDark, dir * 0.62, h, 0, g);
    mesh(LAMP.shade, MAT.metalDark, dir * 1.2, h - 0.05, 0, g);
    const c = C(color);
    const bulbMat = new THREE.MeshBasicMaterial({ color: c.clone().multiplyScalar(1.6) });
    mesh(LAMP.bulb, bulbMat, dir * 1.2, h - 0.25, 0, g);
    const glow = new THREE.Sprite(addGlow(color, 0.9));
    glow.scale.set(3.2, 3.2, 1); glow.position.set(dir * 1.2, h - 0.28, 0); g.add(glow);
    const coneMat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.035, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
    const cone = mesh(LAMP.cone, coneMat, dir * 1.2, (h - 0.3) / 2, 0, g); cone.scale.y = h - 0.3;
    const poolMat = new THREE.MeshBasicMaterial({ map: glowTex, color, transparent: true, opacity: 0.2, blending: THREE.AdditiveBlending, depthWrite: false });
    const pl = mesh(LAMP.plane, poolMat, dir * 1.2, 0.03, 0, g); pl.rotation.x = -Math.PI / 2; pl.scale.set(5.5, 5.5, 1);
    const streakMat = new THREE.MeshBasicMaterial({ map: glowTex, color, transparent: true, opacity: 0.1, blending: THREE.AdditiveBlending, depthWrite: false });
    const st = mesh(LAMP.plane, streakMat, dir * 1.2, 0.035, 3.2, g); st.rotation.x = -Math.PI / 2; st.scale.set(0.9, 7.5, 1);
    return lampRecord(V3(x + dir * 1.2, h - 0.4, z), color, {
      intensity: opts.intensity || 2.1, flicker: !!opts.flicker, always: !!opts.always,
      glow, bulbMat, coneMat, poolMat, streakMat, baseBulb: bulbMat.color.clone(),
    });
  }

  for (let z = 12, i = 0; z > Z.riverStart + 4; z -= 11, i++) makeLamp(i % 2 ? 4.6 : -4.6, z, 0xffc27a, { flicker: i === 5 });
  [-126, -145, -152].forEach((z, i) => makeLamp(i % 2 ? -4.6 : 4.6, z, 0xffd8a0, { flicker: i === 1 }));
  for (let z = Z.curveStart + 2, i = 0; z > Z.curveEnd - 18; z -= 15, i++) {
    const s = i % 2 ? 1 : -1;
    makeLamp(roadX(z) + s * 4.9, z, i % 3 ? 0xffc88a : 0xffe0b0, { dir: -s });
  }
  for (let z = Z.finalGate + 66, i = 0; z > Z.finalGate + 4; z -= 9, i++) {
    makeLamp(4.6, z, i % 2 ? 0xffb3d1 : 0xffd27a, { intensity: 2.3 });
    makeLamp(-4.6, z - 4.5, i % 2 ? 0xffd27a : 0xffb3d1, { intensity: 2.3 });
  }

  /* ------------------------------------------------------------------
     Kerala foliage: coconut palms, banana plants, bushes
     ------------------------------------------------------------------ */
  const swayers = [];
  const trunkVariants = [[7.5, 0.7], [9, 1.3], [10.5, 2.0], [8.2, 0.3]].map(([H, bend]) => {
    const curve = new THREE.CatmullRomCurve3([V3(0, 0, 0), V3(bend * 0.25, H * 0.35, 0), V3(bend * 0.65, H * 0.7, 0), V3(bend, H, 0)]);
    const geo = new THREE.TubeGeometry(curve, 14, 0.17, 7, false);
    const uvs = geo.attributes.uv;
    for (let i = 0; i < uvs.count; i++) uvs.setX(i, uvs.getX(i) * H * 1.2);
    return { geo, top: curve.getPoint(1) };
  });
  const crownVariants = [0, 1, 2].map(() => {
    const parts = [];
    const n = 11 + (Math.random() * 3 | 0);
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + rand(-0.2, 0.2);
      parts.push({ g: leafGeo(rand(3.0, 3.8), 0.62, rand(0.25, 0.55), rand(0.9, 1.4)), m: mat4(0, 0, 0, 0, a, rand(-0.15, 0.2)) });
    }
    for (let i = 0; i < 3; i++) parts.push({ g: leafGeo(2.1, 0.45, 1.5, 0.7), m: mat4(0, 0, 0, 0, rand(0, 6.28), 0) });
    const nut = new THREE.SphereGeometry(0.17, 7, 5);
    for (let i = 0; i < 6; i++) { const a = rand(0, 6.28); parts.push({ g: nut, m: mat4(Math.cos(a) * 0.24, -0.25 - Math.random() * 0.15, Math.sin(a) * 0.24), uv: [0.5, 0.02] }); }
    return mergeGeos(parts);
  });
  function palm(x, z, opts = {}) {
    const g = new THREE.Group();
    g.position.set(x, 0, z);
    g.rotation.y = opts.ry != null ? opts.ry : rand(0, Math.PI * 2);
    g.scale.setScalar(opts.s || rand(0.85, 1.15));
    const tv = pick(trunkVariants);
    mesh(tv.geo, MAT.trunk, 0, 0, 0, g);
    const crown = mesh(pick(crownVariants), MAT.frond, tv.top.x, tv.top.y, tv.top.z, g);
    crown.rotation.y = rand(0, 6.28);
    scene.add(g);
    swayers.push({ o: crown, p: Math.random() * 6, a: rand(0.04, 0.07), base: crown.rotation.clone() });
    return g;
  }
  const bananaLeaves = [0, 1].map(() => {
    const parts = [];
    for (let i = 0; i < 7; i++) parts.push({ g: leafGeo(rand(1.6, 2.1), 0.36, rand(0.7, 1.2), rand(0.9, 1.3), 0.1, 8), m: mat4(0, rand(-0.2, 0.1), 0, 0, (i / 7) * 6.28 + rand(-0.3, 0.3), 0) });
    return mergeGeos(parts);
  });
  const bananaStemGeo = cyl(0.11, 0.16, 1.9, 8);
  function banana(x, z, s = rand(0.8, 1.2)) {
    const g = new THREE.Group(); g.position.set(x, 0, z); g.scale.setScalar(s); g.rotation.y = rand(0, 6.28);
    mesh(bananaStemGeo, MAT.bananaStem, 0, 0.95, 0, g);
    const lv = mesh(pick(bananaLeaves), MAT.banana, 0, 1.85, 0, g);
    scene.add(g);
    swayers.push({ o: lv, p: Math.random() * 6, a: 0.08, base: lv.rotation.clone() });
  }
  const bushVariants = [0, 1, 2].map(() => {
    const parts = [];
    const ico = new THREE.IcosahedronGeometry(1, 0);
    for (let i = 0; i < 5; i++) { const s = rand(0.45, 0.8); parts.push({ g: ico, m: mat4(rand(-0.6, 0.6), s * 0.7, rand(-0.6, 0.6), rand(0, 3), rand(0, 3), 0, s, s * 0.8, s) }); }
    return mergeGeos(parts);
  });
  function bush(x, z, s = rand(0.7, 1.3)) {
    const b = mesh(pick(bushVariants), MAT.bush, x, 0, z);
    b.scale.setScalar(s); b.rotation.y = rand(0, 6.28);
  }

  /* ------------------------------------------------------------------
     Stage 1: Kerala town at golden hour (buildings, tea stalls, neon)
     ------------------------------------------------------------------ */
  const winVariants = Array.from({ length: 6 }, makeWindowTextures);
  const buildingMats = [];
  function building(x, z, w, d, h) {
    const v = pick(winVariants);
    const mat = std({ color: 0xffffff, map: v.map, emissive: 0xffffff, emissiveMap: v.emissive, emissiveIntensity: 0.25, roughness: 0.9 });
    buildingMats.push(mat);
    mesh(box(w, h, d), mat, x, h / 2, z);
    if (Math.random() < 0.45) {
      const roof = mesh(new THREE.ConeGeometry(Math.max(w, d) * 0.72, 2.2, 4), tileMat(3, 1), x, h + 1.1, z);
      roof.rotation.y = Math.PI / 4; roof.scale.set(w / Math.max(w, d), 1, d / Math.max(w, d));
    } else {
      mesh(box(w + 0.3, 0.3, d + 0.3), MAT.metalDark, x, h + 0.15, z);
    }
  }
  for (const side of [-1, 1]) {
    let z = 14;
    while (z > -54) {
      const d = rand(6, 10), w = rand(5, 8), h = rand(7, 16);
      building(side * (6.4 + w / 2 + rand(0, 1)), z - d / 2, w, d, h);
      if (Math.random() < 0.7) {
        const w2 = rand(6, 10), h2 = rand(12, 26);
        building(side * (19 + w2 / 2), z - d / 2 - rand(-2, 2), w2, rand(7, 12), h2);
      }
      if (Math.random() < 0.8 * DENSITY) palm(side * rand(15.5, 17.5), z - d / 2 + rand(-3, 3), { s: rand(1, 1.25) });
      z -= d + rand(0.4, 2.5);
    }
  }
  function neonSign(text, x, y, z, color, rotY) {
    const tex = textTex(512, 128, (g, w, h) => {
      g.font = '600 64px Poppins, sans-serif';
      g.textAlign = 'center'; g.textBaseline = 'middle';
      g.shadowColor = color; g.shadowBlur = 24;
      g.strokeStyle = color; g.lineWidth = 4; g.strokeText(text, w / 2, h / 2);
      g.fillStyle = '#fff'; g.shadowBlur = 12; g.fillText(text, w / 2, h / 2);
    });
    const m = mesh(new THREE.PlaneGeometry(4, 1), new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, side: THREE.DoubleSide }), x, y, z);
    m.rotation.y = rotY;
    return m;
  }
  const neonSigns = [
    neonSign("AMMU'S CAFÉ", -6.35, 3.6, -22, '#ff5fa2', Math.PI / 2),
    neonSign('HOTEL MIDNIGHT', 6.35, 4.2, -41, '#5fc8ff', -Math.PI / 2),
  ];

  // Thattukada / pettikada: wooden stall with a clay-tile canopy and warm bulb.
  function makeStall(x, z, signMl, signEn, opts = {}) {
    const face = x > 0 ? -1 : 1;
    const g = new THREE.Group();
    g.position.set(x, 0, z);
    g.rotation.y = face > 0 ? Math.PI / 2 : -Math.PI / 2;
    scene.add(g);
    mesh(box(2.2, 1.0, 0.8), MAT.wood, 0, 0.5, 0.15, g);
    mesh(box(2.2, 0.06, 0.95), MAT.woodDark, 0, 1.03, 0.2, g);
    mesh(box(2.5, 2.3, 0.1), MAT.woodDark, 0, 1.15, -0.55, g);
    [[-1.15, 0.6], [1.15, 0.6], [-1.15, -0.5], [1.15, -0.5]].forEach(([px, pz]) => mesh(box(0.08, 2.35, 0.08), MAT.woodDark, px, 1.17, pz, g));
    const roof = mesh(box(3.1, 0.08, 2.3), tileMat(3, 2), 0, 2.45, 0.35, g);
    roof.rotation.x = 0.3;
    mesh(new THREE.SphereGeometry(0.07, 8, 6), new THREE.MeshBasicMaterial({ color: 0xffd9a0 }), 0, 2.08, 0.35, g);
    const bg = new THREE.Sprite(addGlow(0xffb35a, 0.9)); bg.scale.set(2.2, 2.2, 1); bg.position.set(0, 2.08, 0.35); g.add(bg);
    const chrome = std({ color: 0xcfcfcf, metalness: 1, roughness: 0.25, envMap: envNight });
    mesh(cyl(0.11, 0.13, 0.28, 12), chrome, -0.65, 1.2, 0.25, g);
    const glass = std({ color: 0xcfe8ff, transparent: true, opacity: 0.35, roughness: 0.05 });
    [0.05, 0.35, 0.65].forEach((px, i) => {
      mesh(cyl(0.1, 0.1, 0.26, 10), glass, px, 1.19, 0.3, g);
      mesh(cyl(0.085, 0.085, 0.16, 10), std({ color: [0xe0a040, 0xd05030, 0xf0d070][i], roughness: 0.6 }), px, 1.14, 0.3, g);
    });
    const bananas = new THREE.Group(); bananas.position.set(0.85, 1.75, 0.45); g.add(bananas);
    const bm = std({ color: 0xe8c43a, roughness: 0.6 });
    for (let i = 0; i < 7; i++) mesh(new THREE.SphereGeometry(0.06, 6, 4), bm, Math.cos(i) * 0.08, -i * 0.05, Math.sin(i) * 0.08, bananas).scale.set(0.7, 2.2, 0.7);
    const signT = textTex(512, 128, (c, w) => {
      c.fillStyle = opts.board || '#1d3f7a'; c.fillRect(0, 0, w, 128);
      c.strokeStyle = '#f5cd6e'; c.lineWidth = 6; c.strokeRect(5, 5, w - 10, 118);
      c.textAlign = 'center'; c.textBaseline = 'middle';
      c.fillStyle = '#ffe9a8'; fitText(c, signMl, w / 2, 48, w - 40, 700, 50, ML);
      c.fillStyle = '#ffffff'; fitText(c, signEn, w / 2, 98, w - 40, 600, 28, 'Poppins, sans-serif');
    });
    mesh(new THREE.PlaneGeometry(2.4, 0.6), new THREE.MeshBasicMaterial({ map: signT }), 0, 2.95, -0.3, g);
    mesh(box(1.4, 0.45, 0.35), MAT.woodDark, 0, 0.23, 1.05, g);
    const lampPos = V3(0, 2.0, 0.35); g.updateMatrixWorld(true); g.localToWorld(lampPos);
    lampRecord(lampPos, 0xffb35a, { intensity: 1.6, always: true });
    return g;
  }
  makeStall(4.95, -27, 'ചായ', 'CHAYA · TEA STALL');
  makeStall(-4.95, -46, 'തട്ടുകട', 'THATTUKADA', { board: '#6a1f2b' });
  [[6, -24], [6.5, -30], [-6.2, -49], [-6.6, -43]].forEach(([x, z], i) => (i % 2 ? bush(x, z, 0.7) : banana(x, z, 0.9)));

  /* ------------------------------------------------------------------
     The dropped paper
     ------------------------------------------------------------------ */
  const paperTex = canvasTex(128, 128, (g) => {
    g.fillStyle = '#f2e7cf'; g.fillRect(0, 0, 128, 128);
    g.strokeStyle = 'rgba(120,90,60,0.4)'; g.beginPath(); g.moveTo(64, 0); g.lineTo(64, 128); g.moveTo(0, 64); g.lineTo(128, 64); g.stroke();
    g.fillStyle = 'rgba(122,30,58,0.7)'; g.font = 'italic 20px serif'; g.fillText('V…', 18, 40);
  });
  const paper = new THREE.Group();
  const paperMesh = mesh(new THREE.PlaneGeometry(0.42, 0.32), std({ map: paperTex, roughness: 0.9, side: THREE.DoubleSide, emissive: 0x332a1a }), 0, 0, 0, paper);
  paperMesh.rotation.x = -Math.PI / 2 + 0.08;
  paper.position.set(0.5, 0.03, Z.paper);
  paper.rotation.y = 0.4;
  scene.add(paper);
  const paperGlow = new THREE.Sprite(addGlow(0xfff0c8, 0.5));
  paperGlow.scale.set(1.3, 1.3, 1); paperGlow.position.y = 0.1; paper.add(paperGlow);

  /* ------------------------------------------------------------------
     Stage 2: CUSAT entrance archway with the old iron gate
     ------------------------------------------------------------------ */
  function barDoor(width, height, mat, opts = {}) {
    const g = new THREE.Group();
    const dir = opts.dir;
    const n = Math.floor(width / (opts.spacing || 0.26));
    const barGeo = cyl(opts.bar || 0.035, opts.bar || 0.035, height, 6);
    const tipGeo = new THREE.ConeGeometry((opts.bar || 0.035) * 2.2, 0.22, 6);
    for (let i = 1; i <= n; i++) {
      const x = dir * (i * width / (n + 1));
      mesh(barGeo, mat, x, height / 2 + 0.05, 0, g);
      mesh(tipGeo, mat, x, height + 0.16, 0, g);
    }
    [0.35, height * 0.5, height - 0.12].forEach((y) => mesh(box(width, 0.09, 0.08), mat, dir * width / 2, y, 0, g));
    mesh(box(0.12, height, 0.12), mat, 0, height / 2, 0, g);
    mesh(box(0.1, height, 0.1), mat, dir * width, height / 2, 0, g);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(width * 0.22, 0.035, 6, 24), mat);
    ring.position.set(dir * width / 2, height * 0.72, 0); g.add(ring);
    return g;
  }

  const gate1 = {};
  {
    const z = Z.gate1;
    [-1, 1].forEach((s) => {
      mesh(box(1.5, 7.6, 1.5), MAT.cream, s * 4.2, 3.8, z);
      [1.0, 6.7].forEach((y) => mesh(box(1.62, 0.35, 1.62), MAT.maroon, s * 4.2, y, z));
      mesh(box(1.8, 0.3, 1.8), MAT.cream, s * 4.2, 7.75, z);
      mesh(box(12, 2.4, 0.6), MAT.cream, s * 11, 1.2, z);
      mesh(box(12, 0.18, 0.72), MAT.maroon, s * 11, 2.45, z);
      makeLamp(s * 5.8, z + 1.3, 0xffc27a, { h: 5.4, intensity: 1.9, flicker: s > 0 });
      palm(s * rand(8, 12), z - rand(3, 6));
      palm(s * rand(13, 17), z - rand(2, 8));
    });
    mesh(box(10, 1.6, 1.3), MAT.cream, 0, 8.4, z);
    mesh(box(10.2, 0.16, 1.4), MAT.maroon, 0, 7.62, z);
    const signTex = textTex(1024, 180, (g, w) => {
      g.fillStyle = '#f3e8cf'; g.fillRect(0, 0, w, 180);
      g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillStyle = '#7a1e28';
      fitText(g, 'കൊച്ചി ശാസ്ത്ര സാങ്കേതിക സർവ്വകലാശാല', w / 2, 54, w - 60, 700, 50, ML);
      fitText(g, 'COCHIN UNIVERSITY OF SCIENCE AND TECHNOLOGY', w / 2, 128, w - 50, 700, 46, 'Cinzel, Georgia, serif');
    });
    mesh(new THREE.PlaneGeometry(9.4, 1.4), new THREE.MeshBasicMaterial({ map: signTex, color: 0xd8d0c0 }), 0, 8.4, z + 0.66);
    const roofM = tileMat(6, 1);
    [-1, 1].forEach((s) => { const r = mesh(box(11, 0.12, 1.3), roofM, 0, 9.55, z + s * 0.5); r.rotation.x = s * 0.5; });
    mesh(box(11.2, 0.16, 0.16), MAT.maroon, 0, 9.9, z);
    gate1.left = barDoor(3.4, 3.3, MAT.iron, { dir: 1 });
    gate1.left.position.set(-3.45, 0, z);
    gate1.right = barDoor(3.4, 3.3, MAT.iron, { dir: -1 });
    gate1.right.position.set(3.45, 0, z);
    scene.add(gate1.left, gate1.right);
    const lock = new THREE.Group();
    const brass = std({ color: 0xb08a3a, metalness: 0.9, roughness: 0.35, envMap: envNight });
    mesh(box(0.34, 0.38, 0.14), brass, 0, 0, 0, lock);
    const sh = new THREE.Mesh(new THREE.TorusGeometry(0.12, 0.03, 6, 16, Math.PI), MAT.iron);
    sh.position.y = 0.19; lock.add(sh);
    gate1.lockMat = new THREE.MeshBasicMaterial({ color: 0xff3355 });
    mesh(new THREE.CircleGeometry(0.045, 12), gate1.lockMat, 0, 0.02, 0.075, lock);
    gate1.lockGlow = new THREE.Sprite(addGlow(0xff3355, 0.8));
    gate1.lockGlow.scale.set(0.8, 0.8, 1); gate1.lockGlow.position.z = 0.1; lock.add(gate1.lockGlow);
    lock.position.set(0, 1.6, z + 0.12);
    scene.add(lock);
    gate1.lock = lock;
  }

  /* ------------------------------------------------------------------
     Stage 3: river & drawbridge
     ------------------------------------------------------------------ */
  // Luminous teal river: self-lit base so it reads at night, plus animated
  // ripple normals so lamp and moon light glint across the surface.
  const riverTex = canvasTex(256, 256, (g, w, h) => {
    g.fillStyle = '#0e4d6e'; g.fillRect(0, 0, w, h);
    const tiled = (fn) => { for (const ox of [-w, 0, w]) for (const oy of [-h, 0, h]) fn(ox, oy); };
    for (let i = 0; i < 70; i++) {
      const x = Math.random() * w, y = Math.random() * h, r = rand(16, 46), light = Math.random() < 0.5;
      tiled((ox, oy) => {
        const gr = g.createRadialGradient(x + ox, y + oy, 0, x + ox, y + oy, r);
        gr.addColorStop(0, light ? 'rgba(46,150,178,0.4)' : 'rgba(5,36,58,0.45)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
        g.fillStyle = gr; g.fillRect(x + ox - r, y + oy - r, r * 2, r * 2);
      });
    }
    for (let i = 0; i < 300; i++) {
      const x = Math.random() * w, y = Math.random() * h, l = rand(6, 26);
      g.strokeStyle = `rgba(${140 + Math.random() * 90 | 0},${225 + Math.random() * 30 | 0},255,${rand(0.08, 0.38)})`;
      g.lineWidth = rand(0.6, 1.8);
      tiled((ox, oy) => { g.beginPath(); g.ellipse(x + ox, y + oy, l, l * 0.16, 0, 0, Math.PI * 2); g.stroke(); });
    }
  }, true);
  riverTex.repeat.set(24, 3);
  const riverTime = { value: 0 };
  const riverMat = envStd({ color: 0x8fa8b8, map: riverTex, emissive: 0xffffff, emissiveMap: riverTex, emissiveIntensity: 0.68, roughness: 0.17, metalness: 0.4, envMapIntensity: 1.6 });
  riverMat.onBeforeCompile = (shader) => {
    shader.uniforms.uRiverT = riverTime;
    shader.vertexShader = 'varying vec3 vRiverW;\n' + shader.vertexShader.replace('#include <project_vertex>', '#include <project_vertex>\n  vRiverW = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    shader.fragmentShader = 'uniform float uRiverT;\nvarying vec3 vRiverW;\n' + shader.fragmentShader.replace('#include <normal_fragment_maps>', [
      '#include <normal_fragment_maps>',
      '{',
      '  vec2 p = vRiverW.xz;',
      '  vec2 s = vec2(0.8, 0.3) * cos(dot(p, vec2(0.8, 0.3)) * 1.9 + uRiverT * 1.7) * 0.5',
      '         + vec2(-0.45, 0.9) * cos(dot(p, vec2(-0.45, 0.9)) * 3.1 + uRiverT * 2.3) * 0.32',
      '         + vec2(0.7, -0.6) * cos(dot(p, vec2(0.7, -0.6)) * 6.2 + uRiverT * 3.4) * 0.18;',
      '  normal = normalize((viewMatrix * vec4(normalize(vec3(-s.x * 0.22, 1.0, -s.y * 0.22)), 0.0)).xyz);',
      '}',
    ].join('\n'));
  };
  const water = mesh(new THREE.PlaneGeometry(260, Z.riverStart - Z.riverEnd + 2), riverMat, 0, -1.6, (Z.riverStart + Z.riverEnd) / 2);
  water.rotation.x = -Math.PI / 2;
  [Z.riverStart, Z.riverEnd].forEach((z, i) => mesh(box(260, 4, 1), MAT.laterite, 0, -2.02, z + (i ? -0.5 : 0.5)));
  // Warm lamp light spilling onto the water beside the bridge (faded in by updateLamps).
  function riverReflection(rec, x, z, color) {
    const m = new THREE.MeshBasicMaterial({ map: glowTex, color, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, fog: false });
    const s = mesh(LAMP.plane, m, x, -1.57, z); s.rotation.x = -Math.PI / 2; s.scale.set(2.4, 6.5, 1);
    rec.reflMat = m; rec.reflBase = 0.3;
  }
  const bridgeLamps = [];
  const bridgePivot = new THREE.Group();
  bridgePivot.position.set(0, 0, Z.riverStart);
  scene.add(bridgePivot);
  {
    const deckLen = Z.riverStart - Z.riverEnd + 0.4;
    const deckTex = woodTex.clone(); deckTex.needsUpdate = true; deckTex.repeat.set(1, 6);
    mesh(box(4.4, 0.35, deckLen), std({ color: 0xa88866, map: deckTex, roughness: 0.8 }), 0, -0.175, -deckLen / 2, bridgePivot);
    for (const s of [-1, 1]) {
      for (let z = -0.5; z > -deckLen; z -= 2) mesh(box(0.1, 1, 0.1), MAT.iron, s * 2.1, 0.5, z, bridgePivot);
      mesh(box(0.08, 0.08, deckLen), MAT.iron, s * 2.1, 1.0, -deckLen / 2, bridgePivot);
      mesh(box(0.8, 0.5, 0.6), MAT.metalDark, s * 1.6, 0.25, -deckLen + 0.4, bridgePivot);
    }
    // Lantern posts along both deck edges, near-to-far pairs; dark until the bridge is down.
    const LH = 3.2, lampCol = 0xffd89a;
    for (let i = 0; i < 3; i++) {
      for (const s of [-1, 1]) {
        const lz = -deckLen * (2 * i + 1) / 6;
        const g = new THREE.Group(); g.position.set(s * 2.25, 0, lz); bridgePivot.add(g);
        const pole = mesh(LAMP.pole, MAT.metalDark, 0, LH / 2, 0, g); pole.scale.y = LH;
        mesh(LAMP.base, MAT.metalDark, 0, 0.22, 0, g);
        mesh(LAMP.shade, MAT.metalDark, 0, LH + 0.3, 0, g);
        const bulbMat = new THREE.MeshBasicMaterial({ color: C(lampCol).multiplyScalar(1.6) });
        mesh(LAMP.bulb, bulbMat, 0, LH + 0.08, 0, g);
        const glow = new THREE.Sprite(addGlow(lampCol, 0)); glow.scale.set(2.8, 2.8, 1); glow.position.set(0, LH + 0.08, 0); g.add(glow);
        const coneMat = new THREE.MeshBasicMaterial({ color: lampCol, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
        const cone = mesh(LAMP.cone, coneMat, 0, LH / 2, 0, g); cone.scale.set(0.5, LH, 0.5);
        const poolMat = new THREE.MeshBasicMaterial({ map: glowTex, color: lampCol, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false });
        const pl = mesh(LAMP.plane, poolMat, -s * 1.1, 0.03, 0, g); pl.rotation.x = -Math.PI / 2; pl.scale.set(2.6, 4.2, 1);
        const rec = lampRecord(V3(s * 2.25, LH, Z.riverStart + lz), lampCol, { intensity: 1.9, onAt: 9, coneBase: 0.05, glow, bulbMat, coneMat, poolMat, baseBulb: bulbMat.color.clone() });
        riverReflection(rec, s * 3.2, Z.riverStart + lz + 1.2, lampCol);
        bridgeLamps.push(rec);
      }
    }
    bridgePivot.rotation.x = Math.PI / 2 * 0.96;
    for (const s of [-1, 1]) {
      mesh(box(0.9, 5.4, 0.9), MAT.stone, s * 2.95, 2.7, Z.riverStart + 1.2);
      mesh(box(1.1, 0.25, 1.1), MAT.stone, s * 2.95, 5.5, Z.riverStart + 1.2);
      makeLamp(s * 2.95, Z.riverStart + 1.21, 0xffc88a, { h: 5.8, intensity: 1.7 });
      mesh(box(1.2, 1.2, 1.2), MAT.stone, s * 2.95, 0.3, Z.riverEnd - 0.6);
    }
    const post = new THREE.Group();
    post.position.set(2.2, 0, Z.bridgeStop - 0.6);
    mesh(box(0.2, 1.1, 0.2), MAT.metalDark, 0, 0.55, 0, post);
    mesh(box(0.6, 0.45, 0.25), MAT.metalDark, 0, 1.25, 0, post);
    const lamp = new THREE.MeshBasicMaterial({ color: 0xff3355 });
    mesh(new THREE.SphereGeometry(0.06, 8, 6), lamp, 0, 1.3, 0.14, post);
    const glow = new THREE.Sprite(addGlow(0xff3355, 0.7)); glow.scale.set(0.7, 0.7, 1); glow.position.set(0, 1.3, 0.16); post.add(glow);
    scene.add(post);
    bridgePivot.userData = { panelMat: lamp, panelGlow: glow, deckLen };
  }
  const chainGeo = [];
  for (const s of [-1, 1]) {
    const g = new THREE.BufferGeometry().setFromPoints([V3(), V3()]);
    scene.add(new THREE.Line(g, new THREE.LineBasicMaterial({ color: 0x4a4a50 })));
    chainGeo.push({ g, s });
  }
  const _tmp = V3();
  function updateChains() {
    for (const c of chainGeo) {
      const p = c.g.attributes.position;
      p.setXYZ(0, c.s * 2.8, 5.2, Z.riverStart + 1.0);
      _tmp.set(c.s * 2.0, 0.6, -bridgePivot.userData.deckLen + 0.6);
      bridgePivot.localToWorld(_tmp);
      p.setXYZ(1, _tmp.x, _tmp.y, _tmp.z);
      p.needsUpdate = true;
    }
  }
  // Moonlight glitter path: a sparkling strip on the water that always runs from
  // the viewer toward the moon, fading in once night falls over the river.
  const moonGlitter = (() => {
    const tex = canvasTex(128, 128, (g, w, h) => {
      g.fillStyle = '#000'; g.fillRect(0, 0, w, h);
      for (let i = 0; i < 150; i++) {
        const x = Math.random() * w, y = Math.random() * h, l = rand(2, 10), t = rand(1, 2.2);
        g.fillStyle = `rgba(225,238,255,${rand(0.35, 1)})`;
        for (const ox of [-w, 0, w]) for (const oy of [-h, 0, h]) g.fillRect(x + ox - l / 2, y + oy, l, t);
      }
    }, true);
    tex.repeat.set(3, 9);
    const geo = new THREE.PlaneGeometry(1, 1, 6, 12);
    const pos = geo.attributes.position, cols = new Float32Array(pos.count * 3);
    for (let i = 0; i < pos.count; i++) {
      const u = pos.getX(i) * 2, t = pos.getY(i) + 0.5;
      pos.setX(i, pos.getX(i) * lerp(0.35, 1, t));
      const c = smooth(0, 0.12, t) * (1 - smooth(0.7, 1, t)) * Math.pow(Math.max(0, 1 - u * u), 1.5);
      cols[i * 3] = cols[i * 3 + 1] = cols[i * 3 + 2] = c;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(cols, 3));
    geo.rotateX(-Math.PI / 2);
    const m = mesh(geo, new THREE.MeshBasicMaterial({ map: tex, vertexColors: true, color: 0xd2e2ff, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }), 0, -1.56, 0);
    m.scale.set(9, 1, 34);
    m.rotation.y = Math.atan2(-moonDir.x, -moonDir.z);
    m.visible = false;
    return m;
  })();
  function updateRiverFx(dt) {
    riverTime.value = S.t;
    riverTex.offset.x += dt * 0.012; riverTex.offset.y -= dt * 0.03;
    const near = smooth(Z.riverEnd - 16, Z.riverEnd - 6, camera.position.z) * (1 - smooth(Z.riverStart + 22, Z.riverStart + 34, camera.position.z));
    const a = 0.6 * near * smooth(0.55, 0.9, atmo.tod) * (1 - atmo.storm);
    moonGlitter.visible = a > 0.01;
    if (!moonGlitter.visible) return;
    const dx = -Math.sin(moonGlitter.rotation.y), dz = -Math.cos(moonGlitter.rotation.y);
    moonGlitter.position.set(camera.position.x + dx * 19, -1.56, camera.position.z + dz * 19);
    moonGlitter.material.opacity = a * (0.85 + Math.sin(S.t * 2.3) * 0.1 + Math.sin(S.t * 5.1) * 0.05);
    moonGlitter.material.map.offset.x += dt * 0.04;
    moonGlitter.material.map.offset.y -= dt * 0.11;
  }

  // Palms leaning over the river banks
  for (const zRange of [[-70, Z.riverStart + 1.5], [Z.riverEnd - 1.5, -130]]) {
    for (let z = zRange[0]; z > zRange[1]; z -= rand(3, 6) / DENSITY) {
      for (const s of [-1, 1]) {
        if (Math.random() < 0.7) palm(s * rand(6.5, 14), z, { ry: z > -100 ? Math.PI / 2 + rand(-0.6, 0.6) : -Math.PI / 2 + rand(-0.6, 0.6) });
        else if (Math.random() < 0.5) banana(s * rand(6.5, 10), z); else bush(s * rand(6, 9), z);
      }
    }
  }

  /* ------------------------------------------------------------------
     Mountains, hill road foliage, canyon
     ------------------------------------------------------------------ */
  for (let z = -131; z > Z.canyonStart + 1; z -= rand(3, 5.5) / DENSITY) {
    const r = Math.random();
    const xL = -rand(6.2, 15);
    if (r < 0.55) palm(xL, z); else if (r < 0.8) banana(xL, z); else bush(xL, z);
    if (z < -148) { if (Math.random() < 0.5) palm(rand(19, 26), z); continue; }
    if (Math.abs(z - Z.shelter) < 4) continue;
    const xR = rand(6.2, 15);
    if (r < 0.5) palm(xR, z); else if (r < 0.75) bush(xR, z); else banana(xR, z);
  }
  const mountainMat = new THREE.MeshBasicMaterial({ color: 0x0c1428, fog: false });
  const mountainMat2 = new THREE.MeshBasicMaterial({ color: 0x111b35, fog: false });
  for (let i = 0; i < 36; i++) {
    const side = i % 2 ? 1 : -1;
    const far = Math.random() < 0.5;
    const r = rand(40, 80) * (far ? 1.4 : 1), h = rand(45, 95) * (far ? 1.3 : 1);
    const m = mesh(new THREE.ConeGeometry(r, h, 6), far ? mountainMat2 : mountainMat, side * rand(110, 190) * (far ? 1.5 : 1), h / 2 - 25, rand(-130, -700));
    m.rotation.y = Math.random();
    m.renderOrder = -5;
  }
  [Z.canyonStart - 1, Z.canyonEnd + 1].forEach((z) => {
    mesh(box(260, 90, 2), MAT.rock, 0, -45, z);
    for (let i = 0; i < 18; i++) {
      const r = mesh(new THREE.DodecahedronGeometry(rand(0.5, 1.6)), MAT.rock, rand(-40, 40), rand(-0.3, 0.3), z + (z > -200 ? rand(-0.5, 1.5) : rand(-1.5, 0.5)));
      r.rotation.set(Math.random(), Math.random(), Math.random());
      if (Math.abs(r.position.x) < 5.5) r.position.x += Math.sign(r.position.x || 1) * 6;
    }
  });
  for (let i = 0; i < 30; i++) {
    const side = i % 2 ? 1 : -1;
    const w = rand(10, 26), h = rand(40, 90);
    const r = mesh(new THREE.DodecahedronGeometry(1, 0), MAT.rock, side * rand(30, 70), -h * 0.45 + rand(-10, 4), rand(Z.canyonStart - 8, Z.canyonEnd + 8));
    r.scale.set(w / 2, h / 2, rand(6, 13));
    r.rotation.y = Math.random() * Math.PI;
  }
  const abyss = mesh(new THREE.PlaneGeometry(260, Z.canyonStart - Z.canyonEnd), new THREE.MeshBasicMaterial({ color: 0x1a3060 }), 0, -85, (Z.canyonStart + Z.canyonEnd) / 2);
  abyss.rotation.x = -Math.PI / 2;
  const mistLayers = [];
  [-9, -22, -40].forEach((y, i) => {
    const t = mistTex.clone(); t.needsUpdate = true; t.repeat.set(4, 2);
    const m = mesh(new THREE.PlaneGeometry(260, Z.canyonStart - Z.canyonEnd), new THREE.MeshBasicMaterial({ map: t, transparent: true, opacity: 0.32 - i * 0.08, depthWrite: false, color: 0x8a98c0 }), 0, y, (Z.canyonStart + Z.canyonEnd) / 2);
    m.rotation.x = -Math.PI / 2;
    mistLayers.push({ t, s: 0.004 + i * 0.002 });
  });
  const streetMist = [];
  for (let i = 0; i < 22; i++) {
    const z = i < 9 ? -20 - i * 11 : i < 14 ? -125 - (i - 9) * 9 : -300 - (i - 14) * 30;
    const m = mesh(new THREE.PlaneGeometry(26, 6.5), new THREE.MeshBasicMaterial({ map: mistSheetTex, transparent: true, opacity: 0.5, depthWrite: false, color: 0x9aa6c8 }), roadX(z) + rand(-3, 3), 1.8, z);
    streetMist.push({ m, x0: m.position.x, p: Math.random() * 6 });
  }

  /* ------------------------------------------------------------------
     Stage 4: pettikada bus shelter with the black kuda
     ------------------------------------------------------------------ */
  const shelter = makeStall(4.95, Z.shelter, 'പെട്ടിക്കട', 'BUS STOP · PETTIKADA', { board: '#20603a' });
  {
    const bs = new THREE.Group(); bs.position.set(4.6, 0, Z.shelter + 2.6); scene.add(bs);
    mesh(cyl(0.04, 0.04, 2.6, 6), MAT.metalDark, 0, 1.3, 0, bs);
    const t = textTex(128, 128, (g) => {
      g.fillStyle = '#f4f0e0'; g.beginPath(); g.arc(64, 64, 60, 0, Math.PI * 2); g.fill();
      g.strokeStyle = '#1d4f9a'; g.lineWidth = 8; g.stroke();
      g.fillStyle = '#1d4f9a'; g.font = '700 30px Poppins, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText('BUS', 64, 50); g.fillText('STOP', 64, 82);
    });
    mesh(new THREE.CircleGeometry(0.4, 20), new THREE.MeshBasicMaterial({ map: t, side: THREE.DoubleSide }), 0, 2.6, 0, bs).rotation.y = -Math.PI / 2;
  }
  function setUmbrellaOpen(u, k) {
    const c = u.userData.canopy;
    const r = lerp(0.14, 1, k);
    c.scale.set(r, lerp(2.2, 1, k), r);
    c.position.y = lerp(0.72, 0.98, k);
  }
  function makeUmbrella(closed) {
    const g = new THREE.Group();
    const cloth = std({ color: 0x0b0b0d, roughness: 0.55, side: THREE.DoubleSide });
    const dark = std({ color: 0x2a2320, roughness: 0.6, metalness: 0.3 });
    mesh(cyl(0.013, 0.013, 0.98, 6), dark, 0, 0.49, 0, g);
    const handle = new THREE.Mesh(new THREE.TorusGeometry(0.055, 0.016, 6, 12, Math.PI), std({ color: 0x3a2414, roughness: 0.7 }));
    handle.rotation.z = Math.PI; handle.position.set(-0.055, 0, 0); g.add(handle);
    const canopy = new THREE.Group(); canopy.position.y = 0.98; g.add(canopy);
    mesh(new THREE.ConeGeometry(0.88, 0.34, 10, 1, true), cloth, 0, 0, 0, canopy);
    mesh(cyl(0.01, 0.01, 0.14, 4), dark, 0, 0.22, 0, canopy);
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2;
      const rib = mesh(box(0.012, 0.012, 0.9), dark, Math.cos(a) * 0.44, -0.01, Math.sin(a) * 0.44, canopy);
      rib.rotation.y = -a + Math.PI / 2; rib.rotation.x = 0.36;
    }
    g.userData.canopy = canopy;
    setUmbrellaOpen(g, closed ? 0 : 1);
    return g;
  }
  const worldUmbrella = makeUmbrella(true);
  worldUmbrella.position.set(-0.95, 0.02, 0.75);
  worldUmbrella.rotation.z = 0.25;
  shelter.add(worldUmbrella);
  const umbGlow = new THREE.Sprite(addGlow(0xfff0c8, 0.4)); umbGlow.scale.set(1.2, 1.2, 1); umbGlow.position.set(-0.95, 0.9, 0.75); shelter.add(umbGlow);

  /* ------------------------------------------------------------------
     Ropeway
     ------------------------------------------------------------------ */
  const panelState = {};
  function station(z, withLock) {
    const g = new THREE.Group();
    g.position.set(0, 0, z);
    scene.add(g);
    mesh(box(9, 0.14, 7.5), MAT.stone, 0, 0.07, 0, g);
    [[-4, -3.4], [4, -3.4], [-4, 3.4], [4, 3.4]].forEach(([x, zz]) => mesh(box(0.35, 7.8, 0.35), MAT.metalDark, x, 3.9, zz, g));
    mesh(box(10, 0.4, 8.4), tileMat(5, 4), 0, 8, 0, g);
    const wheel = new THREE.Mesh(new THREE.TorusGeometry(1.2, 0.12, 8, 24), MAT.iron);
    wheel.rotation.x = Math.PI / 2;
    wheel.position.set(0, 7.4, 0); g.add(wheel);
    const signTex = textTex(512, 128, (c, w, h) => {
      c.fillStyle = '#10131f'; c.fillRect(0, 0, w, h);
      c.strokeStyle = '#ffcf6e'; c.lineWidth = 6; c.strokeRect(6, 6, w - 12, h - 12);
      c.fillStyle = '#ffe3a3'; c.font = '700 60px Cinzel, serif'; c.textAlign = 'center'; c.textBaseline = 'middle';
      c.shadowColor = '#ffb347'; c.shadowBlur = 18;
      c.fillText('ROPEWAY', w / 2, h / 2 + 4);
    });
    mesh(new THREE.PlaneGeometry(4.2, 1.05), new THREE.MeshBasicMaterial({ map: signTex }), 0, 6.8, 3.8, g);
    makeLamp(-4.3, z + 3.2, 0xffe0b0, { h: 5, intensity: 2 });
    if (withLock) {
      const post = new THREE.Group();
      post.position.set(1.9, 0, Z.stationLock - z - 0.4);
      mesh(box(0.25, 1.2, 0.25), MAT.metalDark, 0, 0.6, 0, post);
      mesh(box(0.7, 0.9, 0.2), MAT.metalDark, 0, 1.5, 0, post);
      const scr = new THREE.MeshBasicMaterial({ color: 0xff3355 });
      mesh(new THREE.PlaneGeometry(0.5, 0.3), scr, 0, 1.62, 0.11, post);
      mesh(new THREE.PlaneGeometry(0.46, 0.3), new THREE.MeshBasicMaterial({ color: 0x2a3550 }), 0, 1.25, 0.11, post);
      const glow = new THREE.Sprite(addGlow(0xff3355, 0.7)); glow.scale.set(1, 1, 1); glow.position.set(0, 1.62, 0.2); post.add(glow);
      g.add(post);
      panelState.mat = scr; panelState.glow = glow;
    }
  }
  station(Z.station1, true);
  station(Z.station2, false);
  const CABLE_Y = 7.4;
  {
    const midZ = (Z.canyonStart + Z.canyonEnd) / 2;
    const TX = -4.5;
    for (let i = 0; i < 4; i++) {
      const x = TX + (i % 2 ? 1.2 : -1.2), zz = i < 2 ? midZ - 1.2 : midZ + 1.2;
      mesh(box(0.3, 100, 0.3), MAT.metalDark, x, CABLE_Y - 49, zz);
    }
    for (let y = CABLE_Y - 3; y > -80; y -= 6) mesh(box(2.8, 0.15, 2.8), MAT.metalDark, TX, y, midZ);
    mesh(box(5.6, 0.4, 0.5), MAT.metalDark, TX + 2.3, CABLE_Y + 0.75, midZ);
    mesh(box(0.3, 0.9, 0.3), MAT.metalDark, 0, CABLE_Y + 0.45, midZ);
    const blink = new THREE.Sprite(addGlow(0xff2020, 0.9)); blink.scale.set(1.6, 1.6, 1); blink.position.set(TX, CABLE_Y + 1.4, midZ); scene.add(blink);
    panelState.blink = blink;
    const cableMat = std({ color: 0x777777, metalness: 0.9, roughness: 0.4 });
    const seg = (z0, z1) => {
      const c = mesh(cyl(0.035, 0.035, Math.abs(z1 - z0), 5), cableMat, 0, CABLE_Y, (z0 + z1) / 2);
      c.rotation.x = Math.PI / 2;
    };
    seg(Z.station1, midZ); seg(midZ, Z.station2);
  }
  const car = new THREE.Group();
  {
    const red = std({ color: 0xb3262e, roughness: 0.4, metalness: 0.5, envMap: envNight });
    mesh(box(2.4, 0.12, 2.4), MAT.metalDark, 0, 0.06, 0, car);
    [-1, 1].forEach((s) => mesh(box(0.08, 1.0, 2.4), red, s * 1.2, 0.6, 0, car));
    mesh(box(2.4, 1.0, 0.08), red, 0, 0.6, -1.2, car);
    [[-1.15, -1.15], [1.15, -1.15], [-1.15, 1.15], [1.15, 1.15]].forEach(([x, z]) => mesh(box(0.1, 1.45, 0.1), red, x, 1.8, z, car));
    mesh(box(2.6, 0.18, 2.6), red, 0, 2.58, 0, car);
    const glass = std({ color: 0xa8d0ff, transparent: true, opacity: 0.1, roughness: 0.05, metalness: 0.3, depthWrite: false, envMap: envNight });
    mesh(box(2.34, 1.4, 2.34), glass, 0, 1.8, 0, car);
    mesh(box(0.12, CABLE_Y - 2.7, 0.12), MAT.metalDark, 0, (CABLE_Y + 2.7) / 2, 0, car);
    mesh(box(0.34, 0.34, 1.0), MAT.metalDark, 0, CABLE_Y, 0, car);
    const light = new THREE.Sprite(addGlow(0xfff0d0, 0.6)); light.scale.set(1.4, 1.4, 1); light.position.set(0, 2.4, 0); car.add(light);
  }
  car.position.set(0, 0, Z.station1 - 2.2);
  scene.add(car);

  /* ------------------------------------------------------------------
     Stage 5: backwater ride - water, houseboats, houses, palms
     ------------------------------------------------------------------ */
  const backwaterTex = waterTex.clone(); backwaterTex.needsUpdate = true; backwaterTex.repeat.set(20, 30);
  {
    const L = Z.waterStart - Z.waterEnd, cz = (Z.waterStart + Z.waterEnd) / 2;
    const bw = mesh(new THREE.PlaneGeometry(150, L), envStd({ color: 0x5a7aa8, map: backwaterTex, roughness: 0.06, metalness: 0.9, envMapIntensity: 1.5 }), -99, -0.45, cz);
    bw.rotation.x = -Math.PI / 2;
    mesh(box(1.2, 1.4, L), MAT.laterite, -24.4, -0.7, cz);
    const streakM = new THREE.MeshBasicMaterial({ map: glowTex, color: 0xaabbff, transparent: true, opacity: 0.25, blending: THREE.AdditiveBlending, depthWrite: false });
    for (const z of [-360, -470]) {
      const s = mesh(LAMP.plane, streakM, -70, -0.4, z); s.rotation.x = -Math.PI / 2; s.rotation.z = -0.42; s.scale.set(5, 90, 1);
    }
    const hull = std({ color: 0x3a2616, roughness: 0.8 }), thatch = std({ color: 0x8a6a3a, roughness: 1, side: THREE.DoubleSide });
    [[-48, -340], [-72, -420], [-58, -505], [-95, -380]].forEach(([x, z]) => {
      const b = new THREE.Group(); b.position.set(x, -0.35, z); b.rotation.y = rand(-0.4, 0.4); scene.add(b);
      mesh(box(1.8, 0.6, 9), hull, 0, 0, 0, b);
      [-1, 1].forEach((s) => { const tip = mesh(new THREE.ConeGeometry(0.9, 2.2, 4), hull, 0, 0.3, s * 5.3, b); tip.rotation.x = s * Math.PI / 2 * 0.75; tip.scale.set(1, 1, 0.35); });
      const roof = mesh(new THREE.CylinderGeometry(1.1, 1.1, 5.5, 12, 1, true, 0, Math.PI), thatch, 0, 0.35, 0, b);
      roof.rotation.x = Math.PI / 2; roof.rotation.y = Math.PI / 2;
      const lg = new THREE.Sprite(addGlow(0xffb050, 0.95)); lg.scale.set(2.4, 2.4, 1); lg.position.set(0, 1.0, 2.9); b.add(lg);
      const rs = mesh(LAMP.plane, new THREE.MeshBasicMaterial({ map: glowTex, color: 0xffa040, transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, depthWrite: false }), 0, -0.05, 6, b);
      rs.rotation.x = -Math.PI / 2; rs.scale.set(1.4, 7, 1);
    });
  }
  function keralaHouse(x, z) {
    const g = new THREE.Group(); g.position.set(x, 0, z); g.rotation.y = -Math.PI / 2 + rand(-0.2, 0.2); scene.add(g);
    const wallM = std({ color: pick([0xeee0bc, 0xdde8d2, 0xf2d6c4, 0xe8e0f0]), roughness: 0.9 });
    mesh(box(6, 2.8, 4.6), wallM, 0, 1.4, 0, g);
    const roof = mesh(new THREE.ConeGeometry(4.9, 2.2, 4), tileMat(4, 2), 0, 3.9, 0, g);
    roof.rotation.y = Math.PI / 4; roof.scale.set(1.3, 1, 1);
    mesh(box(6.4, 0.12, 2), tileMat(3, 1), 0, 2.7, 3.1, g).rotation.x = 0.25;
    [-2.6, 2.6].forEach((px) => mesh(cyl(0.1, 0.1, 2.5, 8), MAT.cream, px, 1.25, 3.8, g));
    mesh(box(1, 2, 0.06), MAT.woodDark, 0, 1, 2.33, g);
    const winM = new THREE.MeshBasicMaterial({ color: 0xffc070 });
    [-1.9, 1.9].forEach((px) => { if (Math.random() < 0.75) mesh(new THREE.PlaneGeometry(0.9, 0.8), winM, px, 1.5, 2.32, g); });
    const lg = new THREE.Sprite(addGlow(0xffa050, 0.55)); lg.scale.set(3, 3, 1); lg.position.set(0, 2.2, 3.4); g.add(lg);
  }
  // Rustic tiled houses start after the modern Zone 1 metro corridor.
  for (let z = Z.metroEnd; z > Z.finalGate + 90; z -= rand(18, 28)) keralaHouse(roadX(z) + rand(17, 24), z);
  for (let z = Z.canyonEnd - 4; z > Z.finalGate + 70; z -= rand(4.5, 7.5) / DENSITY) {
    const rx = roadX(z);
    if (z < Z.waterStart && z > Z.waterEnd) palm(rand(-26, -22), z, { ry: Math.PI + rand(-0.5, 0.5), s: rand(1, 1.3) });
    else palm(rx - rand(7, 11), z);
    const r = Math.random();
    if (r < 0.55) palm(rx + rand(7, 12), z); else if (r < 0.8) banana(rx + rand(6.5, 10), z); else bush(rx + rand(6, 9), z);
    if (Math.random() < 0.5) bush(rx - rand(6, 8), z + rand(-2, 2), rand(0.5, 0.9));
  }

  /* ------------------------------------------------------------------
     Bike ride: three seamless Kochi night-drive zones
     Zone 1 Edappally/Metro corridor -> Zone 2 Marine Drive -> Zone 3 Kadamakkudy
     ------------------------------------------------------------------ */
  const concreteMat = std({ color: 0xb7b3a9, roughness: 0.92 });
  const metroDarkMat = std({ color: 0x22242b, roughness: 0.6, metalness: 0.3 });
  const METRO_Y = 9.4, metroOffset = 6.4;

  // --- Zone 1: Edappally / Lulu & Metro corridor ---
  {
    const dz0 = Z.rideStart + 6, dz1 = Z.metroEnd - 6;
    // Elevated concrete metro deck on pillars, following the road curve.
    ribbon(dz0, dz1, metroOffset - 1.8, metroOffset + 1.8, METRO_Y, concreteMat, 22);
    ribbon(dz0, dz1, metroOffset - 1.95, metroOffset - 1.7, METRO_Y + 0.06, metroDarkMat, 22);
    ribbon(dz0, dz1, metroOffset + 1.7, metroOffset + 1.95, METRO_Y + 0.06, metroDarkMat, 22);
    for (let z = dz0, i = 0; z > dz1; z -= 17, i++) {
      const px = roadX(z) + metroOffset;
      mesh(box(0.85, METRO_Y - 0.35, 0.85), concreteMat, px, (METRO_Y - 0.35) / 2, z);
      mesh(box(3.2, 0.5, 1.15), concreteMat, px, METRO_Y - 0.3, z);
    }
    // Modern low-poly buildings with glowing windows (reuses the town's building()).
    for (let z = Z.rideStart - 4, i = 0; z > Z.metroEnd + 6; z -= rand(15, 21), i++) {
      const side = i % 2 ? 1 : -1, w = rand(6, 10), d = rand(7, 12), h = rand(15, 32);
      const off = side > 0 ? metroOffset + 7 + w / 2 : 9 + w / 2;
      building(roadX(z) + side * off, z - d / 2, w, d, h);
    }
    // A few pillars carry pinned movie posters, like a real metro corridor.
    function makeMoviePosterTex(d) {
      const W = 300, H = 420;
      return textTex(W, H, (g) => {
        const grad = g.createLinearGradient(0, 0, 0, H);
        grad.addColorStop(0, d.top); grad.addColorStop(1, d.bottom);
        g.fillStyle = grad; g.fillRect(0, 0, W, H);
        g.fillStyle = d.accent; g.globalAlpha = 0.5;
        g.beginPath(); g.ellipse(W / 2, H * 0.4, W * 0.34, H * 0.24, 0, 0, Math.PI * 2); g.fill();
        g.globalAlpha = 1;
        g.fillStyle = '#ffe066';
        g.beginPath(); g.arc(W - 44, 44, 28, 0, Math.PI * 2); g.fill();
        g.fillStyle = '#3a2a00'; g.font = '700 15px Poppins, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
        g.fillText('★ HIT', W - 44, 44);
        g.strokeStyle = 'rgba(255,255,255,0.55)'; g.lineWidth = 5; g.strokeRect(7, 7, W - 14, H - 14);
        g.textBaseline = 'alphabetic';
        g.shadowColor = 'rgba(0,0,0,0.65)'; g.shadowBlur = 10;
        g.fillStyle = '#ffffff';
        fitText(g, d.title, W / 2, H * 0.72, W - 30, 800, 44, 'Cinzel, Georgia, serif');
        g.shadowBlur = 0;
        g.fillStyle = d.accent;
        fitText(g, d.tagline, W / 2, H * 0.83, W - 40, 600, 17, 'Poppins, sans-serif');
      });
    }
    const MOVIE_POSTERS = [
      { title: 'MONSOON NIGHTS', tagline: 'A LOVE STORY BY THE BACKWATERS', top: '#5a1030', bottom: '#1a0510', accent: '#ff5f95' },
      { title: 'MIDNIGHT RIDER', tagline: 'ONE NIGHT. ONE ROAD. NO LOOKING BACK.', top: '#0a1a3a', bottom: '#020610', accent: '#5fc8ff' },
      { title: 'MARINE DRIVE', tagline: 'WHERE THE CITY MEETS THE SEA', top: '#0a3a3a', bottom: '#021010', accent: '#4dd0e1' },
      { title: 'KOCHI EXPRESS', tagline: 'HOLD ON TIGHT', top: '#4a2a05', bottom: '#160c02', accent: '#ffb347' },
    ];
    {
      let pi = 0;
      for (let z = dz0, i = 0; z > dz1; z -= 17, i++) {
        if (i % 2 !== 0) continue;
        const px = roadX(z) + metroOffset;
        const tex = makeMoviePosterTex(MOVIE_POSTERS[pi % MOVIE_POSTERS.length]);
        pi++;
        const poster = mesh(new THREE.PlaneGeometry(0.75, 1.05), new THREE.MeshBasicMaterial({ map: tex }), px - 0.46, 1.75, z);
        poster.rotation.y = -Math.PI / 2;
      }
    }
    // LuLu billboard on a support frame.
    const luluZ = Z.rideStart - 34, luluX = roadX(luluZ) - 9.5;
    [-1.6, 1.6].forEach((dx) => mesh(box(0.22, 6.6, 0.22), MAT.metalDark, luluX + dx, 3.3, luluZ));
    mesh(box(3.6, 0.2, 0.2), MAT.metalDark, luluX, 6.4, luluZ);
    const lulu = neonSign('LULU', luluX, 6.2, luluZ, '#ff2222', Math.PI / 2);
    lulu.scale.set(1.9, 2.4, 1);
    const luluGlow = new THREE.Sprite(addGlow(0xff3030, 0.7));
    luluGlow.scale.set(6, 3, 1); luluGlow.position.set(luluX, 6.2, luluZ); scene.add(luluGlow);
  }
  // A glowing Kochi Metro train that glides back and forth over Zone 1.
  function makeMetroTrain() {
    const g = new THREE.Group();
    const bodyMat = std({ color: 0x33507a, roughness: 0.35, metalness: 0.55 });
    const stripeMat = new THREE.MeshBasicMaterial({ color: 0xfff2b8 });
    for (let i = 0; i < 3; i++) {
      const car = new THREE.Group(); car.position.z = i * 3.6; g.add(car);
      mesh(box(1.9, 1.15, 3.3), bodyMat, 0, 0.75, 0, car);
      mesh(box(1.94, 0.32, 2.9), stripeMat, 0, 0.85, 0, car);
    }
    g.visible = false;
    scene.add(g);
    return g;
  }
  const metroTrain = makeMetroTrain();
  function updateMetroTrain() {
    if (!S.started) return;
    metroTrain.visible = true;
    const span = Z.rideStart - Z.metroEnd, cyc = 13;
    const u = (S.t % cyc) / cyc, k = u < 0.5 ? u * 2 : (1 - u) * 2;
    const z = Z.rideStart - k * span;
    metroTrain.position.set(roadX(z) + metroOffset, METRO_Y + 0.05, z);
    metroTrain.rotation.y = u < 0.5 ? 0 : Math.PI;
  }

  // --- Zone 2: Marine Drive promenade ---
  const rainbowLights = [];
  {
    const archX = -34, archZ = (Z.metroEnd + Z.marineEnd) / 2, archR = 22;
    const palette = [0xff4d4d, 0xffb347, 0xfff066, 0x6dff8a, 0x66c8ff, 0xb28dff];
    const N = palette.length;
    for (let i = 0; i < N; i++) {
      const a0 = Math.PI * (i / N), a1 = Math.PI * ((i + 1) / N);
      const curve = new THREE.CatmullRomCurve3([0, 0.5, 1].map((t) => {
        const a = lerp(a0, a1, t);
        return V3(archX + Math.cos(a) * archR, Math.sin(a) * archR, archZ);
      }));
      const seg = mesh(new THREE.TubeGeometry(curve, 6, 0.32, 6, false), new THREE.MeshBasicMaterial({ color: palette[i] }));
      rainbowLights.push(seg.material);
    }
    for (let i = 1; i < N; i++) {
      const a = Math.PI * (i / N);
      const top = V3(archX + Math.cos(a) * archR, Math.sin(a) * archR, archZ);
      mesh(cyl(0.03, 0.03, top.y, 6), MAT.metalDark, top.x, top.y / 2, archZ);
    }
    // Distant skyline silhouette across the water, with soft window bokeh.
    const skylineMat = std({ color: 0x0c1220, roughness: 1 });
    const winMat = new THREE.MeshBasicMaterial({ color: 0xffdca0 });
    for (let i = 0; i < 10; i++) {
      const x = -150 + i * 7 + rand(-2, 2), h = rand(10, 34), z = archZ + rand(-40, 40);
      mesh(box(5, h, 5), skylineMat, x, h / 2, z);
      for (let w = 0; w < Math.floor(h / 3); w++) {
        if (Math.random() < 0.5) mesh(new THREE.PlaneGeometry(0.6, 0.6), winMat, x + rand(-2, 2), rand(2, h - 1), z + 2.6);
      }
    }
    // Floating Water Metro jetty terminal along the shoreline.
    function makeWaterMetroJetty(x, z) {
      const deckMat = std({ color: 0xdedbd2, roughness: 0.7 });
      mesh(box(4, 0.25, 8), deckMat, x, -0.35, z);
      [-1.8, 1.8].forEach((dx) => { for (let pz = -3; pz <= 3; pz += 3) mesh(cyl(0.08, 0.1, 1.4, 8), MAT.metalDark, x + dx, 0.25, z + pz); });
      mesh(box(4.4, 0.12, 3.2), std({ color: 0x2a5a78, roughness: 0.6 }), x, 1.9, z - 1.5);
      [-1.9, 1.9].forEach((dx) => mesh(cyl(0.06, 0.06, 2.0, 8), MAT.metalDark, x + dx, 0.9, z - 1.5));
      neonSign('WATER METRO', x, 2.35, z - 1.5 + 0.05, '#3fd6ff', Math.PI / 2);
      const jettyGlow = new THREE.Sprite(addGlow(0x3fd6ff, 0.5)); jettyGlow.scale.set(3, 3, 1); jettyGlow.position.set(x, 1.2, z); scene.add(jettyGlow);
    }
    makeWaterMetroJetty(-27, archZ + 16);
  }
  // The Kochi Water Metro boat, cruising parallel to the road with a gentle wake.
  function makeWaterMetroBoat() {
    const g = new THREE.Group();
    // Fullbright materials (like the game's other night-visible props) so the
    // boat reads clearly against the dark water instead of going near-black.
    const hullMat = new THREE.MeshBasicMaterial({ color: 0xf2f5f7 });
    const stripeMat = new THREE.MeshBasicMaterial({ color: 0x2ec4d6 });
    const cabinMat = new THREE.MeshBasicMaterial({ color: 0xd8f5fa, transparent: true, opacity: 0.9 });
    [-0.55, 0.55].forEach((dx) => {
      mesh(box(0.55, 0.4, 3.6), hullMat, dx, 0.2, 0, g);
      mesh(box(0.56, 0.14, 3.6), stripeMat, dx, 0.02, 0, g);
    });
    mesh(box(1.7, 0.12, 3.2), hullMat, 0, 0.42, 0, g);
    mesh(box(1.3, 0.55, 2.0), cabinMat, 0, 0.78, -0.1, g);
    mesh(box(1.34, 0.06, 2.04), hullMat, 0, 1.08, -0.1, g);
    const beacon = new THREE.Sprite(addGlow(0x66e0ff, 0.9)); beacon.scale.set(1.6, 1.6, 1); beacon.position.set(0, 1.3, -0.1); g.add(beacon);
    const hullGlow = new THREE.Sprite(addGlow(0xcfeeff, 0.55)); hullGlow.scale.set(4.5, 2, 1); hullGlow.position.set(0, 0.3, 0); g.add(hullGlow);
    const wake = mesh(new THREE.PlaneGeometry(1.6, 5), new THREE.MeshBasicMaterial({ map: glowTex, color: 0xbfe8ff, transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, depthWrite: false }), 0, -0.15, 2.6, g);
    wake.rotation.x = -Math.PI / 2;
    g.visible = false;
    scene.add(g);
    return g;
  }
  const waterMetroBoat = makeWaterMetroBoat();
  waterMetroBoat.scale.setScalar(1.7);
  function updateWaterMetroBoat() {
    // Cruises a fixed lead distance ahead of the rider through Zone 2, so it
    // stays in view (rather than an independent path that could drift off-screen).
    const inZone2 = S.onBike && P.z <= Z.metroEnd + 25 && P.z >= Z.marineEnd - 15;
    waterMetroBoat.visible = inZone2;
    if (!inZone2) return;
    const lead = 46 + Math.sin(S.t * 0.3) * 6;
    waterMetroBoat.position.set(-27, 0.05 + Math.sin(S.t * 2) * 0.02, P.z - lead);
    waterMetroBoat.rotation.y = 0;
  }

  // --- Zone 3: Kadamakkudy sunset / midnight causeway ---
  // Bilingual highway signboard right at the zone threshold.
  {
    const signZ = Z.marineEnd - 3, signX = roadX(signZ) + 8.5;
    const signTex = textTex(768, 260, (g, w, h) => {
      g.fillStyle = '#0d6b34'; g.fillRect(0, 0, w, h);
      g.strokeStyle = '#ffffff'; g.lineWidth = 10; g.strokeRect(10, 10, w - 20, h - 20);
      g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillStyle = '#ffffff';
      fitText(g, 'കടമക്കുടി', w / 2, h * 0.36, w - 60, 700, 74, ML);
      fitText(g, 'KADAMAKKUDY', w / 2, h * 0.74, w - 60, 700, 58, 'Cinzel, Georgia, serif');
    });
    const board = mesh(new THREE.PlaneGeometry(4.6, 1.6), new THREE.MeshBasicMaterial({ map: signTex, side: THREE.DoubleSide }), signX, 3.1, signZ);
    board.rotation.y = -Math.PI / 2;
    [-1.6, 1.6].forEach((dz) => mesh(cyl(0.09, 0.11, 3.1, 8), MAT.metalDark, signX - 0.05, 1.55, signZ + dz));
    const boardGlow = new THREE.Sprite(addGlow(0x7fffb0, 0.35)); boardGlow.scale.set(5, 2.2, 1); boardGlow.position.set(signX, 3.1, signZ); scene.add(boardGlow);
  }
  const wetlandTex = waterTex.clone(); wetlandTex.needsUpdate = true; wetlandTex.repeat.set(10, 16);
  {
    const z0 = Z.marineEnd, z1 = Z.waterEnd, L = z0 - z1, cz = (z0 + z1) / 2;
    const wet = mesh(new THREE.PlaneGeometry(46, L), envStd({ color: 0x3d5a46, map: wetlandTex, roughness: 0.1, metalness: 0.8, envMapIntensity: 1.1 }), 32, -0.4, cz);
    wet.rotation.x = -Math.PI / 2;
    const moonStreak = new THREE.MeshBasicMaterial({ map: glowTex, color: 0xcfe0ff, transparent: true, opacity: 0.28, blending: THREE.AdditiveBlending, depthWrite: false });
    const ms = mesh(LAMP.plane, moonStreak, 30, -0.35, cz); ms.rotation.x = -Math.PI / 2; ms.scale.set(6, L * 0.9, 1);
    // Palms lining the narrow causeway edges.
    for (let z = Z.marineEnd - 2, i = 0; z > Z.rideFinish + 14; z -= rand(9, 13), i++) {
      const rx = roadX(z);
      palm(rx - rand(5.5, 7.5), z, { s: rand(0.85, 1.05) });
      if (i % 2) palm(rx + rand(5.5, 7.5), z, { s: rand(0.85, 1.05) });
    }
  }
  // Fireflies drifting over the wetlands.
  const fireflyBase = [];
  const fireflyGeo = new THREE.BufferGeometry();
  {
    const N = 55;
    const pos = new Float32Array(N * 3);
    for (let i = 0; i < N; i++) {
      const z = rand(Z.marineEnd - 8, Z.rideFinish + 18);
      const x = roadX(z) + (Math.random() < 0.5 ? -1 : 1) * rand(3.5, 9);
      fireflyBase.push({ x, z, y: rand(0.35, 1.9), p: Math.random() * 6.28 });
      pos[i * 3] = x; pos[i * 3 + 1] = fireflyBase[i].y; pos[i * 3 + 2] = z;
    }
    fireflyGeo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  }
  const fireflyMat = new THREE.PointsMaterial({ color: 0xd8ff8a, size: 0.16, map: glowTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
  scene.add(new THREE.Points(fireflyGeo, fireflyMat));
  function updateFireflies() {
    const arr = fireflyGeo.attributes.position.array;
    for (let i = 0; i < fireflyBase.length; i++) {
      const b = fireflyBase[i], t = S.t * 0.6 + b.p;
      arr[i * 3] = b.x + Math.sin(t) * 0.6;
      arr[i * 3 + 1] = b.y + Math.sin(t * 1.7) * 0.25;
      arr[i * 3 + 2] = b.z + Math.cos(t * 0.8) * 0.6;
    }
    fireflyGeo.attributes.position.needsUpdate = true;
    fireflyMat.opacity = 0.55 + Math.sin(S.t * 3) * 0.25;
  }
  // Finish-line checkpoint: a cozy waterfront pier (fairy lights added below).
  {
    const pierZ = Z.rideFinish + 8, pierX = roadX(pierZ) - 7.5;
    const deckTex2 = woodTex.clone(); deckTex2.needsUpdate = true; deckTex2.repeat.set(1, 3);
    mesh(box(5, 0.3, 8), std({ color: 0xa88866, map: deckTex2, roughness: 0.85 }), pierX, 0.15, pierZ);
    [-2.3, 2.3].forEach((dx) => { for (let pz = -3.5; pz <= 3.5; pz += 3.5) mesh(cyl(0.09, 0.11, 1.1, 8), MAT.woodDark, pierX + dx, 0.85, pierZ + pz); });
    [-2.3, 2.3].forEach((dx) => mesh(box(0.1, 0.1, 8), MAT.woodDark, pierX + dx, 1.35, pierZ));
    [-4, 4].forEach((pz) => { mesh(box(0.1, 1.4, 0.1), MAT.woodDark, pierX - 2.3, 0.7, pierZ + pz); mesh(box(0.1, 1.4, 0.1), MAT.woodDark, pierX + 2.3, 0.7, pierZ + pz); });
  }
  function updateRideZones(dt) {
    updateMetroTrain();
    updateWaterMetroBoat();
    updateFireflies();
    wetlandTex.offset.x += dt * 0.004; wetlandTex.offset.y -= dt * 0.009;
    rainbowLights.forEach((m, i) => { m.color.setHSL(((S.t * 0.05) + i / rainbowLights.length) % 1, 0.85, 0.55); });
  }

  /* ------------------------------------------------------------------
     In-ride math checkpoints: 3 mandatory stop-and-solve barrier gates.
     The bike physically halts at each one and cannot proceed until it is
     solved. Positions are fixed world-space points along the existing
     road/zones, so every existing landmark (pillars, LuLu, arch, boat,
     Kadamakkudy sign, fireflies, the golden-gate finale) keeps firing
     exactly where it already does - only the time it takes to get there
     is now variable.
     ------------------------------------------------------------------ */
  const LANE_X = [-3.2, 0, 3.2];
  Z.cp1 = Z.rideStart - (Z.rideStart - Z.metroEnd) * 0.7;
  // Past the Rainbow Bridge arch, so its foot isn't beside the bike at the standoff.
  Z.cp3 = Z.metroEnd - (Z.metroEnd - Z.marineEnd) * 0.62;
  // The bike halts this far short of each barrier so the whole gate stays in frame.
  const CP_STANDOFF = 15;
  const RM = { laneChoice: 1, laneOffsetCur: 0, nitroFov: 0, laneReturnZ: null };
  function shuffled(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
    return a;
  }
  function dynamicPanel(w, h) {
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    const tex = new THREE.CanvasTexture(c);
    tex.anisotropy = Math.min(8, maxAniso);
    return { ctx: c.getContext('2d'), tex, w, h };
  }
  function drawPanel(panel, text, opts = {}) {
    const { ctx, w, h } = panel;
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = opts.bg || '#102030'; ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = opts.border || '#f5cd6e'; ctx.lineWidth = 6; ctx.strokeRect(4, 4, w - 8, h - 8);
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillStyle = opts.fg || '#fff';
    fitText(ctx, String(text), w / 2, h / 2, w - 24, 800, opts.size || 54, 'Cinzel, Georgia, serif');
    panel.tex.needsUpdate = true;
  }
  const barrierStripeTex = canvasTex(64, 16, (g, w, h) => {
    g.fillStyle = '#f0f0f0'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#d21f1f';
    for (let x = -8; x < w; x += 16) { g.save(); g.translate(x, 0); g.transform(1, 0, 0.6, 1, 0, 0); g.fillRect(0, 0, 8, h); g.restore(); }
  }, true);
  const radarStripeTex = canvasTex(64, 16, (g, w, h) => {
    g.fillStyle = '#1a1a1a'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#ffcc33';
    for (let x = -8; x < w; x += 16) { g.save(); g.translate(x, 0); g.transform(1, 0, 0.6, 1, 0, 0); g.fillRect(0, 0, 8, h); g.restore(); }
  }, true);

  // --- Checkpoint 1: Toll Gate Lane Hack (3 boom-gate arms) ---
  function makeBoomGate(laneX, z) {
    const g = new THREE.Group(); g.position.set(laneX, 0, z); scene.add(g);
    mesh(cyl(0.13, 0.15, 1.7, 8), MAT.metalDark, -1.0, 0.85, 0, g);
    const lightMat = new THREE.MeshBasicMaterial({ color: 0xff2020 });
    mesh(new THREE.SphereGeometry(0.09, 8, 6), lightMat, -1.0, 1.68, 0, g);
    const glow = new THREE.Sprite(addGlow(0xff2020, 0.7)); glow.scale.set(1, 1, 1); glow.position.set(-1.0, 1.68, 0); g.add(glow);
    const armPivot = new THREE.Group(); armPivot.position.set(-1.0, 1.55, 0); g.add(armPivot);
    const arm = mesh(box(2.4, 0.12, 0.12), std({ color: 0xffffff, map: barrierStripeTex }), 1.2, 0, 0, armPivot);
    arm.material.map.repeat.set(5, 1);
    const panel = dynamicPanel(200, 150);
    const panelMesh = mesh(new THREE.PlaneGeometry(1.15, 0.86), new THREE.MeshBasicMaterial({ map: panel.tex, side: THREE.DoubleSide }), 0, 2.55, 0, g);
    return { g, armPivot, lightMat, glow, panel, panelMesh };
  }
  const boomGates = LANE_X.map((x) => makeBoomGate(roadX(Z.cp1) + x, Z.cp1));
  {
    const tex = textTex(1024, 200, (g, w, h) => {
      g.fillStyle = '#1a0f06'; g.fillRect(0, 0, w, h);
      g.strokeStyle = '#f5cd6e'; g.lineWidth = 8; g.strokeRect(8, 8, w - 16, h - 16);
      g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillStyle = '#f5cd6e';
      fitText(g, 'TOLL GATE', w / 2, h * 0.5, w - 60, 800, 90, 'Cinzel, Georgia, serif');
    });
    mesh(new THREE.PlaneGeometry(6.4, 1.25), new THREE.MeshBasicMaterial({ map: tex, side: THREE.DoubleSide }), roadX(Z.cp1), 3.6, Z.cp1 + 2.4);
  }

  // --- Checkpoint 3: Speed Radar Frequency Lock (police barrier) ---
  function makeRadarBarrier(z) {
    const g = new THREE.Group(); g.position.set(roadX(z), 0, z); scene.add(g);
    [-4.7, 4.7].forEach((dx) => mesh(box(0.2, 1.9, 0.2), MAT.metalDark, dx, 0.95, 0, g));
    const armPivot = new THREE.Group(); armPivot.position.set(-4.7, 1.75, 0); g.add(armPivot);
    const armMat = std({ color: 0xffffff, map: radarStripeTex });
    armMat.map.repeat.set(9, 1);
    mesh(box(9.4, 0.16, 0.16), armMat, 4.7, 0, 0, armPivot);
    const lightMat = new THREE.MeshBasicMaterial({ color: 0xffcc33 });
    const lightMat2 = lightMat.clone();
    mesh(new THREE.SphereGeometry(0.1, 8, 6), lightMat, -4.7, 2.15, 0, g);
    mesh(new THREE.SphereGeometry(0.1, 8, 6), lightMat2, 4.7, 2.15, 0, g);
    const tripod = new THREE.Group(); tripod.position.set(5.8, 0, 0.7); g.add(tripod);
    mesh(cyl(0.05, 0.08, 1.0, 6), MAT.metalDark, 0, 0.5, 0, tripod);
    mesh(box(0.32, 0.22, 0.5), std({ color: 0x1c1c1c }), 0, 1.05, 0, tripod);
    const beam = new THREE.Sprite(addGlow(0xffcc33, 0.6)); beam.scale.set(0.6, 0.6, 1); beam.position.set(0, 1.05, 0.32); tripod.add(beam);
    return { g, armPivot, lightMat, lightMat2 };
  }
  const radarBarrier = makeRadarBarrier(Z.cp3);
  radarBarrier.flashing = true;
  const radarPanels = LANE_X.map((x) => {
    const panel = dynamicPanel(220, 150);
    const m = mesh(new THREE.PlaneGeometry(1.3, 0.9), new THREE.MeshBasicMaterial({ map: panel.tex, side: THREE.DoubleSide }), roadX(Z.cp3) + x, 2.6, Z.cp3 + 0.4);
    const glow = new THREE.Sprite(addGlow(0xffcc33, 0.5)); glow.scale.set(2.1, 1.6, 1); glow.position.copy(m.position); scene.add(glow);
    return { panel, mesh: m, glow };
  });

  const AR = {
    hud: $('arcade-hud'), title: $('arcade-title'), sub: $('arcade-sub'),
    answerRow: $('answer-row'), answerBtns: Array.from(document.querySelectorAll('.answer-btn')),
    answerResolve: null,
  };
  function showArcade(title, sub) { AR.title.textContent = title; AR.sub.textContent = sub; AR.hud.classList.remove('hidden'); }
  function hideArcade() { AR.hud.classList.add('hidden'); }
  function flashArcade(good) { AR.hud.classList.remove('good', 'bad'); void AR.hud.offsetWidth; AR.hud.classList.add(good ? 'good' : 'bad'); }
  // Shows the 3 choices (left-to-right = lane order) and resolves with the tapped index.
  function askAnswers(labels) {
    AR.answerBtns.forEach((b, i) => {
      b.classList.remove('correct', 'wrong', 'dim');
      b.querySelector('.answer-label').textContent = labels[i];
      b.setAttribute('aria-label', `Answer ${i + 1}: ${labels[i]}`);
    });
    AR.answerRow.classList.remove('hidden', 'locked');
    document.body.classList.add('quiz-active');
    return new Promise((resolve) => { AR.answerResolve = resolve; });
  }
  function submitAnswer(i) {
    const resolve = AR.answerResolve;
    if (!resolve) return;
    AR.answerResolve = null;
    AR.answerRow.classList.add('locked');
    resolve(i);
  }
  function markAnswer(i, good) {
    AR.answerBtns.forEach((b, j) => {
      if (j === i) { b.classList.remove('correct', 'wrong'); void b.offsetWidth; b.classList.add(good ? 'correct' : 'wrong'); }
      else if (good) b.classList.add('dim');
    });
  }
  function hideAllArcadeUi() {
    hideArcade();
    AR.answerRow.classList.add('hidden');
    document.body.classList.remove('quiz-active');
    AR.answerResolve = null;
  }
  AR.answerBtns.forEach((b, i) => b.addEventListener('click', () => { b.blur(); submitAnswer(i); }));
  function updateRideChallenges(dt) {
    RM.nitroFov = damp(RM.nitroFov, 0, 3, dt);
    fovBoost += RM.nitroFov;
    if (radarBarrier.flashing) {
      const on = Math.sin(S.t * 6) > 0;
      radarBarrier.lightMat.color.setHex(on ? 0xffcc33 : 0x332200);
      radarBarrier.lightMat2.color.setHex(on ? 0xffcc33 : 0x332200);
    }
  }
  // --- Checkpoint solvers ---
  async function runTollCheckpoint() {
    S.mode = 'cutscene'; input.forward = false;
    AudioSys.engineSet(0.1);
    for (;;) {
      const a = Math.floor(rand(4, 10)), b = Math.floor(rand(4, 10)), correctVal = a * b;
      const correctIdx = Math.floor(rand(0, 3)); RM.debugCorrectIdx = correctIdx;
      const deltas = shuffled([-6, -4, -2, 2, 4, 6].filter((d) => correctVal + d > 0));
      const nums = [0, 1, 2].map((i) => (i === correctIdx ? correctVal : correctVal + deltas.pop()));
      boomGates.forEach((bg, i) => drawPanel(bg.panel, nums[i]));
      showArcade('TOLL BARRIER LOCKED', `Solve to pass! ${a} × ${b} = ?`);
      const chosen = await askAnswers(nums);
      if (chosen === correctIdx) {
        markAnswer(chosen, true);
        AudioSys.chime(); flashArcade(true);
        showArcade('ACCESS GRANTED', 'Barrier lifting — nitro boost!');
        const gate = boomGates[correctIdx];
        gate.lightMat.color.setHex(0x44ff88); gate.glow.material.color.setHex(0x44ff88);
        await tween(0.6, (k) => { gate.armPivot.rotation.z = Math.PI / 2 * k; }, ease.out);
        await wait(0.3);
        RM.laneChoice = correctIdx;
        RM.laneReturnZ = Z.cp1 - 6;
        RM.nitroFov = 8;
        break;
      }
      markAnswer(chosen, false);
      AudioSys.error(); flashArcade(false); S.shake = Math.max(S.shake, 0.2);
      showArcade('ACCESS DENIED', 'Try again — a new equation appears…');
      await wait(1.0);
    }
    hideAllArcadeUi();
  }
  const RADAR_DECOYS = ['ZEUS', 'APOLLO', 'NEPTUNE', 'MARS', 'HERMES', 'ATLAS'];
  async function runRadarCheckpoint() {
    S.mode = 'cutscene'; input.forward = false;
    AudioSys.engineSet(0.1);
    for (;;) {
      const correctIdx = Math.floor(rand(0, 3)); RM.debugCorrectIdx = correctIdx;
      const decoys = shuffled(RADAR_DECOYS);
      const words = [0, 1, 2].map((i) => (i === correctIdx ? 'CUPID' : decoys.pop()));
      radarPanels.forEach((p, i) => drawPanel(p.panel, words[i], { bg: '#241a05', border: '#ffcc33', size: 40 }));
      showArcade('RADAR LOCK', 'Who is known as the god of love?');
      const chosen = await askAnswers(words);
      if (chosen === correctIdx) {
        markAnswer(chosen, true);
        AudioSys.chime(); flashArcade(true);
        showArcade('RADAR CLEAR', 'Full speed ahead!');
        radarBarrier.flashing = false;
        radarBarrier.lightMat.color.setHex(0x44ff88); radarBarrier.lightMat2.color.setHex(0x44ff88);
        await tween(0.6, (k) => { radarBarrier.armPivot.rotation.z = Math.PI / 2 * k; }, ease.out);
        radarPanels.forEach((p) => { p.mesh.visible = false; p.glow.visible = false; });
        await wait(0.3);
        RM.nitroFov = 8;
        break;
      }
      markAnswer(chosen, false);
      AudioSys.error(); flashArcade(false); S.shake = Math.max(S.shake, 0.2);
      showArcade('ACCESS DENIED', 'Try again — the radar reshuffles…');
      await wait(1.0);
    }
    hideAllArcadeUi();
  }

  /* ------------------------------------------------------------------
     Stage 6: final boulevard, golden gate, plaza
     ------------------------------------------------------------------ */
  // The ending now takes place on a beach - same gate, cake, banner, fairy
  // lights and fireworks as before, just sand and open sea for the setting.
  const beachSandTex = canvasTex(256, 256, (g, w, h) => {
    g.fillStyle = '#cdab74'; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 1400; i++) {
      const v = 150 + Math.random() * 55 | 0;
      g.fillStyle = `rgba(${v + 35},${v + 8},${v - 45},${rand(0.2, 0.55)})`;
      g.beginPath(); g.ellipse(Math.random() * w, Math.random() * h, rand(0.6, 2.2), rand(0.5, 1.6), Math.random() * 3, 0, Math.PI * 2); g.fill();
    }
  }, true);
  beachSandTex.repeat.set(9, 13);
  const beachSandMat = std({ color: 0xffffff, map: beachSandTex, roughness: 1 });
  const beachSeaTex = waterTex.clone(); beachSeaTex.needsUpdate = true; beachSeaTex.repeat.set(11, 22);
  const beachFoamMat = new THREE.MeshBasicMaterial({ map: glowTex, color: 0xdfeeff, transparent: true, opacity: 0.28, blending: THREE.AdditiveBlending, depthWrite: false });
  {
    const z0 = Z.beachStart, z1 = Z.end, cz = (z0 + z1) / 2, L = z0 - z1;
    const bR = mesh(new THREE.PlaneGeometry(160, L), beachSandMat, 56, -0.02, cz); bR.rotation.x = -Math.PI / 2;
    const bL = mesh(new THREE.PlaneGeometry(40, L), beachSandMat, -44, -0.02, cz); bL.rotation.x = -Math.PI / 2;
    const sea = mesh(new THREE.PlaneGeometry(100, L), envStd({ color: 0x5a7aa8, map: beachSeaTex, roughness: 0.06, metalness: 0.9, envMapIntensity: 1.5 }), -114, -0.45, cz);
    sea.rotation.x = -Math.PI / 2;
    const foam = mesh(LAMP.plane, beachFoamMat, -64, -0.42, cz); foam.rotation.x = -Math.PI / 2; foam.scale.set(2.2, L, 1);
  }
  const fairy = [];
  {
    const pts = [], cols = [];
    const palette = [0xff9ec7, 0xffe08a, 0xa8d8ff, 0xffffff, 0xffb37a].map(C);
    for (let z = Z.finalGate + 64; z > Z.finalGate + 3; z -= 9) {
      for (let i = 0; i <= 24; i++) {
        const t = i / 24;
        pts.push(lerp(-4.6, 4.6, t), 5.2 - Math.sin(Math.PI * t) * 1.3, z - 2.2 * t);
        const c = pick(palette); cols.push(c.r, c.g, c.b);
      }
    }
    for (let z = Z.finalGate + 66; z > Z.finalGate + 2; z -= 1.1) {
      for (const s of [-1, 1]) { pts.push(s * 6.2, rand(0.6, 2.4), z); const c = pick(palette); cols.push(c.r, c.g, c.b); }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
    const m = new THREE.PointsMaterial({ size: 0.45, map: glowTex, vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
    scene.add(new THREE.Points(g, m));
    fairy.push(m);
  }
  for (let z = Z.finalGate + 64, i = 0; z > Z.finalGate + 2; z -= 5, i++) {
    for (const s of [-1, 1]) {
      mesh(new THREE.DodecahedronGeometry(1.1), MAT.hedge, s * 7, 0.7, z).scale.set(1.2, 0.8, 2.4);
      if (i % 2) palm(s * rand(9.5, 12), z);
    }
  }
  const gate2 = {};
  {
    const z = Z.finalGate;
    [-1, 1].forEach((s) => {
      mesh(box(1.5, 11, 1.5), MAT.marble, s * 5.9, 5.5, z);
      mesh(box(1.9, 0.4, 1.9), MAT.gold, s * 5.9, 11.2, z);
      mesh(box(1.9, 0.4, 1.9), MAT.gold, s * 5.9, 0.2, z);
      mesh(new THREE.SphereGeometry(0.45, 16, 12), MAT.gold, s * 5.9, 11.85, z);
      mesh(box(14, 3.2, 0.8), MAT.marble, s * 13.6, 1.6, z);
      for (let x = 7.2; x < 20; x += 1.3) mesh(new THREE.SphereGeometry(0.22, 10, 8), MAT.gold, s * x, 3.4, z);
    });
    const arch = new THREE.Mesh(new THREE.TorusGeometry(5.9, 0.38, 12, 48, Math.PI), MAT.gold);
    arch.position.set(0, 11, z); scene.add(arch);
    const arch2 = new THREE.Mesh(new THREE.TorusGeometry(5.2, 0.12, 8, 48, Math.PI), MAT.gold);
    arch2.position.set(0, 11, z); scene.add(arch2);
    const hs = new THREE.Shape();
    hs.moveTo(0, 0.3);
    hs.bezierCurveTo(0, 0.6, -0.5, 0.7, -0.5, 0.35);
    hs.bezierCurveTo(-0.5, 0.05, -0.1, -0.2, 0, -0.45);
    hs.bezierCurveTo(0.1, -0.2, 0.5, 0.05, 0.5, 0.35);
    hs.bezierCurveTo(0.5, 0.7, 0, 0.6, 0, 0.3);
    gate2.heartMat = std({ color: 0xff4f8b, emissive: 0xff2a6a, emissiveIntensity: 0.6, roughness: 0.3, metalness: 0.2 });
    gate2.heart = new THREE.Mesh(new THREE.ExtrudeGeometry(hs, { depth: 0.25, bevelEnabled: true, bevelSize: 0.05, bevelThickness: 0.05, bevelSegments: 2 }), gate2.heartMat);
    gate2.heart.scale.set(2.2, 2.2, 2.2);
    gate2.heart.position.set(0, 14.2, z - 0.1);
    scene.add(gate2.heart);
    gate2.left = barDoor(5.15, 9, MAT.gold, { dir: 1, bar: 0.06, spacing: 0.4 });
    gate2.left.position.set(-5.15, 0, z);
    gate2.right = barDoor(5.15, 9, MAT.gold, { dir: -1, bar: 0.06, spacing: 0.4 });
    gate2.right.position.set(5.15, 0, z);
    scene.add(gate2.left, gate2.right);
    gate2.glow = new THREE.Sprite(addGlow(0xffd27a, 0));
    gate2.glow.scale.set(24, 24, 1); gate2.glow.position.set(0, 6, z - 6); scene.add(gate2.glow);
    gate2.rings = [0, 1, 2].map(() => mesh(new THREE.RingGeometry(0.92, 1, 64), new THREE.MeshBasicMaterial({ color: 0xffd27a, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }), 0, 5.5, z - 0.5));
  }
  const plaza = { candles: [] };
  {
    const z = Z.plaza;
    const disc = mesh(new THREE.CircleGeometry(16, 48), envStd({ color: 0x2b2230, roughness: 0.4, metalness: 0.4 }), 0, 0.015, z);
    disc.rotation.x = -Math.PI / 2;
    const ring = mesh(new THREE.RingGeometry(15.4, 16, 64), MAT.gold, 0, 0.02, z); ring.rotation.x = -Math.PI / 2;
    const cz = z - 2;
    mesh(cyl(1.5, 1.7, 1, 32), MAT.marble, 0, 0.5, cz);
    const pink = std({ color: 0xffa6c9, roughness: 0.5 }), cream = std({ color: 0xfff3e6, roughness: 0.5 });
    mesh(cyl(1.15, 1.15, 0.7, 32), pink, 0, 1.35, cz);
    mesh(cyl(0.85, 0.85, 0.55, 32), cream, 0, 1.97, cz);
    mesh(cyl(0.55, 0.55, 0.45, 32), pink, 0, 2.47, cz);
    [[1.15, 1.7], [0.85, 2.24], [0.55, 2.7]].forEach(([r, y]) => {
      const t = new THREE.Mesh(new THREE.TorusGeometry(r, 0.06, 6, 32), cream);
      t.rotation.x = Math.PI / 2; t.position.set(0, y, cz); scene.add(t);
    });
    const candleMat = std({ color: 0xfff7d6 });
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      const x = Math.cos(a) * 0.36, zz = cz + Math.sin(a) * 0.36;
      mesh(cyl(0.025, 0.025, 0.28, 6), candleMat, x, 2.84, zz);
      const f = new THREE.Sprite(addGlow(0xffb050, 0));
      f.scale.set(0.35, 0.5, 1); f.position.set(x, 3.05, zz); scene.add(f);
      plaza.candles.push(f);
    }
    for (const s of [-1, 1]) {
      mesh(cyl(0.12, 0.16, 15, 10), MAT.gold, s * 8.2, 7.5, z - 4);
      mesh(new THREE.SphereGeometry(0.3, 12, 10), MAT.gold, s * 8.2, 15.1, z - 4);
      palm(s * rand(12, 15), z - rand(-4, 6), { s: 1.2 });
    }
    mesh(cyl(0.06, 0.06, 16.4, 6), MAT.gold, 0, 14.4, z - 4).rotation.z = Math.PI / 2;
    const bannerTex = textTex(1024, 384, (g, w, h) => {
      const gr = g.createLinearGradient(0, 0, w, 0);
      gr.addColorStop(0, '#8e1d55'); gr.addColorStop(0.5, '#d63f7c'); gr.addColorStop(1, '#8e1d55');
      g.fillStyle = gr;
      g.beginPath(); g.moveTo(0, 0); g.lineTo(w, 0); g.lineTo(w, h - 40); g.lineTo(w * 0.5, h); g.lineTo(0, h - 40); g.closePath(); g.fill();
      g.strokeStyle = '#ffd27a'; g.lineWidth = 10;
      g.beginPath(); g.moveTo(12, 12); g.lineTo(w - 12, 12); g.lineTo(w - 12, h - 48); g.lineTo(w * 0.5, h - 12); g.lineTo(12, h - 48); g.closePath(); g.stroke();
      g.textAlign = 'center'; g.textBaseline = 'middle';
      g.shadowColor = 'rgba(255,220,140,0.9)'; g.shadowBlur = 20;
      g.fillStyle = '#fff4d6';
      g.font = '700 104px Cinzel, Georgia, serif';
      g.fillText('HAPPY BIRTHDAY', w / 2, 120);
      g.font = '700 70px Poppins, sans-serif';
      g.fillText('MY DEAR AMMU!', w / 2 - 34, 238);
      g.shadowBlur = 16; g.shadowColor = '#ff6fa5';
      g.fillStyle = '#ff5f95';
      heartPath(g, w / 2 + 290, 200, 76); g.fill();
    });
    const bg = new THREE.Group();
    mesh(new THREE.PlaneGeometry(14, 5.25), new THREE.MeshBasicMaterial({ map: bannerTex, transparent: true, side: THREE.DoubleSide, color: 0xb4b4b4, fog: false }), 0, -2.8, 0, bg);
    const bglow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: 0xff7fb0, transparent: true, opacity: 0.18, blending: THREE.AdditiveBlending, depthWrite: false }));
    bglow.scale.set(26, 12, 1); bglow.position.set(0, -2.8, -0.3); bg.add(bglow);
    for (const s of [-1, 1]) mesh(cyl(0.02, 0.02, 0.6, 4), MAT.gold, s * 6.5, -0.1, 0, bg);
    bg.position.set(0, 34, z - 3.9);
    bg.visible = false;
    scene.add(bg);
    plaza.bannerGroup = bg;
  }
  const partyLights = {
    cake: new THREE.PointLight(0xffb070, 0, 14, 2),
    plaza: new THREE.PointLight(0xff7fbf, 0, 45, 2),
    flash: new THREE.PointLight(0xffffff, 0, 80, 2),
    boy: new THREE.PointLight(0xffd6a8, 0, 6, 2),
  };
  partyLights.cake.position.set(0, 4, Z.plaza - 0.5);
  partyLights.plaza.position.set(0, 14, Z.plaza + 4);
  partyLights.boy.position.set(1.4, 2.4, Z.bike + 2.2);
  Object.values(partyLights).forEach((l) => scene.add(l));

  /* ------------------------------------------------------------------
     Characters
     ------------------------------------------------------------------ */
  function makeHuman(o) {
    const g = new THREE.Group();
    const mat = (c, r = 0.75) => std({ color: c, roughness: r, metalness: 0 });
    const skinM = mat(o.skin, 0.6), hairM = mat(o.hair, 0.45), topM = mat(o.top), botM = mat(o.bottom), shoeM = mat(0x141414, 0.4);
    const parts = {};
    const limb = (len, r1, r2, m) => { const geo = cyl(r1, r2, len, 8); geo.translate(0, -len / 2, 0); return new THREE.Mesh(geo, m); };
    ['L', 'R'].forEach((s, i) => {
      const piv = new THREE.Group();
      piv.position.set(i ? 0.1 : -0.1, 0.9, 0);
      piv.add(limb(0.83, 0.07, 0.055, o.female ? skinM : botM));
      mesh(box(0.11, 0.08, 0.24), shoeM, 0, -0.85, -0.04, piv);
      g.add(piv); parts['leg' + s] = piv;
    });
    const body = new THREE.Group();
    g.add(body); parts.body = body;
    if (o.female) {
      const trimM = mat(o.accent, 0.4);
      // flared skirt with a contrast hem trim
      mesh(cyl(0.17, 0.4, 0.62, 18), topM, 0, 0.88, 0, body);
      mesh(new THREE.TorusGeometry(0.395, 0.018, 6, 20), trimM, 0, 0.575, 0, body).rotation.x = Math.PI / 2;
      // fitted bodice tapering to the shoulders
      mesh(cyl(0.15, 0.17, 0.34, 14), topM, 0, 1.34, 0, body);
      // cinched waist sash with a small bow
      mesh(cyl(0.176, 0.176, 0.06, 14), trimM, 0, 1.18, 0, body);
      mesh(box(0.1, 0.07, 0.035), trimM, 0, 1.18, -0.175, body);
      mesh(box(0.045, 0.065, 0.03), trimM, 0.05, 1.17, -0.19, body).rotation.z = 0.5;
      mesh(box(0.045, 0.065, 0.03), trimM, -0.05, 1.17, -0.19, body).rotation.z = -0.5;
      // soft puff sleeves at the shoulders
      [-1, 1].forEach((s) => { const sl = mesh(new THREE.SphereGeometry(0.085, 10, 8), topM, s * 0.21, 1.485, 0, body); sl.scale.set(1, 0.8, 1); });
      // dupatta-style drape across the front, pinned at the neckline
      const sc = new THREE.Mesh(new THREE.TorusGeometry(0.1, 0.038, 6, 16), trimM);
      sc.rotation.x = Math.PI / 2; sc.position.y = 1.52; body.add(sc);
      const drape = mesh(new THREE.PlaneGeometry(0.13, 0.5), std({ color: o.accent, roughness: 0.75, side: THREE.DoubleSide }), 0.16, 1.15, 0.08, body);
      drape.rotation.set(0.15, 0.3, -0.25);
    } else {
      mesh(box(0.34, 0.2, 0.2), botM, 0, 0.92, 0, body);
      mesh(box(0.46, 0.56, 0.26), topM, 0, 1.3, 0, body);
      mesh(box(0.2, 0.3, 0.02), mat(0xf2f2f2), 0, 1.36, -0.135, body);
    }
    mesh(cyl(0.05, 0.055, 0.1, 8), skinM, 0, 1.56, 0, body);
    const head = new THREE.Group();
    head.position.y = 1.7;
    body.add(head); parts.head = head;
    mesh(new THREE.SphereGeometry(0.15, 16, 12), skinM, 0, 0, 0, head);
    const eyeM = new THREE.MeshBasicMaterial({ color: 0x1a1010 });
    [-1, 1].forEach((s) => mesh(new THREE.SphereGeometry(0.018, 6, 6), eyeM, s * 0.05, 0.02, -0.138, head));
    if (o.female) {
      mesh(new THREE.SphereGeometry(0.165, 16, 12), hairM, 0, 0.025, 0.02, head).scale.set(1.02, 1, 1.02);
      mesh(cyl(0.15, 0.11, 0.62, 12), hairM, 0, -0.26, 0.07, head).scale.z = 0.7;
      mesh(new THREE.SphereGeometry(0.06, 8, 6), mat(o.accent, 0.4), 0.12, 0.09, 0.05, head);
      const jasmine = std({ color: 0xf4f0e6, roughness: 0.7 });
      for (let i = 0; i < 7; i++) mesh(new THREE.SphereGeometry(0.017, 5, 4), jasmine, 0.035 * Math.sin(i * 1.7), -0.08 - i * 0.055, 0.135, head);
    } else {
      mesh(new THREE.SphereGeometry(0.162, 16, 10, 0, Math.PI * 2, 0, Math.PI * 0.55), hairM, 0, 0.03, 0.01, head).scale.set(1.03, 1.05, 1.05);
    }
    ['L', 'R'].forEach((s, i) => {
      const piv = new THREE.Group();
      piv.position.set((o.female ? 0.2 : 0.27) * (i ? 1 : -1), 1.49, 0);
      piv.add(limb(0.6, 0.05, 0.04, o.female ? skinM : topM));
      mesh(new THREE.SphereGeometry(0.048, 8, 6), skinM, 0, -0.62, 0, piv);
      if (o.female) mesh(cyl(0.062, 0.058, 0.16, 8), topM, 0, -0.06, 0, piv);
      body.add(piv); parts['arm' + s] = piv;
    });
    const sh = mesh(new THREE.PlaneGeometry(1.1, 1.1), new THREE.MeshBasicMaterial({ map: shadowTex, transparent: true, depthWrite: false }), 0, 0.03, 0, g);
    sh.rotation.x = -Math.PI / 2;
    parts.shadow = sh;
    g.userData.parts = parts;
    g.userData.pose = 'stand';
    return g;
  }
  function animateHuman(h, phase, amt, dt) {
    const p = h.userData.parts;
    if (h.userData.pose === 'sit' || h.userData.lock) return;
    const s = Math.sin(phase);
    const k = 1 - Math.exp(-12 * dt);
    p.legL.rotation.x = lerp(p.legL.rotation.x, s * 0.75 * amt, k);
    p.legR.rotation.x = lerp(p.legR.rotation.x, -s * 0.75 * amt, k);
    if (!h.userData.waving) {
      if (h.userData.holdCone) {
        // hold the cone in front, lifting it for a lick every few seconds
        const lick = Math.pow(Math.max(0, Math.sin(S.t * 1.7)), 10);
        p.armL.rotation.x = lerp(p.armL.rotation.x, 1.15 + lick * 0.55, k);
        p.armL.rotation.z = lerp(p.armL.rotation.z, 0.3 + lick * 0.15, k);
        p.head.rotation.x = lerp(p.head.rotation.x, lick * 0.25, k);
      } else {
        p.armL.rotation.x = lerp(p.armL.rotation.x, -s * 0.7 * amt, k);
        p.armL.rotation.z = lerp(p.armL.rotation.z, -0.08, k);
      }
      if (h.userData.holdUmbrella) {
        p.armR.rotation.x = lerp(p.armR.rotation.x, 2.72, k);
        p.armR.rotation.z = lerp(p.armR.rotation.z, -0.05, k);
      } else {
        p.armR.rotation.x = lerp(p.armR.rotation.x, s * 0.7 * amt, k);
        p.armR.rotation.z = lerp(p.armR.rotation.z, 0.08, k);
      }
    }
    p.body.position.y = Math.abs(Math.cos(phase)) * 0.055 * amt;
    p.body.rotation.x = lerp(p.body.rotation.x, -0.12 * clamp(amt - 0.6, 0, 1), k);
  }
  function setSit(h, hug) {
    const p = h.userData.parts;
    h.userData.pose = 'sit';
    p.legL.rotation.set(0.8, 0, -0.32);
    p.legR.rotation.set(0.8, 0, 0.32);
    p.body.position.y = 0; p.body.rotation.x = -0.05;
    if (hug) { p.armL.rotation.set(1.25, 0, 0.35); p.armR.rotation.set(1.25, 0, -0.35); } else { p.armL.rotation.set(1.1, 0, 0.12); p.armR.rotation.set(1.1, 0, -0.12); }
    p.shadow.visible = false;
  }
  function setStand(h) {
    const p = h.userData.parts;
    h.userData.pose = 'stand';
    ['legL', 'legR', 'armL', 'armR'].forEach((k) => p[k].rotation.set(0, 0, 0));
    p.body.rotation.set(0, 0, 0); p.body.position.y = 0;
    p.shadow.visible = true;
  }

  const vandana = makeHuman({ female: true, skin: 0xd9a27e, hair: 0x140c0a, top: 0x8e2448, bottom: 0x8e2448, accent: 0xf5cd6e });
  scene.add(vandana);
  const heldUmbrella = makeUmbrella(true);
  heldUmbrella.position.set(0.2, 1.62, -0.16);
  heldUmbrella.rotation.z = 0.12;
  heldUmbrella.visible = false;
  vandana.userData.parts.body.add(heldUmbrella);
  const shreyas = makeHuman({ female: false, skin: 0xc68f68, hair: 0x100a08, top: 0x273756, bottom: 0x1d2536 });
  shreyas.scale.setScalar(1.06);
  scene.add(shreyas);

  /* ------------------------------------------------------------------
     CUSAT campus ice-cream cart (just inside the gate)
     ------------------------------------------------------------------ */
  function makeCone() {
    const g = new THREE.Group();
    const wafer = std({ color: 0xc98c45, roughness: 0.8 });
    const cone = mesh(new THREE.ConeGeometry(0.045, 0.16, 10), wafer, 0, 0, 0, g);
    cone.rotation.x = Math.PI;
    const scoops = new THREE.Group(); scoops.position.y = 0.08; g.add(scoops);
    mesh(new THREE.SphereGeometry(0.052, 12, 8), std({ color: 0xfff3dc, roughness: 0.55 }), 0, 0.02, 0, scoops);
    mesh(new THREE.SphereGeometry(0.046, 12, 8), std({ color: 0x6b3f24, roughness: 0.5 }), 0, 0.085, 0, scoops);
    const spr = [0xff4d6d, 0x4dd2ff, 0xffe066, 0x7cff8a];
    for (let i = 0; i < 10; i++) {
      const a = i * 2.4, r = 0.042;
      mesh(box(0.012, 0.005, 0.005), new THREE.MeshBasicMaterial({ color: spr[i % 4] }), Math.cos(a) * r * 0.8, 0.1 + (i % 3) * 0.012, Math.sin(a) * r * 0.8, scoops).rotation.y = a;
    }
    g.userData.scoops = scoops;
    return g;
  }
  const iceCart = new THREE.Group();
  {
    iceCart.position.set(3.9, 0, Z.iceCart);
    iceCart.rotation.y = Math.PI / 2;
    scene.add(iceCart);
    const stripeTex = canvasTex(256, 128, (g) => {
      for (let i = 0; i < 8; i++) { g.fillStyle = i % 2 ? '#ffffff' : '#ff7fa8'; g.fillRect(i * 32, 0, 32, 128); }
    });
    const body = std({ color: 0xffffff, map: stripeTex, roughness: 0.5 });
    mesh(box(1.7, 0.85, 0.8), body, 0, 0.75, 0, iceCart);
    mesh(box(1.76, 0.06, 0.86), std({ color: 0xdcdcdc, metalness: 0.8, roughness: 0.3 }), 0, 1.2, 0, iceCart);
    [[-0.55, 1], [0.55, 1]].forEach(([x]) => {
      const w = mesh(new THREE.TorusGeometry(0.2, 0.05, 8, 16), MAT.metalDark, x, 0.24, 0.42, iceCart);
      mesh(cyl(0.03, 0.03, 0.02, 6), MAT.metalDark, x, 0.24, 0.42, iceCart).rotation.x = Math.PI / 2;
      w.userData.wheel = true;
    });
    mesh(cyl(0.025, 0.025, 1.6, 6), MAT.metalDark, 0.95, 0.95, -0.2, iceCart).rotation.z = 0.5;
    mesh(cyl(0.025, 0.025, 1.9, 6), MAT.metalDark, 0, 2.1, 0, iceCart);
    const canopy = mesh(new THREE.ConeGeometry(1.25, 0.5, 8, 1, true), std({ color: 0xffffff, map: stripeTex, roughness: 0.6, side: THREE.DoubleSide }), 0, 3.05, 0, iceCart);
    canopy.material.map.repeat.set(2, 1);
    // big decorative cone on top of the lid
    const deco = makeCone(); deco.scale.setScalar(3.2); deco.position.set(-0.45, 1.5, 0); iceCart.add(deco);
    const signT = textTex(512, 128, (c, w) => {
      c.fillStyle = '#ff5f95'; c.fillRect(0, 0, w, 128);
      c.strokeStyle = '#fff3dc'; c.lineWidth = 6; c.strokeRect(5, 5, w - 10, 118);
      c.textAlign = 'center'; c.textBaseline = 'middle';
      c.fillStyle = '#ffffff'; fitText(c, 'ഐസ്ക്രീം', w / 2, 48, w - 40, 700, 50, ML);
      c.fillStyle = '#fff3dc'; fitText(c, 'CUSAT ICE CREAM 🍦', w / 2, 98, w - 40, 600, 28, 'Poppins, sans-serif');
    });
    mesh(new THREE.PlaneGeometry(1.6, 0.4), new THREE.MeshBasicMaterial({ map: signT }), 0, 0.78, -0.41, iceCart).rotation.y = Math.PI;
    mesh(new THREE.SphereGeometry(0.06, 8, 6), new THREE.MeshBasicMaterial({ color: 0xffe2f0 }), 0, 2.75, 0, iceCart);
    const cg = new THREE.Sprite(addGlow(0xff9ec8, 0.8)); cg.scale.set(2.2, 2.2, 1); cg.position.set(0, 2.7, 0); iceCart.add(cg);
    lampRecord(V3(3.9, 2.7, Z.iceCart), 0xffb0d0, { intensity: 1.4, always: true });
  }
  const iceVendor = makeHuman({ female: false, skin: 0xb57c55, hair: 0x2a2a2a, top: 0xf2f2f2, bottom: 0x3a5a8a });
  iceVendor.position.set(4.95, 0, Z.iceCart + 0.2);
  iceVendor.rotation.y = Math.PI / 2;
  scene.add(iceVendor);
  const heldCone = makeCone();
  heldCone.position.set(0, -0.66, 0);
  heldCone.scale.setScalar(1.4);
  heldCone.rotation.x = -1.15;
  heldCone.visible = false;
  vandana.userData.parts.armL.add(heldCone);

  // Phone held to her ear during the call-Shreyas task
  function makePhone() {
    const g = new THREE.Group();
    mesh(box(0.09, 0.185, 0.018), std({ color: 0x1c1e24, roughness: 0.35, metalness: 0.4 }), 0, 0, 0, g);
    mesh(box(0.078, 0.155, 0.006), new THREE.MeshBasicMaterial({ color: 0x8fe0ff }), 0, 0.008, 0.011, g);
    return g;
  }
  const heldPhone = makePhone();
  heldPhone.position.set(0, -0.66, 0.03);
  heldPhone.rotation.set(0, 0, 0.15);
  heldPhone.visible = false;
  vandana.userData.parts.armR.add(heldPhone);

  function makeBike() {
    const g = new THREE.Group();
    g.rotation.order = 'YXZ';
    const red = envStd({ color: 0xd0141f, roughness: 0.22, metalness: 0.55, envMapIntensity: 1.3 });
    const black = std({ color: 0x121212, roughness: 0.6 });
    const chrome = envStd({ color: 0xd8d8d8, metalness: 1, roughness: 0.18, envMapIntensity: 1.5 });
    const tire = std({ color: 0x0b0b0b, roughness: 0.9 });
    const wheels = [];
    [-0.8, 0.74].forEach((z) => {
      const w = new THREE.Group();
      w.position.set(0, 0.42, z);
      const t = new THREE.Mesh(new THREE.TorusGeometry(0.33, 0.09, 10, 28), tire); t.rotation.y = Math.PI / 2; w.add(t);
      const rim = new THREE.Mesh(cyl(0.25, 0.25, 0.05, 20), chrome); rim.rotation.z = Math.PI / 2; w.add(rim);
      for (let i = 0; i < 3; i++) mesh(box(0.06, 0.48, 0.05), black, 0, 0, 0, w).rotation.x = (i / 3) * Math.PI;
      g.add(w); wheels.push(w);
    });
    mesh(box(0.3, 0.32, 0.5), chrome, 0, 0.52, -0.02, g);
    mesh(box(0.12, 0.12, 1.25), red, 0, 0.72, -0.05, g).rotation.x = 0.1;
    mesh(new THREE.SphereGeometry(0.22, 16, 12), red, 0, 0.94, -0.36, g).scale.set(0.95, 0.7, 1.5);
    mesh(box(0.32, 0.1, 0.9), black, 0, 0.9, 0.26, g);
    mesh(box(0.24, 0.06, 0.5), red, 0, 0.82, 0.78, g);
    mesh(box(0.2, 0.06, 0.4), red, 0, 0.8, -0.82, g).rotation.x = -0.3;
    [-1, 1].forEach((s) => { mesh(cyl(0.025, 0.025, 0.72, 6), chrome, s * 0.1, 0.74, -0.7, g).rotation.x = -0.35; });
    mesh(cyl(0.02, 0.02, 0.72, 6), black, 0, 1.12, -0.58, g).rotation.z = Math.PI / 2;
    mesh(cyl(0.05, 0.065, 0.85, 8), chrome, 0.2, 0.46, 0.32, g).rotation.x = Math.PI / 2 - 0.12;
    mesh(new THREE.SphereGeometry(0.1, 12, 10), new THREE.MeshBasicMaterial({ color: 0xfff6dc }), 0, 1.0, -0.74, g);
    const hg = new THREE.Sprite(addGlow(0xfff2d0, 0.9)); hg.scale.set(1.3, 1.3, 1); hg.position.set(0, 1.0, -0.8); g.add(hg);
    mesh(box(0.16, 0.06, 0.04), new THREE.MeshBasicMaterial({ color: 0xff1020 }), 0, 0.88, 1.03, g);
    const tg = new THREE.Sprite(addGlow(0xff2030, 0.8)); tg.scale.set(0.8, 0.8, 1); tg.position.set(0, 0.88, 1.06); g.add(tg);
    const spot = new THREE.SpotLight(0xfff1d0, 0, 36, 0.5, 0.5, 1.4);
    spot.position.set(0, 1.0, -0.8);
    const tgt = new THREE.Object3D(); tgt.position.set(0, 0, -12);
    g.add(spot, tgt); spot.target = tgt;
    // Visible headlight beam cutting through rain & mist
    const beamMat = new THREE.MeshBasicMaterial({ map: beamTex, color: 0xfff2d8, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
    mesh(new THREE.ConeGeometry(2.6, 14, 24, 1, true), beamMat, 0, 0.55, -7.8, g).rotation.x = Math.PI / 2 - 0.06;
    const sh = mesh(new THREE.PlaneGeometry(1.2, 2.6), new THREE.MeshBasicMaterial({ map: shadowTex, transparent: true, depthWrite: false }), 0, 0.03, 0, g);
    sh.rotation.x = -Math.PI / 2;
    g.userData = { wheels, spot, beamMat };
    return g;
  }
  const bike = makeBike();
  bike.position.set(0, 0, Z.bike);
  scene.add(bike);
  shreyas.position.set(1.25, 0, Z.bike + 0.3);
  shreyas.rotation.y = Math.PI - 0.35;

  // Winged flyers: bats at dusk, crows at sunset
  const wingShape = new THREE.Shape();
  wingShape.moveTo(0, 0); wingShape.lineTo(0.18, 0.08); wingShape.lineTo(0.42, 0.05); wingShape.lineTo(0.55, -0.02);
  wingShape.lineTo(0.42, -0.06); wingShape.lineTo(0.36, -0.14); wingShape.lineTo(0.24, -0.08); wingShape.lineTo(0.14, -0.16); wingShape.lineTo(0.06, -0.08); wingShape.closePath();
  const batWingGeo = new THREE.ShapeGeometry(wingShape); batWingGeo.rotateX(-Math.PI / 2);
  const crowShape = new THREE.Shape();
  crowShape.moveTo(0, 0.06); crowShape.lineTo(0.3, 0.1); crowShape.lineTo(0.55, 0.06); crowShape.lineTo(0.62, 0.0); crowShape.lineTo(0.56, -0.04);
  crowShape.lineTo(0.5, -0.1); crowShape.lineTo(0.42, -0.08); crowShape.lineTo(0.36, -0.14); crowShape.lineTo(0.2, -0.1); crowShape.lineTo(0, -0.08); crowShape.closePath();
  const crowWingGeo = new THREE.ShapeGeometry(crowShape); crowWingGeo.rotateX(-Math.PI / 2);
  const flyerMat = new THREE.MeshBasicMaterial({ color: 0x07060a, side: THREE.DoubleSide });
  function makeFlyer(wingGeo, isBat, mat = flyerMat) {
    const b = new THREE.Group();
    const body = new THREE.Mesh(new THREE.SphereGeometry(0.07, 8, 6), mat); body.scale.set(1, 0.9, isBat ? 1.6 : 2.6); b.add(body);
    const wl = new THREE.Group(), wr = new THREE.Group();
    wl.add(new THREE.Mesh(wingGeo, mat)); wl.scale.x = -1;
    wr.add(new THREE.Mesh(wingGeo, mat));
    b.add(wl, wr);
    if (isBat) [-1, 1].forEach((s) => mesh(new THREE.SphereGeometry(0.014, 4, 4), new THREE.MeshBasicMaterial({ color: 0xff2a3a }), s * 0.03, 0.02, -0.1, b));
    else {
      mesh(new THREE.SphereGeometry(0.055, 8, 6), mat, 0, 0.02, -0.19, b);
      mesh(new THREE.ConeGeometry(0.02, 0.09, 5), std({ color: 0x2a2a2a }), 0, 0.01, -0.27, b).rotation.x = -Math.PI / 2;
      mesh(new THREE.PlaneGeometry(0.12, 0.16), mat, 0, 0, 0.22, b).rotation.x = -Math.PI / 2;
    }
    b.visible = false;
    b.userData = { wl, wr, flap: Math.random() * 6, fs: rand(18, 26), vel: V3(), last: V3() };
    scene.add(b);
    return b;
  }
  const bats = [];
  for (let i = 0; i < 16; i++) {
    const b = makeFlyer(batWingGeo, true);
    b.scale.setScalar(rand(0.9, 1.5));
    Object.assign(b.userData, { a: rand(0.6, 1.4), b: rand(0.8, 1.8), c: rand(0.5, 1.2), p: Math.random() * 6, rx: rand(1, 3.2), back: rand(-3, 1.2), follow: rand(1.6, 3) });
    bats.push(b);
  }
  const crows = [];
  for (let i = 0; i < 7; i++) {
    const c = makeFlyer(crowWingGeo, false);
    c.scale.setScalar(rand(2.4, 3));
    c.userData.fs = rand(7, 10);
    crows.push(c);
  }

  // Pale egrets (പക്ഷികൾ) gliding in a loose V over the river and bridge at night.
  const egretMat = new THREE.MeshBasicMaterial({ color: 0xe6edf5, side: THREE.DoubleSide });
  const riverBirds = [];
  const flock = { x: 0, y: 0, z: 0, dir: 1, speed: 0, wait: 1.5 };
  for (let i = 0; i < (lowPower ? 6 : 9); i++) {
    const b = makeFlyer(crowWingGeo, false, egretMat);
    b.scale.setScalar(rand(1.7, 2.1));
    Object.assign(b.userData, { fs: rand(5.5, 7.5), row: Math.ceil(i / 2), side: i === 0 ? 0 : (i % 2 ? 1 : -1), oy: rand(-0.4, 0.4), bobP: Math.random() * 6 });
    riverBirds.push(b);
  }

  // Pigeons resting on the road near the very start; they scatter as she approaches.
  const pigeons = [];
  function makePigeon(x, z) {
    const p = makeFlyer(crowWingGeo, false);
    p.scale.setScalar(rand(0.55, 0.7));
    p.position.set(x, 0.04, z);
    p.visible = true;
    p.userData.wl.scale.setScalar(0.001);
    p.userData.wr.scale.setScalar(0.001);
    p.userData.sitting = true;
    p.userData.bobP = Math.random() * 6;
    p.userData.home = V3(x, 0.04, z);
    pigeons.push(p);
    return p;
  }
  for (let i = 0; i < 5; i++) makePigeon(rand(-1.7, 1.7), rand(Z.paper + 6, Z.start - 3));

  function makeDog(color, scale) {
    const g = new THREE.Group();
    const m = std({ color, roughness: 0.95 });
    mesh(box(0.34, 0.34, 0.85), m, 0, 0.58, 0, g);
    const head = new THREE.Group(); head.position.set(0, 0.8, -0.5); g.add(head);
    mesh(box(0.28, 0.28, 0.3), m, 0, 0, 0, head);
    mesh(box(0.15, 0.13, 0.2), m, 0, -0.05, -0.22, head);
    mesh(box(0.06, 0.05, 0.04), std({ color: 0x050505 }), 0, -0.02, -0.33, head);
    [-1, 1].forEach((s) => {
      mesh(new THREE.ConeGeometry(0.06, 0.14, 4), m, s * 0.09, 0.18, 0.04, head).rotation.z = -s * 0.2;
      mesh(new THREE.SphereGeometry(0.022, 6, 4), new THREE.MeshBasicMaterial({ color: 0xffd35a }), s * 0.075, 0.05, -0.155, head);
    });
    const legs = [];
    [[-0.11, -0.3], [0.11, -0.3], [-0.11, 0.3], [0.11, 0.3]].forEach(([x, z]) => {
      const piv = new THREE.Group(); piv.position.set(x, 0.46, z);
      const geo = cyl(0.045, 0.04, 0.46, 6); geo.translate(0, -0.23, 0);
      piv.add(new THREE.Mesh(geo, m)); g.add(piv); legs.push(piv);
    });
    const tail = new THREE.Group(); tail.position.set(0, 0.68, 0.42); g.add(tail);
    const tg = cyl(0.03, 0.02, 0.35, 5); tg.translate(0, 0.17, 0);
    tail.add(new THREE.Mesh(tg, m)); tail.rotation.x = -0.8;
    mesh(new THREE.PlaneGeometry(0.9, 1.4), new THREE.MeshBasicMaterial({ map: shadowTex, transparent: true, depthWrite: false }), 0, 0.03, 0, g).rotation.x = -Math.PI / 2;
    g.scale.setScalar(scale);
    g.visible = false;
    g.userData = { head, legs, tail, phase: Math.random() * 6 };
    scene.add(g);
    return g;
  }
  const dogs = [makeDog(0x2a1c14, 1.0), makeDog(0x121212, 0.9), makeDog(0x5a3a22, 0.85)];
  dogs.forEach((d, i) => Object.assign(d.userData, { ox: [-1.4, 1.3, -0.6][i], back: [0.9, 1.4, 2.0][i], pitch: [300, 380, 440][i], barkT: rand(0.5, 1.5), p: Math.random() * 6, idx: i }));

  /* ------------------------------------------------------------------
     Game state (declared before per-frame systems that read it)
     ------------------------------------------------------------------ */
  const S = {
    started: false, mode: 'intro', stage: 0, t: 0,
    chase: null, hurry: false, batsLeaving: false, dogsStop: false, raining: false, rainLevel: 0,
    umbrella: false, interact: null, triggers: [], limitZ: Z.paper + 1.2,
    onBike: false, celebrating: false, crowsFlying: false, shake: 0, rideSpeed: 0,
    timers: { bat: 0, squeak: 1, lightning: 5, fw: 0, twinkle: 2, drop: 0, tap: 0, crow: 1 },
    crickets: [0, 1, 2, 3].map(() => ({ f: rand(4300, 6600), pulses: 3 + (Math.random() * 4 | 0), rate: rand(0.022, 0.032), pan: rand(-0.9, 0.9), peak: rand(0.008, 0.016), next: rand(0.5, 2) })),
  };
  const atmo = { tod: 0, storm: 0, rideClear: 0, party: 0, flash: 0 };
  const P = { x: 0, y: 0, z: Z.start, speed: 0, phase: 0, lastStep: 0 };
  const input = { forward: false };

  /* ------------------------------------------------------------------
     Rain, puddle ripples, wind streaks
     ------------------------------------------------------------------ */
  const RAIN_N = lowPower ? 1400 : 2800;
  const rainPos = new Float32Array(RAIN_N * 6);
  const rainDrops = new Float32Array(RAIN_N * 4);
  const rainGeo = new THREE.BufferGeometry();
  rainGeo.setAttribute('position', new THREE.BufferAttribute(rainPos, 3));
  const rainMat = new THREE.LineBasicMaterial({ color: 0xa8c0ff, transparent: true, opacity: 0.4, depthWrite: false });
  const rain = new THREE.LineSegments(rainGeo, rainMat);
  rain.frustumCulled = false;
  rain.visible = false;
  scene.add(rain);
  function seedRain() {
    const c = camera.position;
    for (let i = 0; i < RAIN_N; i++) {
      rainDrops[i * 4] = c.x + rand(-22, 22);
      rainDrops[i * 4 + 1] = c.y + rand(-2, 20);
      rainDrops[i * 4 + 2] = c.z + rand(-26, 12);
      rainDrops[i * 4 + 3] = rand(18, 26);
    }
  }
  const _uw = V3();
  function updateRain(dt) {
    rain.visible = S.rainLevel > 0.01;
    if (!rain.visible) return;
    const c = camera.position;
    const n = Math.floor(RAIN_N * clamp(S.rainLevel, 0, 1));
    rainGeo.setDrawRange(0, n * 2);
    rainMat.opacity = 0.2 + 0.22 * S.rainLevel;
    const shield = S.umbrella && heldUmbrella.visible;
    if (shield) heldUmbrella.userData.canopy.getWorldPosition(_uw);
    const slant = 0.06 + atmo.storm * 0.12;
    for (let i = 0; i < n; i++) {
      const o = i * 4;
      rainDrops[o + 1] -= rainDrops[o + 3] * dt;
      rainDrops[o] += slant * 2 * dt;
      let respawn = rainDrops[o + 1] < -0.5 || Math.abs(rainDrops[o] - c.x) > 24 || rainDrops[o + 2] - c.z > 14 || rainDrops[o + 2] - c.z < -30;
      if (!respawn && shield) {
        const dx = rainDrops[o] - _uw.x, dz = rainDrops[o + 2] - _uw.z;
        if (dx * dx + dz * dz < 0.8 && rainDrops[o + 1] < _uw.y && rainDrops[o + 1] > _uw.y - 3) respawn = true;
      }
      if (respawn) {
        rainDrops[o] = c.x + rand(-22, 22);
        rainDrops[o + 1] = c.y + rand(8, 20);
        rainDrops[o + 2] = c.z + rand(-28, 12);
      }
      const x = rainDrops[o], y = rainDrops[o + 1], z = rainDrops[o + 2];
      const p = i * 6;
      rainPos[p] = x; rainPos[p + 1] = y; rainPos[p + 2] = z;
      rainPos[p + 3] = x - slant; rainPos[p + 4] = y + 0.55; rainPos[p + 5] = z + 0.08;
    }
    rainGeo.attributes.position.needsUpdate = true;
  }
  const ripples = [];
  {
    const rg = new THREE.RingGeometry(0.06, 0.085, 18);
    for (let i = 0; i < 60; i++) {
      const r = new THREE.Mesh(rg, new THREE.MeshBasicMaterial({ color: 0xd8e4ff, transparent: true, opacity: 0, depthWrite: false }));
      r.rotation.x = -Math.PI / 2; r.visible = false; scene.add(r);
      ripples.push({ m: r, life: 0, max: 1 });
    }
  }
  let rippleAcc = 0, rippleIdx = 0;
  function updateRipples(dt) {
    if (S.rainLevel > 0.05) {
      rippleAcc += dt * 70 * S.rainLevel;
      while (rippleAcc > 1) {
        rippleAcc -= 1;
        const z = camera.position.z - rand(3, 18);
        if ((z < Z.riverStart && z > Z.riverEnd) || (z < Z.canyonStart && z > Z.canyonEnd)) continue;
        const rp = ripples[rippleIdx++ % ripples.length];
        rp.life = rp.max = rand(0.45, 0.7);
        rp.m.position.set(roadX(z) + rand(-4.5, 4.5), 0.03, z);
        rp.m.visible = true;
      }
    }
    for (const rp of ripples) {
      if (rp.life <= 0) continue;
      rp.life -= dt;
      const k = 1 - rp.life / rp.max;
      rp.m.scale.setScalar(0.4 + k * 3.2);
      rp.m.material.opacity = 0.45 * (1 - k);
      if (rp.life <= 0) rp.m.visible = false;
    }
  }
  const STREAK_N = 130;
  const streakPos = new Float32Array(STREAK_N * 6);
  const streakPts = [];
  const streakGeo = new THREE.BufferGeometry();
  streakGeo.setAttribute('position', new THREE.BufferAttribute(streakPos, 3));
  const streakMat = new THREE.LineBasicMaterial({ color: 0xdfe8ff, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false });
  const streaks = new THREE.LineSegments(streakGeo, streakMat);
  streaks.frustumCulled = false; streaks.visible = false; scene.add(streaks);
  for (let i = 0; i < STREAK_N; i++) streakPts.push(V3(0, -100, 0));
  function updateStreaks() {
    if (!streaks.visible) return;
    const yaw = bike.rotation.y, fx = -Math.sin(yaw), fz = -Math.cos(yaw), sx = Math.cos(yaw), sz = -Math.sin(yaw);
    const c = camera.position, sp = S.rideSpeed;
    for (let i = 0; i < STREAK_N; i++) {
      const p = streakPts[i];
      const rx = p.x - c.x, rz = p.z - c.z;
      const along = rx * fx + rz * fz, lat = rx * sx + rz * sz;
      if (along < -1 || along > 34 || Math.abs(lat) > 8) {
        const a = rand(6, 34), l = (Math.random() < 0.5 ? -1 : 1) * rand(1.2, 7);
        p.set(c.x + fx * a + sx * l, rand(0.3, 4.5), c.z + fz * a + sz * l);
      }
      const len = sp * 0.045, o = i * 6;
      streakPos[o] = p.x; streakPos[o + 1] = p.y; streakPos[o + 2] = p.z;
      streakPos[o + 3] = p.x - fx * len; streakPos[o + 4] = p.y; streakPos[o + 5] = p.z - fz * len;
    }
    streakGeo.attributes.position.needsUpdate = true;
    streakMat.opacity = 0.2 * clamp(sp / 18, 0, 1);
  }

  /* ------------------------------------------------------------------
     Fireworks (+ smoke & flashes), balloons, hearts, 3D letter
     ------------------------------------------------------------------ */
  const FW_MAX = lowPower ? 4200 : 9000;
  const fwPos = new Float32Array(FW_MAX * 3);
  const fwCol = new Float32Array(FW_MAX * 3);
  const fwVel = new Float32Array(FW_MAX * 3);
  const fwBase = new Float32Array(FW_MAX * 3);
  const fwLife = new Float32Array(FW_MAX);
  const fwMax = new Float32Array(FW_MAX).fill(1);
  const fwGeo = new THREE.BufferGeometry();
  fwGeo.setAttribute('position', new THREE.BufferAttribute(fwPos, 3));
  fwGeo.setAttribute('color', new THREE.BufferAttribute(fwCol, 3));
  const fwPoints = new THREE.Points(fwGeo, new THREE.PointsMaterial({ size: 0.65, map: glowTex, vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }));
  fwPoints.frustumCulled = false;
  scene.add(fwPoints);
  let fwCursor = 0;
  const rockets = [];
  const FW_COLORS = [0xff2a4a, 0xffc94a, 0xff6fb5, 0xffe08a, 0xff4f7a, 0xffffff, 0xffa030, 0xd98cff].map(C);
  const smokes = [], flashes = [];
  for (let i = 0; i < 36; i++) {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: smokeTex, color: 0x9a8aa8, transparent: true, opacity: 0, depthWrite: false }));
    s.visible = false; scene.add(s); smokes.push({ s, life: 0, max: 1, v: V3() });
  }
  for (let i = 0; i < 8; i++) {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: 0xffffff, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }));
    s.visible = false; scene.add(s); flashes.push({ s, life: 0, max: 1 });
  }
  let smokeIdx = 0, flashIdx = 0;
  function spawnSpark(x, y, z, vx, vy, vz, c, life) {
    const i = fwCursor; fwCursor = (fwCursor + 1) % FW_MAX;
    fwPos[i * 3] = x; fwPos[i * 3 + 1] = y; fwPos[i * 3 + 2] = z;
    fwVel[i * 3] = vx; fwVel[i * 3 + 1] = vy; fwVel[i * 3 + 2] = vz;
    fwBase[i * 3] = c.r; fwBase[i * 3 + 1] = c.g; fwBase[i * 3 + 2] = c.b;
    fwLife[i] = life; fwMax[i] = life;
  }
  function launchFirework() {
    rockets.push({
      p: V3(rand(-24, 24), 0, Z.plaza - rand(16, 44)),
      v: V3(rand(-2, 2), rand(24, 31), rand(-1, 1)),
      fuse: rand(0.95, 1.35),
      c: pick(FW_COLORS), c2: pick(FW_COLORS),
      heart: Math.random() < 0.2, ring: Math.random() < 0.2,
    });
    AudioSys.fwLaunch();
  }
  function explode(r) {
    const n = lowPower ? 150 : 280;
    const sp = rand(7.5, 12);
    for (let i = 0; i < n; i++) {
      let vx, vy, vz;
      if (r.heart) {
        const t = (i / n) * Math.PI * 2;
        vx = Math.pow(Math.sin(t), 3);
        vy = (13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t)) / 16;
        vz = rand(-0.08, 0.08);
        const s = sp * 0.85; vx *= s; vy *= s; vz *= s;
      } else if (r.ring) {
        const t = (i / n) * Math.PI * 2;
        vx = Math.cos(t) * sp; vy = Math.sin(t) * sp * 0.4 + rand(-0.5, 0.5); vz = Math.sin(t) * sp;
      } else {
        const u = Math.random() * 2 - 1, th = Math.random() * Math.PI * 2, q = Math.sqrt(1 - u * u);
        const s = sp * (0.75 + Math.random() * 0.3);
        vx = q * Math.cos(th) * s; vy = u * s; vz = q * Math.sin(th) * s;
      }
      spawnSpark(r.p.x, r.p.y, r.p.z, vx, vy, vz, r.heart ? FW_COLORS[2] : (i % 3 ? r.c : r.c2), rand(1.7, 2.6));
    }
    for (let i = 0; i < 2; i++) {
      const sm = smokes[smokeIdx++ % smokes.length];
      sm.life = sm.max = rand(4, 6); sm.s.visible = true;
      sm.s.position.set(r.p.x + rand(-2, 2), r.p.y + rand(-2, 2), r.p.z);
      sm.v.set(rand(-0.4, 0.4), rand(-0.3, 0.2), 0);
    }
    const fl = flashes[flashIdx++ % flashes.length];
    fl.life = fl.max = 0.35; fl.s.visible = true; fl.s.position.copy(r.p); fl.s.material.color.copy(r.c).lerp(C(0xffffff), 0.6);
    partyLights.flash.position.copy(r.p);
    partyLights.flash.color.copy(r.c);
    partyLights.flash.intensity = 1.2;
    AudioSys.fwBoom(clamp(r.p.x / 25, -1, 1));
  }
  function updateFireworks(dt) {
    for (let i = rockets.length - 1; i >= 0; i--) {
      const r = rockets[i];
      r.v.y -= 9 * dt;
      r.p.addScaledVector(r.v, dt);
      r.fuse -= dt;
      spawnSpark(r.p.x, r.p.y, r.p.z, rand(-0.4, 0.4), rand(-1.5, -0.5), rand(-0.4, 0.4), FW_COLORS[1], 0.45);
      if (r.fuse <= 0) { explode(r); rockets.splice(i, 1); }
    }
    const drag = Math.exp(-1.1 * dt);
    for (let i = 0; i < FW_MAX; i++) {
      if (fwLife[i] <= 0) continue;
      fwLife[i] -= dt;
      const o = i * 3;
      fwVel[o] *= drag; fwVel[o + 1] = fwVel[o + 1] * drag - 3.5 * dt; fwVel[o + 2] *= drag;
      fwPos[o] += fwVel[o] * dt; fwPos[o + 1] += fwVel[o + 1] * dt; fwPos[o + 2] += fwVel[o + 2] * dt;
      const k = Math.max(0, fwLife[i] / fwMax[i]);
      const tw = k < 0.35 ? (Math.random() < 0.5 ? 0.25 : 1.1) : 1;
      const f = k * k * tw * 1.3;
      fwCol[o] = fwBase[o] * f; fwCol[o + 1] = fwBase[o + 1] * f; fwCol[o + 2] = fwBase[o + 2] * f;
    }
    fwGeo.attributes.position.needsUpdate = true;
    fwGeo.attributes.color.needsUpdate = true;
    partyLights.flash.intensity = damp(partyLights.flash.intensity, 0, 3, dt);
    for (const sm of smokes) {
      if (sm.life <= 0) continue;
      sm.life -= dt;
      const k = 1 - sm.life / sm.max;
      sm.s.position.addScaledVector(sm.v, dt);
      sm.s.scale.setScalar(4 + k * 10);
      sm.s.material.opacity = 0.28 * Math.sin(Math.PI * k);
      if (sm.life <= 0) sm.s.visible = false;
    }
    for (const fl of flashes) {
      if (fl.life <= 0) continue;
      fl.life -= dt;
      const k = 1 - fl.life / fl.max;
      fl.s.scale.setScalar(4 + k * 16);
      fl.s.material.opacity = 0.9 * (1 - k);
      if (fl.life <= 0) fl.s.visible = false;
    }
  }

  const balloons = [];
  {
    const pastel = [0xff4f7a, 0xffc94a, 0xff8fc0, 0xb5e3ff, 0xd2b8ff, 0xb9f5d0, 0xffa46a];
    const geo = new THREE.SphereGeometry(0.5, 16, 12);
    const knot = new THREE.ConeGeometry(0.07, 0.12, 6);
    for (let i = 0; i < (lowPower ? 30 : 48); i++) {
      const c = pick(pastel);
      const m = std({ color: c, roughness: 0.2, metalness: 0.1, emissive: c, emissiveIntensity: 0.32 });
      const g = new THREE.Group();
      mesh(geo, m, 0, 0, 0, g).scale.set(1, 1.18, 1);
      mesh(knot, m, 0, -0.62, 0, g).rotation.x = Math.PI;
      const sg = new THREE.BufferGeometry().setFromPoints([V3(0, -0.66, 0), V3(0.08, -1.5, 0.03), V3(-0.05, -2.4, 0)]);
      g.add(new THREE.Line(sg, new THREE.LineBasicMaterial({ color: 0xdddddd, transparent: true, opacity: 0.6 })));
      g.position.set((Math.random() < 0.5 ? -1 : 1) * rand(2.5, 15), rand(-10, -1), Z.finalGate - rand(4, 30));
      g.userData = { s: rand(0.9, 1.9), p: Math.random() * 6, x0: g.position.x };
      g.visible = false;
      scene.add(g);
      balloons.push(g);
    }
  }
  const hearts = [];
  for (let i = 0; i < (lowPower ? 20 : 34); i++) {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: heartTex, transparent: true, opacity: 0.75, depthWrite: false }));
    const sc = rand(0.35, 0.8); s.scale.set(sc, sc, 1);
    s.position.set(rand(-10, 10), rand(-4, 8), Z.plaza + rand(-8, 12));
    s.userData = { s: rand(0.5, 1.2), p: Math.random() * 6, x0: s.position.x };
    s.visible = false;
    scene.add(s);
    hearts.push(s);
  }
  const letter3d = new THREE.Group();
  {
    // Sized and lit to clearly read as the main falling object, distinct from
    // the smaller photo papers falling alongside it.
    mesh(new THREE.PlaneGeometry(1.7, 1.2), new THREE.MeshBasicMaterial({ map: parchmentTex, side: THREE.DoubleSide, color: 0xfff2d2 }), 0, 0, 0.001, letter3d);
    const heart = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: 0xff5f95, transparent: true, depthWrite: false }));
    heart.scale.set(0.32, 0.32, 1); heart.position.set(0, 0, 0.01); letter3d.add(heart);
    const lg = new THREE.Sprite(addGlow(0xffd27a, 0.95)); lg.scale.set(4.6, 4.6, 1); letter3d.add(lg);
    letter3d.userData.glow = lg;
    letter3d.visible = false;
    scene.add(letter3d);
  }

  // Ammu's photos as polaroid papers fluttering down during the finale (images/photos.js).
  const PHOTO_CAPTIONS = ['Ammu ❤', 'My Vandana ✨', 'Happy Birthday ❤', 'My favourite smile', 'Forever us ❤', 'My Ammu 🌸', 'My beautiful girl', 'This smile ❤', 'My whole world 🌍', 'Simply Ammu ✨', 'My heart 💗', 'Always you ❤'];
  const photoPapers = [];
  const photoCenter = V3(0, 0, Z.plaza);
  {
    const srcs = (window.AMMU_PHOTOS || []).slice(0, 20);
    const photoMats = srcs.map((src, i) => {
      const img = new Image();
      const W = 384, H = 480, pad = 22, ph = 360;
      const tex = textTex(W, H, (g) => {
        g.fillStyle = '#fbf7ee'; g.fillRect(0, 0, W, H);
        g.fillStyle = '#2a2320'; g.fillRect(pad, pad, W - pad * 2, ph);
        if (img.complete && img.naturalWidth) {
          // cover-crop the photo into the window, biased a little toward the top (faces)
          const bw = W - pad * 2, s = Math.max(bw / img.naturalWidth, ph / img.naturalHeight);
          const sw = bw / s, sh = ph / s;
          g.drawImage(img, (img.naturalWidth - sw) / 2, (img.naturalHeight - sh) * 0.3, sw, sh, pad, pad, bw, ph);
        }
        g.textAlign = 'center'; g.textBaseline = 'middle';
        g.fillStyle = '#8e2448';
        fitText(g, PHOTO_CAPTIONS[i % PHOTO_CAPTIONS.length], W / 2, pad + ph + (H - pad - ph) / 2, W - 50, 700, 46, '"Dancing Script", cursive');
      });
      img.onload = textTextures[textTextures.length - 1];
      img.src = src;
      return new THREE.MeshBasicMaterial({ map: tex, color: 0xc4c4c4 });
    });
    const backMat = new THREE.MeshBasicMaterial({ color: 0xd8d3c8 });
    const geo = new THREE.PlaneGeometry(0.8, 1.0);
    const n = photoMats.length ? Math.max(18, photoMats.length) : 0;
    for (let i = 0; i < n; i++) {
      const g = new THREE.Group();
      mesh(geo, photoMats[i % photoMats.length], 0, 0, 0, g);
      mesh(geo, backMat, 0, 0, 0, g).rotation.y = Math.PI;
      g.scale.setScalar(rand(1.5, 1.9));
      g.visible = false;
      g.userData = { i, landed: 0, p: rand(0, 6), spin: rand(0.5, 1.1) * (Math.random() < 0.5 ? -1 : 1) };
      scene.add(g);
      photoPapers.push(g);
    }
  }
  function spawnPhoto(g, first) {
    const u = g.userData;
    u.x0 = photoCenter.x + rand(-5.5, 5.5);
    u.z0 = photoCenter.z + rand(-6, 4);
    u.y = first ? 6 + u.i * 0.9 + rand(0, 2) : rand(13, 18);
    u.fall = rand(0.7, 1.0);
    u.amp = rand(0.8, 1.6);
    u.landed = 0;
    g.visible = true;
  }
  function releasePhotos(cx, cz) {
    photoCenter.set(cx, 0, cz);
    photoPapers.forEach((g) => spawnPhoto(g, true));
    S.photosFlying = true;
  }
  function updatePhotos(dt) {
    if (!S.photosFlying) return;
    for (const g of photoPapers) {
      const u = g.userData;
      if (u.landed) {
        u.landed += dt;
        if (u.landed > 7) spawnPhoto(g, false);
        continue;
      }
      u.y -= u.fall * dt;
      const t = S.t + u.p;
      if (u.y <= 0.03) {
        u.y = 0.03; u.landed = 0.001;
        g.position.y = 0.03;
        g.rotation.set(-Math.PI / 2, 0, rand(-0.8, 0.8));
        continue;
      }
      g.position.set(u.x0 + Math.sin(t * 1.3) * u.amp, u.y, u.z0 + Math.cos(t * 0.8) * 0.5);
      g.rotation.set(Math.sin(t * 1.6) * 0.45, Math.sin(t * u.spin) * 0.75, Math.cos(t * 1.3) * 0.4);
    }
  }

  /* ------------------------------------------------------------------
     Audio: layered Web Audio synthesis with a convolution reverb
     ------------------------------------------------------------------ */
  const AudioSys = (() => {
    let ctx = null, master = null, sfx = null, musicBus = null, revIn = null, noiseBuf = null, engineBuf = null, muted = false;
    const loops = {};
    const ok = () => ctx && ctx.state !== 'closed';
    const now = () => ctx.currentTime;

    function makeIR(sec) {
      const sr = ctx.sampleRate, len = Math.floor(sr * sec), ir = ctx.createBuffer(2, len, sr);
      for (let ch = 0; ch < 2; ch++) {
        const d = ir.getChannelData(ch);
        for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3.4);
        for (let k = 0; k < 8; k++) { const i = Math.floor(rand(0.01, 0.09) * sr); d[i] += (Math.random() < 0.5 ? -1 : 1) * rand(0.4, 0.8); }
      }
      return ir;
    }
    function makeEngineBuf() {
      // One loop = 8 firing cycles of a single-cylinder 4-stroke at 12 Hz,
      // each slightly different; playbackRate then sets the RPM.
      const sr = ctx.sampleRate, clen = Math.floor(sr / 12), cycles = 8;
      const buf = ctx.createBuffer(1, clen * cycles, sr), d = buf.getChannelData(0);
      for (let c = 0; c < cycles; c++) {
        const amp = rand(0.8, 1.1), f1 = rand(52, 64), dec = rand(30, 42);
        for (let i = 0; i < clen; i++) {
          const t = i / sr, env = Math.exp(-t * dec);
          let v = amp * env * (Math.sin(2 * Math.PI * f1 * t) * 0.9 + Math.sin(2 * Math.PI * f1 * 2.02 * t) * 0.4 + Math.sin(2 * Math.PI * f1 * 3.1 * t) * 0.18);
          v += (Math.random() * 2 - 1) * 0.35 * Math.exp(-t * 90);
          const tick = i - Math.floor(clen * 0.55);
          if (tick > 0 && tick < sr * 0.003) v += (Math.random() * 2 - 1) * 0.07;
          d[c * clen + i] = v;
        }
      }
      return buf;
    }
    function init() {
      if (ctx) { if (ctx.state === 'suspended') ctx.resume(); return; }
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      ctx = new AC();
      master = ctx.createGain(); master.gain.value = 0.9;
      const comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -14; comp.ratio.value = 4;
      master.connect(comp); comp.connect(ctx.destination);
      sfx = ctx.createGain(); sfx.connect(master);
      musicBus = ctx.createGain(); musicBus.gain.value = 0.9; musicBus.connect(master);
      const conv = ctx.createConvolver(); conv.buffer = makeIR(2.8);
      revIn = ctx.createGain(); const revOut = ctx.createGain(); revOut.gain.value = 0.55;
      revIn.connect(conv); conv.connect(revOut); revOut.connect(master);
      noiseBuf = ctx.createBuffer(2, ctx.sampleRate * 3, ctx.sampleRate);
      for (let ch = 0; ch < 2; ch++) { const d = noiseBuf.getChannelData(ch); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1; }
      engineBuf = makeEngineBuf();
      const s = ctx.createBufferSource(); s.buffer = ctx.createBuffer(1, 1, 22050); s.connect(ctx.destination); s.start(0);
      if (ctx.state === 'suspended') ctx.resume();
    }
    function out(node, pan = 0, bus = sfx, rev = 0.08) {
      let n = node;
      if (pan && ctx.createStereoPanner) { const p = ctx.createStereoPanner(); p.pan.value = clamp(pan, -1, 1); node.connect(p); n = p; }
      n.connect(bus);
      if (rev > 0) { const r = ctx.createGain(); r.gain.value = rev; n.connect(r); r.connect(revIn); }
    }
    function noise(loop = false) { const s = ctx.createBufferSource(); s.buffer = noiseBuf; s.loop = loop; return s; }
    function filt(type, f, q = 1) { const b = ctx.createBiquadFilter(); b.type = type; b.frequency.value = Math.min(f, ctx.sampleRate / 2 - 100); b.Q.value = q; return b; }
    function gainEnv(t, peak, attack, decay) {
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(peak, t + attack);
      g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
      return g;
    }
    function burst({ t = now(), type = 'bandpass', f = 1000, q = 1, peak = 0.2, attack = 0.005, decay = 0.1, pan = 0, fEnd, rev = 0.05 }) {
      const s = noise(), b = filt(type, f, q), g = gainEnv(t, peak, attack, decay);
      if (fEnd) b.frequency.exponentialRampToValueAtTime(Math.min(fEnd, ctx.sampleRate / 2 - 100), t + attack + decay);
      s.connect(b); b.connect(g); out(g, pan, sfx, rev);
      s.start(t, Math.random() * 2); s.stop(t + attack + decay + 0.05);
    }
    function tone({ t = now(), type = 'sine', f = 440, fEnd, peak = 0.2, attack = 0.005, decay = 0.3, pan = 0, bus = sfx, filter, rev = 0.05 }) {
      const ny = ctx.sampleRate / 2 - 50;
      if (f >= ny) return;
      const o = ctx.createOscillator(); o.type = type; o.frequency.setValueAtTime(f, t);
      if (fEnd) o.frequency.exponentialRampToValueAtTime(Math.min(fEnd, ny), t + attack + decay);
      const g = gainEnv(t, peak, attack, decay);
      if (filter) { const b = filt('lowpass', filter); o.connect(b); b.connect(g); } else o.connect(g);
      out(g, pan, bus, rev);
      o.start(t); o.stop(t + attack + decay + 0.05);
    }
    function bell(f, t, peak = 0.12, bus = sfx) {
      tone({ t, f, peak, decay: 1.6, bus, rev: 0.2 });
      tone({ t, f: f * 2.76, peak: peak * 0.3, decay: 0.7, bus, rev: 0.2 });
    }
    const N = (m) => 440 * Math.pow(2, (m - 69) / 12);

    const api = {
      init,
      setMuted(m) { muted = m; if (ok()) master.gain.setTargetAtTime(m ? 0 : 0.9, now(), 0.05); },
      get muted() { return muted; },
      suspend() { if (ok() && ctx.state === 'running') ctx.suspend(); },
      resume() { if (ok() && ctx.state === 'suspended') ctx.resume(); },

      step(wet, run) {
        if (!ok()) return;
        const t = now(), v = run ? 1.2 : 1;
        tone({ t, f: 95, fEnd: 42, peak: 0.2 * v, decay: 0.07, rev: 0.02 });
        if (wet) {
          burst({ t, f: 1100, fEnd: 3600, q: 0.9, peak: 0.13 * v, attack: 0.004, decay: 0.12 });
          for (let i = 0; i < 3; i++) burst({ t: t + rand(0.03, 0.12), type: 'highpass', f: 4500, peak: 0.03, decay: 0.012 });
        } else {
          burst({ t, f: rand(1500, 2200), q: 1.6, peak: 0.07 * v, decay: 0.04 });
          burst({ t: t + 0.025, f: rand(2500, 3200), q: 2, peak: 0.035 * v, decay: 0.025 });
        }
      },
      ambience() {
        if (!ok() || loops.wind) return;
        const t = now();
        const s = noise(true), lp = filt('lowpass', 420, 0.8), g = ctx.createGain();
        g.gain.value = 0; g.gain.linearRampToValueAtTime(0.07, t + 3);
        const lfo = ctx.createOscillator(), lg = ctx.createGain(); lfo.frequency.value = 0.08; lg.gain.value = 220;
        lfo.connect(lg); lg.connect(lp.frequency);
        s.connect(lp); lp.connect(g); g.connect(sfx); s.start(); lfo.start();
        // Rustling coconut leaves: bright noise with slow, uneven gusts
        const s2 = noise(true), bp = filt('bandpass', 2600, 0.5), g2 = ctx.createGain(), am = ctx.createGain();
        g2.gain.value = 0; g2.gain.linearRampToValueAtTime(0.05, t + 3);
        am.gain.value = 0.5;
        const l1 = ctx.createOscillator(), l2 = ctx.createOscillator(), lg1 = ctx.createGain(), lg2 = ctx.createGain();
        l1.frequency.value = 0.13; l2.frequency.value = 0.37; lg1.gain.value = 0.35; lg2.gain.value = 0.2;
        l1.connect(lg1); l2.connect(lg2); lg1.connect(am.gain); lg2.connect(am.gain);
        s2.connect(bp); bp.connect(am); am.connect(g2);
        if (ctx.createStereoPanner) { const pn = ctx.createStereoPanner(); pn.pan.value = 0.3; g2.connect(pn); pn.connect(sfx); } else g2.connect(sfx);
        s2.start(0, 1.1); l1.start(); l2.start();
        const d1 = ctx.createOscillator(), d2 = ctx.createOscillator(), dg = ctx.createGain();
        d1.frequency.value = 55; d2.frequency.value = 82.6; d2.detune.value = 6; dg.gain.value = 0;
        dg.gain.linearRampToValueAtTime(0.018, t + 4);
        d1.connect(dg); d2.connect(dg); dg.connect(sfx); d1.start(); d2.start();
        loops.wind = { nodes: [s, lfo, s2, l1, l2, d1, d2], gains: [g, g2, dg] };
      },
      stopLoop(name, fade = 1.5) {
        const L = loops[name];
        if (!L || !ok()) return;
        const t = now();
        L.gains.forEach((g) => { g.gain.cancelScheduledValues(t); g.gain.setValueAtTime(g.gain.value, t); g.gain.linearRampToValueAtTime(0, t + fade); });
        L.nodes.forEach((n) => { try { n.stop(t + fade + 0.1); } catch (e) { /* already stopped */ } });
        delete loops[name];
      },
      // Tropical crickets: pulsed trains ("chillum chillum") from several voices.
      cricket(voice, level) {
        if (!ok()) return;
        const t = now();
        const o = ctx.createOscillator(), o2 = ctx.createOscillator(), g = ctx.createGain();
        o.frequency.value = Math.min(voice.f, ctx.sampleRate / 2 - 200); o2.frequency.value = Math.min(voice.f * 1.006, ctx.sampleRate / 2 - 200);
        g.gain.setValueAtTime(0, t);
        for (let k = 0; k < voice.pulses; k++) {
          const st = t + k * voice.rate;
          g.gain.setValueAtTime(0, st);
          g.gain.linearRampToValueAtTime(voice.peak * level, st + 0.004);
          g.gain.linearRampToValueAtTime(0, st + voice.rate * 0.65);
        }
        const hp = filt('highpass', 3000);
        o.connect(g); o2.connect(g); g.connect(hp); out(hp, voice.pan, sfx, 0.25);
        const end = t + voice.pulses * voice.rate + 0.05;
        o.start(t); o2.start(t); o.stop(end); o2.stop(end);
      },
      crow(pan, vol = 1) {
        if (!ok()) return;
        const t0 = now(), n = 2 + (Math.random() * 2 | 0);
        const curve = new Float32Array(256);
        for (let i = 0; i < 256; i++) curve[i] = Math.tanh((i / 128 - 1) * 4);
        for (let k = 0; k < n; k++) {
          const t = t0 + k * rand(0.34, 0.42), f = rand(520, 620);
          const o = ctx.createOscillator(), o2 = ctx.createOscillator();
          o.type = 'sawtooth'; o2.type = 'square';
          o.frequency.setValueAtTime(f * 0.9, t); o.frequency.linearRampToValueAtTime(f * 1.12, t + 0.07); o.frequency.linearRampToValueAtTime(f * 0.82, t + 0.26);
          o2.frequency.setValueAtTime(f * 1.51, t); o2.frequency.linearRampToValueAtTime(f * 1.3, t + 0.26);
          const ws = ctx.createWaveShaper(); ws.curve = curve;
          const g2 = ctx.createGain(); g2.gain.value = 0.25;
          const bp = filt('bandpass', 1350, 1.3), g = gainEnv(t, 0.14 * vol, 0.02, 0.26);
          o.connect(ws); o2.connect(g2); g2.connect(ws); ws.connect(bp); bp.connect(g); out(g, pan, sfx, 0.4);
          o.start(t); o2.start(t); o.stop(t + 0.32); o2.stop(t + 0.32);
          burst({ t, f: 2100, q: 1.2, peak: 0.035 * vol, attack: 0.02, decay: 0.22, pan, rev: 0.3 });
        }
      },
      wingFlap(pan) { if (ok()) for (let i = 0; i < 3; i++) burst({ t: now() + i * 0.13, f: 480, fEnd: 260, q: 0.8, peak: 0.06, attack: 0.02, decay: 0.09, pan }); },
      batFlap(pan) { if (ok()) burst({ f: rand(700, 1300), q: 2, peak: rand(0.05, 0.11), decay: 0.045, pan }); },
      batSqueak(pan) { if (ok()) tone({ f: rand(6500, 8500), fEnd: rand(4000, 5000), peak: 0.03, decay: 0.07, pan, rev: 0.15 }); },
      bark(pan, pitch, vol = 1, rev = 0.25) {
        if (!ok()) return;
        const t = now();
        [0, rand(0.18, 0.26)].forEach((off, i) => {
          const st = t + off, base = pitch * (i ? 0.92 : 1);
          const o = ctx.createOscillator(); o.type = 'sawtooth';
          o.frequency.setValueAtTime(base * 1.7, st);
          o.frequency.exponentialRampToValueAtTime(base * 0.75, st + 0.14);
          const bp = filt('bandpass', 1000, 1.4), lp = filt('lowpass', 2600), g = gainEnv(st, 0.32 * vol, 0.012, 0.15);
          o.connect(bp); bp.connect(lp); lp.connect(g); out(g, pan, sfx, rev);
          o.start(st); o.stop(st + 0.2);
          burst({ t: st, f: 1600, q: 1, peak: 0.1 * vol, attack: 0.01, decay: 0.1, pan, rev });
        });
      },
      // Binaural-style rain: decorrelated L/R layers + low roar; droplets scheduled separately.
      rain(level) {
        if (!ok()) return;
        if (!loops.rain) {
          if (level <= 0) return;
          const mk = (hp, lp, pan, off) => {
            const s = noise(true), a = filt('highpass', hp), b = filt('lowpass', lp), g = ctx.createGain();
            g.gain.value = 0; s.connect(a); a.connect(b); b.connect(g);
            if (ctx.createStereoPanner) { const p = ctx.createStereoPanner(); p.pan.value = pan; g.connect(p); p.connect(sfx); } else g.connect(sfx);
            s.start(0, off);
            return { s, g };
          };
          const L = mk(800, 6400, -0.85, 0.3), R = mk(900, 7400, 0.85, 1.7), roar = mk(60, 320, 0, 2.3);
          loops.rain = { nodes: [L.s, R.s, roar.s], gains: [L.g, R.g, roar.g], L, R, roar };
        }
        const r = loops.rain, t = now();
        r.L.g.gain.setTargetAtTime(0.13 * level, t, 0.8);
        r.R.g.gain.setTargetAtTime(0.13 * level, t, 0.8);
        r.roar.g.gain.setTargetAtTime(0.1 * level, t, 0.8);
        if (level <= 0) { delete loops.rain; setTimeout(() => r.nodes.forEach((n) => { try { n.stop(); } catch (e) { /* noop */ } }), 5000); }
      },
      drop(pan) { if (ok()) burst({ f: rand(3000, 6500), q: 3, peak: rand(0.02, 0.06), attack: 0.001, decay: 0.015, pan }); },
      umbrellaTap() { if (ok()) burst({ f: rand(700, 1100), q: 1.2, peak: rand(0.03, 0.06), attack: 0.001, decay: 0.03, pan: rand(-0.3, 0.3), rev: 0 }); },
      umbrellaOpen() {
        if (!ok()) return;
        const t = now();
        burst({ t, f: 500, fEnd: 2500, q: 0.7, peak: 0.25, attack: 0.15, decay: 0.2 });
        burst({ t: t + 0.36, f: 1800, q: 4, peak: 0.25, decay: 0.03 });
        tone({ t: t + 0.36, f: 180, fEnd: 90, peak: 0.2, decay: 0.08 });
      },
      distantThunder() {
        if (!ok()) return;
        const t = now();
        const s = noise(), lp = filt('lowpass', 160, 0.7), g = ctx.createGain();
        g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(0.5, t + 1.2); g.gain.linearRampToValueAtTime(0.3, t + 2.5); g.gain.exponentialRampToValueAtTime(0.0001, t + 5.5);
        s.connect(lp); lp.connect(g); out(g, rand(-0.6, 0.6), sfx, 0.6); s.start(t); s.stop(t + 6);
        tone({ t, f: 38, fEnd: 30, peak: 0.25, attack: 1, decay: 3.5, rev: 0.3 });
      },
      thunder() {
        if (!ok()) return;
        const t = now();
        burst({ t, type: 'highpass', f: 1800, peak: 0.3, attack: 0.004, decay: 0.3, rev: 0.4 });
        const s = noise(), lp = filt('lowpass', 900), g = ctx.createGain();
        lp.frequency.setValueAtTime(900, t); lp.frequency.exponentialRampToValueAtTime(80, t + 3.5);
        g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(0.8, t + 0.06); g.gain.exponentialRampToValueAtTime(0.0001, t + 4.2);
        s.connect(lp); lp.connect(g); out(g, rand(-0.5, 0.5), sfx, 0.5); s.start(t); s.stop(t + 4.5);
      },
      creak(dur = 2.5, bright = false) {
        if (!ok()) return;
        const t = now();
        const o = ctx.createOscillator(); o.type = 'sawtooth';
        for (let x = 0; x < dur; x += 0.09) o.frequency.setValueAtTime(rand(80, 150) * (bright ? 1.8 : 1), t + x);
        const bp = filt('bandpass', bright ? 1400 : 650, 7), g = ctx.createGain();
        g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(0.13, t + 0.3);
        g.gain.setValueAtTime(0.13, t + dur - 0.4); g.gain.linearRampToValueAtTime(0.0001, t + dur);
        o.connect(bp); bp.connect(g); out(g, 0, sfx, bright ? 0.7 : 0.3); o.start(t); o.stop(t + dur + 0.1);
        [0, 0.02].forEach((d, i) => tone({ t: t + dur + d, f: bright ? [660, 990][i] : [180, 270][i], peak: 0.2, decay: 1.4, rev: bright ? 0.8 : 0.3 }));
        burst({ t: t + dur, f: 400, peak: 0.25, decay: 0.2, rev: 0.5 });
      },
      rumble(dur = 3.5) {
        if (!ok()) return;
        const t = now();
        const s = noise(true), lp = filt('lowpass', 140), g = ctx.createGain();
        g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(0.4, t + 0.4);
        g.gain.setValueAtTime(0.4, t + dur - 0.5); g.gain.linearRampToValueAtTime(0.0001, t + dur);
        s.connect(lp); lp.connect(g); out(g, 0, sfx, 0.2); s.start(t); s.stop(t + dur + 0.1);
        for (let x = 0; x < dur; x += 0.22) tone({ t: t + x, type: 'square', f: 110, peak: 0.04, decay: 0.04, filter: 900 });
        burst({ t: t + dur, type: 'lowpass', f: 300, peak: 0.5, decay: 0.5, rev: 0.3 });
      },
      unlock() {
        if (!ok()) return;
        const t = now();
        burst({ t, f: 3000, q: 3, peak: 0.2, decay: 0.05 });
        burst({ t: t + 0.12, f: 2200, q: 3, peak: 0.25, decay: 0.07 });
        [1046.5, 1318.5, 1568, 2093].forEach((f, i) => bell(f, t + 0.2 + i * 0.09, 0.08));
      },
      error() {
        if (!ok()) return;
        const t = now();
        tone({ t, type: 'square', f: 220, peak: 0.07, decay: 0.12, filter: 1200 });
        tone({ t: t + 0.15, type: 'square', f: 165, peak: 0.07, decay: 0.18, filter: 1200 });
      },
      iceBell() {
        if (!ok()) return;
        const t = now();
        [0, 0.16, 0.32, 0.62, 0.78].forEach((d, i) => bell(i === 2 ? 2217 : 1760, t + d, 0.07));
      },
      coin() {
        if (!ok()) return;
        const t = now();
        tone({ t, type: 'triangle', f: 2637, peak: 0.08, decay: 0.18, rev: 0.1 });
        tone({ t: t + 0.07, type: 'triangle', f: 3520, peak: 0.07, decay: 0.3, rev: 0.1 });
      },
      paper() {
        if (!ok()) return;
        const t = now();
        for (let i = 0; i < 6; i++) burst({ t: t + rand(0, 0.45), f: rand(2500, 4500), q: 0.8, peak: 0.1, decay: rand(0.03, 0.07) });
        [1568, 2093, 2637].forEach((f, i) => bell(f, t + 0.5 + i * 0.12, 0.05));
      },
      whoosh() { if (ok()) burst({ type: 'bandpass', f: 300, fEnd: 1800, q: 0.8, peak: 0.2, attack: 0.5, decay: 0.9 }); },
      cable(on) {
        if (!ok()) return;
        if (on && !loops.cable) {
          const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = 58;
          const lp = filt('lowpass', 240), g = ctx.createGain(); g.gain.value = 0; g.gain.linearRampToValueAtTime(0.06, now() + 1);
          o.connect(lp); lp.connect(g); g.connect(sfx); o.start();
          loops.cable = { nodes: [o], gains: [g] };
        } else if (!on) api.stopLoop('cable', 1.2);
      },
      // Vintage single-cylinder 4-stroke commuter bike.
      engineStart() {
        if (!ok() || loops.engine) return;
        const t = now();
        const src = ctx.createBufferSource(); src.buffer = engineBuf; src.loop = true; src.playbackRate.value = 0.7;
        const ws = ctx.createWaveShaper(), curve = new Float32Array(512);
        for (let i = 0; i < 512; i++) curve[i] = Math.tanh((i / 256 - 1) * 2.4);
        ws.curve = curve;
        const lp = filt('lowpass', 700, 1.2), eg = ctx.createGain();
        eg.gain.value = 0; eg.gain.linearRampToValueAtTime(0.5, t + 0.3);
        src.connect(ws); ws.connect(lp); lp.connect(eg); out(eg, 0, sfx, 0.06);
        const tap = noise(true), tbp = filt('bandpass', 3200, 2), tg = ctx.createGain(); tg.gain.value = 0.012;
        tap.connect(tbp); tbp.connect(tg); tg.connect(eg);
        src.start(); tap.start();
        burst({ t, f: 900, q: 2, peak: 0.2, decay: 0.08 });
        burst({ t: t + 0.1, type: 'lowpass', f: 400, peak: 0.4, decay: 0.35 });
        loops.engine = { nodes: [src, tap], gains: [eg], src, lp, tg };
      },
      engineSet(x) {
        const L = loops.engine; if (!L) return;
        const t = now();
        L.src.playbackRate.setTargetAtTime(0.7 + x * 2.7, t, 0.18);
        L.lp.frequency.setTargetAtTime(650 + x * 1700, t, 0.2);
        L.tg.gain.setTargetAtTime(0.012 + x * 0.03, t, 0.2);
      },
      engineRev() { api.engineSet(0.9); setTimeout(() => api.engineSet(0.05), 520); },
      fwLaunch() { if (ok()) { tone({ f: 380, fEnd: 1500, peak: 0.03, attack: 0.05, decay: 0.9, pan: rand(-0.6, 0.6) }); burst({ type: 'highpass', f: 3000, peak: 0.04, attack: 0.05, decay: 0.8 }); } },
      fwBoom(pan) {
        if (!ok()) return;
        const t = now();
        burst({ t, type: 'lowpass', f: 600, fEnd: 70, peak: 0.55, attack: 0.005, decay: 1.4, pan, rev: 0.6 });
        for (let i = 0; i < 18; i++) burst({ t: t + rand(0.3, 1.5), type: 'highpass', f: 4000, peak: rand(0.02, 0.06), decay: 0.02, pan: pan + rand(-0.3, 0.3), rev: 0.2 });
      },
      chime() { if (ok()) [784, 988, 1175, 1568].forEach((f, i) => bell(f, now() + i * 0.1, 0.07)); },

      piano(f, t, v = 0.4, pan = 0) {
        const ny = ctx.sampleRate / 2 - 100;
        const gLow = ctx.createGain(), gHigh = ctx.createGain();
        const dec = f < 300 ? 4.5 : f < 700 ? 3.2 : 2.2;
        [[gLow, v, dec], [gHigh, v * 0.55, dec * 0.35]].forEach(([g, pk, d]) => {
          g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(pk, t + 0.006); g.gain.setTargetAtTime(0.0001, t + 0.01, d / 4.5);
        });
        [1, 0.45, 0.25, 0.16, 0.1, 0.06].forEach((a, i) => {
          const n = i + 1, fn = f * n * Math.sqrt(1 + 0.0004 * n * n);
          if (fn >= ny) return;
          const o = ctx.createOscillator(); o.frequency.value = fn;
          const og = ctx.createGain(); og.gain.value = a;
          o.connect(og); og.connect(i < 2 ? gLow : gHigh);
          o.start(t); o.stop(t + dec + 0.3);
        });
        const lp = filt('lowpass', 4200);
        gLow.connect(lp); gHigh.connect(lp); out(lp, pan, musicBus, 0.35);
        burst({ t, type: 'lowpass', f: 2600, peak: v * 0.05, attack: 0.001, decay: 0.03, pan, rev: 0.1 });
      },
      musicBox(f, t, v = 0.12) {
        tone({ t, f, peak: v, attack: 0.002, decay: 1.5, bus: musicBus, rev: 0.45 });
        tone({ t, f: f * 3.0, peak: v * 0.25, attack: 0.002, decay: 0.5, bus: musicBus, rev: 0.45 });
        tone({ t, f: f * 5.2, peak: v * 0.08, attack: 0.001, decay: 0.2, bus: musicBus, rev: 0.45 });
      },
      song() {
        if (!ok()) return 0;
        const beat = 0.62, t0 = now() + 0.3;
        [72, 76, 79, 84, 79, 76, 72, 79, 84, 88, 84, 79].forEach((m, i) => api.musicBox(N(m + 12), t0 + i * beat * 0.5, 0.09));
        const s0 = t0 + 6 * beat;
        const mel = [
          [0, 67], [0.75, 67], [1, 69], [2, 67], [3, 72], [4, 71],
          [6, 67], [6.75, 67], [7, 69], [8, 67], [9, 74], [10, 72],
          [12, 67], [12.75, 67], [13, 79], [14, 76], [15, 72], [16, 71], [17, 69],
          [18, 77], [18.75, 77], [19, 76], [20, 72], [21, 74], [22, 72],
        ];
        const CH = { C: [48, 55, 60, 64, 67], G: [43, 50, 55, 59, 62], F: [41, 53, 57, 60, 65] };
        const bars = [[1, 'C'], [4, 'G'], [7, 'G'], [10, 'C'], [13, 'C'], [16, 'F'], [19, 'C'], [22, 'C']];
        mel.forEach(([b, m]) => {
          const t = s0 + b * beat, swell = b >= 12 ? 1.25 : 1;
          api.piano(N(m), t, 0.3 * swell, 0.1);
          api.musicBox(N(m + 24), t, 0.05 * swell);
        });
        bars.forEach(([b, name]) => {
          for (let k = 0; k < (b === 22 ? 1 : 3); k++) {
            const chord = CH[b === 19 && k === 2 ? 'G' : name], t = s0 + (b + k) * beat;
            if (k === 0) {
              api.piano(N(chord[0]), t, 0.22, -0.25);
              if (b === 22) chord.slice(1).forEach((m, j) => api.piano(N(m), t + 0.05 * (j + 1), 0.13, -0.1));
            } else chord.slice(2).forEach((m, j) => api.piano(N(m), t + 0.02 * j, 0.07, -0.15));
          }
        });
        // String pad swelling through the last two phrases
        const padG = ctx.createGain(), padLp = filt('lowpass', 1400, 0.7);
        padG.gain.setValueAtTime(0.0001, s0 + 11 * beat);
        padG.gain.linearRampToValueAtTime(0.05, s0 + 21 * beat);
        padG.gain.setValueAtTime(0.05, s0 + 23 * beat);
        padG.gain.linearRampToValueAtTime(0.0001, s0 + 28 * beat);
        padLp.connect(padG); out(padG, 0, musicBus, 0.5);
        const padBars = bars.slice(3);
        padBars.forEach(([b, name], i) => {
          const t = s0 + b * beat, end = s0 + (padBars[i + 1] ? padBars[i + 1][0] : 28) * beat;
          CH[name].slice(1, 4).forEach((m) => {
            [-7, 7].forEach((det) => {
              const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = N(m + 12); o.detune.value = det;
              const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(0.3, t + 0.4); g.gain.setValueAtTime(0.3, end - 0.1); g.gain.linearRampToValueAtTime(0.0001, end + 0.3);
              o.connect(g); g.connect(padLp); o.start(t); o.stop(end + 0.4);
            });
          });
        });
        [84, 88, 91, 96].forEach((m, i) => api.musicBox(N(m), s0 + (22 + i * 0.5) * beat + 0.3, 0.06));
        return 32 * beat;
      },
      twinkle() { if (ok()) api.musicBox(N(pick([84, 88, 91, 96, 100])), now(), 0.03); },
    };
    return api;
  })();

  /* ------------------------------------------------------------------
     HUD helpers
     ------------------------------------------------------------------ */
  const ui = {
    hud: $('hud'), chapterCard: $('chapter-card'), chapterNum: $('chapter-num'), chapterTitle: $('chapter-title'),
    objective: $('objective'), objectiveText: $('objective-text'), narration: $('narration'),
    prompt: $('prompt'), promptText: $('prompt-text'), promptKey: $('prompt-key'),
    mobile: $('mobile-controls'), btnWalk: $('btn-walk'), btnAction: $('btn-action'),
    fade: $('fade'), flash: $('flash'), alert: $('alert'), alertText: $('alert-text'),
    speedo: $('speedo'), speedoNum: $('speedo-num'), speedoArc: $('speedo-arc'), speedoNeedle: $('speedo-needle'),
    modalOpen: false,
  };
  const ROMAN = ['', 'I', 'II', 'III', 'IV', 'V', 'VI'];
  let chapterTimer = 0, sayTimer = 0, alertTimer = 0;
  function chapter(n, title) {
    ui.chapterNum.textContent = n ? `Chapter ${ROMAN[n]}` : '';
    ui.chapterTitle.textContent = title;
    ui.chapterCard.classList.add('show');
    clearTimeout(chapterTimer);
    chapterTimer = setTimeout(() => ui.chapterCard.classList.remove('show'), 3800);
  }
  function objective(text) {
    ui.objective.classList.add('fade');
    setTimeout(() => { ui.objectiveText.textContent = text; ui.objective.classList.toggle('fade', !text); }, 350);
  }
  function say(text, dur = 4) {
    ui.narration.textContent = text;
    ui.narration.classList.add('show');
    clearTimeout(sayTimer);
    sayTimer = setTimeout(() => ui.narration.classList.remove('show'), dur * 1000);
  }
  function alertBox(text, dur = 4.5) {
    ui.alertText.textContent = text;
    ui.alert.classList.add('show');
    clearTimeout(alertTimer);
    alertTimer = setTimeout(() => ui.alert.classList.remove('show'), dur * 1000);
  }
  function setSpeedo(kmh) {
    const pct = clamp(kmh / 120, 0, 1);
    ui.speedoNum.textContent = Math.round(kmh);
    ui.speedoArc.style.strokeDashoffset = String(100 - pct * 100);
    ui.speedoNeedle.style.transform = `rotate(${-135 + pct * 270}deg)`;
  }
  function fadeTo(o) { ui.fade.style.opacity = o; return wait(0.48); }
  function lightningFlash(strength = 0.75, thunder = true) {
    ui.flash.style.transition = 'none';
    ui.flash.style.opacity = String(strength);
    requestAnimationFrame(() => { ui.flash.style.transition = 'opacity 0.6s ease-out'; ui.flash.style.opacity = '0'; });
    atmo.flash = strength;
    if (thunder) setTimeout(() => AudioSys.thunder(), rand(300, 1200));
  }

  /* ------------------------------------------------------------------
     Answer checking
     ------------------------------------------------------------------ */
  const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
  function dateMatches(input, d, m, y) {
    const s = String(input).toLowerCase().replace(/(\d+)(st|nd|rd|th)\b/g, '$1');
    const nums = (s.match(/\d+/g) || []).map(Number);
    const words = s.match(/[a-z]+/g) || [];
    const yOk = (n) => n === y || n === y % 100;
    let month = 0;
    for (const w of words) {
      const i = MONTHS.findIndex((full) => w.length >= 3 && full.startsWith(w));
      if (i >= 0) { month = i + 1; break; }
      if (w === 'sept') { month = 9; break; }
    }
    if (month) return month === m && nums.length === 2 && ((nums[0] === d && yOk(nums[1])) || (nums[1] === d && yOk(nums[0])));
    const raw = s.match(/\d+/g) || [];
    if (raw.length === 1 && raw[0].length === 8) {
      const str = raw[0];
      const a = +str.slice(0, 2), b = +str.slice(2, 4), c = +str.slice(4);
      const Y = +str.slice(0, 4), M = +str.slice(4, 6), D = +str.slice(6);
      return (a === d && b === m && c === y) || (a === m && b === d && c === y) || (Y === y && M === m && D === d);
    }
    if (nums.length === 3) {
      const [a, b, c] = nums;
      return (a === d && b === m && yOk(c)) || (a === m && b === d && yOk(c)) || (a === y && b === m && c === d);
    }
    return false;
  }
  // Only the total is stored, so the two phone numbers never appear in the source.
  const PHONE_SUM = 19153650503;
  function phoneSumMatches(input) {
    const vals = String(input).split(/\+|&|plus|and/i)
      .map((p) => p.replace(/\D/g, ''))
      .filter(Boolean)
      .map((p) => (p.length === 12 && p.startsWith('91') ? p.slice(2) : p))
      .map(Number);
    if (!vals.length || vals.length > 2) return false;
    return vals.reduce((a, b) => a + b, 0) === PHONE_SUM;
  }
  // The call-Shreyas task: dial his number to place the call.
  const SHREYAS_NUMBER = '9946249402';
  function phoneMatches(input) {
    let d = String(input).replace(/\D/g, '');
    if (d.length === 12 && d.startsWith('91')) d = d.slice(2);
    else if (d.length === 11 && d.startsWith('0')) d = d.slice(1);
    return d === SHREYAS_NUMBER;
  }

  /* ------------------------------------------------------------------
     Camera
     ------------------------------------------------------------------ */
  const cam = { pos: V3(3, 2.4, 16), look: V3(0, 1.5, 0), tPos: V3(), tLook: V3(), fn: null, lambda: 3.2 };
  function camFollow() {
    const run = !!S.chase || S.hurry;
    const back = camera.aspect < 0.8 ? 6.6 : 5.4;
    cam.tPos.set(P.x + 0.4, P.y + (run ? 2.1 : 2.5) + (S.umbrella ? 0.35 : 0), P.z + (run ? back - 0.5 : back));
    cam.tLook.set(P.x, P.y + 1.35, P.z - 5);
  }

  /* ------------------------------------------------------------------
     Puzzles
     ------------------------------------------------------------------ */
  const PUZZLES = {
    gate1: {
      tag: 'The Old CUSAT Gate', icon: '🗝️',
      question: 'When did you first meet your partner?',
      placeholder: 'e.g. Month DD YYYY or DD/MM/YYYY',
      inputmode: 'text',
      check: (s) => dateMatches(s, 13, 11, 2023),
      hints: ['Think back to the day your story began… 🍂', 'It was a chilly November day in 2023. Try a format like DD/MM/YYYY.'],
      onSolve: () => openGate1(),
    },
    bridge: {
      tag: 'Bridge Control Panel', icon: '🌉',
      question: 'Which spot did you both have your first food together?',
      placeholder: 'Type the name of the place',
      inputmode: 'text',
      check: (s) => s.toLowerCase().replace(/[^a-z]/g, '').includes('arya'),
      hints: ['Somewhere your first meal together tasted extra special 🍽️', "The name starts with 'A'…"],
      onSolve: () => lowerBridge(),
    },
    ropeway: {
      tag: 'Ropeway Electronic Lock', icon: '🚡',
      question: 'Add your mobile number + partner mobile number',
      placeholder: 'your number + his number',
      inputmode: 'tel',
      check: phoneSumMatches,
      hints: ['Type both 10-digit numbers with a + between them 📱', 'You can also type the final sum directly.'],
      onSolve: () => startRopeway(),
    },
    final: {
      tag: 'The Golden Gate', icon: '🎂',
      question: 'Enter your date of birth',
      placeholder: 'DD/MM/YYYY',
      inputmode: 'text',
      check: (s) => dateMatches(s, 29, 9, 2004),
      hints: ['The day the world became a little brighter ✨', 'Try DD/MM/YYYY, e.g. 01/01/2000.'],
      onSolve: () => celebrate(),
    },
  };
  const pz = {
    modal: $('puzzle-modal'), card: $('puzzle-form'), icon: $('puzzle-icon'), tag: $('puzzle-tag'),
    q: $('puzzle-question'), input: $('puzzle-input'), fb: $('puzzle-feedback'), hint: $('puzzle-hint'),
    current: null, prevMode: 'walk', solving: false,
  };
  function openPuzzle(cfg) {
    if (ui.modalOpen) return;
    pz.current = cfg;
    if (cfg.attempts == null) cfg.attempts = 0;
    pz.prevMode = S.mode;
    S.mode = 'modal';
    input.forward = false;
    ui.modalOpen = true;
    ui.prompt.classList.add('hidden');
    pz.icon.textContent = cfg.icon;
    pz.tag.textContent = cfg.tag;
    pz.q.textContent = cfg.question;
    pz.input.value = '';
    pz.input.placeholder = cfg.placeholder;
    pz.input.setAttribute('inputmode', cfg.inputmode);
    pz.fb.textContent = ''; pz.fb.className = '';
    pz.hint.textContent = cfg.attempts >= 2 ? cfg.hints[Math.min(cfg.attempts - 2, cfg.hints.length - 1)] : '';
    pz.card.classList.remove('solved', 'shake');
    pz.modal.classList.remove('hidden');
    pz.input.focus({ preventScroll: true });
    AudioSys.chime();
  }
  function closePuzzle() {
    pz.modal.classList.add('hidden');
    pz.input.blur();
    ui.modalOpen = false;
    S.mode = pz.prevMode === 'modal' ? 'walk' : pz.prevMode;
  }
  pz.card.addEventListener('submit', (e) => {
    e.preventDefault();
    const cfg = pz.current;
    if (!cfg || pz.solving) return;
    const val = pz.input.value.trim();
    if (!val) { pz.fb.textContent = 'Type your answer first ♡'; pz.fb.className = 'bad'; return; }
    if (cfg.check(val)) {
      pz.solving = true;
      pz.fb.textContent = 'Unlocked! ✨'; pz.fb.className = 'good';
      pz.card.classList.add('solved');
      pz.input.blur();
      setTimeout(() => {
        pz.solving = false;
        closePuzzle();
        S.mode = 'cutscene';
        S.interact = null;
        cfg.onSolve();
      }, 750);
    } else {
      cfg.attempts++;
      AudioSys.error();
      pz.fb.textContent = pick(['Not quite… try again ♡', "Hmm, that's not it. One more try!", 'Almost! Think again 💭']);
      pz.fb.className = 'bad';
      if (cfg.attempts >= 2) pz.hint.textContent = cfg.hints[Math.min(cfg.attempts - 2, cfg.hints.length - 1)];
      pz.card.classList.remove('shake'); void pz.card.offsetWidth; pz.card.classList.add('shake');
      pz.input.select();
    }
  });
  $('puzzle-cancel').addEventListener('click', () => closePuzzle());

  /* ------------------------------------------------------------------
     Phone call task (dial Shreyas's number)
     ------------------------------------------------------------------ */
  const ph = {
    modal: $('phone-modal'), card: $('phone-card'), status: $('phone-status'),
    display: $('phone-display'), fb: $('phone-feedback'), hint: $('phone-hint'),
    digits: '', attempts: 0, prevMode: 'walk', solving: false, onSolve: null,
  };
  const PHONE_HINTS = ['Dial the number that first comes to mind… 📱', 'It starts with 99462…'];
  function updatePhoneDisplay() {
    ph.display.textContent = ph.digits ? ph.digits.replace(/(\d{5})(\d{0,5})/, (m, a, b) => (b ? `${a} ${b}` : a)) : ' ';
  }
  function openPhoneCall(onSolve) {
    if (ui.modalOpen) return;
    ph.onSolve = onSolve;
    ph.digits = ''; ph.attempts = 0; ph.solving = false;
    ph.prevMode = S.mode;
    S.mode = 'modal';
    input.forward = false;
    ui.modalOpen = true;
    ui.prompt.classList.add('hidden');
    ph.status.textContent = 'Dial his number to call him';
    ph.fb.textContent = ''; ph.fb.className = '';
    ph.hint.textContent = '';
    ph.card.classList.remove('solved', 'shake');
    updatePhoneDisplay();
    ph.modal.classList.remove('hidden');
    AudioSys.chime();
  }
  function closePhoneCall() {
    ph.modal.classList.add('hidden');
    ui.modalOpen = false;
    S.mode = ph.prevMode === 'modal' ? 'walk' : ph.prevMode;
  }
  $('phone-keypad').addEventListener('click', (e) => {
    const btn = e.target.closest('.key');
    if (!btn || ph.solving) return;
    const k = btn.dataset.k;
    if (k === 'cancel') { closePhoneCall(); return; }
    if (k === 'back') ph.digits = ph.digits.slice(0, -1);
    else if (ph.digits.length < 10) ph.digits += k;
    ph.fb.textContent = ''; ph.fb.className = '';
    updatePhoneDisplay();
  });
  $('phone-call-btn').addEventListener('click', async () => {
    if (ph.solving) return;
    if (!ph.digits) { ph.fb.textContent = 'Dial a number first ♡'; ph.fb.className = 'bad'; return; }
    if (phoneMatches(ph.digits)) {
      ph.solving = true;
      ph.status.textContent = 'Calling…';
      ph.fb.textContent = 'Connecting ✨'; ph.fb.className = 'good';
      ph.card.classList.add('solved');
      AudioSys.unlock();
      await wait(1.1);
      ph.status.textContent = 'Connected ❤';
      await wait(0.5);
      ph.solving = false;
      closePhoneCall();
      S.interact = null;
      const onSolve = ph.onSolve;
      if (onSolve) onSolve();
    } else {
      ph.attempts++;
      AudioSys.error();
      ph.fb.textContent = pick(['Wrong number… try again ♡', "That's not his number.", 'Almost! Check the digits 💭']);
      ph.fb.className = 'bad';
      if (ph.attempts >= 2) ph.hint.textContent = PHONE_HINTS[Math.min(ph.attempts - 2, PHONE_HINTS.length - 1)];
      ph.card.classList.remove('shake'); void ph.card.offsetWidth; ph.card.classList.add('shake');
    }
  });

  const paperModal = $('paper-modal');
  $('paper-close').addEventListener('click', () => {
    paperModal.classList.add('hidden');
    ui.modalOpen = false;
    startBats();
  });

  /* ------------------------------------------------------------------
     Story flow
     ------------------------------------------------------------------ */
  function launchCrows() {
    crows.forEach((c, i) => {
      c.visible = true;
      c.position.set(-46 - i * 2.5 - rand(0, 3), rand(13, 19), P.z - rand(18, 32));
      c.userData.vel.set(rand(8, 10), rand(-0.2, 0.2), rand(-0.8, 0.8));
      c.userData.last.copy(c.position);
    });
    S.crowsFlying = true;
    AudioSys.crow(-0.7, 0.8);
  }

  function beginGame() {
    if (S.started) return;
    S.started = true;
    AudioSys.init();
    unlockTrack();
    AudioSys.ambience();
    $('start-screen').classList.add('leaving');
    setTimeout(() => $('start-screen').classList.add('hidden'), 1300);
    ui.hud.classList.remove('hidden');
    if (isTouch) { ui.mobile.classList.remove('hidden'); ui.promptKey.textContent = '✦'; document.body.classList.add('touch'); }
    S.mode = 'walk';
    S.stage = 1;
    setTimeout(() => chapter(1, 'The Dropped Paper'), 900);
    objective(isTouch ? 'Hold Walk to stroll through the town' : 'Press W / ↑ to walk through the town');
    setTimeout(() => say('The sun is melting into the Arabian Sea… Vandana walks home through the quiet town.', 5), 1600);
    setTimeout(launchCrows, 2600);
    S.limitZ = Z.paper + 1.1;
    S.interact = { z: Z.paper + 1.1, range: 2.2, text: 'Pick up the paper', fn: pickPaper };
    S.triggers.push({ z: Z.paper + 7, fn: () => say('Something pale is lying on the road ahead…', 3.5) });
  }

  async function pickPaper() {
    S.interact = null;
    S.mode = 'cutscene';
    P.speed = 0;
    const p = vandana.userData.parts;
    AudioSys.paper();
    vandana.userData.lock = true;
    await tween(0.45, (k) => { p.body.rotation.x = 0.55 * k; p.armR.rotation.x = 0.9 * k; p.body.position.y = -0.18 * k; });
    paper.visible = false;
    await tween(0.4, (k) => { p.body.rotation.x = 0.55 * (1 - k); p.armR.rotation.x = 0.9 - 1.6 * k; p.body.position.y = -0.18 * (1 - k); });
    vandana.userData.lock = false;
    ui.modalOpen = true;
    S.mode = 'modal';
    paperModal.classList.remove('hidden');
  }

  function startBats() {
    S.mode = 'walk';
    S.stage = 2;
    S.chase = 'bats';
    S.shake = 0.25;
    bats.forEach((b) => {
      b.visible = true;
      b.position.set(P.x + rand(-4, 4), rand(3, 7), P.z + rand(12, 20));
      b.userData.last.copy(b.position);
    });
    AudioSys.whoosh();
    startBatSound();
    chapter(2, 'Wings in the Dusk');
    say('Dusk falls… and a rush of wings sweeps in behind her. Bats! RUN!', 3.8);
    objective('Run to the old CUSAT gate!');
    S.limitZ = Z.gate1 + 2.2;
    S.interact = { z: Z.gate1 + 2.2, range: 2.4, text: 'Inspect the gate lock', fn: () => openPuzzle(PUZZLES.gate1) };
    S.triggers.push({ z: Z.gate1 + 10, fn: () => say('The old university gate is locked… a question is engraved on the lock.', 3.8) });
  }

  async function openGate1() {
    AudioSys.unlock();
    gate1.lockMat.color.set(0x44ff99);
    gate1.lockGlow.material.color.set(0x44ff99);
    S.batsLeaving = true;
    stopBatSound();
    bats.forEach((b) => b.userData.vel.set(rand(-3, 3), rand(3, 6), rand(-8, -3)));
    say('The lock clicks open… and the bats scatter into the night.', 4);
    const l0 = gate1.lock.position.y;
    tween(0.7, (k) => { gate1.lock.position.y = l0 - k * (l0 - 0.1); gate1.lock.rotation.z = k * 1.2; }, ease.in);
    await wait(0.4);
    AudioSys.creak(2.6);
    cam.fn = () => { cam.tPos.set(P.x + 2.6, 2.4, P.z + 5); cam.tLook.set(0, 2.6, Z.gate1 - 2); };
    await tween(2.6, (k) => { gate1.left.rotation.y = 1.75 * k; gate1.right.rotation.y = -1.75 * k; }, ease.inOutSine);
    S.chase = null;
    bats.forEach((b) => { b.visible = false; });
    cam.fn = null;
    S.mode = 'walk';
    S.stage = 3;
    objective('Buy an ice cream at the CUSAT campus cart 🍦');
    S.limitZ = Z.iceStop;
    S.interact = { z: Z.iceStop, range: 2.4, text: 'Buy an ice cream', fn: buyIceCream };
    S.triggers.push({ z: Z.gate1 - 1.5, fn: () => { AudioSys.iceBell(); say('Ting-ting! An ice-cream cart is ringing its bell just inside the campus…', 3.8); } });
  }

  async function buyIceCream() {
    S.interact = null;
    S.mode = 'cutscene';
    P.speed = 0;
    input.forward = false;
    const p = vandana.userData.parts, vp = iceVendor.userData.parts;
    vandana.userData.lock = true;
    cam.fn = () => { cam.tPos.set(P.x - 2.4, 2.1, P.z + 3.4); cam.tLook.set(2.2, 1.3, Z.iceCart); };
    await tween(0.55, (k) => { p.body.rotation.y = -0.95 * k; }, ease.inOut);
    AudioSys.iceBell();
    await tween(0.4, (k) => { vp.armR.rotation.z = 2.5 * k; });
    say('"Chetta, oru ice cream!" Chocolate and vanilla, with extra sprinkles. 🍦', 3.6);
    for (let i = 0; i < 3; i++) await tween(0.3, (k) => { vp.armR.rotation.z = 2.5 + Math.sin(k * Math.PI) * 0.35; });
    await tween(0.4, (k) => { vp.armR.rotation.z = 2.5 * (1 - k); });
    await wait(0.4);
    AudioSys.coin();
    await tween(0.5, (k) => { vp.armR.rotation.x = 1.3 * k; p.armL.rotation.x = 1.35 * k; p.armL.rotation.z = 0.45 * k; });
    heldCone.visible = true;
    heldCone.userData.scoops.scale.setScalar(1);
    AudioSys.paper();
    await wait(0.35);
    tween(0.5, (k) => { vp.armR.rotation.x = 1.3 * (1 - k); });
    await tween(0.55, (k) => { p.body.rotation.y = -0.95 * (1 - k); }, ease.inOut);
    vandana.userData.lock = false;
    vandana.userData.holdCone = true;
    S.iceCream = true;
    cam.fn = null;
    S.mode = 'walk';
    say('The first bite is cold and sweet, the perfect start to the night.', 3.4);
    objective('Enjoy your ice cream and follow the road toward the river');
    S.limitZ = Z.bridgeStop;
    S.triggers.push({ z: -76.5, fn: () => {
      S.iceCream = false;
      vandana.userData.holdCone = false;
      heldCone.visible = false;
      vandana.userData.parts.head.rotation.x = 0;
      say('The last crunchy bite of the cone… happiness tastes like chocolate tonight.', 3.2);
    } });
    S.triggers.push({ z: -84, fn: () => { chapter(3, 'The River Bridge'); say('Night has fallen over a wide, dark river… and the bridge is raised!', 4); objective('Find the bridge control panel'); } });
    S.interact = { z: Z.bridgeStop, range: 2.4, text: 'Use the bridge control panel', fn: () => openPuzzle(PUZZLES.bridge) };
  }

  async function lowerBridge() {
    AudioSys.unlock();
    bridgePivot.userData.panelMat.color.set(0x44ff99);
    bridgePivot.userData.panelGlow.material.color.set(0x44ff99);
    say('Gears groan to life… the bridge begins to lower.', 4);
    cam.fn = () => { cam.tPos.set(7.5, 4.2, Z.riverStart + 7); cam.tLook.set(0, 1.5, Z.riverStart - 8); };
    await wait(0.6);
    AudioSys.rumble(3.8);
    const r0 = bridgePivot.rotation.x;
    await tween(3.8, (k) => { bridgePivot.rotation.x = r0 * (1 - k); }, ease.inOutSine);
    S.shake = 0.2;
    for (let i = 0; i < bridgeLamps.length; i += 2) {
      bridgeLamps[i].onAt = -1; bridgeLamps[i + 1].onAt = -1;
      await wait(0.3);
    }
    cam.fn = null;
    S.mode = 'walk';
    objective('Cross the bridge, then call Shreyas 📞');
    S.limitZ = Z.callSpot;
    S.interact = { z: Z.callSpot, range: 2.4, text: 'Call Shreyas 📞', fn: () => openPhoneCall(callShreyas) };
    S.triggers.push({ z: Z.riverEnd - 0.5, fn: () => say('Her phone buzzes in her pocket… time to call Shreyas.', 3.4) });
  }

  async function callShreyas() {
    S.mode = 'cutscene';
    input.forward = false;
    P.speed = 0;
    const p = vandana.userData.parts;
    vandana.userData.lock = true;
    heldPhone.visible = true;
    await tween(0.4, (k) => { p.armR.rotation.x = lerp(0, 2.6, k); p.armR.rotation.z = lerp(0, -0.95, k); });
    AudioSys.chime();
    say('"Hey Ammu, almost there? Be careful, it looks like rain," Shreyas says.', 4.2);
    await wait(3.6);
    say('"I will, I promise. See you soon," she smiles into the phone.', 3.2);
    await wait(3);
    await tween(0.4, (k) => { p.armR.rotation.x = lerp(2.6, 0, k); p.armR.rotation.z = lerp(-0.95, 0, k); });
    heldPhone.visible = false;
    vandana.userData.lock = false;
    S.mode = 'walk';
    objective('Continue toward the hills');
    S.limitZ = Z.shelterStop;
    S.triggers.push({ z: Z.storm, fn: startStorm });
  }

  async function startStorm() {
    S.mode = 'cutscene';
    S.stage = 4;
    input.forward = false;
    const p = vandana.userData.parts;
    AudioSys.distantThunder();
    lightningFlash(0.18, false);
    say('The wind drops. Far away, thunder rolls across the hills…', 3.5);
    tween(3.5, (k) => { atmo.storm = k; p.head.rotation.x = -0.35 * Math.sin(Math.PI * Math.min(1, k * 1.2)); }, ease.inOut);
    await wait(2.6);
    S.raining = true;
    seedRain();
    tween(2, (k) => { S.rainLevel = k; }, ease.in);
    AudioSys.rain(1);
    lightningFlash(0.8, true);
    S.shake = 0.15;
    await wait(0.4);
    alertBox('Heavy rain started! Find shelter or an umbrella!', 5);
    chapter(4, 'Rain, Kuda & the Ropeway');
    objective('Hurry to the pettikada shelter ahead');
    S.hurry = true;
    S.mode = 'walk';
    S.limitZ = Z.shelterStop;
    S.interact = { z: Z.shelterStop, range: 2.4, text: 'Pick up the black kuda (umbrella)', fn: pickUmbrella };
    S.timers.lightning = rand(6, 10);
  }

  async function pickUmbrella() {
    S.interact = null;
    S.mode = 'cutscene';
    P.speed = 0;
    const p = vandana.userData.parts;
    vandana.userData.lock = true;
    await tween(0.4, (k) => { p.armR.rotation.x = 1.3 * k; p.armR.rotation.z = -0.6 * k; p.body.rotation.y = -0.4 * k; });
    worldUmbrella.visible = false; umbGlow.visible = false;
    heldUmbrella.visible = true;
    p.body.rotation.y = 0;
    vandana.userData.lock = false;
    vandana.userData.holdUmbrella = true;
    await wait(0.35);
    AudioSys.umbrellaOpen();
    await tween(0.45, (k) => setUmbrellaOpen(heldUmbrella, k), ease.out);
    S.umbrella = true;
    say('She opens the old black kuda… just in time. The rain drums softly above her.', 4);
    await wait(1.6);
    AudioSys.bark(-0.8, 330, 0.35, 0.8);
    await wait(0.7);
    AudioSys.bark(0.6, 400, 0.3, 0.8);
    await wait(0.8);
    say('…but barking echoes through the rain. Dogs! Run to the ropeway!', 3.8);
    objective('Escape to the ropeway station!');
    S.hurry = false;
    S.chase = 'dogs';
    startDogSound();
    dogs.forEach((d) => { d.visible = true; d.position.set(d.userData.ox, 0, P.z + 16 + d.userData.idx * 2); });
    S.mode = 'walk';
    S.limitZ = Z.stationLock;
    S.interact = { z: Z.stationLock, range: 2.4, text: 'Unlock the ropeway', fn: () => openPuzzle(PUZZLES.ropeway) };
  }

  async function walkTo(z, dur) {
    const z0 = P.z;
    P.speed = Math.abs(z - z0) / dur;
    await tween(dur, (k) => { P.z = lerp(z0, z, k); }, ease.linear);
    P.speed = 0;
  }
  // Free-form walk used for short off-road detours.
  async function walkToXZ(x, z, dur) {
    const x0 = P.x, z0 = P.z, dx = x - x0, dz = z - z0;
    if (Math.hypot(dx, dz) > 0.05) vandana.rotation.y = Math.atan2(dx, -dz);
    P.speed = Math.hypot(dx, dz) / dur;
    await tween(dur, (k) => { P.x = lerp(x0, x, k); P.z = lerp(z0, z, k); }, ease.inOutSine);
    P.speed = 0;
  }

  async function startRopeway() {
    AudioSys.unlock();
    panelState.mat.color.set(0x44ff99);
    panelState.glow.material.color.set(0x44ff99);
    say('Access granted! The cable car is ready… hop in!', 3);
    S.dogsStop = true;
    stopDogSound();
    await wait(0.5);
    await walkTo(car.position.z + 0.2, 1.7);
    tween(0.5, (k) => setUmbrellaOpen(heldUmbrella, 1 - k)).then(() => { heldUmbrella.visible = false; vandana.userData.holdUmbrella = false; S.umbrella = false; });
    S.mode = 'ride';
    P.y = 0.12;
    objective('Enjoy the ride across the canyon ✨');
    AudioSys.cable(true);
    AudioSys.whoosh();
    cam.lambda = 1.8;
    cam.fn = () => {
      const w = camera.aspect < 0.8 ? 12 : 9;
      cam.tPos.set(car.position.x + w, car.position.y + 3.2, car.position.z + 5);
      cam.tLook.set(car.position.x, car.position.y + 1.2, car.position.z - 3);
    };
    const zA = car.position.z, zB = Z.station2 + 1.8;
    let eased = false, dogsGone = false;
    setTimeout(() => say('The car glides off the platform, out over the misty canyon…', 4), 800);
    await tween(16, (k) => {
      car.position.z = lerp(zA, zB, k);
      car.position.y = -Math.sin(Math.PI * k) * 0.9;
      car.rotation.z = Math.sin(S.t * 1.1) * 0.025;
      P.z = car.position.z + 0.2;
      P.y = car.position.y + 0.12;
      atmo.rideClear = Math.sin(Math.PI * k);
      if (k > 0.22 && !dogsGone) { dogsGone = true; dogs.forEach((d) => { d.visible = false; }); S.chase = null; }
      if (k > 0.4 && !eased) {
        eased = true;
        tween(4, (q) => { S.rainLevel = lerp(1, 0.45, q); atmo.storm = lerp(1, 0.55, q); });
        AudioSys.rain(0.45);
        say('The storm softens into a gentle drizzle. Only mist and silence now.', 4.5);
      }
    }, ease.inOutSine);
    atmo.rideClear = 0;
    car.rotation.z = 0;
    AudioSys.cable(false);
    cam.fn = null;
    cam.lambda = 3.2;
    await walkTo(Z.station2 - 6.8, 2.4);
    P.y = 0;
    meetShreyas();
  }

  function meetShreyas() {
    S.stage = 5;
    S.mode = 'walk';
    shreyas.userData.waving = true;
    tween(1.5, (k) => { partyLights.boy.intensity = 1.3 * k; });
    chapter(5, 'A Ride with Shreyas');
    say('Shreyas! He has been waiting for her with his red motorcycle ❤', 4.5);
    objective('Walk to Shreyas');
    S.limitZ = Z.bike + 2.1;
    S.interact = { z: Z.bike + 2.1, range: 2.6, text: 'Hop on the bike with Shreyas', fn: rideBike };
  }

  async function rideBike() {
    S.interact = null;
    S.mode = 'cutscene';
    P.speed = 0;
    await fadeTo(1);
    shreyas.userData.waving = false;
    bike.add(shreyas);
    shreyas.position.set(0, 0.06, -0.05);
    shreyas.rotation.set(0, 0, 0);
    setSit(shreyas, false);
    bike.add(vandana);
    vandana.position.set(0, 0.12, 0.5);
    vandana.rotation.set(0, 0, 0);
    setSit(vandana, true);
    S.onBike = true;
    partyLights.boy.intensity = 0;
    bike.userData.spot.intensity = 3.2;
    bike.userData.beamMat.opacity = 0.16;
    const fwdOf = () => { const y = bike.rotation.y; return [-Math.sin(y), -Math.cos(y), Math.cos(y), -Math.sin(y)]; };
    const camFront = () => {
      const [fx, fz, sx, sz] = fwdOf();
      cam.tPos.set(bike.position.x + fx * 4.4 + sx * 1.6, 1.5, bike.position.z + fz * 4.4 + sz * 1.6);
      cam.tLook.set(bike.position.x, 1.15, bike.position.z);
    };
    cam.fn = camFront; camFront();
    cam.pos.copy(cam.tPos); cam.look.copy(cam.tLook);
    await fadeTo(0);
    objective('Ride through Edappally toward the coast 🏍️');
    AudioSys.engineStart();
    say('"Hold on tight, Ammu!" 🏍️', 2.6);
    await wait(1.0);
    AudioSys.engineRev();
    await wait(1.4);
    // Low-angle chase camera
    cam.lambda = 8;
    const camChase = () => {
      const [fx, fz, sx, sz] = fwdOf();
      const back = camera.aspect < 0.8 ? 5.6 : 4.2, sway = 1.0 + Math.sin(S.t * 0.35) * 0.6;
      cam.tPos.set(bike.position.x - fx * back + sx * sway, 0.95 + Math.sin(S.t * 0.6) * 0.12, bike.position.z - fz * back + sz * sway);
      cam.tLook.set(bike.position.x + fx * 7, 1.4, bike.position.z + fz * 7);
    };
    cam.fn = camChase;
    // While stopped at a barrier: a raised view over the riders that frames the whole gate.
    async function atCheckpoint(gateZ, solve) {
      cam.lambda = 2.6;
      cam.fn = () => {
        const portrait = camera.aspect < 0.8;
        cam.tPos.set(bike.position.x + (portrait ? 0.7 : 1.4), 3.2, bike.position.z + (portrait ? 6.5 : 5.2));
        cam.tLook.set(roadX(gateZ), 1.9, gateZ);
      };
      await solve();
      cam.fn = camChase;
      tween(1.6, (k) => { cam.lambda = lerp(3, 8, k); }, ease.linear);
    }
    ui.speedo.classList.add('show');
    streaks.visible = true;
    let prevYaw = 0, lean = 0, zoneMarine = false, zoneKadamakkudy = false;
    // Drives a stretch of road with a natural accelerate/cruise/decelerate
    // curve, arriving at rest right at targetZ (used between checkpoints,
    // since each checkpoint brings the bike to a full, mandatory stop).
    async function driveSegment(targetZ, opts = {}) {
      const ta = opts.ta ?? 3.2, td = opts.td ?? 2.4, vmax = RIDE.vmax;
      const z0 = bike.position.z;
      const dist = z0 - targetZ;
      if (dist <= 0.05) { bike.position.z = targetZ; P.z = targetZ; return; }
      let vp = vmax, da = 0.5 * vp * ta, dd = 0.5 * vp * td;
      if (da + dd > dist) { vp = Math.sqrt(Math.max(2, dist / (0.5 * ta + 0.5 * td))); da = 0.5 * vp * ta; dd = 0.5 * vp * td; }
      const dCruise = Math.max(0, dist - da - dd), tCruise = dCruise / Math.max(vp, 0.01);
      const segT = ta + tCruise + td;
      const segSAt = (t) => (t < ta ? 0.5 * vp * t * t / ta : t < ta + tCruise ? da + vp * (t - ta) : da + dCruise + vp * (t - ta - tCruise) - 0.5 * (vp / td) * (t - ta - tCruise) * (t - ta - tCruise));
      const segVAt = (t) => (t < ta ? vp * t / ta : t < ta + tCruise ? vp : Math.max(0, vp - (vp / td) * (t - ta - tCruise)));
      let prevZ = z0, prevT = 0;
      await tween(segT, (k) => {
        const t = k * segT, dtT = Math.max(1e-4, t - prevT);
        const z = z0 - segSAt(t), v = segVAt(t);
        if (RM.laneReturnZ !== null && z < RM.laneReturnZ) { RM.laneChoice = 1; RM.laneReturnZ = null; }
        const prevLane = RM.laneOffsetCur;
        // Quick swing into the open toll lane from rest; gentle drift back to centre at speed.
        RM.laneOffsetCur = lerp(RM.laneOffsetCur, LANE_X[RM.laneChoice], 1 - Math.exp(-(RM.laneChoice === 1 ? 1.1 : 2.6) * dtT));
        const steer = clamp(-Math.atan2((RM.laneOffsetCur - prevLane) / dtT, Math.max(v, 4)), -0.35, 0.35);
        const dxdz = roadX(z - 0.5) - roadX(z + 0.5);
        const yaw = Math.atan2(-dxdz, 1) + steer;
        const yawRate = (yaw - prevYaw) / dtT;
        lean = lerp(lean, clamp(yawRate * v * 0.05, -0.32, 0.32), 0.1);
        bike.position.set(roadX(z) + RM.laneOffsetCur, 0, z);
        bike.rotation.y = yaw;
        bike.rotation.z = lean;
        bike.userData.wheels.forEach((w) => { w.rotation.x -= (prevZ - z) / 0.42; });
        const gearFrac = ((v / vmax) * 3.2) % 1;
        AudioSys.engineSet(clamp(0.12 + 0.5 * (v / vmax) + 0.35 * gearFrac * (v / vmax), 0, 1));
        P.z = z; P.x = bike.position.x;
        S.rideSpeed = v;
        fovBoost = 9 * (v / vmax);
        setSpeedo(v * 3.6);
        if (!zoneMarine && z <= Z.metroEnd) {
          zoneMarine = true;
          objective('Cruise along Marine Drive 🌊');
          say('The road bends toward the coast… Marine Drive opens up beside the water.', 3.6);
        }
        if (!zoneKadamakkudy && z <= Z.marineEnd) {
          zoneKadamakkudy = true;
          objective('Cross the Kadamakkudy causeway 🌴');
          say('The road narrows onto the Kadamakkudy causeway, palms leaning over the water.', 3.8);
        }
        prevYaw = yaw; prevZ = z; prevT = t;
      }, ease.linear);
      bike.position.z = targetZ; P.z = targetZ; bike.rotation.z = 0;
      S.rideSpeed = 0; fovBoost = 0;
      AudioSys.engineSet(0.12);
    }
    say('"Hold on tight, Ammu — I brake for potholes, not for feelings!" 😄', 3.6);
    await driveSegment(Z.cp1 + CP_STANDOFF);
    objective('Solve the toll barrier to pass 🔢');
    await atCheckpoint(Z.cp1, runTollCheckpoint);
    say('Past the LuLu lights and the metro humming overhead…', 3.4);
    const toCp3 = driveSegment(Z.cp3 + CP_STANDOFF);
    await wait(4.2);
    say('The Rainbow Bridge glows over Marine Drive as a Water Metro boat glides by.', 4.2);
    await toCp3;
    objective('Answer the radar\'s riddle 💘');
    await atCheckpoint(Z.cp3, runRadarCheckpoint);
    say('Her arms around him, her heart racing faster than the bike. ❤', 4);
    await driveSegment(Z.rideFinish, { td: 3.2 });
    streaks.visible = false;
    ui.speedo.classList.remove('show');
    hideAllArcadeUi();
    AudioSys.engineSet(0.03);
    S.stage = 6;
    chapter(6, 'The Golden Gate');
    say('A majestic golden gate glows at the end of the road…', 4);
    objective('Unlock the golden gate');
    cam.lambda = 2.5;
    cam.fn = () => { cam.tPos.set(1.6, 2.6, bike.position.z + 5.4); cam.tLook.set(0, 4.5, Z.finalGate); };
    await wait(2.2);
    S.mode = 'walk';
    S.interact = { z: P.z, range: 6, text: 'Unlock the golden gate', fn: () => openPuzzle(PUZZLES.final) };
    openPuzzle(PUZZLES.final);
  }

  // The birthday song for the finale comes from music/ (falls back to the synthesized melody).
  const birthdayTrack = new Audio('music/videoplayback.m4a');
  birthdayTrack.preload = 'auto';
  birthdayTrack.volume = 0.9;
  let trackOk = true;
  birthdayTrack.addEventListener('error', () => { trackOk = false; });
  // Bat wings & screeches for the chase (music/batsound.m4a), looped under the synthesized ambience.
  const batTrack = new Audio('music/batsound.m4a');
  batTrack.preload = 'auto';
  batTrack.loop = true;
  let batOk = true;
  batTrack.addEventListener('error', () => { batOk = false; });
  const BAT_VOL = 0.85;
  // Dogs barking for the rainy chase (music/dogbark.m4a).
  const dogTrack = new Audio('music/dogbark.m4a');
  dogTrack.preload = 'auto';
  dogTrack.loop = true;
  let dogOk = true;
  dogTrack.addEventListener('error', () => { dogOk = false; });
  const DOG_VOL = 0.9;
  const mediaTracks = [birthdayTrack, batTrack, dogTrack];
  function unlockTrack() {
    // iOS/Safari only allows later playback if the element was started from a tap once.
    mediaTracks.forEach((a) => {
      a.muted = true;
      const p = a.play();
      if (p) p.then(() => { a.pause(); a.currentTime = 0; a.muted = AudioSys.muted; }).catch(() => { a.muted = AudioSys.muted; });
    });
  }
  function startBatSound() {
    if (!batOk) return;
    batTrack.currentTime = 0;
    batTrack.volume = 0;
    batTrack.muted = AudioSys.muted;
    const p = batTrack.play();
    if (p) p.catch(() => { batOk = false; });
    tween(0.8, (k) => { batTrack.volume = BAT_VOL * k; });
  }
  function stopBatSound(fade = 2.2) {
    if (batTrack.paused) return;
    const v0 = batTrack.volume;
    tween(fade, (k) => { batTrack.volume = v0 * (1 - k); }).then(() => batTrack.pause());
  }
  function startDogSound() {
    if (!dogOk) return;
    dogTrack.currentTime = 0;
    dogTrack.volume = 0;
    dogTrack.muted = AudioSys.muted;
    const p = dogTrack.play();
    if (p) p.catch(() => { dogOk = false; });
    tween(0.6, (k) => { dogTrack.volume = DOG_VOL * k; });
  }
  function stopDogSound(fade = 3.5) {
    if (dogTrack.paused) return;
    const v0 = dogTrack.volume;
    tween(fade, (k) => { dogTrack.volume = v0 * (1 - k); }).then(() => dogTrack.pause());
  }
  function playBirthdaySong() {
    if (trackOk) {
      birthdayTrack.currentTime = 0;
      birthdayTrack.muted = AudioSys.muted;
      const p = birthdayTrack.play();
      if (p) p.catch(() => { trackOk = false; songEnd = S.t + AudioSys.song() + 1; });
      return (isFinite(birthdayTrack.duration) && birthdayTrack.duration) || 30;
    }
    return AudioSys.song();
  }

  let songEnd = 0;
  async function celebrate() {
    S.mode = 'end';
    ui.objective.classList.add('fade');
    AudioSys.unlock();
    AudioSys.stopLoop('wind', 3);
    AudioSys.rain(0);
    tween(3, (k) => { S.rainLevel = 0.45 * (1 - k); atmo.storm = 0.55 * (1 - k); }).then(() => { S.raining = false; });
    tween(1.2, (k) => { gate2.heartMat.emissiveIntensity = 0.6 + 0.8 * k; MAT.gold.emissive.setRGB(0.29 + 0.08 * k, 0.19 + 0.05 * k, 0.02); }, ease.out);
    cam.fn = () => { cam.tPos.set(0.8, 3.2, bike.position.z + 7); cam.tLook.set(0, 5.5, Z.finalGate - 6); };
    songEnd = S.t + playBirthdaySong() + 1;
    await wait(0.6);
    // Slow, echoing opening with a golden aura
    AudioSys.creak(4.2, true);
    tween(4.2, (k) => { gate2.glow.material.opacity = 0.45 * k; }, ease.inOut);
    gate2.rings.forEach((r, i) => {
      wait(i * 0.9).then(() => tween(2.4, (k) => { r.scale.setScalar(1 + k * 13); r.material.opacity = 0.7 * (1 - k); }, ease.out));
    });
    await tween(4.2, (k) => { gate2.left.rotation.y = 1.6 * k; gate2.right.rotation.y = -1.6 * k; }, ease.inOutSine);
    tween(5, (k) => {
      atmo.party = k;
      partyLights.cake.intensity = 1.2 * k;
      partyLights.plaza.intensity = 0.9 * k;
      plaza.candles.forEach((c) => { c.material.opacity = k; });
    }, ease.inOut);
    S.celebrating = true;
    balloons.forEach((b) => { b.visible = true; });
    hearts.forEach((h) => { h.visible = true; });
    launchFirework(); setTimeout(launchFirework, 250); setTimeout(launchFirework, 500);
    // Roll through the gate into the plaza
    const z0 = bike.position.z, z1 = Z.plaza + 13;
    let prev = z0;
    AudioSys.engineSet(0.25);
    cam.lambda = 1.6;
    cam.fn = () => { cam.tPos.set(3.5, 2.6, bike.position.z + 6.5); cam.tLook.set(0, 4, bike.position.z - 8); };
    await tween(4.5, (k) => {
      const z = lerp(z0, z1, k), d = prev - z; prev = z;
      bike.position.z = z; P.z = z;
      bike.userData.wheels.forEach((w) => { w.rotation.x -= d / 0.42; });
    }, ease.inOutSine);
    AudioSys.stopLoop('engine', 1.5);
    bike.userData.spot.intensity = 0;
    bike.userData.beamMat.opacity = 0;
    tween(1.5, (k) => { gate2.glow.material.opacity = 0.45 * (1 - k); });
    plaza.bannerGroup.visible = true;
    tween(2.4, (k) => { plaza.bannerGroup.position.y = lerp(34, 14.1, k); }, ease.bounce);
    await wait(1.2);
    // Dismount
    await fadeTo(1);
    scene.add(shreyas); setStand(shreyas);
    shreyas.position.set(-1.4, 0, bike.position.z - 0.4); shreyas.rotation.set(0, 0.35, 0);
    scene.add(vandana); setStand(vandana);
    S.onBike = false;
    P.x = 0.9; P.y = 0; P.z = bike.position.z - 1.2;
    vandana.position.set(P.x, 0, P.z); vandana.rotation.set(0, 0, 0);
    const x0 = P.x, lz = P.z - 6;
    letter3d.visible = true; letter3d.position.set(x0, 20, lz);
    cam.fn = () => { cam.tPos.set(P.x + 1.6, 2.1, P.z + 5.2); cam.tLook.set(letter3d.position.x, lerp(3.5, letter3d.position.y, 0.4), letter3d.position.z); };
    cam.lambda = 2.2;
    cam.fn(); cam.pos.copy(cam.tPos); cam.look.copy(cam.tLook);
    await fadeTo(0);
    chapter(0, 'Happy Birthday, Ammu ❤');
    say('Something is drifting down from the sky… a glowing letter, and her photos, like falling stars.', 5);
    releasePhotos(x0, lz);
    // Gentle gliding descent, like a wing riding the wind, easing in and out of the fall
    await tween(8, (k) => {
      const t = k * 8, fall = smooth(0, 1, k);
      const amp = 2.0 * (1 - smooth(0.15, 1, k)), sway = Math.sin(t * 0.55);
      letter3d.position.set(x0 + sway * amp, lerp(20, 0.05, fall), lz + Math.cos(t * 0.4) * 0.5 * (1 - fall));
      letter3d.rotation.set(lerp(-0.25, -Math.PI / 2, smooth(0.85, 1, k)), Math.sin(t * 0.4) * 0.3, -sway * 0.35);
    }, ease.linear);
    letter3d.rotation.set(-Math.PI / 2, 0, 0);
    cam.fn = null;
    cam.lambda = 3.2;
    S.mode = 'walk';
    objective('Walk to the letter and pick it up');
    S.limitZ = lz + 1.1;
    S.interact = { z: lz + 1.1, range: 2.2, text: 'Pick up the love letter', fn: pickLetter };
  }

  async function pickLetter() {
    S.interact = null;
    S.mode = 'cutscene';
    P.speed = 0;
    const p = vandana.userData.parts;
    vandana.userData.lock = true;
    AudioSys.paper();
    await tween(0.45, (k) => { p.body.rotation.x = 0.55 * k; p.armR.rotation.x = 0.9 * k; p.body.position.y = -0.18 * k; });
    letter3d.visible = false;
    await tween(0.45, (k) => { p.body.rotation.x = 0.55 * (1 - k); p.armR.rotation.x = 0.9 + 0.3 * k; p.body.position.y = -0.18 * (1 - k); });
    S.mode = 'end';
    ui.objective.classList.add('fade');
    cam.fn = camCelebrate;
    cam.lambda = 1.2;
    showLetter();
  }

  function camCelebrate() {
    const hfov = 2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * camera.aspect);
    const dist = Math.max(17, 9.5 / Math.tan(hfov / 2));
    const a = Math.sin(S.t * 0.11) * (dist > 20 ? 0.15 : 0.32);
    const look = V3(0, 8.6, Z.plaza - 4);
    cam.tPos.set(look.x + Math.sin(a) * dist, 3.4 + Math.sin(S.t * 0.2) * 0.6, look.z + Math.cos(a) * dist);
    cam.tLook.copy(look);
  }

  const letter = $('letter'), letterShow = $('letter-show'), heartsLayer = $('hearts-layer');
  let heartTimer = 0;
  function spawnHeart() {
    const h = document.createElement('span');
    h.className = 'fh';
    h.textContent = pick(['❤', '♥', '❥']);
    h.style.left = `${rand(0, 100)}%`;
    h.style.fontSize = `${rand(14, 34)}px`;
    h.style.setProperty('--d', `${rand(6, 10)}s`);
    h.style.setProperty('--sx', `${rand(-40, 40)}px`);
    h.style.color = pick(['#ff5f95', '#ff8fb5', '#ffc2d8', '#f5cd6e', '#ff3d6e']);
    h.addEventListener('animationend', () => h.remove());
    heartsLayer.appendChild(h);
  }
  function showLetter() {
    letter.classList.remove('hidden');
    letterShow.classList.add('hidden');
    clearInterval(heartTimer);
    for (let i = 0; i < 8; i++) setTimeout(spawnHeart, i * 120);
    heartTimer = setInterval(spawnHeart, 380);
  }
  $('letter-hide').addEventListener('click', () => { letter.classList.add('hidden'); letterShow.classList.remove('hidden'); clearInterval(heartTimer); });
  letterShow.addEventListener('click', showLetter);
  $('letter-song').addEventListener('click', () => { AudioSys.init(); songEnd = S.t + playBirthdaySong() + 1; });
  $('letter-replay').addEventListener('click', () => window.location.reload());

  /* ------------------------------------------------------------------
     Input
     ------------------------------------------------------------------ */
  function doAction() {
    if (!S.started || ui.modalOpen || S.mode !== 'walk' || !S.interact) return;
    if (Math.abs(P.z - S.interact.z) <= S.interact.range) S.interact.fn();
  }
  window.addEventListener('keydown', (e) => {
    if (ui.modalOpen) {
      if (e.key === 'Escape' && !paperModal.classList.contains('hidden')) $('paper-close').click();
      else if (e.key === 'Escape' && pz.current) closePuzzle();
      else if ((e.key === 'Enter' || e.key === ' ') && !paperModal.classList.contains('hidden')) { e.preventDefault(); $('paper-close').click(); }
      return;
    }
    if (!S.started) {
      if ((e.key === 'Enter' || e.key === ' ') && !$('start-btn').disabled) { e.preventDefault(); beginGame(); }
      return;
    }
    const k = e.key.toLowerCase();
    if (k === 'w' || e.key === 'ArrowUp') { input.forward = true; e.preventDefault(); }
    if ((k === 'e' || e.key === ' ' || e.key === 'Enter') && letter.classList.contains('hidden')) {
      e.preventDefault();
      if (!e.repeat) doAction();
    }
    if (AR.answerResolve && !e.repeat && (e.key === '1' || e.key === '2' || e.key === '3')) { e.preventDefault(); submitAnswer(Number(e.key) - 1); }
  });
  window.addEventListener('keyup', (e) => {
    const k = e.key.toLowerCase();
    if (k === 'w' || e.key === 'ArrowUp') input.forward = false;
  });
  window.addEventListener('blur', () => { input.forward = false; });
  function holdButton(el, on, off) {
    el.addEventListener('pointerdown', (e) => { e.preventDefault(); el.classList.add('pressed'); try { el.setPointerCapture(e.pointerId); } catch (er) { /* noop */ } on(); });
    const up = () => { el.classList.remove('pressed'); if (off) off(); };
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
    el.addEventListener('lostpointercapture', up);
    el.addEventListener('contextmenu', (e) => e.preventDefault());
  }
  holdButton(ui.btnWalk, () => { input.forward = true; }, () => { input.forward = false; });
  holdButton(ui.btnAction, doAction);
  $('start-btn').addEventListener('click', beginGame);
  $('mute-btn').addEventListener('click', (e) => {
    AudioSys.setMuted(!AudioSys.muted);
    e.currentTarget.textContent = AudioSys.muted ? '🔇' : '🔊';
    mediaTracks.forEach((a) => { a.muted = AudioSys.muted; });
    e.currentTarget.blur();
  });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { AudioSys.suspend(); mediaTracks.forEach((a) => { if (!a.paused) { a.pause(); a.dataset.resume = '1'; } }); }
    else { AudioSys.resume(); mediaTracks.forEach((a) => { if (a.dataset.resume) { delete a.dataset.resume; a.play().catch(() => {}); } }); }
    input.forward = false;
  });
  document.addEventListener('touchmove', (e) => { if (!e.target.closest('.modal, #letter')) e.preventDefault(); }, { passive: false });

  /* ------------------------------------------------------------------
     Per-frame updates
     ------------------------------------------------------------------ */
  function updatePlayer(dt) {
    if (S.mode === 'walk' && !S.onBike) {
      const target = input.forward ? (S.chase ? 6.2 : S.hurry ? 5 : 3.3) : 0;
      P.speed = damp(P.speed, target, 7, dt);
      let nz = P.z - P.speed * dt;
      if (nz < S.limitZ) { nz = S.limitZ; P.speed *= 0.6; }
      P.z = nz;
    } else if (S.mode === 'modal') {
      P.speed = damp(P.speed, 0, 10, dt);
    }
    if (!S.onBike) {
      vandana.position.set(P.x, P.y, P.z);
      const amt = clamp(P.speed / 3.3, 0, 1.35);
      P.phase += P.speed * dt * 2.7;
      animateHuman(vandana, P.phase, amt, dt);
      const stepIdx = Math.floor(P.phase / Math.PI);
      if (stepIdx !== P.lastStep && P.speed > 0.6) AudioSys.step(S.raining || P.z < Z.riverStart, P.speed > 4.5);
      P.lastStep = stepIdx;
      if (S.iceCream) heldCone.userData.scoops.scale.setScalar(1 - 0.85 * clamp((Z.iceStop - P.z) / 8.5, 0, 1));
      if (amt < 0.05 && vandana.userData.pose === 'stand') vandana.userData.parts.body.scale.y = 1 + Math.sin(S.t * 2.2) * 0.006;
    }
    fillLight.position.set(P.x, P.y + 2.3, P.z + 0.9);
  }

  function flapFlyer(b, dt, glide) {
    const u = b.userData;
    u.flap += dt * u.fs;
    const f = glide ? 0.15 + Math.sin(u.flap * 0.3) * 0.1 : Math.sin(u.flap) * 0.95;
    u.wl.rotation.z = -f; u.wr.rotation.z = f;
  }
  function faceVelocity(b) {
    const u = b.userData;
    const vx = b.position.x - u.last.x, vz = b.position.z - u.last.z;
    if (Math.abs(vx) + Math.abs(vz) > 1e-4) b.rotation.y = Math.atan2(-vx, -vz);
  }
  function updatePigeons(dt) {
    for (const p of pigeons) {
      const u = p.userData;
      if (u.sitting) {
        p.position.y = u.home.y + Math.sin(S.t * 2 + u.bobP) * 0.008;
        p.rotation.y = Math.sin(S.t * 0.4 + u.bobP) * 0.3;
        const dx = P.x - p.position.x, dz = P.z - p.position.z;
        if (S.started && Math.hypot(dx, dz) < 3.2) {
          u.sitting = false;
          u.wl.scale.setScalar(1); u.wr.scale.setScalar(1);
          const away = Math.atan2(-dx, -dz) + rand(-0.6, 0.6);
          u.vel.set(Math.sin(away) * rand(3, 4.5), rand(2.6, 3.6), Math.cos(away) * rand(3, 4.5));
          u.flap = Math.random() * 6;
          u.last.copy(p.position);
          AudioSys.wingFlap(clamp(dx / 10, -1, 1));
        }
      } else {
        u.last.copy(p.position);
        u.vel.y = Math.max(u.vel.y - 1.2 * dt, 0.4);
        p.position.addScaledVector(u.vel, dt);
        flapFlyer(p, dt, false);
        faceVelocity(p);
        if (p.position.y > 8 || Math.abs(p.position.x) > 40) p.visible = false;
      }
    }
  }
  function updateBats(dt) {
    if (!bats[0].visible) return;
    for (const b of bats) {
      const u = b.userData;
      flapFlyer(b, dt, false);
      u.last.copy(b.position);
      if (S.batsLeaving) {
        u.vel.y += 5 * dt;
        b.position.addScaledVector(u.vel, dt);
      } else {
        const t = S.t;
        _tmp.set(P.x + Math.sin(t * u.a + u.p) * u.rx, P.y + 2.1 + Math.sin(t * u.b + u.p) * 0.9, P.z + u.back + Math.cos(t * u.c + u.p) * 1.2);
        b.position.lerp(_tmp, 1 - Math.exp(-u.follow * dt));
      }
      faceVelocity(b);
    }
    if (S.chase === 'bats' && !S.batsLeaving && (!batOk || batTrack.paused)) {
      S.timers.bat -= dt;
      if (S.timers.bat <= 0) { S.timers.bat = rand(0.05, 0.12); AudioSys.batFlap(rand(-0.7, 0.7)); }
      S.timers.squeak -= dt;
      if (S.timers.squeak <= 0) { S.timers.squeak = rand(0.5, 1.6); AudioSys.batSqueak(rand(-0.8, 0.8)); }
    }
  }
  function updateCrows(dt) {
    if (!S.crowsFlying) return;
    let any = false;
    for (const c of crows) {
      if (!c.visible) continue;
      any = true;
      const u = c.userData;
      u.last.copy(c.position);
      c.position.addScaledVector(u.vel, dt);
      c.position.y += Math.sin(S.t * 1.3 + u.flap) * 0.01;
      flapFlyer(c, dt, Math.sin(S.t * 0.8 + u.fs) > 0.55);
      faceVelocity(c);
      if (c.position.x > 55) c.visible = false;
    }
    S.timers.crow -= dt;
    if (any && S.timers.crow <= 0) {
      S.timers.crow = rand(0.9, 1.8);
      const c = pick(crows.filter((x) => x.visible));
      if (c) { const pan = clamp((c.position.x - camera.position.x) / 30, -1, 1); AudioSys.crow(pan, 0.7); if (Math.random() < 0.5) AudioSys.wingFlap(pan); }
    }
    if (!any) S.crowsFlying = false;
  }
  function placeRiverBird(b) {
    const u = b.userData;
    b.position.set(
      flock.x - flock.dir * u.row * 1.4,
      flock.y + u.oy + Math.sin(S.t * 1.1 + u.bobP) * 0.25,
      flock.z + u.side * u.row * 1.2 + Math.sin(S.t * 0.7 + u.bobP) * 0.2,
    );
  }
  function updateRiverBirds(dt) {
    const active = S.started && P.z < -70 && P.z > -150 && !S.raining && atmo.storm < 0.2;
    if (!active) {
      if (riverBirds[0].visible) riverBirds.forEach((b) => { b.visible = false; });
      flock.speed = 0;
      return;
    }
    if (flock.speed === 0 || Math.abs(flock.x) > 48) {
      if (riverBirds[0].visible) riverBirds.forEach((b) => { b.visible = false; });
      flock.wait -= dt;
      if (flock.wait > 0) return;
      flock.dir = Math.random() < 0.5 ? 1 : -1;
      flock.x = -flock.dir * 44;
      flock.y = rand(6, 8.5);
      flock.z = clamp(P.z - rand(16, 26), Z.riverEnd - 16, Z.riverStart - 4);
      flock.speed = rand(4.2, 5.6);
      flock.wait = rand(3, 6);
      riverBirds.forEach((b) => { b.visible = true; placeRiverBird(b); b.userData.last.copy(b.position); });
    }
    flock.x += flock.dir * flock.speed * dt;
    for (const b of riverBirds) {
      const u = b.userData;
      u.last.copy(b.position);
      placeRiverBird(b);
      flapFlyer(b, dt, Math.sin(S.t * 0.6 + u.bobP) > 0.3);
      faceVelocity(b);
    }
  }
  function updateDogs(dt) {
    if (!dogs[0].visible) return;
    for (const d of dogs) {
      const u = d.userData;
      let tz = P.z + u.back;
      if (S.dogsStop) tz = Math.max(tz, Z.canyonStart + 1.2 + u.idx * 0.9);
      const tx = u.ox + Math.sin(S.t * 1.3 + u.p) * 0.4;
      const pz0 = d.position.z;
      d.position.z = damp(d.position.z, tz, 4.5, dt);
      d.position.x = damp(d.position.x, tx, 2, dt);
      const v = Math.abs(d.position.z - pz0) / Math.max(dt, 1e-4);
      const amt = clamp(v / 5, 0, 1);
      u.phase += dt * (4 + v * 2.2);
      const s = Math.sin(u.phase);
      u.legs[0].rotation.x = s * 0.9 * amt; u.legs[3].rotation.x = s * 0.9 * amt;
      u.legs[1].rotation.x = -s * 0.9 * amt; u.legs[2].rotation.x = -s * 0.9 * amt;
      u.tail.rotation.z = Math.sin(S.t * 10 + u.p) * 0.4;
      d.children[0].position.y = 0.58 + Math.abs(s) * 0.06 * amt;
      u.head.rotation.x = damp(u.head.rotation.x, 0, 8, dt);
      u.barkT -= dt;
      if (u.barkT <= 0) {
        u.barkT = rand(0.9, 2.2);
        const dist = Math.abs(d.position.z - camera.position.z);
        if (!dogOk || (dogTrack.paused && !S.dogsStop)) AudioSys.bark(clamp((d.position.x - camera.position.x) / 5, -1, 1), u.pitch, clamp(1.3 - dist / 25, 0.2, 1), clamp(dist / 30, 0.15, 0.6));
        u.head.rotation.x = -0.35;
      }
    }
  }
  let poolTimer = 0;
  function updateLamps(dt) {
    const tod = atmo.tod;
    for (const l of lamps) {
      let lv = l.onAt < 0 ? 1 : smooth(l.onAt, l.onAt + 0.035, tod);
      if (lv > 0 && lv < 1) lv *= Math.random() < 0.4 ? 0.2 : 1;
      if (l.flicker && lv > 0) lv *= Math.sin(S.t * 13) + Math.sin(S.t * 31.7) > 1.55 ? 0.15 : 1;
      l.cur = lv;
      if (l.bulbMat) {
        l.glow.material.opacity = 0.9 * lv;
        l.bulbMat.color.copy(l.baseBulb).multiplyScalar(0.12 + 0.88 * lv);
        l.coneMat.opacity = l.coneBase * lv * (1 + atmo.storm * 0.9);
        l.poolMat.opacity = 0.2 * lv;
        if (l.streakMat) l.streakMat.opacity = 0.07 * lv;
        if (l.reflMat) l.reflMat.opacity = l.reflBase * lv;
      }
    }
    poolTimer -= dt;
    if (poolTimer <= 0) {
      poolTimer = S.rideSpeed > 1 ? 0.08 : 0.2;
      const fz = S.started ? P.z - 5 : 0, fx = P.x;
      // Unlit lamps sort last so they never steal a real light from a lit one.
      const score = (l) => Math.abs(l.pos.z - fz) + Math.abs(l.pos.x - fx) * 0.3 + (l.cur > 0.01 ? 0 : 1000);
      const sorted = lamps.slice().sort((a, b) => score(a) - score(b));
      for (let i = 0; i < pool.length; i++) {
        poolMap[i] = sorted[i];
        pool[i].position.copy(sorted[i].pos);
        pool[i].color.copy(sorted[i].color);
      }
    }
    for (let i = 0; i < pool.length; i++) { const l = poolMap[i]; pool[i].intensity = l ? l.intensity * (l.cur || 0) : 0; }
  }

  // Sunset -> dusk -> night, plus storm, ride-clearing and party overlays.
  const SKY = [
    { top: C(0x2b4585), mid: C(0xe28a58), bot: C(0x3a2420), d: 0.012, hs: C(0xffc9a0), hg: C(0x4a3028), hi: 0.95 },
    { top: C(0x17183f), mid: C(0x6e3a5e), bot: C(0x140a14), d: 0.019, hs: C(0x8f78a8), hg: C(0x1a1020), hi: 0.68 },
    { top: C(0x02040d), mid: C(0x121a33), bot: C(0x05060a), d: 0.028, hs: C(0x4a5a8c), hg: C(0x0a0a12), hi: 0.55 },
  ];
  const STORM = { top: C(0x05070c), mid: C(0x0f131e), bot: C(0x040506) };
  const PARTY = { top: C(0x14082a), mid: C(0x3a1c46), bot: C(0x0c0610) };
  const SUN_A = C(0xffb060), SUN_B = C(0xff5a2a);
  let lastWinTod = -1;
  function updateAtmosphere(dt) {
    const target = S.started ? smooth(Z.start - 2, -104, P.z) : 0;
    atmo.tod = damp(atmo.tod, Math.max(atmo.tod, target), 1.5, dt);
    const t = atmo.tod;
    const a = t < 0.5 ? SKY[0] : SKY[1], b = t < 0.5 ? SKY[1] : SKY[2];
    const k = ease.inOutSine(t < 0.5 ? t / 0.5 : (t - 0.5) / 0.5);
    const U = skyMat.uniforms;
    U.top.value.copy(a.top).lerp(b.top, k);
    U.mid.value.copy(a.mid).lerp(b.mid, k);
    U.bottom.value.copy(a.bot).lerp(b.bot, k);
    const st = atmo.storm * 0.8;
    U.top.value.lerp(STORM.top, st); U.mid.value.lerp(STORM.mid, st); U.bottom.value.lerp(STORM.bot, st);
    U.top.value.lerp(PARTY.top, atmo.party); U.mid.value.lerp(PARTY.mid, atmo.party); U.bottom.value.lerp(PARTY.bot, atmo.party);
    let dens = lerp(a.d, b.d, k) + 0.007 * atmo.storm;
    dens = lerp(dens, 0.012, atmo.rideClear);
    dens = lerp(dens, 0.009, atmo.party);
    scene.fog.density = dens;
    scene.fog.color.copy(U.mid.value);
    scene.background.copy(U.mid.value);
    hemi.color.copy(a.hs).lerp(b.hs, k);
    hemi.groundColor.copy(a.hg).lerp(b.hg, k);
    hemi.intensity = lerp(a.hi, b.hi, k) * (1 - 0.25 * atmo.storm) + atmo.flash * 1.8 + atmo.party * 0.1;
    atmo.flash = damp(atmo.flash, 0, 4, dt);
    const sh = lerp(0.075, -0.12, smooth(0, 0.6, t));
    sunDir.set(0.28, sh, -1).normalize();
    sun.position.copy(sunDir).multiplyScalar(440);
    sun.visible = sh > -0.06;
    sun.material.color.copy(SUN_A).lerp(SUN_B, smooth(0, 0.5, t));
    U.sunCol.value.copy(sun.material.color);
    U.sunAmt.value = (1 - smooth(0.35, 0.75, t)) * (1 - atmo.storm);
    sunLight.position.copy(sunDir).multiplyScalar(60);
    sunLight.color.copy(sun.material.color);
    sunLight.intensity = 0.9 * (1 - smooth(0.05, 0.55, t));
    const night = smooth(0.4, 0.85, t) * (1 - atmo.storm * 0.92);
    starMat.opacity = smooth(0.35, 0.8, t) * (1 - atmo.storm) * (0.85 + Math.sin(S.t * 1.7) * 0.1);
    moon.material.opacity = night;
    moonHalo.material.opacity = 0.55 * night;
    moonLight.intensity = 0.16 * night;
    if (Math.abs(t - lastWinTod) > 0.01) {
      lastWinTod = t;
      const wi = lerp(0.25, 0.85, t);
      buildingMats.forEach((m) => { m.emissiveIntensity = wi; });
    }
    if (!envIsNight && t > 0.55 && envNight) { envIsNight = true; envMats.forEach((m) => { m.envMap = envNight; }); }
  }

  function updateWorld(dt) {
    backwaterTex.offset.x += dt * 0.006; backwaterTex.offset.y -= dt * 0.012;
    beachSeaTex.offset.x += dt * 0.006; beachSeaTex.offset.y -= dt * 0.012;
    beachFoamMat.opacity = 0.24 + Math.sin(S.t * 0.9) * 0.08;
    for (const m of mistLayers) { m.t.offset.x += dt * m.s; m.t.offset.y += dt * m.s * 0.5; }
    for (const m of streetMist) m.m.position.x = m.x0 + Math.sin(S.t * 0.12 + m.p) * 3;
    paperGlow.material.opacity = 0.35 + Math.sin(S.t * 3) * 0.2;
    umbGlow.material.opacity = 0.25 + Math.sin(S.t * 3) * 0.15;
    fairy[0].size = 0.42 + Math.sin(S.t * 3) * 0.06;
    neonSigns[0].material.opacity = Math.sin(S.t * 9) > -0.93 ? 1 : 0.25;
    if (panelState.blink) panelState.blink.material.opacity = Math.sin(S.t * 4) > 0 ? 0.9 : 0.1;
    gate2.heart.rotation.y = Math.sin(S.t * 0.8) * 0.35;
    const wind = 1 + atmo.storm * 2.2;
    for (const s of swayers) {
      s.o.rotation.z = s.base.z + Math.sin(S.t * 0.9 * wind + s.p) * s.a * wind;
      s.o.rotation.x = s.base.x + Math.sin(S.t * 0.7 * wind + s.p * 1.3) * s.a * 0.6 * wind;
    }
    if (shreyas.userData.waving) {
      const p = shreyas.userData.parts;
      p.armR.rotation.z = 2.55 + Math.sin(S.t * 7) * 0.35;
      p.armR.rotation.x = 0;
      p.head.rotation.z = Math.sin(S.t * 2) * 0.08;
      animateHuman(shreyas, 0, 0, dt);
    } else if (!S.onBike) animateHuman(shreyas, 0, 0, dt);
    if (letter3d.visible) letter3d.userData.glow.material.opacity = 0.6 + Math.sin(S.t * 3) * 0.25;

    // Soundscape schedulers
    if (S.started && !S.celebrating) {
      const cricketLevel = smooth(0.15, 0.5, atmo.tod) * (1 - S.rainLevel * 0.85);
      if (cricketLevel > 0.05) {
        for (const v of S.crickets) {
          v.next -= dt;
          if (v.next <= 0) { v.next = rand(0.35, 1.3); AudioSys.cricket(v, cricketLevel); }
        }
      }
    }
    if (S.rainLevel > 0.05) {
      S.timers.drop -= dt;
      if (S.timers.drop <= 0) { S.timers.drop = rand(0.02, 0.09) / S.rainLevel; AudioSys.drop(rand(-1, 1)); }
      if (S.umbrella) {
        S.timers.tap -= dt;
        if (S.timers.tap <= 0) { S.timers.tap = rand(0.015, 0.05) / S.rainLevel; AudioSys.umbrellaTap(); }
      }
    }
    if (S.raining && atmo.storm > 0.9 && S.stage === 4) {
      S.timers.lightning -= dt;
      if (S.timers.lightning <= 0) { S.timers.lightning = rand(6, 12); lightningFlash(); }
    }
    updatePhotos(dt);
    if (S.celebrating) {
      S.timers.fw -= dt;
      if (S.timers.fw <= 0) {
        S.timers.fw = rand(0.3, 0.85);
        launchFirework();
        if (Math.random() < 0.35) { setTimeout(launchFirework, 150); setTimeout(launchFirework, 320); }
      }
      if (S.t > songEnd) {
        S.timers.twinkle -= dt;
        if (S.timers.twinkle <= 0) { S.timers.twinkle = rand(0.5, 1.6); AudioSys.twinkle(); }
      }
      for (const b of balloons) {
        const u = b.userData;
        b.position.y += u.s * dt;
        b.position.x = u.x0 + Math.sin(S.t * 0.8 + u.p) * 0.6;
        b.rotation.z = Math.sin(S.t * 1.1 + u.p) * 0.12;
        if (b.position.y > 36) { b.position.y = rand(-6, -1); u.x0 = (Math.random() < 0.5 ? -1 : 1) * rand(2.5, 15); }
      }
      for (const h of hearts) {
        const u = h.userData;
        h.position.y += u.s * dt;
        h.position.x = u.x0 + Math.sin(S.t * 1.5 + u.p) * 0.5;
        if (h.position.y > 16) { h.position.y = rand(-1, 1); u.x0 = rand(-10, 10); }
      }
      plaza.candles.forEach((c, i) => { const f = 0.85 + Math.sin(S.t * 18 + i * 2.1) * 0.1 + Math.random() * 0.08; c.scale.set(0.35 * f, 0.5 * f, 1); });
      partyLights.cake.intensity = 1.1 + Math.sin(S.t * 14) * 0.12;
      plaza.bannerGroup.rotation.x = Math.sin(S.t * 1.3) * 0.03;
    }
    updateFireworks(dt);
  }

  function updateTriggers() {
    for (const tr of S.triggers) if (!tr.done && P.z < tr.z) { tr.done = true; tr.fn(); }
  }

  let promptVisible = false;
  function updatePrompt() {
    const show = !!(S.started && S.mode === 'walk' && !ui.modalOpen && S.interact && Math.abs(P.z - S.interact.z) <= S.interact.range);
    if (show !== promptVisible) {
      promptVisible = show;
      ui.prompt.classList.toggle('hidden', !show);
      ui.btnAction.classList.toggle('ready', show);
    }
    if (show && ui.promptText.textContent !== S.interact.text) ui.promptText.textContent = S.interact.text;
  }

  function updateCamera(dt) {
    if (!S.started) {
      cam.tPos.set(Math.sin(S.t * 0.15) * 2.5 + 1.5, 2.2 + Math.sin(S.t * 0.2) * 0.3, Z.start + 7);
      cam.tLook.set(0, 2.2, Z.start - 12);
    } else (cam.fn || camFollow)();
    const k = 1 - Math.exp(-cam.lambda * dt);
    cam.pos.lerp(cam.tPos, k);
    cam.look.lerp(cam.tLook, Math.min(1, k * 1.4));
    camera.position.copy(cam.pos);
    if (S.shake > 0.001 || S.chase) {
      const a = S.shake + (S.chase && P.speed > 2 ? 0.02 : 0);
      camera.position.x += (Math.random() - 0.5) * a;
      camera.position.y += (Math.random() - 0.5) * a;
      S.shake = damp(S.shake, 0, 3, dt);
    }
    camera.lookAt(cam.look);
    const fov = baseFov + fovBoost;
    if (Math.abs(camera.fov - fov) > 0.05) { camera.fov = damp(camera.fov, fov, 3, dt); camera.updateProjectionMatrix(); }
    skyGroup.position.copy(camera.position);
  }

  /* ------------------------------------------------------------------
     Main loop
     ------------------------------------------------------------------ */
  const clock = new THREE.Clock();
  function frame() {
    requestAnimationFrame(frame);
    const dt = Math.min(clock.getDelta(), 0.05);
    S.t += dt;
    updateTweens(dt);
    updatePlayer(dt);
    updateAtmosphere(dt);
    updatePigeons(dt);
    updateBats(dt);
    updateCrows(dt);
    updateRiverBirds(dt);
    updateDogs(dt);
    updateRideZones(dt);
    updateRideChallenges(dt);
    updateLamps(dt);
    updateWorld(dt);
    updateRiverFx(dt);
    updateTriggers();
    updatePrompt();
    updateCamera(dt);
    updateRain(dt);
    updateRipples(dt);
    updateStreaks();
    updateChains();
    if (composer) composer.render(); else renderer.render(scene, camera);
  }

  try { renderer.compile(scene, camera); } catch (e) { /* compile is an optimisation only */ }
  camera.position.copy(cam.pos);
  frame();
  const sb = $('start-btn');
  sb.disabled = false;
  sb.textContent = 'Begin the Journey';

  // Minimal hook for automated testing / debugging.
  window.__journey = { S, P, atmo, PUZZLES, dateMatches, phoneSumMatches, phoneMatches, shelter, vandana, camera, letter3d, Z, RIDE, waterMetroBoat, metroTrain, RM, bike };
})();
