// ==UserScript==
// @name         Claude Web Spider — العنكبوت الرقمي
// @namespace    https://github.com/alarapioranse-dotcom/claude-web-spider
// @version      1.0.0
// @description  A digital spider that weaves red/yellow/green threads over claude.ai while Claude writes and when links appear.
// @match        https://claude.ai/*
// @run-at       document-idle
// @grant        none
// @noframes
// ==/UserScript==

(() => {
  'use strict';
  if (window.__claudeWebSpider) return;
  window.__claudeWebSpider = true;

  /* ================= Settings ================= */
  const COLORS = ['#ff3b3b', '#ffd23b', '#2ee66b']; // red, yellow, green
  const MAX_THREADS = 40;       // oldest threads are dropped past this
  const SPOKES = 2;             // side threads to the nearest visited points
  const TEXT_TICK_MS = 650;     // how often the spider follows the writing
  const MIN_HOP_PX = 40;        // ignore hops shorter than this
  const MAX_QUEUE = 6;          // pending hops kept at most
  const WARMUP_MS = 1500;       // ignore the burst of DOM changes when a chat loads
  const STORE_KEY = 'claudeWebSpider.enabled';
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ================= Persistence (safe) ================= */
  const store = {
    get() { try { return localStorage.getItem(STORE_KEY) !== '0'; } catch { return true; } },
    set(v) { try { localStorage.setItem(STORE_KEY, v ? '1' : '0'); } catch { /* storage blocked */ } }
  };
  let enabled = store.get();

  /* ================= Overlay ================= */
  const canvas = document.createElement('canvas');
  canvas.setAttribute('aria-hidden', 'true');
  Object.assign(canvas.style, {
    position: 'fixed', inset: '0', width: '100vw', height: '100vh',
    pointerEvents: 'none', zIndex: '2147483000'
  });
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.textContent = '🕷️';
  btn.title = 'العنكبوت الرقمي: إظهار / إخفاء';
  btn.setAttribute('aria-label', btn.title);
  Object.assign(btn.style, {
    position: 'fixed', left: '10px', bottom: 'calc(env(safe-area-inset-bottom, 0px) + 140px)',
    zIndex: '2147483001', width: '34px', height: '34px', padding: '0',
    borderRadius: '50%', border: '1px solid #2a3847', background: 'rgba(18,24,33,.85)',
    fontSize: '18px', lineHeight: '1', cursor: 'pointer'
  });

  let W = 0, H = 0;
  function resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    W = window.innerWidth;
    H = window.innerHeight;
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  window.addEventListener('resize', resize);
  resize();

  /* ================= Targets =================
   * A target is { el } (a link) or { range, rtl } (the last character
   * Claude wrote). Its position is recomputed every frame, so threads
   * follow scrolling. A target whose node left the page resolves to null.
   */
  function resolve(t) {
    if (!t) return null;
    if ('x' in t) return t; // fixed point
    if (t.el) {
      if (!t.el.isConnected) return null;
      const r = t.el.getBoundingClientRect();
      if (!r.width && !r.height) return null;
      return { x: r.left + r.width / 2, y: r.top - 4 };
    }
    if (t.range) {
      if (!t.range.startContainer.isConnected) return null;
      const rects = t.range.getClientRects();
      const r = rects[rects.length - 1];
      if (!r) return null;
      return { x: t.rtl ? r.left : r.right, y: r.top - 4 };
    }
    return null;
  }

  function ctrl(a, b, seed, now) {
    const dist = Math.hypot(b.x - a.x, b.y - a.y);
    const sag = Math.min(80, dist * 0.2);
    const wobble = reduceMotion ? 0 : Math.sin(now * 0.002 + seed) * 4;
    return { x: (a.x + b.x) / 2 + wobble, y: (a.y + b.y) / 2 + sag + wobble };
  }
  function bez(a, c, b, t) {
    const u = 1 - t;
    return { x: u * u * a.x + 2 * u * t * c.x + t * t * b.x, y: u * u * a.y + 2 * u * t * c.y + t * t * b.y };
  }
  const ease = (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);
  function lerpAngle(a, b, k) {
    let d = b - a;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    return a + d * k;
  }

  /* ================= State ================= */
  let threads = [];   // { a, b, color, seed, born, spoke }
  let visited = [];   // targets reached
  let queue = [];
  let colorIdx = 0;
  const nextColor = () => COLORS[colorIdx++ % COLORS.length];

  const spider = {
    x: W / 2, y: -30, angle: Math.PI / 2, gait: 0,
    from: null, to: null, current: null,
    t: 1, t0: 0, dur: 0, seed: 0, color: COLORS[0]
  };

  function reset() {
    threads = []; visited = []; queue = [];
    spider.from = spider.to = spider.current = null;
    spider.t = 1; spider.x = W / 2; spider.y = -30;
  }

  function enqueue(t) {
    if (queue.length >= MAX_QUEUE) {
      const i = queue.findIndex(q => !q.el); // drop an old text hop before a link
      queue.splice(i >= 0 ? i : 0, 1);
    }
    queue.push(t);
  }

  function startTravel(t) {
    const b = resolve(t);
    if (!b) return;
    const fromPt = resolve(spider.current) || { x: spider.x, y: spider.y };
    if (spider.current && Math.hypot(b.x - fromPt.x, b.y - fromPt.y) < MIN_HOP_PX && !t.el) return;
    spider.from = spider.current && resolve(spider.current) ? spider.current : { x: spider.x, y: spider.y };
    spider.to = t;
    const dist = Math.hypot(b.x - fromPt.x, b.y - fromPt.y);
    spider.dur = reduceMotion ? 120 : Math.min(900, 250 + dist * 0.6);
    spider.t0 = performance.now();
    spider.t = 0;
    spider.seed = Math.random() * 100;
    spider.color = nextColor();
  }

  function arrive() {
    const t = spider.to;
    threads.push({ a: spider.from, b: t, color: spider.color, seed: spider.seed, born: performance.now(), spoke: false });
    const p = resolve(t);
    if (p) {
      visited
        .map(v => ({ v, q: resolve(v) }))
        .filter(o => o.q && o.v !== spider.from)
        .map(o => ({ v: o.v, d: Math.hypot(o.q.x - p.x, o.q.y - p.y) }))
        .sort((m, n) => m.d - n.d)
        .slice(0, SPOKES)
        .forEach(({ v }) => threads.push({ a: t, b: v, color: nextColor(), seed: Math.random() * 100, born: performance.now(), spoke: true }));
    }
    visited.push(t);
    if (visited.length > MAX_THREADS) visited.shift();
    if (threads.length > MAX_THREADS) threads = threads.slice(-MAX_THREADS);
    spider.current = t;
    spider.to = null;
  }

  /* ================= Drawing ================= */
  function strokeStyle(color, width, alpha, now) {
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.globalAlpha = alpha;
    ctx.shadowColor = color;
    ctx.shadowBlur = 8;
    ctx.setLineDash([7, 5]);
    ctx.lineDashOffset = reduceMotion ? 0 : -now * 0.04;
  }

  function drawThread(th, a, b, now) {
    const c = ctrl(a, b, th.seed, now);
    const fade = Math.min(1, (now - th.born) / 400);
    strokeStyle(th.color, th.spoke ? 1.1 : 2, (th.spoke ? 0.5 : 0.9) * fade, now);
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.quadraticCurveTo(c.x, c.y, b.x, b.y);
    ctx.stroke();
  }

  function drawPartial(a, c, b, e, color, now) {
    strokeStyle(color, 2.2, 1, now);
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    const steps = 24;
    for (let i = 1; i <= steps; i++) {
      const q = bez(a, c, b, (e * i) / steps);
      ctx.lineTo(q.x, q.y);
    }
    ctx.stroke();
  }

  function drawSpider(moving) {
    ctx.save();
    ctx.translate(spider.x, spider.y);
    ctx.rotate(spider.angle);
    ctx.scale(0.85, 0.85);
    ctx.setLineDash([]);
    ctx.globalAlpha = 1;
    ctx.lineCap = 'round';
    ctx.strokeStyle = '#d7dde4';
    ctx.lineWidth = 1.4;
    ctx.shadowBlur = 0;
    for (const s of [-1, 1]) {
      for (let i = 0; i < 4; i++) {
        const phase = spider.gait + i * Math.PI / 2 + (s > 0 ? Math.PI : 0);
        const a = s * (0.5 + i * 0.62) + Math.sin(phase) * 0.28 * moving;
        const kx = Math.cos(a) * 10, ky = Math.sin(a) * 10;
        const bend = a + s * 0.65 * (i < 2 ? -1 : 1);
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.lineTo(kx, ky);
        ctx.lineTo(kx + Math.cos(bend) * 10, ky + Math.sin(bend) * 10);
        ctx.stroke();
      }
    }
    ctx.shadowColor = spider.color;
    ctx.shadowBlur = 14;
    ctx.fillStyle = '#151a21';
    ctx.strokeStyle = spider.color;
    ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.ellipse(-8, 0, 8, 6, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    ctx.beginPath(); ctx.ellipse(3, 0, 5, 4.2, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    ctx.shadowBlur = 6;
    ctx.shadowColor = '#ff3b3b';
    ctx.fillStyle = '#ff3b3b';
    ctx.beginPath(); ctx.arc(6, -1.6, 1.1, 0, Math.PI * 2); ctx.arc(6, 1.6, 1.1, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }

  /* ================= Watching the page ================= */
  let warmUntil = performance.now() + WARMUP_MS;
  let pendingText = null;
  let lastUrl = location.href;

  function ignored(node) {
    const el = node.nodeType === 1 ? node : node.parentElement;
    if (!el || el === canvas || el === btn) return true;
    // the message box, menus, sidebars and dialogs are not Claude's writing
    return !!el.closest('[contenteditable="true"], textarea, input, nav, aside, [role="dialog"], [role="menu"], button');
  }

  function lastTextIn(root) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let t, last = null;
    while ((t = walker.nextNode())) if (t.textContent.trim()) last = t;
    return last;
  }

  const observer = new MutationObserver(muts => {
    if (!enabled || performance.now() < warmUntil) return;
    let linksThisBatch = 0;
    for (const m of muts) {
      if (m.type === 'characterData') {
        if (!ignored(m.target) && m.target.textContent.trim()) pendingText = m.target;
        continue;
      }
      for (const n of m.addedNodes) {
        if (ignored(n)) continue;
        if (n.nodeType === Node.TEXT_NODE) {
          if (n.textContent.trim()) pendingText = n;
          continue;
        }
        if (n.nodeType !== Node.ELEMENT_NODE) continue;
        const links = n.matches('a[href]') ? [n] : Array.from(n.querySelectorAll('a[href]'));
        for (const a of links) {
          if (linksThisBatch >= 3) break;
          if (/^https?:/i.test(a.href) && !ignored(a)) { enqueue({ el: a }); linksThisBatch++; }
        }
        const last = lastTextIn(n);
        if (last) pendingText = last;
      }
    }
  });

  setInterval(() => {
    if (location.href !== lastUrl) {           // switched to another chat
      lastUrl = location.href;
      reset();
      warmUntil = performance.now() + WARMUP_MS;
      return;
    }
    if (!enabled || !pendingText || !pendingText.isConnected) return;
    const node = pendingText;
    pendingText = null;
    const len = node.length;
    if (!len) return;
    const range = document.createRange();
    range.setStart(node, len - 1);
    range.setEnd(node, len);
    const rtl = getComputedStyle(node.parentElement).direction === 'rtl';
    enqueue({ range, rtl });
  }, TEXT_TICK_MS);

  /* ================= Main loop ================= */
  function frame(now) {
    ctx.clearRect(0, 0, W, H);
    if (enabled && !document.hidden) {
      let moving = 0;

      // drop threads whose ends left the page, draw the rest
      threads = threads.filter(th => {
        const a = resolve(th.a), b = resolve(th.b);
        if (!a || !b) return false;
        drawThread(th, a, b, now);
        return true;
      });

      if (spider.t >= 1 && queue.length) startTravel(queue.shift());

      if (spider.t < 1 && spider.to) {
        const a = resolve(spider.from), b = resolve(spider.to);
        if (!a || !b) {
          spider.t = 1; spider.to = null;
        } else {
          spider.t = Math.min(1, (now - spider.t0) / spider.dur);
          const e = ease(spider.t);
          const c = ctrl(a, b, spider.seed, now);
          const p = bez(a, c, b, e);
          const p2 = bez(a, c, b, Math.min(1, e + 0.03));
          if (e < 0.97) spider.angle = lerpAngle(spider.angle, Math.atan2(p2.y - p.y, p2.x - p.x), 0.25);
          spider.x = p.x; spider.y = p.y;
          spider.gait += 0.45;
          moving = 1;
          drawPartial(a, c, b, e, spider.color, now);
          if (spider.t >= 1) arrive();
        }
      } else if (spider.current) {
        const p = resolve(spider.current);
        if (p) { spider.x = p.x; spider.y = p.y; }
      }

      // white dots on visited points
      ctx.setLineDash([]);
      ctx.shadowBlur = 0;
      ctx.globalAlpha = 0.85;
      ctx.fillStyle = '#ffffff';
      for (const v of visited) {
        const p = resolve(v);
        if (!p || p.y < -10 || p.y > H + 10) continue;
        ctx.beginPath(); ctx.arc(p.x, p.y, 2, 0, Math.PI * 2); ctx.fill();
      }

      if (spider.y > -20) drawSpider(moving);
      ctx.globalAlpha = 1;
    }
    requestAnimationFrame(frame);
  }

  btn.addEventListener('click', () => {
    enabled = !enabled;
    store.set(enabled);
    btn.style.opacity = enabled ? '1' : '0.45';
    if (!enabled) reset();
  });
  btn.style.opacity = enabled ? '1' : '0.45';

  document.body.append(canvas, btn);
  observer.observe(document.body, { childList: true, subtree: true, characterData: true });
  requestAnimationFrame(frame);
})();
