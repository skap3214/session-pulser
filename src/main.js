import { initTerrain } from './terrain.js';
import { initSessions } from './sessions.js';
import { initHeatmap } from './heatmap.js';
import { initProjects } from './projects.js';

function formatNum(n) {
  if (n >= 1e9) return (n / 1e9).toFixed(1) + 'B';
  if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M';
  if (n >= 1e3) return (n / 1e3).toFixed(1) + 'K';
  return n.toString();
}

function formatDate(dateStr) {
  const [, m, d] = dateStr.split('-');
  return `${parseInt(m)}/${parseInt(d)}`;
}

function renderHeader(stats) {
  const el = document.getElementById('header-stats');
  const items = [
    { label: 'sessions', value: stats.totalSessions, cls: '' },
    { label: 'prompts', value: formatNum(stats.totalPrompts), cls: '' },
    { label: 'input', value: formatNum(stats.totalInput), cls: 'green' },
    { label: 'output', value: formatNum(stats.totalOutput), cls: 'red' },
    { label: 'tokens', value: formatNum(stats.totalTokens), cls: '' },
  ];
  el.innerHTML = items.map(i =>
    `<span><span class="stat-label">${i.label}:</span><span class="stat-value ${i.cls}">${i.value}</span></span>`
  ).join('');

  const start = formatDate(stats.dateRange.start);
  const end = formatDate(stats.dateRange.end);
  document.getElementById('date-range').textContent = `${start} → ${end}`;

  // Session + project counts
  document.getElementById('sessions-count').textContent = `${stats.totalSessions} TOTAL`;
  document.getElementById('projects-count').textContent = `${stats.totalProjects} TOTAL`;
}

function startClock() {
  const clockEl = document.getElementById('clock');
  function update() {
    const now = new Date();
    clockEl.textContent = now.toLocaleTimeString('en-US', { hour12: false });
  }
  update();
  setInterval(update, 1000);
}

function computeDaysBetween(start, end) {
  const d1 = new Date(start);
  const d2 = new Date(end);
  return Math.round(Math.abs(d2 - d1) / (1000 * 60 * 60 * 24));
}

function initThemeToggle() {
  const btn = document.getElementById('theme-cycle');
  const themes = ['dark', 'light', 'system'];
  const icons = {
    dark: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>',
    light: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>',
    system: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>',
  };
  const labels = { dark: 'Dark', light: 'Light', system: 'System' };
  let current = localStorage.getItem('sp-theme') || 'dark';
  applyTheme(current);

  btn.addEventListener('click', () => {
    const idx = (themes.indexOf(current) + 1) % themes.length;
    current = themes[idx];
    applyTheme(current);
    localStorage.setItem('sp-theme', current);
  });

  function applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    btn.innerHTML = icons[theme];
    btn.title = labels[theme];
  }
}

function setLoading(pct, status, sub) {
  const fill = document.getElementById('loading-fill');
  const statusEl = document.getElementById('loading-status');
  const subEl = document.getElementById('loading-sub');
  if (fill) fill.style.width = pct + '%';
  if (status && statusEl) statusEl.textContent = status;
  if (sub && subEl) subEl.textContent = sub;
}

function hideLoading() {
  const el = document.getElementById('loading-screen');
  if (el) el.classList.add('hidden');
  setTimeout(() => { if (el) el.remove(); }, 600);
}

async function main() {
  setLoading(10, 'CONNECTING', 'extracting session data...');

  const resp = await fetch('/data.json');
  setLoading(50, 'PARSING', 'processing sessions...');

  const data = await resp.json();
  setLoading(70, 'RENDERING', `${data.stats.totalSessions} sessions found`);

  renderHeader(data.stats);
  startClock();
  initThemeToggle();

  // Terrain subtitle
  const days = computeDaysBetween(data.stats.dateRange.start, data.stats.dateRange.end);
  const s = formatDate(data.stats.dateRange.start);
  const e = formatDate(data.stats.dateRange.end);
  document.getElementById('terrain-subtitle').textContent =
    `TOKEN USAGE \u00B7 ${s} \u00B7 ${e} \u00B7 ${days} DAYS`;

  // Initialize all components
  setLoading(80, 'BUILDING TERRAIN', 'generating contour map...');
  await new Promise(r => setTimeout(r, 50)); // yield for UI update
  initTerrain(data);

  setLoading(90, 'LOADING PANELS', 'sessions, heatmap, projects...');
  await new Promise(r => setTimeout(r, 30));
  initSessions(data);
  initHeatmap(data);
  initProjects(data);

  setLoading(100, 'COMPLETE', `${data.stats.totalSessions} sessions across ${data.stats.totalProjects} projects`);
  await new Promise(r => setTimeout(r, 400));
  hideLoading();

  // Resizable projects panel
  const resizeHandle = document.getElementById('panel-resize-handle');
  const mainEl = document.getElementById('main');
  let isResizing = false;

  resizeHandle.addEventListener('mousedown', (e) => {
    isResizing = true;
    resizeHandle.classList.add('active');
    e.preventDefault();
  });
  window.addEventListener('mousemove', (e) => {
    if (!isResizing) return;
    const mainRect = mainEl.getBoundingClientRect();
    const rightWidth = Math.max(180, Math.min(500, mainRect.right - e.clientX));
    mainEl.style.gridTemplateColumns = `290px 1fr 4px ${rightWidth}px`;
  });
  window.addEventListener('mouseup', () => {
    isResizing = false;
    resizeHandle.classList.remove('active');
  });
}

main();
