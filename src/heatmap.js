export function initHeatmap(data) {
  const container = document.getElementById('heatmap-container');
  const metricBtns = document.querySelectorAll('#metric-tabs .tab-btn');
  const timeBtns = document.querySelectorAll('#time-tabs .tab-btn');

  let metric = 'tokens';
  let timeRange = 'month';

  const canvas = document.createElement('canvas');
  container.appendChild(canvas);
  const ctx = canvas.getContext('2d');

  const CELL = 13;
  const GAP = 3;
  const STEP = CELL + GAP;
  const PAD = { top: 4, left: 28, right: 8, bottom: 18 };

  // Build daily data
  const dailyMap = {};
  for (const session of data.sessions) {
    const date = session.date;
    if (!dailyMap[date]) {
      dailyMap[date] = { sessions: 0, tokens: 0, prompts: 0, toolCalls: 0 };
    }
    dailyMap[date].sessions++;
    dailyMap[date].tokens += session.tokens.total;
    dailyMap[date].prompts += session.promptCount;
    dailyMap[date].toolCalls += session.toolCalls;
  }

  function getDateRange() {
    const dates = Object.keys(dailyMap).sort();
    if (!dates.length) return { start: new Date(), end: new Date() };
    const end = new Date(dates[dates.length - 1]);
    let start;
    if (timeRange === 'week') {
      start = new Date(end); start.setDate(start.getDate() - 7);
    } else if (timeRange === 'month') {
      start = new Date(end); start.setMonth(start.getMonth() - 1);
    } else {
      start = new Date(dates[0]);
    }
    return { start, end };
  }

  function getColors() {
    const cs = getComputedStyle(document.documentElement);
    return [
      cs.getPropertyValue('--heatmap-0').trim() || '#0c160c',
      cs.getPropertyValue('--heatmap-1').trim() || '#1a3e1a',
      cs.getPropertyValue('--heatmap-2').trim() || '#2a6a2a',
      cs.getPropertyValue('--heatmap-3').trim() || '#389838',
      cs.getPropertyValue('--heatmap-4').trim() || '#48b040',
      cs.getPropertyValue('--accent-green').trim() || '#58c848',
      cs.getPropertyValue('--accent-bright-green').trim() || '#70e060',
    ];
  }

  function render() {
    const rect = container.getBoundingClientRect();
    const W = rect.width || 500;
    const H = rect.height || 200;
    const dpr = window.devicePixelRatio;
    canvas.width = W * dpr;
    canvas.height = H * dpr;
    canvas.style.width = W + 'px';
    canvas.style.height = H + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const bgColor = getComputedStyle(document.documentElement).getPropertyValue('--heatmap-bg').trim() || '#060a06';
    ctx.fillStyle = bgColor;
    ctx.fillRect(0, 0, W, H);

    const { start, end } = getDateRange();
    const days = [];
    const d = new Date(start);
    while (d <= end) {
      days.push(d.toISOString().split('T')[0]);
      d.setDate(d.getDate() + 1);
    }

    const values = days.map(date => (dailyMap[date] || {})[metric] || 0);
    const maxVal = Math.max(...values, 1);

    const startDay = new Date(start).getDay();
    const dayLabels = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

    // Day labels
    ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--text-muted').trim() || '#506840';
    ctx.font = '8px "IBM Plex Mono", monospace';
    ctx.textAlign = 'right';
    for (let r = 0; r < 7; r++) {
      ctx.fillText(dayLabels[r], PAD.left - 5, PAD.top + r * STEP + CELL / 2 + 3);
    }

    // Cells
    for (let i = 0; i < days.length; i++) {
      const cellIdx = i + startDay;
      const col = Math.floor(cellIdx / 7);
      const row = cellIdx % 7;
      const x = PAD.left + col * STEP;
      const y = PAD.top + row * STEP;

      const val = values[i];
      const intensity = val > 0 ? Math.min(6, Math.floor((val / maxVal) * 6) + 1) : 0;
      const colors = getColors();
      ctx.fillStyle = colors[intensity];
      ctx.fillRect(x, y, CELL, CELL);

      if (val > 0 && intensity >= 3) {
        ctx.strokeStyle = colors[Math.min(6, intensity + 1)];
        ctx.lineWidth = 0.5;
        ctx.strokeRect(x + 0.5, y + 0.5, CELL - 1, CELL - 1);
      }
    }

    // Month labels along bottom
    ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--text-muted').trim() || '#506840';
    ctx.font = '7px "IBM Plex Mono", monospace';
    ctx.textAlign = 'left';
    let lastMonth = -1;
    for (let i = 0; i < days.length; i++) {
      const cellIdx = i + startDay;
      const col = Math.floor(cellIdx / 7);
      const month = new Date(days[i]).getMonth();
      if (month !== lastMonth) {
        lastMonth = month;
        const x = PAD.left + col * STEP;
        const monthNames = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
        ctx.fillText(monthNames[month], x, PAD.top + 7 * STEP + 10);
      }
    }
  }

  // Tooltip
  const tooltip = document.createElement('div');
  tooltip.className = 'tooltip';
  tooltip.style.display = 'none';
  document.body.appendChild(tooltip);

  canvas.addEventListener('mousemove', (e) => {
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const { start, end } = getDateRange();
    const startDay = new Date(start).getDay();

    const col = Math.floor((mx - PAD.left) / STEP);
    const row = Math.floor((my - PAD.top) / STEP);
    if (col < 0 || row < 0 || row >= 7) { tooltip.style.display = 'none'; return; }

    const dayIdx = col * 7 + row - startDay;
    const days = [];
    const d = new Date(start);
    while (d <= end) { days.push(d.toISOString().split('T')[0]); d.setDate(d.getDate() + 1); }

    if (dayIdx < 0 || dayIdx >= days.length) { tooltip.style.display = 'none'; return; }

    const date = days[dayIdx];
    const entry = dailyMap[date];
    const fmt = (v) => v >= 1e6 ? (v / 1e6).toFixed(1) + 'M' : v >= 1e3 ? (v / 1e3).toFixed(1) + 'K' : v;

    if (entry) {
      tooltip.innerHTML = `
        <div class="t-label">${date}</div>
        <div class="t-row">sessions: <span class="t-value">${entry.sessions}</span></div>
        <div class="t-row">prompts: <span class="t-value">${entry.prompts}</span></div>
        <div class="t-row">tokens: <span class="t-value">${fmt(entry.tokens)}</span></div>
        <div class="t-row">tools: <span class="t-value">${entry.toolCalls}</span></div>`;
    } else {
      tooltip.innerHTML = `<div class="t-label">${date}</div><div class="t-row">no activity</div>`;
    }
    tooltip.style.display = 'block';
    tooltip.style.left = e.clientX + 12 + 'px';
    tooltip.style.top = e.clientY - 10 + 'px';
  });

  canvas.addEventListener('mouseleave', () => { tooltip.style.display = 'none'; });

  metricBtns.forEach(btn => btn.addEventListener('click', () => {
    metricBtns.forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    metric = btn.dataset.metric;
    render();
  }));

  timeBtns.forEach(btn => btn.addEventListener('click', () => {
    timeBtns.forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    timeRange = btn.dataset.range;
    render();
  }));

  render();
  const ro = new ResizeObserver(() => render());
  ro.observe(container);
  // Re-render on theme change
  new MutationObserver(render).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
}
