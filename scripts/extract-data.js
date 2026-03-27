import fs from 'fs';
import path from 'path';
import os from 'os';

const CLAUDE_DIR = path.join(os.homedir(), '.claude');
const PROJECTS_DIR = path.join(CLAUDE_DIR, 'projects');
const HISTORY_FILE = path.join(CLAUDE_DIR, 'history.jsonl');
const SUMMARIES_DIR = path.join(CLAUDE_DIR, 'session-summaries');
const STATS_FILE = path.join(CLAUDE_DIR, 'stats-cache.json');
const OUTPUT_FILE = path.join(import.meta.dirname, '..', 'public', 'data.json');

function decodeProjectPath(encoded) {
  return encoded.replace(/^-/, '/').replace(/-/g, '/');
}

function getProjectName(encoded) {
  // Pattern-based naming for known path structures
  const e = encoded;

  // Slock agents / Pi Agent
  if (e.includes('slock-agents')) return 'Pi Agent';
  // Temp sessions
  if (e.includes('private-var-folders')) return 'Temp Session';
  // Claude worktrees
  if (e.includes('claude-worktrees')) return 'YL Backend (worktree)';

  // YL workspace trees: -workspace-trees-workspace-<name>-<sub>
  const wtMatch = e.match(/yl-workspace-trees-workspace-(\d+)(?:-(.+))?$/);
  if (wtMatch) {
    const num = wtMatch[1];
    const sub = wtMatch[2];
    if (sub === 'frontend') return `YL #${num} Frontend`;
    if (sub === 'youlearn-backend') return `YL #${num} Backend`;
    return `YL Workspace #${num}`;
  }

  // YL workspace trees with feature names
  const wtFeature = e.match(/yl-workspace-trees-workspace-([a-z][\w-]+?)(?:-(frontend|youlearn-backend))?$/);
  if (wtFeature) {
    const feature = wtFeature[1].replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
    const sub = wtFeature[2];
    if (sub === 'frontend') return `YL ${feature} FE`;
    if (sub === 'youlearn-backend') return `YL ${feature} BE`;
    return `YL ${feature}`;
  }

  // YL workspace trees root
  if (e.match(/yl-workspace-trees$/)) return 'YL Workspace Trees';

  // Date-based workspace trees (20260120-000339)
  const wtDate = e.match(/workspace-(\d{8})-(\d+)(?:-(frontend|youlearn-backend))?$/);
  if (wtDate) {
    const date = wtDate[1].slice(4, 6) + '/' + wtDate[1].slice(6);
    const sub = wtDate[3];
    if (sub === 'frontend') return `YL ${date} FE`;
    if (sub === 'youlearn-backend') return `YL ${date} BE`;
    return `YL Workspace ${date}`;
  }

  // Refresh auth token worktree
  if (e.includes('refresh-auth-token')) {
    if (e.endsWith('frontend')) return 'YL Auth Token FE';
    if (e.endsWith('youlearn-backend')) return 'YL Auth Token BE';
    return 'YL Auth Token';
  }

  // YL direct paths
  if (e.match(/yl-workspace-frontend$/)) return 'YL Workspace FE';
  if (e.match(/yl-workspace-youlearn-backend$/)) return 'YL Workspace BE';
  if (e.match(/yl-workspace$/)) return 'YL Workspace';
  if (e.match(/yl-frontend-apps-web-app$/)) return 'YL Web App';
  if (e.match(/yl-frontend$/)) return 'YL Frontend';
  if (e.match(/yl-youlearn-backend$/)) return 'YL Backend';
  if (e.match(/yl-customer-support-youlearn-backend$/)) return 'YL Customer Support BE';
  if (e.match(/yl-pdf-extract$/)) return 'YL PDF Extract';
  if (e.match(/yl-youlearn-chrome-extension$/)) return 'YL Chrome Extension';

  // wt (worktree) paths
  if (e.includes('wt-youlearn')) return 'YL Video Generator';

  // Int projects
  if (e.match(/int-halo-2-cloud-pi-agent$/)) return 'Pi Agent (Cloud)';
  if (e.match(/int-halo-2$/)) return 'Halo 2';
  if (e.match(/int-halo$/)) return 'Halo';
  if (e.match(/int-torix$/)) return 'Torix';
  if (e.match(/int-astra$/)) return 'Astra';
  if (e.match(/int-principles$/)) return 'Principles';
  if (e.match(/int-autoresearch-macos$/)) return 'AutoResearch';
  if (e.match(/int-video-gen$/)) return 'Video Gen';
  if (e.match(/code-int$/)) return 'Home Sessions';
  if (e.match(/code-portfolio$/)) return 'Portfolio';

  // User home directory (just the username)
  const homeDir = os.homedir();
  const username = homeDir.split('/').pop();
  if (e === `-Users-${username}`) return 'Home';

  // Fallback: take last meaningful segment
  const decoded = decodeProjectPath(encoded);
  const parts = decoded.split('/').filter(Boolean);
  return parts.slice(-2).join('/') || encoded;
}

function categorizeProject(name, fullPath) {
  const lower = (name + ' ' + fullPath).toLowerCase();
  if (/shader|glsl|webgl|threejs|three\.js|visual|art|generative/.test(lower)) return 'Visual Art & Shaders';
  if (/podcast|audio|music|sound/.test(lower)) return 'Creative Coding';
  if (/ml|machine.?learn|neural|model|train|deep.?learn|micrograd|lora|diffusion/.test(lower)) return 'Machine Learning';
  if (/data|viz|visual|chart|graph|dashboard|analytics/.test(lower)) return 'Data & Visualization';
  if (/note|network|garden|knowledge|brain/.test(lower)) return 'Research';
  if (/ai|agent|claude|llm|gpt|anthropic|hermes|autoresearch/.test(lower)) return 'AI & Dev Tools';
  if (/app|web|frontend|backend|api|server|workspace|portfolio/.test(lower)) return 'Apps & Tools';
  if (/cube|rubik|game|play/.test(lower)) return 'Creative Coding';
  if (/doc|principle|explore/.test(lower)) return 'Research';
  return 'Misc';
}

function parseSessionJSONL(filePath) {
  const content = fs.readFileSync(filePath, 'utf-8');
  const lines = content.split('\n').filter(l => l.trim());

  const session = {
    userMessages: [],
    tokens: { input: 0, output: 0, cacheCreation: 0, cacheRead: 0, total: 0 },
    timestamps: [],
    models: new Set(),
    toolCalls: 0,
    messageCount: 0,
    cwd: null,
    gitBranch: null,
    version: null,
  };

  for (const line of lines) {
    let obj;
    try { obj = JSON.parse(line); } catch { continue; }

    if (obj.type === 'user') {
      const content = obj.message?.content;
      let displayText = '';
      if (typeof content === 'string') {
        displayText = content;
      } else if (Array.isArray(content)) {
        const textPart = content.find(p => typeof p === 'string' || p.type === 'text');
        if (typeof textPart === 'string') displayText = textPart;
        else if (textPart?.text) displayText = textPart.text;
        // Skip tool results - these are not user prompts
        if (content.some(p => p.type === 'tool_result')) continue;
      }
      // Skip internal/system messages
      if (displayText.startsWith('<teammate-message') ||
          displayText.startsWith('<local-command') ||
          displayText.startsWith('<bash-stdout>') ||
          displayText.startsWith('[Image:') ||
          displayText.startsWith('<system-reminder')) continue;
      // Clean up display text
      displayText = displayText.replace(/<[^>]+>/g, '').trim();
      if (displayText && displayText.length > 0) {
        session.userMessages.push({
          text: displayText.slice(0, 300),
          timestamp: obj.timestamp
        });
      }
      if (obj.timestamp) session.timestamps.push(new Date(obj.timestamp).getTime());
      if (obj.cwd) session.cwd = obj.cwd;
      if (obj.gitBranch) session.gitBranch = obj.gitBranch;
      if (obj.version) session.version = obj.version;
      session.messageCount++;
    }

    if (obj.type === 'assistant') {
      const usage = obj.message?.usage;
      if (usage) {
        session.tokens.input += usage.input_tokens || 0;
        session.tokens.output += usage.output_tokens || 0;
        session.tokens.cacheCreation += usage.cache_creation_input_tokens || 0;
        session.tokens.cacheRead += usage.cache_read_input_tokens || 0;
      }
      if (obj.message?.model) session.models.add(obj.message.model);
      if (obj.timestamp) session.timestamps.push(new Date(obj.timestamp).getTime());

      // Count tool calls
      const content = obj.message?.content;
      if (Array.isArray(content)) {
        session.toolCalls += content.filter(p => p.type === 'tool_use').length;
      }
      session.messageCount++;
    }
  }

  session.tokens.total = session.tokens.input + session.tokens.output +
    session.tokens.cacheCreation + session.tokens.cacheRead;

  return session;
}

function loadSummary(sessionId) {
  const summaryFile = path.join(SUMMARIES_DIR, `${sessionId}.md`);
  if (fs.existsSync(summaryFile)) {
    const content = fs.readFileSync(summaryFile, 'utf-8');
    // Extract the goal line
    const goalMatch = content.match(/## Goal\n(.+)/);
    return goalMatch ? goalMatch[1].trim() : content.split('\n').find(l => l.trim() && !l.startsWith('#'))?.trim() || '';
  }
  return null;
}

function loadHistory() {
  if (!fs.existsSync(HISTORY_FILE)) return [];
  const content = fs.readFileSync(HISTORY_FILE, 'utf-8');
  const entries = [];
  for (const line of content.split('\n').filter(l => l.trim())) {
    try {
      const obj = JSON.parse(line);
      entries.push({
        display: obj.display,
        timestamp: obj.timestamp,
        project: obj.project
      });
    } catch { /* skip */ }
  }
  return entries;
}

function loadStatsCache() {
  if (!fs.existsSync(STATS_FILE)) return null;
  try {
    return JSON.parse(fs.readFileSync(STATS_FILE, 'utf-8'));
  } catch { return null; }
}

function main() {
  console.log('Extracting Claude Code session data...');

  const projectDirs = fs.readdirSync(PROJECTS_DIR);
  const allSessions = [];
  const projectMap = {};

  for (const projDir of projectDirs) {
    const projPath = path.join(PROJECTS_DIR, projDir);
    if (!fs.statSync(projPath).isDirectory()) continue;

    const projectName = getProjectName(projDir);
    const fullPath = decodeProjectPath(projDir);
    const category = categorizeProject(projectName, fullPath);

    if (!projectMap[projDir]) {
      projectMap[projDir] = {
        name: projectName,
        encoded: projDir,
        path: fullPath,
        category,
        sessions: [],
        totalTokens: 0,
        totalMessages: 0,
        totalToolCalls: 0,
      };
    }

    const files = fs.readdirSync(projPath).filter(f => f.endsWith('.jsonl'));

    for (const file of files) {
      const sessionId = file.replace('.jsonl', '');
      const filePath = path.join(projPath, file);

      try {
        const sessionData = parseSessionJSONL(filePath);

        if (sessionData.timestamps.length === 0) continue;

        const startTime = Math.min(...sessionData.timestamps);
        const endTime = Math.max(...sessionData.timestamps);
        const summary = loadSummary(sessionId);

        const session = {
          id: sessionId,
          project: projectName,
          projectEncoded: projDir,
          projectPath: fullPath,
          category,
          startTime,
          endTime,
          date: new Date(startTime).toISOString().split('T')[0],
          duration: endTime - startTime,
          tokens: sessionData.tokens,
          promptCount: sessionData.userMessages.length,
          messageCount: sessionData.messageCount,
          toolCalls: sessionData.toolCalls,
          firstPrompt: sessionData.userMessages[0]?.text || summary || '(agent session)',
          lastPrompt: sessionData.userMessages.length > 1
            ? sessionData.userMessages[sessionData.userMessages.length - 1]?.text || ''
            : '',
          models: [...sessionData.models],
          cwd: sessionData.cwd,
          summary,
        };

        allSessions.push(session);
        projectMap[projDir].sessions.push(sessionId);
        projectMap[projDir].totalTokens += sessionData.tokens.total;
        projectMap[projDir].totalMessages += sessionData.messageCount;
        projectMap[projDir].totalToolCalls += sessionData.toolCalls;
      } catch (e) {
        console.warn(`  Skipping ${file}: ${e.message}`);
      }
    }
  }

  // Sort sessions by start time (newest first)
  allSessions.sort((a, b) => b.startTime - a.startTime);

  // Build projects array
  const projects = Object.values(projectMap)
    .filter(p => p.sessions.length > 0)
    .sort((a, b) => b.totalTokens - a.totalTokens);

  // Load history for timeline - adds older prompts not in session JSONL files
  const history = loadHistory();
  // Merge history entries as lightweight sessions for dates we don't have JSONL data
  const sessionDates = new Set(allSessions.map(s => s.date));
  const historyByDate = {};
  for (const h of history) {
    const date = new Date(h.timestamp).toISOString().split('T')[0];
    if (!historyByDate[date]) historyByDate[date] = { prompts: 0, project: h.project };
    historyByDate[date].prompts++;
  }
  for (const [date, info] of Object.entries(historyByDate)) {
    if (!sessionDates.has(date)) {
      // Create a lightweight session from history data
      const ts = new Date(date).getTime();
      const projectPath = info.project || '';
      const name = projectPath.split('/').filter(Boolean).slice(-2).join('/') || 'unknown';
      allSessions.push({
        id: `history-${date}`,
        project: name,
        projectEncoded: '',
        projectPath,
        category: 'Misc',
        startTime: ts,
        endTime: ts,
        date,
        duration: 0,
        tokens: { input: 0, output: 0, cacheCreation: 0, cacheRead: 0, total: 0 },
        promptCount: info.prompts,
        messageCount: info.prompts,
        toolCalls: 0,
        firstPrompt: '(from history)',
        lastPrompt: '',
        models: [],
        cwd: projectPath,
        summary: null,
      });
    }
  }

  // Re-sort with merged data
  allSessions.sort((a, b) => b.startTime - a.startTime);

  // Build daily activity from sessions
  const dailyMap = {};
  for (const session of allSessions) {
    const date = session.date;
    if (!dailyMap[date]) {
      dailyMap[date] = { date, sessions: 0, tokens: 0, prompts: 0, toolCalls: 0 };
    }
    dailyMap[date].sessions++;
    dailyMap[date].tokens += session.tokens.total;
    dailyMap[date].prompts += session.promptCount;
    dailyMap[date].toolCalls += session.toolCalls;
  }
  const dailyActivity = Object.values(dailyMap).sort((a, b) => a.date.localeCompare(b.date));

  // Build terrain data: daily token usage per project
  const terrainData = [];
  for (const session of allSessions) {
    terrainData.push({
      date: session.date,
      project: session.project,
      tokens: session.tokens.total,
      output: session.tokens.output,
    });
  }

  // Compute stats
  const totalTokens = allSessions.reduce((s, x) => s + x.tokens.total, 0);
  const totalOutput = allSessions.reduce((s, x) => s + x.tokens.output, 0);
  const totalInput = allSessions.reduce((s, x) => s + x.tokens.input + x.tokens.cacheCreation + x.tokens.cacheRead, 0);
  const totalPrompts = allSessions.reduce((s, x) => s + x.promptCount, 0);
  const dates = allSessions.map(s => s.date).sort();

  // Load stats cache for supplementary data
  const statsCache = loadStatsCache();

  const output = {
    extractedAt: new Date().toISOString(),
    stats: {
      totalSessions: allSessions.length,
      totalPrompts,
      totalTokens,
      totalInput,
      totalOutput,
      totalProjects: projects.length,
      dateRange: {
        start: dates[0] || '',
        end: dates[dates.length - 1] || '',
      },
    },
    sessions: allSessions,
    projects,
    dailyActivity,
    terrainData,
    statsCache: statsCache?.dailyActivity || [],
  };

  // Ensure output directory exists
  const outputDir = path.dirname(OUTPUT_FILE);
  if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(output, null, 0));

  const sizeMB = (fs.statSync(OUTPUT_FILE).size / 1024 / 1024).toFixed(1);
  console.log(`\nExtracted:`);
  console.log(`  ${allSessions.length} sessions across ${projects.length} projects`);
  console.log(`  ${totalPrompts} prompts, ${(totalTokens / 1e6).toFixed(1)}M tokens`);
  console.log(`  Date range: ${output.stats.dateRange.start} → ${output.stats.dateRange.end}`);
  console.log(`  Output: ${OUTPUT_FILE} (${sizeMB} MB)`);
}

main();
