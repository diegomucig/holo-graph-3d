'use strict';
/* Holo Graph 3D — grafo 3D olografico per Obsidian (nessuna dipendenza, nessuna build) */
const obsidian = require('obsidian');
const { Plugin, ItemView, PluginSettingTab, Notice, TFile, TFolder, Menu, setIcon } = obsidian;

const VIEW_TYPE = 'holo-graph-3d-view';
const FOV = Math.PI / 3;

/* ============================== IMPOSTAZIONI ============================== */
const DEFAULTS = {
  // filtri
  search: '', showNotes: true, showFolders: true, showAttachments: true, showTags: false,
  showUnresolved: false, showOrphans: true, showRoot: false,
  showNoteLinks: true, showEmbedLinks: true, showFolderLinks: true, showTagLinks: true,
  localMode: false, localDepth: 2, excludePaths: '',
  // colori
  settingsVersion: 3, style: 'Arancione', colorMode: 'type', groups: [],
  bgColor: '#050302',
  colorNote: '#ffa726', colorFolder: '#ffd27a', colorAttachment: '#e8660c', colorTag: '#ffc04d',
  colorUnresolved: '#7a4a22', colorActive: '#fff1d6',
  colorLinkLink: '#d9801a', colorLinkEmbed: '#ff8c1a', colorLinkFolder: '#9c5a14', colorLinkTag: '#b8761c',
  linkColorMode: 'type',
  // nodi
  nodeSize: 3.2, sizeByDegree: 1, scaleNote: 1, scaleFolder: 1.7, scaleAttachment: 1.1, scaleTag: 1.2, scaleUnresolved: 0.7,
  wireframeFolders: true, wireframeAttachments: false,
  // link
  linkOpacity: 0.5, linkWidth: 1,
  particles: true, particleCount: 300, particleSpeed: 0.5, particleSize: 1.6, particlesFolder: false,
  // etichette
  labels: true, labelMode: 'near', labelDistance: 220, maxLabels: 50, labelSize: 12, labelColor: '#ffe3bf',
  // effetti
  glow: true, glowSize: 1.5, glowStrength: 0.55, depthFade: 0.6, dimOthers: 0.12,
  stars: true, starCount: 1200, starColor: '#ffb066',
  autoRotate: false, autoRotateSpeed: 0.12, pixelRatioCap: 2,
  // forze
  repulsion: 45, linkDistance: 32, linkStrength: 0.8, folderLinkDistance: 20, folderLinkStrength: 0.9,
  gravity: 0.05, velocityDecay: 0.4,
  // nucleo
  core: true, coreAll: true, coreSize: 9, coreGlow: 1.6, coreParticles: 160,
  colorCore: '#ffe2a8', colorLinkCore: '#b86a14',
  spokeOpacity: 0.16, spokeDistance: 85, spokeStrength: 0.25,
  panelVisible: true,
};

const PRESETS = {
  'Arancione': {
    bgColor: '#050302', colorNote: '#ffa726', colorFolder: '#ffd27a', colorAttachment: '#e8660c', colorTag: '#ffc04d',
    colorUnresolved: '#7a4a22', colorActive: '#fff1d6',
    colorLinkLink: '#d9801a', colorLinkEmbed: '#ff8c1a', colorLinkFolder: '#9c5a14', colorLinkTag: '#b8761c',
    starColor: '#ffb066', labelColor: '#ffe3bf',
    colorCore: '#ffe2a8', colorLinkCore: '#b86a14' },
  'Azzurro': {
    bgColor: '#020812', colorNote: '#3ec6ff', colorFolder: '#b5ecff', colorAttachment: '#1f8fff', colorTag: '#7fd8ff',
    colorUnresolved: '#3b5873', colorActive: '#e8f9ff',
    colorLinkLink: '#2a9be0', colorLinkEmbed: '#1f7fe0', colorLinkFolder: '#2b6ea0', colorLinkTag: '#3aa6c9',
    starColor: '#8fd0ff', labelColor: '#d6f2ff',
    colorCore: '#d2f3ff', colorLinkCore: '#2a86c0' },
};

function cloneDefaults() { return JSON.parse(JSON.stringify(DEFAULTS)); }

/* ================================ UTILITÀ ================================= */
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
function hex2rgb(h) {
  h = String(h || '#ffffff').replace('#', '');
  if (h.length === 3) h = h.split('').map((x) => x + x).join('');
  const v = parseInt(h, 16) || 0;
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}
function hsl2rgb(h, s, l) {
  const k = (n) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return [Math.round(f(0) * 255), Math.round(f(8) * 255), Math.round(f(4) * 255)];
}
function hashStr(str) { let h = 0; for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) | 0; return Math.abs(h); }
const rgba = (c, a) => `rgba(${c[0]},${c[1]},${c[2]},${Math.round(clamp(a, 0, 1) * 100) / 100})`;
const mixWhite = (c, t) => [Math.round(c[0] + (255 - c[0]) * t), Math.round(c[1] + (255 - c[1]) * t), Math.round(c[2] + (255 - c[2]) * t)];

function parseQuery(q) {
  q = (q || '').trim();
  if (!q) return null;
  const toks = q.split(/\s+/).map((t) => {
    let neg = false;
    if (t.startsWith('-') && t.length > 1) { neg = true; t = t.slice(1); }
    let key = 'text', val = t;
    const m = t.match(/^(path|file|tag|ext|type):(.*)$/i);
    if (m) { key = m[1].toLowerCase(); val = m[2]; }
    return { neg, key, val: val.toLowerCase().replace(/^"|"$/g, '') };
  }).filter((t) => t.val);
  return toks.length ? toks : null;
}
function matchQuery(n, toks) {
  const path = n.path.toLowerCase(), label = n.label.toLowerCase();
  for (const t of toks) {
    let ok;
    switch (t.key) {
      case 'path': ok = path.includes(t.val); break;
      case 'file': ok = label.includes(t.val) || path.split('/').pop().includes(t.val); break;
      case 'tag': {
        const v = t.val.replace(/^#/, '');
        ok = n.tags.some((x) => x.toLowerCase().includes(v)) || (n.type === 'tag' && label.includes(v));
        break;
      }
      case 'ext': ok = n.ext === t.val.replace(/^\./, ''); break;
      case 'type': ok = n.type === t.val; break;
      default: ok = path.includes(t.val) || label.includes(t.val);
    }
    if (t.neg) ok = !ok;
    if (!ok) return false;
  }
  return true;
}

/* ============================ COSTRUZIONE GRAFO =========================== */
const NOTE_EXT = new Set(['md', 'canvas', 'base']);

function buildFullGraph(app) {
  const vault = app.vault, mc = app.metadataCache;
  const nodes = new Map();
  const links = [];
  const seen = new Set();
  const addLink = (s, t, type) => {
    const k = s < t ? s + '\u0001' + t + type : t + '\u0001' + s + type;
    if (seen.has(k)) return;
    seen.add(k);
    links.push({ s, t, type });
  };
  const root = vault.getRoot();
  nodes.set('/', { id: '/', type: 'folder', label: vault.getName() || 'Vault', path: '/', ext: '', tags: [], isRoot: true, file: root });
  for (const af of vault.getAllLoadedFiles()) {
    if (af === root) continue;
    if (af instanceof TFolder) {
      nodes.set(af.path, { id: af.path, type: 'folder', label: af.name, path: af.path, ext: '', tags: [], file: af });
    } else if (af instanceof TFile) {
      const ext = (af.extension || '').toLowerCase();
      const isNote = NOTE_EXT.has(ext);
      let tags = [];
      if (ext === 'md') {
        const c = mc.getFileCache(af);
        const t = c && obsidian.getAllTags ? obsidian.getAllTags(c) : null;
        if (t) tags = [...new Set(t)];
      }
      nodes.set(af.path, { id: af.path, type: isNote ? 'note' : 'attachment', label: isNote ? af.basename : af.name, path: af.path, ext, tags, file: af });
    }
  }
  // gerarchia cartelle
  for (const n of [...nodes.values()]) {
    if (n.isRoot) continue;
    const p = n.file.parent;
    const pid = !p || (p.isRoot && p.isRoot()) ? '/' : p.path;
    if (nodes.has(pid)) addLink(pid, n.id, 'folder');
  }
  // link e incorporamenti
  const resolved = mc.resolvedLinks || {};
  for (const src of Object.keys(resolved)) {
    if (!nodes.has(src)) continue;
    for (const dst of Object.keys(resolved[src])) {
      const d = nodes.get(dst);
      if (!d || dst === src) continue;
      addLink(src, dst, d.type === 'attachment' ? 'embed' : 'link');
    }
  }
  // non risolti
  const unresolved = mc.unresolvedLinks || {};
  for (const src of Object.keys(unresolved)) {
    if (!nodes.has(src)) continue;
    for (const name of Object.keys(unresolved[src])) {
      const gid = 'ghost:' + name;
      if (!nodes.has(gid)) nodes.set(gid, { id: gid, type: 'unresolved', label: name, path: name, ext: '', tags: [] });
      addLink(src, gid, 'link');
    }
  }
  // tag
  for (const n of [...nodes.values()]) {
    for (const t of n.tags) {
      const tid = 'tag:' + t;
      if (!nodes.has(tid)) nodes.set(tid, { id: tid, type: 'tag', label: t, path: t, ext: '', tags: [] });
      addLink(n.id, tid, 'tag');
    }
  }
  const arr = [...nodes.values()];
  const sig = arr.map((n) => n.id + (n.tags.length ? '#' + n.tags.join(',') : '')).join('\n') + '|' + links.map((l) => l.s + '>' + l.t).join('\n');
  return { nodes: arr, links, sig };
}

function filterGraph(full, s, focusId) {
  const ex = (s.excludePaths || '').split(',').map((x) => x.trim().toLowerCase()).filter(Boolean);
  const toks = parseQuery(s.search);
  let nodes = full.nodes.filter((n) => {
    switch (n.type) {
      case 'note': if (!s.showNotes) return false; break;
      case 'folder': if (!s.showFolders) return false; if (n.isRoot && !s.showRoot) return false; break;
      case 'attachment': if (!s.showAttachments) return false; break;
      case 'tag': if (!s.showTags) return false; break;
      case 'unresolved': if (!s.showUnresolved) return false; break;
    }
    if (ex.length) {
      const p = n.path.toLowerCase();
      for (const e of ex) if (p.startsWith(e) || p.includes('/' + e)) return false;
    }
    if (toks && !matchQuery(n, toks)) return false;
    return true;
  });
  let ids = new Set(nodes.map((n) => n.id));
  const lt = { link: s.showNoteLinks, embed: s.showEmbedLinks, folder: s.showFolderLinks, tag: s.showTagLinks };
  let links = full.links.filter((l) => lt[l.type] && ids.has(l.s) && ids.has(l.t));
  if (!s.showOrphans) {
    const d = new Set();
    for (const l of links) { d.add(l.s); d.add(l.t); }
    nodes = nodes.filter((n) => d.has(n.id));
    ids = new Set(nodes.map((n) => n.id));
  }
  if (focusId && ids.has(focusId)) {
    const adj = new Map();
    for (const l of links) {
      if (!adj.has(l.s)) adj.set(l.s, []);
      if (!adj.has(l.t)) adj.set(l.t, []);
      adj.get(l.s).push(l.t); adj.get(l.t).push(l.s);
    }
    const keep = new Set([focusId]);
    let frontier = [focusId];
    for (let d = 0; d < Math.max(1, s.localDepth); d++) {
      const next = [];
      for (const id of frontier) for (const nb of adj.get(id) || []) if (!keep.has(nb)) { keep.add(nb); next.push(nb); }
      frontier = next;
    }
    nodes = nodes.filter((n) => keep.has(n.id));
    links = links.filter((l) => keep.has(l.s) && keep.has(l.t));
  }
  return { nodes, links };
}

/* ============================ FISICA 3D (Barnes-Hut) ====================== */
function Cell(x, y, z, s) { this.x = x; this.y = y; this.z = z; this.s = s; this.m = 0; this.cx = 0; this.cy = 0; this.cz = 0; this.ch = null; this.n = null; }
function treeInsert(c, n, d) {
  const m = c.m;
  c.cx = (c.cx * m + n.x) / (m + 1); c.cy = (c.cy * m + n.y) / (m + 1); c.cz = (c.cz * m + n.z) / (m + 1);
  c.m = m + 1;
  if (c.m === 1) { c.n = n; return; }
  if (!c.ch) {
    if (d > 40) return;
    c.ch = [null, null, null, null, null, null, null, null];
    const old = c.n; c.n = null;
    if (old) treePut(c, old, d);
  }
  treePut(c, n, d);
}
function treePut(c, n, d) {
  const h = c.s / 2;
  const ix = n.x >= c.x + h ? 1 : 0, iy = n.y >= c.y + h ? 1 : 0, iz = n.z >= c.z + h ? 1 : 0;
  const i = ix | (iy << 1) | (iz << 2);
  let ch = c.ch[i];
  if (!ch) ch = c.ch[i] = new Cell(c.x + ix * h, c.y + iy * h, c.z + iz * h, h);
  treeInsert(ch, n, d + 1);
}
function applyRepel(root, n, k, theta2, maxD2) {
  const stack = [root];
  while (stack.length) {
    const c = stack.pop();
    if (c.m === 0) continue;
    let dx = c.cx - n.x, dy = c.cy - n.y, dz = c.cz - n.z;
    let d2 = dx * dx + dy * dy + dz * dz;
    if (!c.ch) {
      if (c.n === n) continue;
      if (d2 === 0) { dx = (Math.random() - 0.5) * 0.1; dy = (Math.random() - 0.5) * 0.1; dz = (Math.random() - 0.5) * 0.1; d2 = dx * dx + dy * dy + dz * dz + 1e-6; }
      if (d2 > maxD2) continue;
      if (d2 < 1) d2 = 1;
      const f = (k * c.m) / d2;
      n.vx -= dx * f; n.vy -= dy * f; n.vz -= dz * f;
    } else if (c.s * c.s < theta2 * d2) {
      if (d2 > maxD2) continue;
      if (d2 < 1) d2 = 1;
      const f = (k * c.m) / d2;
      n.vx -= dx * f; n.vy -= dy * f; n.vz -= dz * f;
    } else {
      const ch = c.ch;
      for (let i = 0; i < 8; i++) if (ch[i]) stack.push(ch[i]);
    }
  }
}

/* ================================= MOTORE ================================= */
const K_STRUCT = new Set(['search', 'showNotes', 'showFolders', 'showAttachments', 'showTags', 'showUnresolved', 'showOrphans',
  'showRoot', 'showNoteLinks', 'showEmbedLinks', 'showFolderLinks', 'showTagLinks', 'localMode', 'localDepth', 'excludePaths', 'core', 'coreAll']);
const K_FORCE = new Set(['repulsion', 'linkDistance', 'linkStrength', 'folderLinkDistance', 'folderLinkStrength', 'gravity', 'velocityDecay', 'spokeDistance', 'spokeStrength']);
const K_SIZE = new Set(['nodeSize', 'sizeByDegree', 'scaleNote', 'scaleFolder', 'scaleAttachment', 'scaleTag', 'scaleUnresolved', 'coreSize']);
const K_PART = new Set(['particles', 'particleCount', 'particleSpeed', 'particleSize', 'particlesFolder', 'coreParticles']);
const K_STARS = new Set(['stars', 'starCount', 'starColor']);
const K_VIEW = new Set(['bgColor', 'autoRotate', 'autoRotateSpeed', 'pixelRatioCap']);
const K_PLAIN = new Set(['labels', 'labelMode', 'labelDistance', 'maxLabels', 'labelSize', 'labelColor', 'glow', 'glowSize', 'glowStrength',
  'depthFade', 'dimOthers', 'linkOpacity', 'linkWidth', 'wireframeFolders', 'wireframeAttachments', 'spokeOpacity', 'coreGlow']);

class Engine {
  constructor(app, plugin, host) {
    this.app = app; this.plugin = plugin; this.host = host; this.s = plugin.settings;
    this.full = null; this.nodes = []; this.links = []; this.adj = new Map();
    this.cam = { yaw: 0.6, pitch: 0.3, dist: 300, tx: 0, ty: 0, tz: 0, vyaw: 0, vpitch: 0 };
    this.R = 100; this.alpha = 1; this.alphaDecay = 0.02; this.alphaMin = 0.004; this.running = false;
    this.hover = null; this.hoverSet = null; this.activeId = null; this.focusId = null;
    this.pts = new Map(); this.drag = null; this.tween = null; this.dirty = true;
    this.parts = []; this.stars = []; this.glowCache = new Map(); this.cleanups = [];
    this.openSecs = { 'Nucleo': true }; this.coreNode = null; this.realNodes = null; this.realLinks = null; this.corePool = []; this.frame = 0; this.disposed = false; this.lastMoveT = 0;
    this.mx = -1; this.my = -1; this.pointerDirty = false; this.w = 300; this.h = 300; this.dpr = 1;
    this.targetLeaf = null; this.saveTimer = null; this.structTimer = null;
    this.focal = 300; this.pool = null;
  }

  start() {
    const h = this.host;
    h.empty(); h.addClass('h3d-root');
    this.canvas = h.createEl('canvas', { cls: 'h3d-canvas' });
    this.ctx = this.canvas.getContext('2d');
    this.hud = h.createDiv({ cls: 'h3d-hud' });
    this.panelWrap = h.createDiv({ cls: 'h3d-panelwrap' });
    try { this.fontFamily = getComputedStyle(document.body).fontFamily || 'sans-serif'; } catch (e) { this.fontFamily = 'sans-serif'; }
    const af = this.app.workspace.getActiveFile();
    this.activeId = af ? af.path : null;
    this.bindEvents();
    this.applyTheme();
    this.buildPanel();
    this.resize();
    this.makeStars();
    this.refreshFull(true);
    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(h);
    this.last = performance.now();
    this.loop = this.loop.bind(this);
    this.raf = requestAnimationFrame(this.loop);
  }

  destroy() {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    if (this.ro) this.ro.disconnect();
    for (const f of this.cleanups) f();
    this.cleanups = [];
    clearTimeout(this.saveTimer); clearTimeout(this.structTimer);
    this.plugin.saveSettings();
    this.host.empty();
  }

  on(el, ev, fn, opt) { el.addEventListener(ev, fn, opt); this.cleanups.push(() => el.removeEventListener(ev, fn, opt)); }

  /* ---------- dati ---------- */
  refreshFull(first) {
    const g = buildFullGraph(this.app);
    if (this.full && !first && g.sig === this.full.sig) return;
    if (this.full) {
      const old = new Map(this.full.nodes.map((n) => [n.id, n]));
      for (const n of g.nodes) {
        const o = old.get(n.id);
        if (o && o.x !== undefined) {
          n.x = o.x; n.y = o.y; n.z = o.z; n.vx = 0; n.vy = 0; n.vz = 0;
          if (o.pinned) { n.pinned = true; n.fx = o.fx; n.fy = o.fy; n.fz = o.fz; }
        }
      }
    }
    this.full = g;
    this.rebuildScene(!!first);
  }

  rebuildScene(first) {
    if (!this.full) return;
    const s = this.s;
    const f = filterGraph(this.full, s, this.focusId || (s.localMode ? this.activeId : null));
    this.nodes = f.nodes;
    const idx = new Map();
    for (const n of this.nodes) { n._deg = 0; idx.set(n.id, n); }
    this.links = [];
    for (const l of f.links) {
      const a = idx.get(l.s), b = idx.get(l.t);
      if (!a || !b) continue;
      a._deg++; b._deg++;
      this.links.push({ source: a, target: b, type: l.type });
    }
    this.adj = new Map();
    for (const n of this.nodes) this.adj.set(n.id, new Set());
    for (const l of this.links) { this.adj.get(l.source.id).add(l.target.id); this.adj.get(l.target.id).add(l.source.id); }
    let had = 0;
    for (const n of this.nodes) {
      if (n.x === undefined || isNaN(n.x)) {
        const r = 25 + Math.random() * 25, th = Math.random() * Math.PI * 2, ph = Math.acos(2 * Math.random() - 1);
        n.x = r * Math.sin(ph) * Math.cos(th); n.y = r * Math.sin(ph) * Math.sin(th); n.z = r * Math.cos(ph);
        n.vx = 0; n.vy = 0; n.vz = 0;
      } else had++;
    }
    this.hover = null; this.hoverSet = null;
    const fresh = had < this.nodes.length * 0.5;
    this.realNodes = this.nodes.length; this.realLinks = this.links.length;
    this.coreNode = null;
    if (s.core && this.nodes.length) this.addCore();
    this.styleAll();
    this.rebuildParticles();
    this.alpha = fresh ? 1 : 0.45;
    if (fresh) {
      const nn = this.nodes.length;
      const it = nn <= 800 ? 200 : nn <= 2500 ? 80 : 25;
      for (let i = 0; i < it; i++) this.physicsStep();
    }
    this.running = true;
    if (first || fresh) this.fitAll(first);
    this.updateHud();
    this.dirty = true;
  }

  addCore() {
    const s = this.s;
    const c = { id: '__core__', type: 'core', label: 'Nucleo', path: '', ext: '', tags: [], isRoot: false,
      x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, fx: 0, fy: 0, fz: 0, pinned: true, _deg: 0 };
    const targets = this.nodes.filter((n) => s.coreAll || n._deg === 0 || (n.type === 'folder' && !n.isRoot && n.path.indexOf('/') < 0));
    for (const n of targets) this.links.push({ source: c, target: n, type: 'core' });
    c._deg = targets.length;
    this.adj.set(c.id, new Set(targets.map((n) => n.id)));
    this.nodes.push(c);
    this.coreNode = c;
  }

  styleAll() {
    const s = this.s;
    const T = { note: hex2rgb(s.colorNote), folder: hex2rgb(s.colorFolder), attachment: hex2rgb(s.colorAttachment), tag: hex2rgb(s.colorTag), unresolved: hex2rgb(s.colorUnresolved) };
    const SC = { note: s.scaleNote, folder: s.scaleFolder, attachment: s.scaleAttachment, tag: s.scaleTag, unresolved: s.scaleUnresolved };
    this.linkRgb = { link: hex2rgb(s.colorLinkLink), embed: hex2rgb(s.colorLinkEmbed), folder: hex2rgb(s.colorLinkFolder), tag: hex2rgb(s.colorLinkTag), core: hex2rgb(s.colorLinkCore) };
    this.activeRgb = hex2rgb(s.colorActive);
    const groups = (s.groups || []).map((g) => ({ toks: parseQuery(g.query), c: hex2rgb(g.color) })).filter((g) => g.toks);
    for (const n of this.nodes) {
      if (n.type === 'core') { n._col = hex2rgb(s.colorCore); n._r = s.coreSize; continue; }
      let c = null;
      for (const g of groups) if (matchQuery(n, g.toks)) { c = g.c; break; }
      if (!c && s.colorMode === 'topFolder' && !n.isRoot && (n.type === 'note' || n.type === 'folder' || n.type === 'attachment')) {
        const parts = n.path.split('/');
        if (parts.length > 1 || n.type === 'folder') c = hsl2rgb(hashStr(parts[0]) % 360, 0.9, 0.62);
      }
      n._col = c || T[n.type];
      n._r = s.nodeSize * SC[n.type] * (1 + s.sizeByDegree * Math.log2(1 + n._deg) * 0.28) * (n.isRoot ? 1.5 : 1);
    }
    this.dirty = true;
  }

  rebuildParticles() {
    const s = this.s;
    this.parts = [];
    this.pool = []; this.corePool = [];
    if (!s.particles || !this.links.length) return;
    const real = this.links.filter((l) => l.type !== 'core');
    let pool = real.filter((l) => s.particlesFolder || l.type !== 'folder');
    if (!pool.length) pool = real;
    this.pool = pool;
    const P = pool.length ? Math.min(s.particleCount, pool.length * 4) : 0;
    for (let i = 0; i < P; i++) this.parts.push({ l: pool[(Math.random() * pool.length) | 0], t: Math.random(), v: 0.5 + Math.random() });
    const cp = this.links.filter((l) => l.type === 'core');
    this.corePool = cp;
    const C = cp.length ? Math.min(s.coreParticles, cp.length * 3) : 0;
    for (let i = 0; i < C; i++) this.parts.push({ l: cp[(Math.random() * cp.length) | 0], t: Math.random(), v: 0.6 + Math.random() * 0.8, core: true });
  }

  makeStars() {
    const N = this.s.starCount, a = [];
    for (let i = 0; i < N; i++) {
      const th = Math.random() * Math.PI * 2, z = 2 * Math.random() - 1, r = Math.sqrt(1 - z * z);
      a.push({ x: r * Math.cos(th), y: z, z: r * Math.sin(th), a: 0.2 + Math.random() * 0.6, s: 0.6 + Math.random() * 1.0 });
    }
    this.stars = a;
  }

  /* ---------- fisica ---------- */
  physicsStep() {
    const s = this.s, nodes = this.nodes, links = this.links, a = this.alpha, N = nodes.length;
    if (N === 0) return;
    if (N > 1) {
      let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity;
      for (let i = 0; i < N; i++) {
        const n = nodes[i];
        if (n.x < x0) x0 = n.x; if (n.x > x1) x1 = n.x;
        if (n.y < y0) y0 = n.y; if (n.y > y1) y1 = n.y;
        if (n.z < z0) z0 = n.z; if (n.z > z1) z1 = n.z;
      }
      const size = Math.max(x1 - x0, y1 - y0, z1 - z0) + 1;
      const root = new Cell(x0, y0, z0, size);
      for (let i = 0; i < N; i++) treeInsert(root, nodes[i], 0);
      const k = s.repulsion * a;
      for (let i = 0; i < N; i++) applyRepel(root, nodes[i], k, 0.81, 640000);
    }
    for (let i = 0; i < links.length; i++) {
      const l = links[i], A = l.source, B = l.target;
      let dx = B.x + B.vx - A.x - A.vx, dy = B.y + B.vy - A.y - A.vy, dz = B.z + B.vz - A.z - A.vz;
      if (dx === 0 && dy === 0 && dz === 0) { dx = (Math.random() - 0.5) * 0.1; dy = (Math.random() - 0.5) * 0.1; dz = (Math.random() - 0.5) * 0.1; }
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1e-6;
      let dist, st;
      if (l.type === 'core') { dist = s.spokeDistance; st = s.spokeStrength; }
      else {
        const isF = l.type === 'folder';
        dist = isF ? s.folderLinkDistance : s.linkDistance;
        st = (isF ? s.folderLinkStrength : s.linkStrength) / Math.max(1, Math.min(A._deg, B._deg));
      }
      const kk = ((d - dist) / d) * a * st;
      dx *= kk; dy *= kk; dz *= kk;
      const bias = A._deg / (A._deg + B._deg);
      B.vx -= dx * bias; B.vy -= dy * bias; B.vz -= dz * bias;
      A.vx += dx * (1 - bias); A.vy += dy * (1 - bias); A.vz += dz * (1 - bias);
    }
    const g = s.gravity * a, damp = 1 - s.velocityDecay;
    for (let i = 0; i < N; i++) {
      const n = nodes[i];
      n.vx -= n.x * g; n.vy -= n.y * g; n.vz -= n.z * g;
      if (n.fx != null) { n.x = n.fx; n.y = n.fy; n.z = n.fz; n.vx = n.vy = n.vz = 0; continue; }
      n.vx *= damp; n.vy *= damp; n.vz *= damp;
      n.x += n.vx; n.y += n.vy; n.z += n.vz;
    }
    this.alpha += (0 - this.alpha) * this.alphaDecay;
  }

  /* ---------- camera ---------- */
  fitAll(instant) {
    const nodes = this.nodes;
    if (!nodes.length) return;
    this.updateCam();
    let cx = 0, cy = 0, cz = 0;
    for (const n of nodes) { cx += n.x; cy += n.y; cz += n.z; }
    cx /= nodes.length; cy /= nodes.length; cz /= nodes.length;
    let R = 10;
    for (const n of nodes) R = Math.max(R, Math.hypot(n.x - cx, n.y - cy, n.z - cz));
    this.R = R;
    const to = { tx: cx, ty: cy, tz: cz, dist: Math.max(80, (1.2 * R * this.focal) / (0.5 * Math.min(this.w, this.h))) };
    if (instant) Object.assign(this.cam, to);
    else this.tween = { t0: performance.now(), dur: 700, from: { tx: this.cam.tx, ty: this.cam.ty, tz: this.cam.tz, dist: this.cam.dist }, to };
    this.dirty = true;
  }
  flyTo(n) {
    this.tween = { t0: performance.now(), dur: 650, from: { tx: this.cam.tx, ty: this.cam.ty, tz: this.cam.tz, dist: this.cam.dist },
      to: { tx: n.x, ty: n.y, tz: n.z, dist: Math.max(70, Math.min(this.cam.dist, 150)) } };
    this.dirty = true;
  }
  updateCam() {
    const c = this.cam;
    const cp = Math.cos(c.pitch), sp = Math.sin(c.pitch), cy = Math.cos(c.yaw), sy = Math.sin(c.yaw);
    this.px = c.tx + cp * sy * c.dist; this.py = c.ty + sp * c.dist; this.pz = c.tz + cp * cy * c.dist;
    this.fx = -cp * sy; this.fy = -sp; this.fz = -cp * cy;
    this.rx = cy; this.rz = -sy;
    this.ux = -sp * sy; this.uy = cp; this.uz = -sp * cy;
    this.focal = this.h / (2 * Math.tan(FOV / 2));
    this.ccx = this.w / 2; this.ccy = this.h / 2;
  }
  project(n) {
    const dx = n.x - this.px, dy = n.y - this.py, dz = n.z - this.pz;
    const z = dx * this.fx + dy * this.fy + dz * this.fz;
    n._z = z;
    if (z < 2) { n._vis = false; return; }
    const k = this.focal / z;
    n._k = k;
    n._sx = this.ccx + (dx * this.rx + dz * this.rz) * k;
    n._sy = this.ccy - (dx * this.ux + dy * this.uy + dz * this.uz) * k;
    n._vis = n._sx > -80 && n._sx < this.w + 80 && n._sy > -80 && n._sy < this.h + 80;
  }
  screenToWorld(x, y, z) {
    const k = z / this.focal, ox = (x - this.ccx) * k, oy = -(y - this.ccy) * k;
    return [this.px + this.fx * z + this.rx * ox + this.ux * oy, this.py + this.fy * z + this.uy * oy, this.pz + this.fz * z + this.rz * ox + this.uz * oy];
  }

  resize() {
    if (this.disposed) return;
    const w = this.host.clientWidth, h = this.host.clientHeight;
    if (!w || !h) return;
    this.dpr = Math.min(window.devicePixelRatio || 1, this.s.pixelRatioCap);
    this.w = w; this.h = h;
    this.canvas.width = Math.round(w * this.dpr); this.canvas.height = Math.round(h * this.dpr);
    this.canvas.style.width = w + 'px'; this.canvas.style.height = h + 'px';
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this.updateCam();
    this.dirty = true;
  }

  /* ---------- interazione ---------- */
  bindEvents() {
    const c = this.canvas;
    this.on(c, 'pointerdown', (e) => this.onDown(e));
    this.on(c, 'pointermove', (e) => this.onMove(e));
    this.on(c, 'pointerup', (e) => this.onUp(e));
    this.on(c, 'pointercancel', (e) => this.onUp(e));
    this.on(c, 'pointerleave', () => { if (!this.pts.size) { this.mx = -1; this.setHover(null); } });
    this.on(c, 'wheel', (e) => {
      e.preventDefault();
      this.cam.dist = clamp(this.cam.dist * Math.exp(e.deltaY * 0.0012), 15, 30000);
      this.tween = null; this.dirty = true;
    }, { passive: false });
    this.on(c, 'contextmenu', (e) => e.preventDefault());
    this.on(c, 'dblclick', () => { if (this.hover) this.flyTo(this.hover); else this.fitAll(false); });
  }
  rel(e) { const r = this.canvas.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; }

  pick(x, y) {
    let best = null, bd = 1e18;
    for (const n of this.nodes) {
      if (!n._vis) continue;
      const rs = Math.max(6, n._r * n._k * 1.3);
      const dx = n._sx - x, dy = n._sy - y, d2 = dx * dx + dy * dy;
      if (d2 < rs * rs) { const sc = d2 / (rs * rs) + n._z * 1e-6; if (sc < bd) { bd = sc; best = n; } }
    }
    this.setHover(best);
  }
  setHover(n) {
    if (n === this.hover) return;
    this.hover = n;
    this.hoverSet = n ? new Set([n.id, ...(this.adj.get(n.id) || [])]) : null;
    this.canvas.style.cursor = n ? 'pointer' : '';
    this.updateHud(); this.dirty = true;
  }

  onDown(e) {
    const [x, y] = this.rel(e);
    try { this.canvas.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
    this.pts.set(e.pointerId, { x, y });
    this.mx = x; this.my = y;
    this.tween = null; this.cam.vyaw = 0; this.cam.vpitch = 0;
    if (this.pts.size === 1) {
      this.updateCam();
      for (const n of this.nodes) this.project(n);
      this.pick(x, y);
      const mode = e.button === 2 || e.button === 1 || e.shiftKey ? 'pan' : this.hover && this.hover.type !== 'core' && e.button === 0 ? 'node' : 'orbit';
      this.drag = { mode, node: this.hover, moved: 0, btn: e.button };
    } else if (this.pts.size === 2) {
      const [a, b] = [...this.pts.values()];
      this.drag = { mode: 'pinch', moved: 99, d: Math.hypot(a.x - b.x, a.y - b.y), mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2 };
    }
    this.dirty = true;
  }
  onMove(e) {
    const [x, y] = this.rel(e);
    const p = this.pts.get(e.pointerId);
    if (!p) { this.mx = x; this.my = y; this.pointerDirty = true; return; }
    const dx = x - p.x, dy = y - p.y;
    p.x = x; p.y = y;
    const cam = this.cam, d = this.drag;
    if (!d) return;
    this.lastMoveT = performance.now();
    if (d.mode === 'pinch' && this.pts.size >= 2) {
      const [a, b] = [...this.pts.values()];
      const nd = Math.hypot(a.x - b.x, a.y - b.y), mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
      if (d.d > 0 && nd > 0) cam.dist = clamp(cam.dist * (d.d / nd), 15, 30000);
      const sc = cam.dist / this.focal, pdx = mx - d.mx, pdy = my - d.my;
      cam.tx -= (this.rx * pdx) * sc; cam.tz -= (this.rz * pdx) * sc;
      cam.tx += this.ux * pdy * sc; cam.ty += this.uy * pdy * sc; cam.tz += this.uz * pdy * sc;
      d.d = nd; d.mx = mx; d.my = my;
    } else if (d.mode === 'orbit') {
      d.moved += Math.abs(dx) + Math.abs(dy);
      cam.yaw -= dx * 0.006; cam.pitch = clamp(cam.pitch + dy * 0.006, -1.5, 1.5);
      cam.vyaw = -dx * 0.006; cam.vpitch = dy * 0.006;
    } else if (d.mode === 'pan') {
      d.moved += Math.abs(dx) + Math.abs(dy);
      const sc = cam.dist / this.focal;
      cam.tx -= this.rx * dx * sc; cam.tz -= this.rz * dx * sc;
      cam.tx += this.ux * dy * sc; cam.ty += this.uy * dy * sc; cam.tz += this.uz * dy * sc;
    } else if (d.mode === 'node') {
      d.moved += Math.abs(dx) + Math.abs(dy);
      if (d.moved > 6 && d.node) {
        const w = this.screenToWorld(x, y, Math.max(5, d.node._z));
        d.node.fx = w[0]; d.node.fy = w[1]; d.node.fz = w[2];
        this.alpha = Math.max(this.alpha, 0.3); this.running = true;
      }
    }
    this.dirty = true;
  }
  onUp(e) {
    const had = this.pts.delete(e.pointerId);
    try { this.canvas.releasePointerCapture(e.pointerId); } catch (err) { /* ignore */ }
    if (!had) return;
    const d = this.drag;
    if (this.pts.size === 0 && d) {
      if (d.mode === 'node' && d.node) {
        if (d.moved > 6) { if (!d.node.pinned) { d.node.fx = null; d.node.fy = null; d.node.fz = null; } }
        else this.clickNode(d.node, e);
      } else if (d.mode === 'pan' && d.moved < 6 && d.btn === 2 && this.hover) {
        this.nodeMenu(this.hover, e);
      }
      if (performance.now() - this.lastMoveT > 80) { this.cam.vyaw = 0; this.cam.vpitch = 0; }
      this.drag = null;
    } else if (this.pts.size === 1) {
      this.drag = { mode: 'orbit', moved: 99, node: null, btn: 0 };
    }
    this.dirty = true;
  }

  openNode(n, newTab) {
    if (!n.file || !(n.file instanceof TFile)) return;
    const ws = this.app.workspace;
    let leaf;
    if (newTab) leaf = ws.getLeaf('tab');
    else {
      leaf = this.targetLeaf;
      let ok = false;
      if (leaf) ws.iterateAllLeaves((l) => { if (l === leaf) ok = true; });
      if (!ok) leaf = ws.getLeaf('split', 'vertical');
    }
    this.targetLeaf = leaf;
    leaf.openFile(n.file);
  }
  clickNode(n, e) {
    if (n.type === 'note' || n.type === 'attachment') this.openNode(n, e.ctrlKey || e.metaKey);
    else this.flyTo(n);
  }
  nodeMenu(n, e) {
    if (n.type === 'core') return;
    const menu = new Menu();
    if (n.file instanceof TFile) {
      menu.addItem((i) => i.setTitle('Apri').setIcon('file').onClick(() => this.openNode(n, false)));
      menu.addItem((i) => i.setTitle('Apri in nuova scheda').setIcon('file-plus').onClick(() => this.openNode(n, true)));
    }
    menu.addItem((i) => i.setTitle('Zoom sul nodo').setIcon('locate-fixed').onClick(() => this.flyTo(n)));
    menu.addItem((i) => i.setTitle('Mostra solo il vicinato').setIcon('git-fork').onClick(() => { this.focusId = n.id; this.rebuildScene(false); this.fitAll(false); }));
    menu.addItem((i) => i.setTitle(n.pinned ? 'Sblocca posizione' : 'Blocca posizione').setIcon(n.pinned ? 'unlock' : 'lock').onClick(() => {
      if (n.pinned) { n.pinned = false; n.fx = null; n.fy = null; n.fz = null; }
      else { n.pinned = true; n.fx = n.x; n.fy = n.y; n.fz = n.z; }
      this.dirty = true;
    }));
    menu.showAtMouseEvent(e);
  }
  setActive(path) {
    this.activeId = path;
    if (this.s.localMode && !this.focusId) this.rebuildScene(false);
    this.dirty = true;
  }

  /* ---------- HUD ---------- */
  updateHud() {
    this.hud.empty();
    this.hud.createSpan({ text: `${this.realNodes != null ? this.realNodes : this.nodes.length} nodi · ${this.realLinks != null ? this.realLinks : this.links.length} collegamenti` });
    if (this.focusId) {
      const b = this.hud.createEl('button', { text: '✕ esci dal vicinato', cls: 'h3d-hudbtn' });
      b.onclick = () => { this.focusId = null; this.rebuildScene(false); this.fitAll(false); };
    }
    if (this.hover) this.hud.createDiv({ cls: 'h3d-hudhover', text: this.hover.isRoot || !this.hover.path ? this.hover.label : this.hover.path });
  }

  /* ---------- ciclo ---------- */
  loop(now) {
    if (this.disposed) return;
    this.raf = requestAnimationFrame(this.loop);
    this.frame++;
    if (this.frame % 15 === 0 && this.host.isShown && !this.host.isShown()) return;
    const dt = Math.min(0.05, (now - this.last) / 1000); this.last = now;
    const s = this.s, cam = this.cam;
    let animating = false;
    if (this.tween) {
      const k = clamp((now - this.tween.t0) / this.tween.dur, 0, 1), e = k < 0.5 ? 2 * k * k : 1 - 2 * (1 - k) * (1 - k);
      const f = this.tween.from, t = this.tween.to;
      cam.tx = f.tx + (t.tx - f.tx) * e; cam.ty = f.ty + (t.ty - f.ty) * e; cam.tz = f.tz + (t.tz - f.tz) * e;
      cam.dist = f.dist + (t.dist - f.dist) * e;
      if (k >= 1) this.tween = null;
      animating = true;
    }
    if (!this.pts.size && (Math.abs(cam.vyaw) > 1e-4 || Math.abs(cam.vpitch) > 1e-4)) {
      cam.yaw += cam.vyaw; cam.pitch = clamp(cam.pitch + cam.vpitch, -1.5, 1.5);
      cam.vyaw *= 0.93; cam.vpitch *= 0.93; animating = true;
    }
    if (s.autoRotate && !this.pts.size) { cam.yaw += s.autoRotateSpeed * dt; animating = true; }
    if (this.running) {
      const nn = this.nodes.length, iters = nn > 4000 ? 1 : 2;
      for (let i = 0; i < iters && this.alpha > this.alphaMin; i++) this.physicsStep();
      if (this.alpha <= this.alphaMin) this.running = false;
      if (this.frame % 20 === 0) this.updateRadius();
      animating = true;
    }
    if (s.particles && this.parts.length) animating = true;
    if (this.coreNode) animating = true;
    if (!animating && !this.dirty && !this.pointerDirty) return;
    this.updateCam();
    for (const n of this.nodes) this.project(n);
    if (this.pointerDirty) {
      this.pointerDirty = false;
      if (!this.pts.size && this.mx >= 0) this.pick(this.mx, this.my);
    }
    this.stepParticles(dt);
    this.draw();
    this.dirty = false;
  }
  updateRadius() {
    const nodes = this.nodes;
    if (!nodes.length) return;
    let R = 10;
    for (const n of nodes) R = Math.max(R, Math.hypot(n.x - this.cam.tx, n.y - this.cam.ty, n.z - this.cam.tz));
    this.R = R;
  }
  stepParticles(dt) {
    const sp = this.s.particleSpeed;
    for (const p of this.parts) {
      const A = p.l.source, B = p.l.target;
      const len = Math.max(8, Math.hypot(B.x - A.x, B.y - A.y, B.z - A.z));
      p.t += (dt * sp * p.v * 60) / len;
      if (p.t > 1) { p.t = 0; const pl = p.core ? this.corePool : this.pool; if (pl && pl.length) p.l = pl[(Math.random() * pl.length) | 0]; }
    }
  }

  /* ---------- disegno ---------- */
  glowSprite(c) {
    const key = c[0] + ',' + c[1] + ',' + c[2];
    let sp = this.glowCache.get(key);
    if (!sp) {
      if (this.glowCache.size > 400) this.glowCache.clear();
      sp = document.createElement('canvas'); sp.width = sp.height = 64;
      const g = sp.getContext('2d');
      if (g && g.createRadialGradient) {
        const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
        gr.addColorStop(0, `rgba(${key},1)`); gr.addColorStop(0.18, `rgba(${key},0.55)`);
        gr.addColorStop(0.5, `rgba(${key},0.14)`); gr.addColorStop(1, `rgba(${key},0)`);
        g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
      }
      this.glowCache.set(key, sp);
    }
    return sp;
  }

  nodeAlpha(n) {
    const s = this.s;
    let a = 1 - s.depthFade * clamp((n._z - (this.cam.dist - this.R)) / (2 * this.R), 0, 1);
    if (this.hoverSet && !this.hoverSet.has(n.id)) a *= s.dimOthers;
    return Math.max(0.05, a);
  }

  draw() {
    const ctx = this.ctx, s = this.s, w = this.w, h = this.h;
    ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1;
    ctx.fillStyle = s.bgColor; ctx.fillRect(0, 0, w, h);
    const accent = hex2rgb(s.colorNote);
    const vg = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, Math.max(w, h) * 0.7);
    vg.addColorStop(0, rgba(accent, 0.07)); vg.addColorStop(1, rgba(accent, 0));
    ctx.fillStyle = vg; ctx.fillRect(0, 0, w, h);

    if (s.stars) this.drawStars();

    const hover = this.hover, hi = this.hoverSet;
    /* collegamenti */
    const buckets = new Map();
    const R = this.R, dist = this.cam.dist, dfade = s.depthFade;
    for (const l of this.links) {
      const A = l.source, B = l.target;
      if (A._z < 2 || B._z < 2) continue;
      if (!(A._vis || B._vis)) continue;
      const zm = (A._z + B._z) / 2;
      const bin = zm < dist - R * 0.35 ? 0 : zm < dist + R * 0.35 ? 1 : 2;
      const hot = hover && (A === hover || B === hover) ? 1 : 0;
      const base = s.linkColorMode === 'node' ? A._col : this.linkRgb[l.type];
      const isCore = l.type === 'core' ? 1 : 0;
      const key = base[0] + ',' + base[1] + ',' + base[2] + '|' + bin + '|' + hot + '|' + isCore;
      let b = buckets.get(key);
      if (!b) { b = { c: base, bin, hot, core: isCore, list: [] }; buckets.set(key, b); }
      b.list.push(l);
    }
    const ordered = [...buckets.values()].sort((a, b) => a.hot - b.hot);
    ctx.globalCompositeOperation = 'lighter';
    for (const b of ordered) {
      const depthMul = 1 - dfade * [0, 0.35, 0.65][b.bin];
      let alpha = (b.core ? s.spokeOpacity : s.linkOpacity) * depthMul, width = b.core ? Math.max(0.4, s.linkWidth * 0.7) : s.linkWidth;
      if (hi) { if (b.hot) { alpha = Math.min(1, alpha * 2.6 + 0.2); width *= 1.8; } else alpha *= s.dimOthers; }
      ctx.strokeStyle = rgba(b.c, alpha); ctx.lineWidth = Math.max(0.3, width);
      ctx.beginPath();
      for (const l of b.list) { ctx.moveTo(l.source._sx, l.source._sy); ctx.lineTo(l.target._sx, l.target._sy); }
      ctx.stroke();
    }

    /* particelle */
    if (s.particles && this.parts.length) {
      for (const p of this.parts) {
        const A = p.l.source, B = p.l.target;
        if (hi && A !== hover && B !== hover) continue;
        const x = A.x + (B.x - A.x) * p.t, y = A.y + (B.y - A.y) * p.t, z = A.z + (B.z - A.z) * p.t;
        const dx = x - this.px, dy = y - this.py, dz = z - this.pz;
        const zz = dx * this.fx + dy * this.fy + dz * this.fz;
        if (zz < 2) continue;
        const k = this.focal / zz;
        const sx = this.ccx + (dx * this.rx + dz * this.rz) * k, sy = this.ccy - (dx * this.ux + dy * this.uy + dz * this.uz) * k;
        const c = mixWhite(this.linkRgb[p.l.type], 0.45);
        const r = Math.max(0.8, s.particleSize * k * 0.5);
        ctx.fillStyle = rgba(c, 0.9 * (1 - dfade * clamp((zz - (dist - R)) / (2 * R), 0, 1)));
        ctx.beginPath(); ctx.arc(sx, sy, r, 0, 6.2832); ctx.fill();
      }
    }

    /* nodi */
    const vis = [];
    for (const n of this.nodes) if (n._vis) vis.push(n);
    vis.sort((a, b) => b._z - a._z);
    if (s.glow) {
      for (const n of vis) {
        if (n.type === 'core') continue;
        const rs = Math.max(1.5, n._r * n._k);
        const gs = rs * (1 + s.glowSize * 2.2);
        ctx.globalAlpha = Math.min(1, this.nodeAlpha(n) * s.glowStrength);
        const col = n.id === this.activeId ? this.activeRgb : n._col;
        ctx.drawImage(this.glowSprite(col), n._sx - gs, n._sy - gs, gs * 2, gs * 2);
      }
    }
    if (s.core && this.coreNode && this.coreNode._vis) this.drawCoreGlow();
    ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
    for (const n of vis) {
      if (n.type === 'core') { this.drawCoreBody(n); continue; }
      let rs = n._r * n._k;
      const a = this.nodeAlpha(n);
      const isActive = n.id === this.activeId;
      if (rs < 1.2) { rs = 1.2; }
      if (n === hover) rs *= 1.35;
      if (isActive) rs *= 1.5;
      const col = isActive ? this.activeRgb : n._col;
      const wire = n.type === 'unresolved' || (n.type === 'folder' && s.wireframeFolders) || (n.type === 'attachment' && s.wireframeAttachments);
      this.shapePath(ctx, n.type, n._sx, n._sy, rs);
      if (wire) {
        ctx.fillStyle = rgba(col, a * 0.14); ctx.fill();
        ctx.strokeStyle = rgba(mixWhite(col, 0.15), a); ctx.lineWidth = Math.max(1, rs * 0.16); ctx.stroke();
      } else {
        ctx.fillStyle = rgba(col, a * 0.95); ctx.fill();
        if (rs > 3) { ctx.fillStyle = rgba(mixWhite(col, 0.8), a * 0.7); ctx.beginPath(); ctx.arc(n._sx, n._sy, rs * 0.3, 0, 6.2832); ctx.fill(); }
      }
      if (isActive || n === hover) {
        ctx.strokeStyle = rgba(mixWhite(col, 0.6), a * 0.9); ctx.lineWidth = 1.2;
        ctx.beginPath(); ctx.arc(n._sx, n._sy, rs * 1.9, 0, 6.2832); ctx.stroke();
      }
    }
    if (s.labels) this.drawLabels(vis);
  }

  drawCoreGlow() {
    const ctx = this.ctx, s = this.s, n = this.coreNode;
    const rs = Math.max(2, n._r * n._k);
    const pulse = 1 + 0.07 * Math.sin(performance.now() / 650);
    const a = this.hoverSet && !this.hoverSet.has(n.id) ? Math.max(0.25, s.dimOthers * 2) : 1;
    ctx.globalCompositeOperation = 'lighter';
    const halo = (col, size, alpha) => {
      const g = size * pulse;
      ctx.globalAlpha = Math.min(1, alpha * a);
      ctx.drawImage(this.glowSprite(col), n._sx - g, n._sy - g, g * 2, g * 2);
    };
    halo(n._col, rs * 11 * s.coreGlow, 0.55);
    halo(n._col, rs * 5 * s.coreGlow, 0.85);
    halo(mixWhite(n._col, 0.6), rs * 2.4, 1);
    ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
  }

  drawCoreBody(n) {
    const ctx = this.ctx, rs = Math.max(3, n._r * n._k), c = n._col;
    ctx.fillStyle = rgba(mixWhite(c, 0.9), 1);
    ctx.beginPath(); ctx.arc(n._sx, n._sy, rs * 0.6, 0, 6.2832); ctx.fill();
    ctx.strokeStyle = rgba(mixWhite(c, 0.5), 0.9); ctx.lineWidth = Math.max(1, rs * 0.12);
    ctx.beginPath(); ctx.arc(n._sx, n._sy, rs, 0, 6.2832); ctx.stroke();
    ctx.strokeStyle = rgba(c, 0.35); ctx.lineWidth = 1;
    ctx.beginPath(); ctx.arc(n._sx, n._sy, rs * 1.7, 0, 6.2832); ctx.stroke();
  }

  shapePath(ctx, type, x, y, r) {
    ctx.beginPath();
    if (type === 'folder') {
      const rr = r * 1.2;
      for (let i = 0; i < 6; i++) { const an = Math.PI / 6 + (i * Math.PI) / 3; const px = x + Math.cos(an) * rr, py = y + Math.sin(an) * rr; if (i) ctx.lineTo(px, py); else ctx.moveTo(px, py); }
      ctx.closePath();
    } else if (type === 'attachment') {
      const rr = r * 1.3;
      ctx.moveTo(x, y - rr); ctx.lineTo(x + rr, y); ctx.lineTo(x, y + rr); ctx.lineTo(x - rr, y); ctx.closePath();
    } else if (type === 'tag') {
      const rr = r * 1.35;
      ctx.moveTo(x, y - rr); ctx.lineTo(x + rr * 0.9, y + rr * 0.7); ctx.lineTo(x - rr * 0.9, y + rr * 0.7); ctx.closePath();
    } else {
      ctx.arc(x, y, r, 0, 6.2832);
    }
  }

  drawStars() {
    const ctx = this.ctx, c = hex2rgb(this.s.starColor);
    ctx.globalCompositeOperation = 'lighter';
    for (const st of this.stars) {
      const z = st.x * this.fx + st.y * this.fy + st.z * this.fz;
      if (z < 0.05) continue;
      const k = this.focal / z;
      const sx = this.ccx + (st.x * this.rx + st.z * this.rz) * k, sy = this.ccy - (st.x * this.ux + st.y * this.uy + st.z * this.uz) * k;
      if (sx < 0 || sx > this.w || sy < 0 || sy > this.h) continue;
      ctx.fillStyle = rgba(c, st.a * 0.8);
      ctx.fillRect(sx, sy, st.s, st.s);
    }
    ctx.globalCompositeOperation = 'source-over';
  }

  drawLabels(vis) {
    const s = this.s, ctx = this.ctx, mode = s.labelMode, hi = this.hoverSet;
    const cand = [];
    for (const n of vis) {
      if (n._sx < 0 || n._sx > this.w || n._sy < 0 || n._sy > this.h) continue;
      if (n.type === 'core' && n !== this.hover) continue;
      let pr = 0;
      if (n === this.hover) pr = 4;
      else if (hi && hi.has(n.id)) pr = 3;
      else if (n.id === this.activeId) pr = 3;
      else if (hi) pr = 0;
      else if (mode === 'all') pr = 1;
      else if (mode === 'near' && n._z < s.labelDistance) pr = 1;
      if (pr) { n._lp = pr; cand.push(n); }
    }
    cand.sort((a, b) => b._lp - a._lp || (mode === 'all' ? b._deg - a._deg : a._z - b._z));
    const max = Math.max(1, s.maxLabels);
    ctx.font = `${s.labelSize}px ${this.fontFamily}`; ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    ctx.lineJoin = 'round'; ctx.lineWidth = 3;
    const lc = hex2rgb(s.labelColor), bg = hex2rgb(s.bgColor);
    for (let i = 0; i < cand.length && i < max; i++) {
      const n = cand[i];
      let o = 1;
      if (n._lp < 3) o = clamp(1.15 - n._z / (mode === 'all' ? s.labelDistance * 3 : s.labelDistance), 0.15, 1);
      const y = n._sy + Math.max(3, n._r * n._k) * 1.5 + 4;
      ctx.fillStyle = rgba(lc, o);
      ctx.strokeStyle = rgba(bg, 0.85 * o);
      ctx.strokeText(n.label, n._sx, y); ctx.fillText(n.label, n._sx, y);
    }
  }

  /* ---------- modifica impostazioni ---------- */
  changed(key) {
    if (key === 'bgColor' || key === 'colorNote' || key === 'labelColor') this.applyTheme();
    if (K_STRUCT.has(key)) {
      clearTimeout(this.structTimer);
      this.structTimer = setTimeout(() => { if (!this.disposed) this.rebuildScene(false); }, key === 'search' || key === 'excludePaths' ? 250 : 0);
    } else if (K_FORCE.has(key)) { this.alpha = Math.max(this.alpha, 0.5); this.running = true; }
    else if (K_SIZE.has(key)) this.styleAll();
    else if (K_PART.has(key)) this.rebuildParticles();
    else if (K_STARS.has(key)) this.makeStars();
    else if (K_VIEW.has(key)) { if (key === 'pixelRatioCap') this.resize(); }
    else if (K_PLAIN.has(key)) { /* letto a ogni frame */ }
    else { this.styleAll(); this.rebuildParticles(); }
    this.dirty = true;
    this.scheduleSave();
  }
  set(key, val) { this.s[key] = val; this.changed(key); }
  scheduleSave() { clearTimeout(this.saveTimer); this.saveTimer = setTimeout(() => this.plugin.saveSettings(), 600); }

  applyPreset(name) {
    const p = PRESETS[name];
    if (!p) return;
    Object.assign(this.s, JSON.parse(JSON.stringify(p)));
    this.s.style = name;
    this.afterBulkChange();
  }
  resetAll() {
    const st = PRESETS[this.s.style] ? this.s.style : 'Arancione';
    Object.keys(this.s).forEach((k) => delete this.s[k]);
    Object.assign(this.s, cloneDefaults(), JSON.parse(JSON.stringify(PRESETS[st])));
    this.s.style = st;
    this.afterBulkChange();
  }
  afterBulkChange() {
    this.makeStars(); this.resize(); this.applyTheme(); this.rebuildScene(false);
    this.buildPanel(); this.scheduleSave(); this.dirty = true;
  }

  async screenshot() {
    this.updateCam(); this.draw();
    const blob = await new Promise((r) => this.canvas.toBlob(r, 'image/png'));
    if (!blob) { new Notice('Impossibile creare lo screenshot.'); return; }
    const buf = await blob.arrayBuffer();
    const d = new Date(), p2 = (x) => String(x).padStart(2, '0');
    const name = `Grafo 3D ${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())} ${p2(d.getHours())}-${p2(d.getMinutes())}.png`;
    let path = name;
    try { path = await this.app.fileManager.getAvailablePathForAttachment(name); } catch (e) { /* usa root */ }
    await this.app.vault.createBinary(path, buf);
    new Notice('Screenshot salvato: ' + path);
  }

  applyTheme() {
    const s = this.s, st = this.host.style;
    const acc = hex2rgb(s.colorNote), lt = mixWhite(acc, 0.35), bg = hex2rgb(s.bgColor), tx = hex2rgb(s.labelColor);
    st.setProperty('--h3d-bg', s.bgColor);
    st.setProperty('--h3d-bg-rgb', bg.join(','));
    st.setProperty('--h3d-acc-rgb', acc.join(','));
    st.setProperty('--h3d-acc', 'rgb(' + acc.join(',') + ')');
    st.setProperty('--h3d-lt', 'rgb(' + lt.join(',') + ')');
    st.setProperty('--h3d-tx', 'rgb(' + tx.join(',') + ')');
    st.setProperty('--h3d-dim', 'rgba(' + tx.join(',') + ',0.62)');
  }

  /* ---------- pannello ---------- */
  buildPanel() {
    const s = this.s, wrap = this.panelWrap;
    const prevScroll = this.panelBody ? this.panelBody.scrollTop : 0;
    wrap.empty();
    const gear = wrap.createEl('button', { cls: 'h3d-gear', attr: { 'aria-label': 'Impostazioni grafo' } });
    setIcon(gear, 'sliders-horizontal');
    const body = wrap.createDiv({ cls: 'h3d-panel' });
    this.panelBody = body;
    body.toggleClass('is-hidden', !s.panelVisible);
    gear.onclick = () => { s.panelVisible = !s.panelVisible; body.toggleClass('is-hidden', !s.panelVisible); this.scheduleSave(); };
    const sw = body.createDiv({ cls: 'h3d-styles' });
    for (const name of Object.keys(PRESETS)) {
      const b = sw.createEl('button', { text: name, cls: 'h3d-style' + (s.style === name ? ' is-on' : '') });
      b.style.setProperty('--sw', PRESETS[name].colorNote);
      b.onclick = () => this.applyPreset(name);
    }

    const section = (title) => {
      const d = body.createEl('details', { cls: 'h3d-sec' });
      d.open = !!this.openSecs[title];
      d.addEventListener('toggle', () => { this.openSecs[title] = d.open; });
      d.createEl('summary', { text: title });
      return d.createDiv({ cls: 'h3d-secbody' });
    };
    const row = (p, label) => { const r = p.createDiv({ cls: 'h3d-row' }); r.createSpan({ cls: 'h3d-lbl', text: label }); return r.createDiv({ cls: 'h3d-ctl' }); };
    const fmt = (v) => (Math.abs(v) >= 100 ? String(Math.round(v)) : String(Math.round(v * 100) / 100));
    const slider = (p, label, key, min, max, step) => {
      const c = row(p, label);
      const i = c.createEl('input', { attr: { type: 'range', min: String(min), max: String(max), step: String(step) } });
      i.value = String(s[key]);
      const v = c.createSpan({ cls: 'h3d-val', text: fmt(s[key]) });
      i.addEventListener('input', () => { const val = parseFloat(i.value); v.setText(fmt(val)); this.set(key, val); });
    };
    const toggle = (p, label, key) => {
      const c = row(p, label);
      const i = c.createEl('input', { attr: { type: 'checkbox' } });
      i.checked = !!s[key];
      i.addEventListener('change', () => this.set(key, i.checked));
    };
    const color = (p, label, key) => {
      const c = row(p, label);
      const i = c.createEl('input', { attr: { type: 'color' } });
      i.value = s[key];
      i.addEventListener('input', () => this.set(key, i.value));
    };
    const select = (p, label, key, opts) => {
      const c = row(p, label);
      const sel = c.createEl('select');
      for (const [v, t] of opts) sel.createEl('option', { text: t, value: v });
      sel.value = s[key];
      sel.addEventListener('change', () => this.set(key, sel.value));
    };
    const text = (p, label, key, ph) => {
      const c = row(p, label);
      const i = c.createEl('input', { attr: { type: 'text', placeholder: ph || '' } });
      i.value = s[key];
      i.addEventListener('input', () => this.set(key, i.value));
    };
    const button = (p, label, fn) => { const b = p.createEl('button', { text: label, cls: 'h3d-btn' }); b.onclick = fn; return b; };

    // Nucleo
    let p = section('Nucleo');
    toggle(p, 'Nucleo luminoso al centro', 'core');
    toggle(p, 'Collega tutti i nodi al nucleo', 'coreAll');
    p.createDiv({ cls: 'h3d-hint', text: 'Senza la seconda opzione il nucleo si collega solo alle cartelle principali e ai nodi isolati.' });
    slider(p, 'Dimensione nucleo', 'coreSize', 2, 30, 0.5); slider(p, 'Intensità alone', 'coreGlow', 0.3, 4, 0.1);
    slider(p, 'Opacità raggi', 'spokeOpacity', 0, 0.8, 0.02); slider(p, 'Distanza raggi', 'spokeDistance', 20, 300, 5);
    slider(p, 'Forza raggi', 'spokeStrength', 0, 1.5, 0.05); slider(p, 'Particelle dal nucleo', 'coreParticles', 0, 600, 10);
    color(p, 'Colore nucleo', 'colorCore'); color(p, 'Colore raggi', 'colorLinkCore');

    // Filtri
    p = section('Filtri e contenuto');
    text(p, 'Cerca', 'search', 'path:Uni tag:#esame ext:png');
    p.createDiv({ cls: 'h3d-hint', text: 'Operatori: path: file: tag: ext: type: — "-" davanti per escludere.' });
    toggle(p, 'Note', 'showNotes'); toggle(p, 'Cartelle', 'showFolders'); toggle(p, 'Allegati', 'showAttachments');
    toggle(p, 'Tag', 'showTags'); toggle(p, 'Link irrisolti', 'showUnresolved'); toggle(p, 'Nodi isolati', 'showOrphans');
    toggle(p, 'Nodo radice vault', 'showRoot');
    p.createDiv({ cls: 'h3d-sub', text: 'Collegamenti da mostrare' });
    toggle(p, 'Link tra note', 'showNoteLinks'); toggle(p, 'Allegati incorporati', 'showEmbedLinks');
    toggle(p, 'Gerarchia cartelle', 'showFolderLinks'); toggle(p, 'Tag', 'showTagLinks');
    toggle(p, 'Solo vicinato nota attiva', 'localMode'); slider(p, 'Profondità', 'localDepth', 1, 6, 1);
    text(p, 'Escludi percorsi', 'excludePaths', 'Archivio, Template');

    // Colori
    p = section('Colori');
    select(p, 'Modalità', 'colorMode', [['type', 'Per tipo'], ['topFolder', 'Per cartella principale']]);
    color(p, 'Sfondo', 'bgColor'); color(p, 'Note', 'colorNote'); color(p, 'Cartelle', 'colorFolder');
    color(p, 'Allegati', 'colorAttachment'); color(p, 'Tag', 'colorTag'); color(p, 'Irrisolti', 'colorUnresolved');
    color(p, 'Nota attiva', 'colorActive');
    p.createDiv({ cls: 'h3d-sub', text: 'Collegamenti' });
    select(p, 'Colore link', 'linkColorMode', [['type', 'Per tipo'], ['node', 'Dal nodo di partenza']]);
    color(p, 'Link tra note', 'colorLinkLink'); color(p, 'Allegati', 'colorLinkEmbed');
    color(p, 'Cartelle', 'colorLinkFolder'); color(p, 'Tag', 'colorLinkTag');
    color(p, 'Etichette', 'labelColor'); color(p, 'Stelle', 'starColor');

    // Gruppi
    p = section('Gruppi di colore');
    p.createDiv({ cls: 'h3d-hint', text: 'Colora i nodi con una ricerca, es. path:Università · tag:#esame · ext:pdf. Vince il primo gruppo che corrisponde.' });
    s.groups.forEach((g, i) => {
      const r = p.createDiv({ cls: 'h3d-grow' });
      const t = r.createEl('input', { attr: { type: 'text', placeholder: 'path:Cartella' } });
      t.value = g.query;
      t.addEventListener('input', () => { g.query = t.value; this.changed('groups'); });
      const c = r.createEl('input', { attr: { type: 'color' } });
      c.value = g.color;
      c.addEventListener('input', () => { g.color = c.value; this.changed('groups'); });
      const x = r.createEl('button', { text: '✕', cls: 'h3d-btn h3d-x' });
      x.onclick = () => { s.groups.splice(i, 1); this.changed('groups'); this.buildPanel(); };
    });
    button(p, '+ Aggiungi gruppo', () => { s.groups.push({ query: '', color: '#ffd24a' }); this.changed('groups'); this.buildPanel(); });

    // Nodi
    p = section('Nodi');
    slider(p, 'Dimensione', 'nodeSize', 0.5, 12, 0.1); slider(p, 'Più grandi se collegati', 'sizeByDegree', 0, 3, 0.1);
    slider(p, 'Scala note', 'scaleNote', 0.2, 4, 0.1); slider(p, 'Scala cartelle', 'scaleFolder', 0.2, 4, 0.1);
    slider(p, 'Scala allegati', 'scaleAttachment', 0.2, 4, 0.1); slider(p, 'Scala tag', 'scaleTag', 0.2, 4, 0.1);
    slider(p, 'Scala irrisolti', 'scaleUnresolved', 0.2, 4, 0.1);
    toggle(p, 'Cartelle a contorno', 'wireframeFolders'); toggle(p, 'Allegati a contorno', 'wireframeAttachments');

    // Link
    p = section('Collegamenti e particelle');
    slider(p, 'Opacità', 'linkOpacity', 0.05, 1.5, 0.05); slider(p, 'Spessore', 'linkWidth', 0.3, 4, 0.1);
    toggle(p, 'Particelle sui link', 'particles'); slider(p, 'Quantità', 'particleCount', 20, 2000, 10);
    slider(p, 'Velocità', 'particleSpeed', 0.05, 3, 0.05); slider(p, 'Dimensione', 'particleSize', 0.5, 6, 0.1);
    toggle(p, 'Anche sulle cartelle', 'particlesFolder');

    // Etichette
    p = section('Etichette');
    toggle(p, 'Mostra etichette', 'labels');
    select(p, 'Modalità', 'labelMode', [['near', 'Solo vicine'], ['all', 'Tutte (max)'], ['hover', 'Solo al passaggio']]);
    slider(p, 'Distanza', 'labelDistance', 40, 1500, 10); slider(p, 'Numero massimo', 'maxLabels', 5, 300, 5);
    slider(p, 'Dimensione testo', 'labelSize', 8, 24, 1);

    // Forze
    p = section('Forze e layout');
    slider(p, 'Repulsione', 'repulsion', 0, 300, 1); slider(p, 'Distanza link', 'linkDistance', 5, 150, 1);
    slider(p, 'Forza link', 'linkStrength', 0.05, 2, 0.05); slider(p, 'Distanza cartelle', 'folderLinkDistance', 3, 120, 1);
    slider(p, 'Forza cartelle', 'folderLinkStrength', 0.05, 2, 0.05); slider(p, 'Gravità al centro', 'gravity', 0, 0.5, 0.005);
    slider(p, 'Attrito', 'velocityDecay', 0.05, 0.9, 0.01);

    // Effetti
    p = section('Effetti e vista');
    toggle(p, 'Alone luminoso', 'glow'); slider(p, 'Raggio alone', 'glowSize', 0.2, 4, 0.1); slider(p, 'Intensità alone', 'glowStrength', 0.1, 1, 0.05);
    slider(p, 'Sfumatura profondità', 'depthFade', 0, 1, 0.05); slider(p, 'Attenuazione non evidenziati', 'dimOthers', 0, 0.6, 0.02);
    toggle(p, 'Stelle di sfondo', 'stars'); slider(p, 'Numero stelle', 'starCount', 100, 5000, 100);
    toggle(p, 'Rotazione automatica', 'autoRotate'); slider(p, 'Velocità rotazione', 'autoRotateSpeed', 0.02, 1, 0.02);
    slider(p, 'Qualità (pixel ratio max)', 'pixelRatioCap', 1, 3, 0.5);

    // Strumenti
    p = section('Strumenti');
    button(p, 'Ricentra vista', () => this.fitAll(false));
    button(p, 'Ricalcola layout', () => {
      for (const n of this.nodes) { n.x = (Math.random() - 0.5) * 80; n.y = (Math.random() - 0.5) * 80; n.z = (Math.random() - 0.5) * 80; n.vx = n.vy = n.vz = 0; }
      this.alpha = 1; this.running = true; this.fitAll(false);
    });
    button(p, 'Sblocca tutti i nodi', () => { for (const n of this.full.nodes) { n.pinned = false; n.fx = null; n.fy = null; n.fz = null; } this.alpha = 0.5; this.running = true; });
    button(p, 'Salva screenshot', () => this.screenshot());
    button(p, 'Ripristina predefiniti', () => this.resetAll());
    p.createDiv({ cls: 'h3d-hint', text: 'Trascina: ruota · Shift/tasto destro: sposta · Rotella/pizzico: zoom · Clic su nodo: apri · Tasto destro su nodo: menu · Doppio clic: zoom/ricentra.' });

    body.scrollTop = prevScroll;
  }
}

/* ================================== VISTA ================================= */
class HoloGraphView extends ItemView {
  constructor(leaf, plugin) { super(leaf); this.plugin = plugin; this.engine = null; }
  getViewType() { return VIEW_TYPE; }
  getDisplayText() { return 'Grafo 3D'; }
  getIcon() { return 'network'; }
  async onOpen() {
    this.contentEl.addClass('h3d-host');
    this.engine = new Engine(this.app, this.plugin, this.contentEl);
    this.engine.start();
  }
  async onClose() {
    if (this.engine) { this.engine.destroy(); this.engine = null; }
  }
}

/* ================================== PLUGIN ================================ */
const CSS = `
.h3d-host{padding:0 !important;overflow:hidden !important}
.h3d-root{position:relative;width:100%;height:100%;overflow:hidden;background:var(--h3d-bg,#050302);user-select:none;--h3d-bg-rgb:5,3,2;--h3d-acc-rgb:255,167,38;--h3d-acc:rgb(255,167,38);--h3d-lt:rgb(255,210,122);--h3d-tx:rgb(255,227,191);--h3d-dim:rgba(255,227,191,.62)}
.h3d-canvas{position:absolute;left:0;top:0;display:block;touch-action:none;outline:none;cursor:grab}
.h3d-hud{position:absolute;left:12px;top:10px;max-width:55%;color:var(--h3d-lt);font-size:12px;pointer-events:none;text-shadow:0 0 6px #000,0 0 3px #000}
.h3d-hudhover{margin-top:4px;color:var(--h3d-tx);word-break:break-all}
.h3d-hudbtn{pointer-events:auto;margin-left:8px;font-size:11px;padding:1px 8px;border-radius:10px}
.h3d-panelwrap{position:absolute;right:10px;top:10px;bottom:10px;display:flex;flex-direction:column;align-items:flex-end;gap:6px;pointer-events:none}
.h3d-gear{pointer-events:auto;width:34px;height:34px;padding:0;display:flex;align-items:center;justify-content:center;border-radius:50%;background:rgba(var(--h3d-bg-rgb),.8);border:1px solid rgba(var(--h3d-acc-rgb),.5);color:var(--h3d-lt);flex:0 0 auto}
.h3d-panel{pointer-events:auto;width:290px;max-width:calc(100vw - 30px);flex:0 1 auto;min-height:0;overflow-y:auto;background:rgba(var(--h3d-bg-rgb),.84);backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px);border:1px solid rgba(var(--h3d-acc-rgb),.38);border-radius:10px;padding:4px 8px;color:var(--h3d-tx);font-size:12px;user-select:none}
.h3d-panel.is-hidden{display:none}
.h3d-styles{display:flex;gap:6px;padding:6px 0 8px;border-bottom:1px solid rgba(var(--h3d-acc-rgb),.2)}
.h3d-style{flex:1;display:flex;align-items:center;justify-content:center;gap:6px;font-size:12px;padding:5px 8px;border-radius:7px;background:transparent;border:1px solid rgba(var(--h3d-acc-rgb),.3);color:var(--h3d-tx);box-shadow:none}
.h3d-style::before{content:'';width:9px;height:9px;border-radius:50%;background:var(--sw);box-shadow:0 0 6px var(--sw)}
.h3d-style.is-on{border-color:var(--h3d-acc);background:rgba(var(--h3d-acc-rgb),.16)}
.h3d-sec{border-bottom:1px solid rgba(var(--h3d-acc-rgb),.2)}
.h3d-sec>summary{cursor:pointer;padding:7px 2px;font-weight:600;color:var(--h3d-lt);list-style:none}
.h3d-sec>summary::-webkit-details-marker{display:none}
.h3d-sec>summary::before{content:'▸ ';color:var(--h3d-acc)}
.h3d-sec[open]>summary::before{content:'▾ '}
.h3d-secbody{padding:2px 0 8px}
.h3d-row{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:2px 0}
.h3d-lbl{flex:1 1 45%;min-width:0}
.h3d-ctl{flex:1 1 55%;display:flex;align-items:center;gap:6px;justify-content:flex-end}
.h3d-ctl input[type=range]{flex:1;min-width:0;height:18px;accent-color:var(--h3d-acc)}
.h3d-ctl input[type=checkbox]{accent-color:var(--h3d-acc)}
.h3d-ctl input[type=text],.h3d-ctl select{width:100%;font-size:12px;height:24px;padding:0 6px}
.h3d-ctl input[type=color]{width:42px;height:22px;padding:0;border:none;background:none;cursor:pointer}
.h3d-val{width:34px;text-align:right;color:var(--h3d-lt);font-variant-numeric:tabular-nums}
.h3d-sub{margin:8px 0 2px;color:var(--h3d-lt);font-weight:600}
.h3d-hint{color:var(--h3d-dim);font-size:11px;margin:3px 0 6px;line-height:1.35}
.h3d-grow{display:flex;gap:6px;align-items:center;margin:3px 0}
.h3d-grow input[type=text]{flex:1;min-width:0;height:24px;font-size:12px}
.h3d-grow input[type=color]{width:38px;height:22px;padding:0;border:none;background:none}
.h3d-btn{font-size:12px;padding:3px 10px;margin:3px 6px 3px 0;border-radius:6px}
.h3d-x{padding:2px 7px;margin:0}
`;

class HoloSettingTab extends PluginSettingTab {
  constructor(app, plugin) { super(app, plugin); this.plugin = plugin; }
  display() {
    const el = this.containerEl;
    el.empty();
    el.createEl('h2', { text: 'Holo Graph 3D' });
    el.createEl('p', { text: 'Tutte le opzioni (colori, forze, filtri, gruppi, effetti) sono nel pannello a destra della vista del grafo: icona con i cursori in alto a destra.' });
    const b = el.createEl('button', { text: 'Apri il grafo 3D' });
    b.onclick = () => this.plugin.activateView();
  }
}

class HoloGraph3DPlugin extends Plugin {
  async onload() {
    const saved = (await this.loadData()) || {};
    this.settings = Object.assign(cloneDefaults(), saved);
    if ((saved.settingsVersion || 0) < 2) {
      // versione 0.1: un solo tema con due colori -> passa allo stile Arancione monocromatico
      Object.assign(this.settings, PRESETS['Arancione'], { style: 'Arancione', settingsVersion: 2 });
    }
    if ((saved.settingsVersion || 0) < 3) {
      // versione 0.3: nucleo luminoso al centro, il nodo radice del vault non serve piu come centro
      const pr = PRESETS[this.settings.style] || PRESETS['Arancione'];
      Object.assign(this.settings, { showRoot: false, colorCore: pr.colorCore, colorLinkCore: pr.colorLinkCore, settingsVersion: 3 });
    }
    if (!Array.isArray(this.settings.groups)) this.settings.groups = [];
    const st = document.createElement('style');
    st.id = 'holo-graph-3d-css'; st.textContent = CSS;
    document.head.appendChild(st);
    this.register(() => st.remove());

    this.registerView(VIEW_TYPE, (leaf) => new HoloGraphView(leaf, this));
    this.addRibbonIcon('network', 'Apri grafo 3D', () => this.activateView());
    this.addCommand({ id: 'open-holo-graph-3d', name: 'Apri grafo 3D', callback: () => this.activateView() });
    this.addCommand({
      id: 'holo-graph-3d-fit', name: 'Grafo 3D: ricentra la vista',
      callback: () => this.engines().forEach((e) => e.fitAll(false)),
    });
    this.addSettingTab(new HoloSettingTab(this.app, this));

    let timer = null;
    const queue = () => {
      clearTimeout(timer);
      timer = setTimeout(() => this.engines().forEach((e) => e.refreshFull(false)), 1500);
    };
    this.register(() => clearTimeout(timer));
    this.registerEvent(this.app.metadataCache.on('resolved', queue));
    this.registerEvent(this.app.vault.on('create', queue));
    this.registerEvent(this.app.vault.on('delete', queue));
    this.registerEvent(this.app.vault.on('rename', queue));
    this.registerEvent(this.app.workspace.on('file-open', (f) => { if (f) this.engines().forEach((e) => e.setActive(f.path)); }));
  }
  engines() {
    return this.app.workspace.getLeavesOfType(VIEW_TYPE).map((l) => l.view && l.view.engine).filter(Boolean);
  }
  async activateView() {
    const ws = this.app.workspace;
    let leaf = ws.getLeavesOfType(VIEW_TYPE)[0];
    if (!leaf) {
      leaf = ws.getLeaf('tab');
      await leaf.setViewState({ type: VIEW_TYPE, active: true });
    }
    ws.revealLeaf(leaf);
  }
  async saveSettings() { await this.saveData(this.settings); }
  onunload() { this.app.workspace.detachLeavesOfType(VIEW_TYPE); }
}

module.exports = HoloGraph3DPlugin;
