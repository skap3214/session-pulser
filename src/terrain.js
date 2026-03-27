import * as THREE from 'three';
import { Line2 } from 'three/addons/lines/Line2.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import { LineGeometry } from 'three/addons/lines/LineGeometry.js';

export function initTerrain(data) {
  const container = document.getElementById('terrain-container');
  const labelsEl = document.getElementById('terrain-labels');
  const rect = container.getBoundingClientRect();
  let W = rect.width || 600;
  let H = rect.height || 300;

  const scene = new THREE.Scene();
  function updateSceneBg() {
    const bg = getComputedStyle(document.documentElement).getPropertyValue('--terrain-bg').trim() || '#060a06';
    scene.background = new THREE.Color(bg);
  }
  updateSceneBg();
  const observer = new MutationObserver(updateSceneBg);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

  const camera = new THREE.PerspectiveCamera(50, W / H, 0.1, 800);
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
  renderer.setSize(W, H);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  container.insertBefore(renderer.domElement, labelsEl);

  const sessions = data.sessions;
  if (!sessions.length) return;

  const dates = [...new Set(sessions.map(s => s.date))].sort();
  const dateMin = new Date(dates[0]).getTime();
  const dateMax = new Date(dates[dates.length - 1]).getTime();
  const dateSpan = dateMax - dateMin || 1;

  // Slider setup
  const scrubber = document.getElementById('time-scrubber');
  const sliderStart = document.getElementById('slider-start');
  const sliderEnd = document.getElementById('slider-end');
  const fmtDate = (d) => { const dt = new Date(d); return `${dt.getMonth()+1}/${dt.getDate()}`; };
  if (sliderStart) sliderStart.textContent = fmtDate(dates[0]);
  if (sliderEnd) sliderEnd.textContent = fmtDate(dates[dates.length - 1]);

  let timeWindow = 0.15;
  if (scrubber) {
    scrubber.addEventListener('input', () => {
      timeWindow = Math.max(0.15, parseInt(scrubber.value) / 100);
      rebuildContours();
    });
  }

  // Scene dimensions
  const terrainW = 90;
  const terrainD = 50;

  // Ground grid + plane - theme aware
  let grid1, grid2;
  const planeGeom = new THREE.PlaneGeometry(terrainW, terrainD);
  planeGeom.rotateX(-Math.PI / 2);
  const planeMat = new THREE.MeshBasicMaterial({ color: 0x0a180a, transparent: true, opacity: 0.25, side: THREE.DoubleSide });
  const groundPlane = new THREE.Mesh(planeGeom, planeMat);
  groundPlane.position.y = -0.1;
  scene.add(groundPlane);

  function isLightTheme() {
    const theme = document.documentElement.getAttribute('data-theme');
    return theme === 'light' || (theme === 'system' && window.matchMedia('(prefers-color-scheme: light)').matches);
  }
  function rebuildGrids() {
    if (grid1) scene.remove(grid1);
    if (grid2) scene.remove(grid2);
    const light = isLightTheme();
    grid1 = new THREE.GridHelper(terrainW, 18,
      light ? 0xc8d0c8 : 0x252525,
      light ? 0xd8ddd8 : 0x1c1c1c
    );
    grid1.position.y = -0.1;
    scene.add(grid1);
    grid2 = new THREE.GridHelper(terrainW * 1.2, 6,
      light ? 0xe0e4e0 : 0x181818,
      light ? 0xe8ece8 : 0x141414
    );
    grid2.position.y = -0.15;
    grid2.visible = !light;
    scene.add(grid2);
    planeMat.color.set(light ? 0xf0f2f0 : 0x1a1a1a);
    planeMat.opacity = light ? 0.03 : 0.2;
  }
  rebuildGrids();
  new MutationObserver(() => { rebuildGrids(); updateSceneBg(); rebuildContours(); })
    .observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

  // ── Heightfield grid ──
  const GRID_X = 200; // date axis resolution
  const GRID_Z = 120; // hour axis resolution
  const MAX_HEIGHT = 16;

  // Separable 1D Gaussian blur (much faster, bigger radius)
  function blurPass(src, dst, sigma) {
    const kSize = Math.ceil(sigma * 3);
    const k = new Float32Array(kSize * 2 + 1);
    let kSum = 0;
    for (let i = -kSize; i <= kSize; i++) {
      k[i + kSize] = Math.exp(-(i * i) / (2 * sigma * sigma));
      kSum += k[i + kSize];
    }
    for (let i = 0; i < k.length; i++) k[i] /= kSum;

    // Blur along X
    const tmp = Array.from({ length: GRID_X }, () => new Float32Array(GRID_Z));
    for (let x = 0; x < GRID_X; x++) {
      for (let z = 0; z < GRID_Z; z++) {
        let v = 0;
        for (let i = -kSize; i <= kSize; i++) {
          const nx = Math.min(GRID_X - 1, Math.max(0, x + i));
          v += src[nx][z] * k[i + kSize];
        }
        tmp[x][z] = v;
      }
    }
    // Blur along Z
    for (let x = 0; x < GRID_X; x++) {
      for (let z = 0; z < GRID_Z; z++) {
        let v = 0;
        for (let i = -kSize; i <= kSize; i++) {
          const nz = Math.min(GRID_Z - 1, Math.max(0, z + i));
          v += tmp[x][nz] * k[i + kSize];
        }
        dst[x][z] = v;
      }
    }
  }

  // Build heightfield from sessions
  function buildHeightfield(filtered, startMs, visibleSpan) {
    const grid = Array.from({ length: GRID_X }, () => new Float32Array(GRID_Z));

    // Splat each session as a radial contribution, not a single pixel
    const splatRadius = 3;
    for (const s of filtered) {
      const t = (new Date(s.date).getTime() - startMs) / visibleSpan;
      const hour = new Date(s.startTime).getHours() + new Date(s.startTime).getMinutes() / 60;
      const gx = Math.floor(t * (GRID_X - 1));
      const gz = Math.floor((hour / 24) * (GRID_Z - 1));
      for (let dx = -splatRadius; dx <= splatRadius; dx++) {
        for (let dz = -splatRadius; dz <= splatRadius; dz++) {
          const nx = gx + dx, nz = gz + dz;
          if (nx >= 0 && nx < GRID_X && nz >= 0 && nz < GRID_Z) {
            const dist = Math.sqrt(dx * dx + dz * dz);
            const w = Math.max(0, 1 - dist / (splatRadius + 1));
            grid[nx][nz] += s.tokens.total * w;
          }
        }
      }
    }

    // Multi-pass separable blur for very smooth, organic shapes
    let a = grid;
    let b = Array.from({ length: GRID_X }, () => new Float32Array(GRID_Z));
    blurPass(a, b, 6.0);
    blurPass(b, a, 4.0);
    blurPass(a, b, 3.0);
    const blurred = b;

    // Log scale and normalize
    let maxVal = 0;
    for (let x = 0; x < GRID_X; x++)
      for (let z = 0; z < GRID_Z; z++)
        if (blurred[x][z] > maxVal) maxVal = blurred[x][z];

    const logMax = Math.log10(maxVal + 1);
    if (logMax > 0) {
      for (let x = 0; x < GRID_X; x++)
        for (let z = 0; z < GRID_Z; z++)
          blurred[x][z] = (Math.log10(blurred[x][z] + 1) / logMax) * MAX_HEIGHT;
    }

    return blurred;
  }

  // ── Marching squares contour extraction ──
  function extractContours(grid, threshold) {
    const segments = [];

    for (let x = 0; x < GRID_X - 1; x++) {
      for (let z = 0; z < GRID_Z - 1; z++) {
        const v00 = grid[x][z];
        const v10 = grid[x + 1][z];
        const v11 = grid[x + 1][z + 1];
        const v01 = grid[x][z + 1];

        // Classify corners
        let caseIdx = 0;
        if (v00 >= threshold) caseIdx |= 1;
        if (v10 >= threshold) caseIdx |= 2;
        if (v11 >= threshold) caseIdx |= 4;
        if (v01 >= threshold) caseIdx |= 8;

        if (caseIdx === 0 || caseIdx === 15) continue;

        // Interpolate edge crossings
        const lerp = (a, b) => (threshold - a) / (b - a);
        const top    = { x: x + lerp(v00, v10), z: z };       // bottom edge (z=z)
        const right  = { x: x + 1, z: z + lerp(v10, v11) };   // right edge
        const bottom = { x: x + lerp(v01, v11), z: z + 1 };   // top edge (z=z+1)
        const left   = { x: x, z: z + lerp(v00, v01) };       // left edge

        const addSeg = (a, b) => segments.push([a, b]);

        switch (caseIdx) {
          case 1:  addSeg(top, left); break;
          case 2:  addSeg(top, right); break;
          case 3:  addSeg(left, right); break;
          case 4:  addSeg(right, bottom); break;
          case 5:  addSeg(top, right); addSeg(bottom, left); break;
          case 6:  addSeg(top, bottom); break;
          case 7:  addSeg(left, bottom); break;
          case 8:  addSeg(left, bottom); break;
          case 9:  addSeg(top, bottom); break;
          case 10: addSeg(top, left); addSeg(right, bottom); break;
          case 11: addSeg(right, bottom); break;
          case 12: addSeg(left, right); break;
          case 13: addSeg(top, right); break;
          case 14: addSeg(top, left); break;
        }
      }
    }

    return segments;
  }

  // Chain segments into polylines for smoother rendering
  function chainSegments(segments) {
    if (!segments.length) return [];

    const ptKey = (p) => `${p.x.toFixed(4)},${p.z.toFixed(4)}`;
    const remaining = new Set(segments.map((_, i) => i));
    const chains = [];

    while (remaining.size > 0) {
      const startIdx = remaining.values().next().value;
      remaining.delete(startIdx);
      const chain = [segments[startIdx][0], segments[startIdx][1]];

      let extended = true;
      while (extended) {
        extended = false;
        const headKey = ptKey(chain[0]);
        const tailKey = ptKey(chain[chain.length - 1]);

        for (const idx of remaining) {
          const seg = segments[idx];
          const k0 = ptKey(seg[0]);
          const k1 = ptKey(seg[1]);

          if (k0 === tailKey) {
            chain.push(seg[1]); remaining.delete(idx); extended = true; break;
          } else if (k1 === tailKey) {
            chain.push(seg[0]); remaining.delete(idx); extended = true; break;
          } else if (k0 === headKey) {
            chain.unshift(seg[1]); remaining.delete(idx); extended = true; break;
          } else if (k1 === headKey) {
            chain.unshift(seg[0]); remaining.delete(idx); extended = true; break;
          }
        }
      }
      chains.push(chain);
    }
    return chains;
  }

  // Convert grid coords to world coords
  function gridToWorld(gx, gz) {
    const wx = (gx / (GRID_X - 1) - 0.5) * terrainW;
    const wz = (gz / (GRID_Z - 1) - 0.5) * terrainD;
    return { x: wx, z: wz };
  }

  // Find peak positions for labels
  function findPeaks(grid, filtered, startMs, visibleSpan) {
    const peaks = [];
    // Find local maxima in the heightfield
    for (let x = 1; x < GRID_X - 1; x++) {
      for (let z = 1; z < GRID_Z - 1; z++) {
        const v = grid[x][z];
        if (v < 1) continue;
        let isMax = true;
        for (let dx = -1; dx <= 1; dx++) {
          for (let dz = -1; dz <= 1; dz++) {
            if (dx === 0 && dz === 0) continue;
            if (grid[x + dx][z + dz] > v) { isMax = false; break; }
          }
          if (!isMax) break;
        }
        if (!isMax) continue;

        const w = gridToWorld(x, z);
        // Find the dominant project at this location
        const hourCenter = (z / (GRID_Z - 1)) * 24;
        const tCenter = x / (GRID_X - 1);
        const dateCenterMs = startMs + tCenter * visibleSpan;

        const nearby = filtered.filter(s => {
          const st = (new Date(s.date).getTime() - startMs) / visibleSpan;
          const sh = new Date(s.startTime).getHours() + new Date(s.startTime).getMinutes() / 60;
          return Math.abs(st - tCenter) < 0.08 && Math.abs(sh - hourCenter) < 3;
        });

        const projectCounts = {};
        for (const s of nearby) {
          projectCounts[s.project] = (projectCounts[s.project] || 0) + s.tokens.total;
        }
        const entries = Object.entries(projectCounts).sort((a, b) => b[1] - a[1]);
        const topProject = entries.length ? entries[0][0] : '';
        const topDate = nearby.length
          ? nearby.sort((a, b) => b.tokens.total - a.tokens.total)[0].date
          : new Date(dateCenterMs).toISOString().split('T')[0];

        peaks.push({
          pos: new THREE.Vector3(w.x, v + 1.5, w.z),
          text: topProject,
          date: topDate,
          height: v,
        });
      }
    }

    // Deduplicate peaks that are very close
    peaks.sort((a, b) => b.height - a.height);
    const kept = [];
    for (const p of peaks) {
      let tooClose = false;
      for (const k of kept) {
        if (Math.abs(p.pos.x - k.pos.x) < 8 && Math.abs(p.pos.z - k.pos.z) < 5) {
          tooClose = true; break;
        }
      }
      if (!tooClose) kept.push(p);
    }
    return kept;
  }

  // Container for contour objects
  let contourGroup = new THREE.Group();
  scene.add(contourGroup);

  // Label management
  let labelDivs = [];
  let dateMarkerDivs = [];

  function clearLabels() {
    for (const l of [...labelDivs, ...dateMarkerDivs]) l.el.remove();
    labelDivs = [];
    dateMarkerDivs = [];
  }

  function rebuildContours() {
    scene.remove(contourGroup);
    contourGroup = new THREE.Group();
    scene.add(contourGroup);
    clearLabels();

    const endMs = dateMax;
    const startMs = dateMin + (1 - timeWindow) * dateSpan;
    const filtered = sessions.filter(s => {
      const t = new Date(s.date).getTime();
      return t >= startMs && t <= endMs;
    });
    const visibleSpan = endMs - startMs || 1;

    const startIdx = dates.findIndex(d => new Date(d).getTime() >= startMs);
    if (sliderStart && startIdx >= 0) sliderStart.textContent = fmtDate(dates[startIdx]);

    // Build heightfield
    const heightfield = buildHeightfield(filtered, startMs, visibleSpan);

    // Find the actual max height for contour level spacing
    let fieldMax = 0;
    for (let x = 0; x < GRID_X; x++)
      for (let z = 0; z < GRID_Z; z++)
        if (heightfield[x][z] > fieldMax) fieldMax = heightfield[x][z];

    if (fieldMax < 0.1) { return; }

    // Generate contour levels
    const numLevels = 32;
    const light = isLightTheme();

    for (let lvl = 1; lvl <= numLevels; lvl++) {
      const threshold = (lvl / numLevels) * fieldMax;
      const segments = extractContours(heightfield, threshold);
      if (!segments.length) continue;

      const chains = chainSegments(segments);
      const t = lvl / numLevels;
      const y = threshold; // contour drawn at its actual height

      for (const chain of chains) {
        if (chain.length < 2) continue;
        const positions = [];
        for (const pt of chain) {
          const w = gridToWorld(pt.x, pt.z);
          positions.push(w.x, y, w.z);
        }

        const geom = new LineGeometry();
        geom.setPositions(positions);

        const opacity = 0.4 + (1 - t) * 0.45;
        const lineWidth = 1.2 + (1 - t) * 1.0;
        const isAccent = lvl % 5 === 0;
        const color = light
          ? (isAccent ? 0x1a5010 : 0x286818)
          : (isAccent ? 0xb0e848 : 0x8cc830);

        const mat = new LineMaterial({
          color,
          linewidth: isAccent ? lineWidth * 1.3 : lineWidth,
          transparent: true,
          opacity: light ? opacity * 0.85 : opacity,
          resolution: new THREE.Vector2(W, H),
        });
        contourGroup.add(new Line2(geom, mat));
      }
    }

    // Vertical lines — sample the heightfield at regular grid points
    const vStepX = 10;
    const vStepZ = 10;
    for (let x = 0; x < GRID_X; x += vStepX) {
      for (let z = 0; z < GRID_Z; z += vStepZ) {
        const h = heightfield[x][z];
        if (h < 0.5) continue;

        const w = gridToWorld(x, z);
        const positions = [w.x, 0, w.z, w.x, h, w.z];
        const geom = new LineGeometry();
        geom.setPositions(positions);

        const vMat = new LineMaterial({
          color: light ? 0x3a8020 : 0x68a838,
          linewidth: 0.8,
          transparent: true,
          opacity: light ? 0.15 : 0.2,
          resolution: new THREE.Vector2(W, H),
        });
        contourGroup.add(new Line2(geom, vMat));
      }
    }

    // Peak labels
    const peaks = findPeaks(heightfield, filtered, startMs, visibleSpan);
    for (const label of peaks.slice(0, 18)) {
      const div = document.createElement('div');
      div.className = 'terrain-label';
      const d = new Date(label.date);
      div.innerHTML = `${label.text}<span class="label-date">${d.getMonth()+1}/${d.getDate()}</span>`;
      labelsEl.appendChild(div);
      labelDivs.push({ el: div, pos: label.pos });
    }

    // Date markers along X axis
    const visibleDates = dates.filter(d => new Date(d).getTime() >= startMs);
    const dStep = Math.max(1, Math.floor(visibleDates.length / 6));
    for (let i = 0; i < visibleDates.length; i += dStep) {
      const t = (new Date(visibleDates[i]).getTime() - startMs) / visibleSpan;
      const wx = (t - 0.5) * terrainW;

      const lineGeom = new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(wx, 0, -terrainD / 2 - 2),
        new THREE.Vector3(wx, MAX_HEIGHT, -terrainD / 2 - 2),
      ]);
      contourGroup.add(new THREE.Line(lineGeom, new THREE.LineBasicMaterial({ color: 0xd06048, transparent: true, opacity: 0.4 })));

      const dot = new THREE.Mesh(new THREE.SphereGeometry(0.25, 4, 4), new THREE.MeshBasicMaterial({ color: 0xd06048 }));
      dot.position.set(wx, 0, -terrainD / 2 - 2);
      contourGroup.add(dot);

      const div = document.createElement('div');
      div.className = 'terrain-label date-marker';
      div.textContent = fmtDate(visibleDates[i]);
      labelsEl.appendChild(div);
      dateMarkerDivs.push({ el: div, pos: new THREE.Vector3(wx, MAX_HEIGHT + 1, -terrainD / 2 - 2) });
    }

    // Hour labels along Z axis
    for (let h = 0; h <= 24; h += 3) {
      const wz = (h / 24 - 0.5) * terrainD;
      const div = document.createElement('div');
      div.className = 'terrain-label';
      div.style.color = 'var(--text-dim)';
      div.style.fontSize = '9px';
      div.style.letterSpacing = '1px';
      div.textContent = `${String(h).padStart(2, '0')}:00`;
      labelsEl.appendChild(div);
      dateMarkerDivs.push({ el: div, pos: new THREE.Vector3(terrainW / 2 + 4, 0.5, wz) });

      const tickGeom = new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(terrainW / 2 + 1, 0.05, wz),
        new THREE.Vector3(terrainW / 2 + 3, 0.05, wz),
      ]);
      contourGroup.add(new THREE.Line(tickGeom, new THREE.LineBasicMaterial({ color: 0x2a4a2a, transparent: true, opacity: 0.5 })));
    }

    // Axis labels
    const hourLabel = document.createElement('div');
    hourLabel.className = 'terrain-label';
    hourLabel.style.color = 'var(--text-dim)';
    hourLabel.style.fontSize = '8px';
    hourLabel.style.letterSpacing = '2px';
    hourLabel.textContent = 'HOUR \u2192';
    labelsEl.appendChild(hourLabel);
    dateMarkerDivs.push({ el: hourLabel, pos: new THREE.Vector3(terrainW / 2 + 5, 1, 0) });

    const dateLabel = document.createElement('div');
    dateLabel.className = 'terrain-label';
    dateLabel.style.color = 'var(--text-dim)';
    dateLabel.style.fontSize = '8px';
    dateLabel.style.letterSpacing = '2px';
    dateLabel.textContent = 'DATE';
    labelsEl.appendChild(dateLabel);
    dateMarkerDivs.push({ el: dateLabel, pos: new THREE.Vector3(0, MAX_HEIGHT + 1, -terrainD / 2 - 3) });
  }

  // Initial build
  rebuildContours();

  // Label projection
  function updateLabels() {
    const all = [...labelDivs, ...dateMarkerDivs];
    for (const label of all) {
      const projected = label.pos.clone().project(camera);
      const x = (projected.x * 0.5 + 0.5) * W;
      const y = (-projected.y * 0.5 + 0.5) * H;
      if (projected.z > 0 && projected.z < 1 && x > -60 && x < W + 60 && y > -20 && y < H + 20) {
        label.el.style.transform = `translate(${x}px, ${y}px)`;
        label.el.style.display = 'block';
      } else {
        label.el.style.display = 'none';
      }
    }
  }

  // Camera orbit
  let isDragging = false;
  let prevMouse = { x: 0, y: 0 };
  let phi = 0.9;
  let theta = 0.6;
  let radius = 75;
  const lookTarget = new THREE.Vector3(5, 2, 0);

  container.addEventListener('mousedown', (e) => {
    isDragging = true;
    prevMouse = { x: e.clientX, y: e.clientY };
    e.preventDefault();
  });
  window.addEventListener('mouseup', () => { isDragging = false; });
  window.addEventListener('mousemove', (e) => {
    if (!isDragging) return;
    theta -= (e.clientX - prevMouse.x) * 0.005;
    phi = Math.max(0.05, Math.min(Math.PI * 0.48, phi + (e.clientY - prevMouse.y) * 0.005));
    prevMouse = { x: e.clientX, y: e.clientY };
  });
  container.addEventListener('wheel', (e) => {
    e.preventDefault();
    if (scrubber) {
      const newVal = Math.max(10, Math.min(100, parseInt(scrubber.value) - e.deltaY * 0.1));
      scrubber.value = newVal;
      timeWindow = Math.max(0.15, newVal / 100);
      rebuildContours();
    }
  }, { passive: false });

  // Animate
  let autoTheta = 0;
  function animate() {
    requestAnimationFrame(animate);
    if (!isDragging) autoTheta += 0.0005;
    const t = theta + autoTheta;
    camera.position.x = lookTarget.x + Math.sin(t) * Math.sin(phi) * radius;
    camera.position.y = lookTarget.y + Math.cos(phi) * radius;
    camera.position.z = lookTarget.z + Math.cos(t) * Math.sin(phi) * radius;
    camera.lookAt(lookTarget);
    renderer.render(scene, camera);
    updateLabels();
  }
  animate();

  // Resize
  const ro = new ResizeObserver(entries => {
    const { width, height } = entries[0].contentRect;
    if (width === 0 || height === 0) return;
    W = width; H = height;
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    contourGroup.traverse(obj => {
      if (obj.material && obj.material.resolution) {
        obj.material.resolution.set(width, height);
      }
    });
  });
  ro.observe(container);
}
