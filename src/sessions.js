export function initSessions(data) {
  const listEl = document.getElementById('session-list');
  const searchEl = document.getElementById('session-search');
  const countEl = document.getElementById('sessions-count');
  const filterBtns = document.querySelectorAll('.filter-bar .filter-btn[data-sort]');

  let sessions = [...data.sessions];
  let sortMode = 'recent';
  let searchQuery = '';

  function timeAgo(ts) {
    const diff = Date.now() - ts;
    const mins = Math.floor(diff / 60000);
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    const days = Math.floor(hrs / 24);
    if (days < 30) return `${days}d ago`;
    return `${Math.floor(days / 30)}mo ago`;
  }

  function tokenLevel(total) {
    if (total > 50000000) return 'g4';
    if (total > 10000000) return 'g3';
    if (total > 1000000) return 'g2';
    return 'g1';
  }

  function promptLevel(count) {
    if (count > 30) return 'g4';
    if (count > 15) return 'g3';
    if (count > 5) return 'g2';
    return 'g1';
  }

  function toolLevel(count) {
    if (count > 50) return 'orange';
    if (count > 20) return 'g3';
    if (count > 5) return 'g2';
    return 'g1';
  }

  function durationLevel(ms) {
    if (ms > 3600000) return 'g4';
    if (ms > 1800000) return 'g3';
    if (ms > 600000) return 'g2';
    return 'g1';
  }

  function formatTokens(n) {
    if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M';
    if (n >= 1e3) return (n / 1e3).toFixed(1) + 'K';
    return n.toString();
  }

  function formatDuration(ms) {
    const mins = Math.floor(ms / 60000);
    if (mins < 60) return `${mins}m`;
    const hrs = Math.floor(mins / 60);
    const rem = mins % 60;
    return `${hrs}h${rem}m`;
  }

  function renderSessions(list) {
    countEl.textContent = `${list.length} TOTAL`;

    // Virtual scrolling: render only visible items
    const fragment = document.createDocumentFragment();
    const visible = list.slice(0, 200); // cap at 200 for perf

    for (const s of visible) {
      const card = document.createElement('div');
      card.className = 'session-card';
      card.dataset.sessionId = s.id;

      const firstPrompt = s.firstPrompt ? s.firstPrompt.slice(0, 80) : '(no prompt)';
      const lastPrompt = s.lastPrompt && s.lastPrompt !== s.firstPrompt
        ? s.lastPrompt.slice(0, 60)
        : '';

      card.innerHTML = `
        <div class="project-name">${escapeHtml(s.project)}</div>
        <div class="session-time">${timeAgo(s.startTime)}</div>
        <div class="prompt-text">${escapeHtml(firstPrompt)}</div>
        <div class="session-dots">
          <span class="dot ${tokenLevel(s.tokens.total)}"></span>
          <span class="dot ${promptLevel(s.promptCount)}"></span>
          <span class="dot ${toolLevel(s.toolCalls)}"></span>
          <span class="dot ${durationLevel(s.duration)}"></span>
          <span class="dot ${tokenLevel(s.tokens.output)}"></span>
          <span class="dot ${s.toolCalls > 30 ? 'red' : 'g1'}"></span>
        </div>
        ${lastPrompt ? `<div class="prompt-text">${escapeHtml(lastPrompt)}</div>` : ''}
        <div class="expand-content">
          <div class="meta-row">
            <span><span class="meta-label">tokens:</span> <span class="meta-value">${formatTokens(s.tokens.total)}</span></span>
            <span><span class="meta-label">prompts:</span> <span class="meta-value">${s.promptCount}</span></span>
            <span><span class="meta-label">tools:</span> <span class="meta-value">${s.toolCalls}</span></span>
          </div>
          <div class="meta-row">
            <span><span class="meta-label">duration:</span> <span class="meta-value">${formatDuration(s.duration)}</span></span>
            <span><span class="meta-label">model:</span> <span class="meta-value">${s.models[0] || 'unknown'}</span></span>
          </div>
          ${s.summary ? `<div class="meta-row" style="margin-top:4px"><span class="meta-label">summary:</span> <span class="meta-value">${escapeHtml(s.summary.slice(0, 120))}</span></div>` : ''}
          <button class="copy-resume-btn" data-cmd="cd ${escapeHtml(s.projectPath || s.cwd || '~')} && claude --resume ${s.id}">COPY RESUME CMD</button>
        </div>
      `;

      card.addEventListener('click', (e) => {
        if (e.target.classList.contains('copy-resume-btn')) {
          const cmd = e.target.dataset.cmd;
          navigator.clipboard.writeText(cmd).then(() => {
            e.target.textContent = 'COPIED!';
            setTimeout(() => { e.target.textContent = 'COPY RESUME CMD'; }, 1500);
          });
          e.stopPropagation();
          return;
        }
        card.classList.toggle('expanded');
      });

      fragment.appendChild(card);
    }

    listEl.innerHTML = '';
    listEl.appendChild(fragment);
  }

  function escapeHtml(str) {
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function filterAndSort() {
    let filtered = sessions;

    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      filtered = filtered.filter(s =>
        s.project.toLowerCase().includes(q) ||
        s.firstPrompt.toLowerCase().includes(q) ||
        s.lastPrompt.toLowerCase().includes(q) ||
        (s.summary && s.summary.toLowerCase().includes(q))
      );
    }

    if (sortMode === 'recent') {
      filtered.sort((a, b) => b.startTime - a.startTime);
    } else if (sortMode === 'tokens') {
      filtered.sort((a, b) => b.tokens.total - a.tokens.total);
    }

    renderSessions(filtered);
  }

  // Search handler
  searchEl.addEventListener('input', (e) => {
    searchQuery = e.target.value;
    filterAndSort();
  });

  // Sort handlers
  filterBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      filterBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      sortMode = btn.dataset.sort;
      filterAndSort();
    });
  });

  // Initial render
  filterAndSort();
}
