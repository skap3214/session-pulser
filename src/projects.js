const CATEGORY_COLORS = {
  'Visual Art & Shaders': '#8b5cf6',
  'Creative Coding': '#ec4899',
  'Data & Visualization': '#06b6d4',
  'Machine Learning': '#f59e0b',
  'Apps & Tools': '#3b82f6',
  'Research': '#10b981',
  'AI & Dev Tools': '#ef4444',
  'Misc': '#6b7280',
};

// Shared styled tooltip
let tooltip;
function ensureTooltip() {
  if (!tooltip) {
    tooltip = document.createElement('div');
    tooltip.className = 'tooltip';
    tooltip.style.display = 'none';
    document.body.appendChild(tooltip);
  }
  return tooltip;
}
function showTooltip(e, name, category, tokens, sessions, color) {
  const tt = ensureTooltip();
  const fmtTokens = (n) => n >= 1e9 ? (n/1e9).toFixed(1)+'B' : n >= 1e6 ? (n/1e6).toFixed(1)+'M' : n >= 1e3 ? (n/1e3).toFixed(1)+'K' : n;
  tt.innerHTML = `
    <div class="t-label">${name}</div>
    <div class="t-row"><span style="display:inline-block;width:6px;height:6px;background:${color};border-radius:1px;margin-right:4px;vertical-align:middle"></span>${category}</div>
    <div class="t-row">tokens: <span class="t-value">${fmtTokens(tokens)}</span></div>
    <div class="t-row">sessions: <span class="t-value">${sessions}</span></div>
  `;
  tt.style.display = 'block';
  tt.style.left = e.clientX + 12 + 'px';
  tt.style.top = e.clientY - 10 + 'px';
}
function moveTooltip(e) {
  if (tooltip) {
    tooltip.style.left = e.clientX + 12 + 'px';
    tooltip.style.top = e.clientY - 10 + 'px';
  }
}
function hideTooltip() {
  if (tooltip) tooltip.style.display = 'none';
}

export function initProjects(data) {
  const legendEl = document.getElementById('category-legend');
  const treemapEl = document.getElementById('treemap-container');
  const listEl = document.getElementById('project-list');

  const projects = data.projects.filter(p => p.sessions.length > 0);

  // Build category map
  const categories = {};
  for (const p of projects) {
    const cat = p.category || 'Misc';
    if (!categories[cat]) categories[cat] = { name: cat, totalTokens: 0, projects: [] };
    categories[cat].totalTokens += p.totalTokens;
    categories[cat].projects.push(p);
  }

  // Render legend
  const catList = Object.values(categories).sort((a, b) => b.totalTokens - a.totalTokens);
  legendEl.innerHTML = catList.map(c => {
    const color = CATEGORY_COLORS[c.name] || '#6b7280';
    return `<span class="category-tag" data-category="${c.name}">
      <span class="category-dot" style="background:${color}"></span>
      ${c.name}
    </span>`;
  }).join('');

  // Squarified treemap layout
  function squarify(items, x, y, w, h) {
    if (!items.length || w <= 0 || h <= 0) return [];
    const total = items.reduce((s, i) => s + i.value, 0);
    if (total === 0) return [];

    const cells = [];
    let remaining = [...items];
    let cx = x, cy = y, cw = w, ch = h;

    while (remaining.length > 0) {
      const isWide = cw >= ch;
      const sideLen = isWide ? ch : cw;
      const totalRemaining = remaining.reduce((s, i) => s + i.value, 0);

      // Find the best row
      let row = [remaining[0]];
      let rowSum = remaining[0].value;
      let bestRatio = Infinity;

      for (let i = 1; i < remaining.length; i++) {
        const testRow = [...row, remaining[i]];
        const testSum = rowSum + remaining[i].value;
        const rowLen = (testSum / totalRemaining) * (isWide ? cw : ch);

        // Calculate worst aspect ratio in this row
        let worstRatio = 0;
        for (const item of testRow) {
          const itemLen = (item.value / testSum) * sideLen;
          const ratio = Math.max(rowLen / itemLen, itemLen / rowLen);
          worstRatio = Math.max(worstRatio, ratio);
        }

        let currentWorst = 0;
        const currentRowLen = (rowSum / totalRemaining) * (isWide ? cw : ch);
        for (const item of row) {
          const itemLen = (item.value / rowSum) * sideLen;
          const ratio = Math.max(currentRowLen / itemLen, itemLen / currentRowLen);
          currentWorst = Math.max(currentWorst, ratio);
        }

        if (worstRatio <= currentWorst) {
          row = testRow;
          rowSum = testSum;
        } else {
          break;
        }
      }

      // Place the row
      const rowLen = (rowSum / totalRemaining) * (isWide ? cw : ch);
      let offset = 0;

      for (const item of row) {
        const itemLen = (item.value / rowSum) * sideLen;
        if (isWide) {
          cells.push({
            ...item,
            x: cx,
            y: cy + offset,
            w: rowLen,
            h: itemLen,
          });
        } else {
          cells.push({
            ...item,
            x: cx + offset,
            y: cy,
            w: itemLen,
            h: rowLen,
          });
        }
        offset += itemLen;
      }

      // Update remaining area
      remaining = remaining.slice(row.length);
      if (isWide) {
        cx += rowLen;
        cw -= rowLen;
      } else {
        cy += rowLen;
        ch -= rowLen;
      }
    }

    return cells;
  }

  // Render treemap
  function renderTreemap() {
    const rect = treemapEl.getBoundingClientRect();
    const W = rect.width || 130;
    const H = rect.height || 300;

    const items = projects
      .filter(p => p.totalTokens > 0)
      .map(p => ({
        name: p.name,
        value: p.totalTokens,
        category: p.category,
        sessions: p.sessions.length,
      }))
      .sort((a, b) => b.value - a.value);

    const cells = squarify(items, 0, 0, W, H);

    treemapEl.innerHTML = '';
    for (const cell of cells) {
      const div = document.createElement('div');
      div.className = 'treemap-cell';
      const color = CATEGORY_COLORS[cell.category] || '#6b7280';
      div.style.left = cell.x + 'px';
      div.style.top = cell.y + 'px';
      div.style.width = Math.max(0, cell.w) + 'px';
      div.style.height = Math.max(0, cell.h) + 'px';
      // Crosshatch pattern via SVG
      const patternSvg = `url("data:image/svg+xml,%3Csvg width='8' height='8' xmlns='http://www.w3.org/2000/svg'%3E%3Cpath d='M0 0L8 8M8 0L0 8' stroke='${encodeURIComponent(color)}' stroke-width='0.5' opacity='0.4'/%3E%3C/svg%3E")`;
      div.style.background = `${patternSvg}, ${color}25`;
      div.style.borderColor = color + '40';

      // Only show text if cell is big enough
      if (cell.w > 30 && cell.h > 14) {
        div.innerHTML = `<span>${cell.name}</span>`;
      }

      // Styled tooltip on hover
      div.addEventListener('mouseenter', (e) => {
        showTooltip(e, cell.name, cell.category, cell.value, cell.sessions, color);
      });
      div.addEventListener('mousemove', (e) => {
        moveTooltip(e);
      });
      div.addEventListener('mouseleave', hideTooltip);

      treemapEl.appendChild(div);
    }
  }

  function formatTokens(n) {
    if (n >= 1e9) return (n / 1e9).toFixed(1) + 'B';
    if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M';
    if (n >= 1e3) return (n / 1e3).toFixed(1) + 'K';
    return n.toString();
  }

  // Build session activity per project for sparklines
  function getProjectSparkline(project) {
    const projectSessions = data.sessions.filter(s => s.project === project.name);
    const byDate = {};
    for (const s of projectSessions) {
      byDate[s.date] = (byDate[s.date] || 0) + s.tokens.total;
    }
    const allDates = Object.keys(byDate).sort();
    return allDates.map(d => byDate[d]);
  }

  function renderSparkline(values, color) {
    const canvas = document.createElement('canvas');
    canvas.className = 'p-sparkline';
    canvas.width = 80;
    canvas.height = 24;
    canvas.style.width = '40px';
    canvas.style.height = '12px';
    const ctx = canvas.getContext('2d');
    if (!values.length) return canvas;

    const max = Math.max(...values, 1);
    const step = 80 / Math.max(values.length - 1, 1);

    ctx.strokeStyle = color;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    values.forEach((v, i) => {
      const x = i * step;
      const y = 24 - (v / max) * 20 - 2;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();
    return canvas;
  }

  // Render project list
  function renderProjectList() {
    listEl.innerHTML = '';
    const sorted = projects.sort((a, b) => b.totalTokens - a.totalTokens);

    for (const p of sorted) {
      const div = document.createElement('div');
      div.className = 'project-item';
      const color = CATEGORY_COLORS[p.category] || '#6b7280';

      const dot = document.createElement('span');
      dot.className = 'p-dot';
      dot.style.background = color;

      const name = document.createElement('span');
      name.className = 'p-name';
      name.title = `${p.name} (${p.sessions.length} sessions, ${formatTokens(p.totalTokens)} tokens)`;
      name.textContent = p.name;

      const sparkData = getProjectSparkline(p);
      const sparkline = renderSparkline(sparkData, color);

      const arrow = document.createElement('span');
      arrow.className = 'p-arrow';
      arrow.innerHTML = '&rsaquo;';

      div.appendChild(dot);
      div.appendChild(name);
      div.appendChild(sparkline);
      div.appendChild(arrow);
      listEl.appendChild(div);
    }
  }

  renderTreemap();
  renderProjectList();

  // Resize treemap
  const ro = new ResizeObserver(() => renderTreemap());
  ro.observe(treemapEl);
}
