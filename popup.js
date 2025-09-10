function getQueryTabId() {
  try {
    const u = new URL(location.href);
    const val = u.searchParams.get('tabId');
    if (!val) return null;
    const n = parseInt(val, 10);
    return Number.isFinite(n) ? n : null;
  } catch (_) { return null; }
}

async function getTargetTabId() {
  const q = getQueryTabId();
  if (q != null) return q;
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  return tabs[0] && tabs[0].id;
}

function setStatus(text) {
  const el = document.getElementById('status');
  el.textContent = text || '';
}

function uuidv4() {
  const b = new Uint8Array(16);
  crypto.getRandomValues(b);
  b[6] = (b[6] & 0x0f) | 0x40; // version 4
  b[8] = (b[8] & 0x3f) | 0x80; // variant 10
  const hex = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
  const canonical = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  return canonical;
}

document.addEventListener('DOMContentLoaded', () => {
  const baseInput = document.getElementById('basename');
  const retryBtn = document.getElementById('retryBtn');
  const openBigBtn = document.getElementById('openBigBtn');
  const downloadBtn = document.getElementById('downloadSelectedBtn');
  const selectAllBtn = document.getElementById('selectAllBtn');
  const selectNoneBtn = document.getElementById('selectNoneBtn');
  const invertSelectBtn = document.getElementById('invertSelectBtn');
  const counts = document.getElementById('counts');
  const grid = document.getElementById('grid');
  const marquee = document.getElementById('marquee');
  const saveDirect = document.getElementById('saveDirect');
  const saveInFolder = document.getElementById('saveInFolder');
  const folderName = document.getElementById('folderName');
  const folderPreset = document.getElementById('folderPreset');
  const addFolderBtn = document.getElementById('addFolderBtn');
  const deleteFolderBtn = document.getElementById('deleteFolderBtn');

  // state
  let collected = [];
  let selected = new Set();
  let lastClickedIndex = null;

  // Auto-fill with uuidv4 without hyphens
  try {
    baseInput.value = uuidv4().replace(/-/g, '');
  } catch (_) {
    // fallback: timestamp-based
    baseInput.value = `f${Date.now().toString(36)}`;
  }
  // Keep subfolder name empty by default
  folderName.value = '';

  // Toggle folder input enabled state
  function updateFolderEnabled() {
    folderName.disabled = !saveInFolder.checked;
  }
  saveDirect.addEventListener('change', updateFolderEnabled);
  saveInFolder.addEventListener('change', updateFolderEnabled);
  updateFolderEnabled();

  // Folder name sanitization (mirror of background)
  function sanitizeFolderName(name) {
    const trimmed = (name || '').toString().trim();
    if (!trimmed) return '';
    let safe = trimmed
      .replace(/[\\/:*?"<>|]/g, '-')
      .replace(/\.+/g, '.')
      .replace(/\s+/g, ' ')
      .replace(/^\.+|\.+$/g, '');
    if (safe === '.' || safe === '..') safe = '';
    if (safe.length > 100) safe = safe.slice(0, 100);
    return safe;
  }

  // Presets storage helpers
  const PRESET_KEY = 'folderPresets';
  const LAST_PRESET_KEY = 'lastFolderPreset';
  async function loadPresets() {
    try {
      const obj = await chrome.storage.local.get([PRESET_KEY, LAST_PRESET_KEY]);
      const list = Array.isArray(obj[PRESET_KEY]) ? obj[PRESET_KEY] : [];
      const last = typeof obj[LAST_PRESET_KEY] === 'string' ? obj[LAST_PRESET_KEY] : '';
      return { list, last };
    } catch (_) {
      return { list: [], last: '' };
    }
  }
  async function savePresets(list) {
    try {
      await chrome.storage.local.set({ [PRESET_KEY]: list });
      return true;
    } catch (_) {
      return false;
    }
  }
  async function saveLastPreset(value) {
    try {
      await chrome.storage.local.set({ [LAST_PRESET_KEY]: value || '' });
      return true;
    } catch (_) {
      return false;
    }
  }

  let presets = [];
  let lastUsedPreset = '';
  function renderPresets() {
    folderPreset.innerHTML = '';
    const none = document.createElement('option');
    none.value = '';
    none.textContent = '(선택된 프리셋 없음)';
    folderPreset.appendChild(none);
    for (const p of presets) {
      const opt = document.createElement('option');
      opt.value = p;
      opt.textContent = p;
      folderPreset.appendChild(opt);
    }
    // Apply last used selection
    folderPreset.value = presets.includes(lastUsedPreset) ? lastUsedPreset : '';
  }

  // Initialize presets and last used
  (async () => {
    const { list, last } = await loadPresets();
    presets = list;
    lastUsedPreset = last || '';
    renderPresets();
    // Apply effects of last used selection
    if (lastUsedPreset) {
      saveInFolder.checked = true;
      updateFolderEnabled();
      folderName.value = lastUsedPreset;
    } else {
      saveDirect.checked = true;
      updateFolderEnabled();
    }
  })();

  // Preset interactions
  folderPreset.addEventListener('change', () => {
    const chosen = folderPreset.value;
    if (chosen) {
      saveInFolder.checked = true;
      updateFolderEnabled();
      folderName.value = chosen;
    }
    // Persist last used (including none)
    lastUsedPreset = chosen || '';
    saveLastPreset(lastUsedPreset);
  });
  addFolderBtn.addEventListener('click', async () => {
    const name = sanitizeFolderName(folderName.value || '');
    if (!name) {
      setStatus('유효한 폴더명을 입력하세요.');
      return;
    }
    if (presets.includes(name)) {
      setStatus('이미 존재하는 프리셋입니다.');
      folderPreset.value = name;
      lastUsedPreset = name;
      saveLastPreset(lastUsedPreset);
      return;
    }
    presets.push(name);
    presets.sort((a,b)=>a.localeCompare(b));
    await savePresets(presets);
    renderPresets();
    folderPreset.value = name;
    lastUsedPreset = name;
    await saveLastPreset(lastUsedPreset);
    setStatus('프리셋이 추가되었습니다.');
  });
  deleteFolderBtn.addEventListener('click', async () => {
    const name = folderPreset.value;
    if (!name) {
      setStatus('삭제할 프리셋을 선택하세요.');
      return;
    }
    presets = presets.filter(p => p !== name);
    await savePresets(presets);
    renderPresets();
    if (lastUsedPreset === name) {
      lastUsedPreset = '';
      await saveLastPreset('');
    }
    setStatus('프리셋이 삭제되었습니다.');
  });

  function updateCounts() {
    counts.textContent = collected.length
      ? `찾은 이미지: ${collected.length} / 선택: ${selected.size}`
      : '';
    // Enable download only when there is at least one selection
    downloadBtn.disabled = selected.size === 0;
  }

  function renderGrid() {
    grid.innerHTML = '';
    // Re-append marquee overlay
    if (marquee) grid.appendChild(marquee);
    for (let i = 0; i < collected.length; i += 1) {
      const url = collected[i];
      const item = document.createElement('div');
      item.className = 'item';
      item.setAttribute('role', 'button');
      item.setAttribute('tabindex', '0');
      if (selected.has(i)) item.classList.add('selected');
      item.setAttribute('aria-pressed', selected.has(i) ? 'true' : 'false');
      item.addEventListener('click', (e) => {
        // Range selection with Shift
        if (e.shiftKey && lastClickedIndex != null) {
          const start = Math.min(lastClickedIndex, i);
          const end = Math.max(lastClickedIndex, i);
          const shouldSelect = !selected.has(i);
          for (let k = start; k <= end; k += 1) {
            if (shouldSelect) selected.add(k);
            else selected.delete(k);
          }
          renderGrid();
          lastClickedIndex = i;
          return;
        }
        // Toggle single
        if (selected.has(i)) {
          selected.delete(i);
          item.classList.remove('selected');
        } else {
          selected.add(i);
          item.classList.add('selected');
        }
        lastClickedIndex = i;
        item.setAttribute('aria-pressed', selected.has(i) ? 'true' : 'false');
        updateCounts();
      });
      item.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          item.click();
        }
      });

      const img = document.createElement('img');
      img.src = url;
      img.alt = `image-${i+1}`;
      img.loading = 'lazy';

      const mark = document.createElement('span');
      mark.className = 'mark';
      mark.textContent = '선택됨';

      const badge = document.createElement('span');
      badge.className = 'badge';
      badge.textContent = `${i + 1}`;

      item.appendChild(img);
      item.appendChild(mark);
      item.appendChild(badge);
      grid.appendChild(item);
    }
    updateCounts();
  }

  async function autoLoadImages() {
    setStatus('이미지 수집 중...');
    const tabId = await getTargetTabId();
    if (!tabId) {
      setStatus('활성 탭을 찾지 못했습니다.');
      return;
    }
    try {
      // Ensure content script is injected (dynamic injection for privacy/perf)
      try {
        await chrome.scripting.executeScript({
          target: { tabId: tabId, allFrames: true },
          files: ['content.js']
        });
      } catch (injErr) {
        // ignore if already injected or if blocked on special pages
      }
      const res = await chrome.tabs.sendMessage(tabId, {
        type: 'COLLECT_IMAGES',
        payload: { includeBackground: true }
      });
      collected = (res && res.urls) || [];
      selected = new Set(); // start with none selected
      renderGrid();

      const hasAny = collected.length > 0;
      downloadBtn.disabled = true; // until some selected
      selectAllBtn.disabled = !hasAny;
      selectNoneBtn.disabled = !hasAny;
      invertSelectBtn.disabled = !hasAny;
      if (!hasAny) {
        setStatus('표시할 이미지를 찾지 못했습니다.');
      } else {
        const skippedBlobCount = (res && res.skippedBlobCount) || 0;
        setStatus(`미리보기 완료. ${skippedBlobCount ? `blob ${skippedBlobCount}개 제외됨.` : ''}`);
      }
    } catch (e) {
      setStatus('확장 권한 또는 콘텐츠 스크립트 통신 오류');
    }
  }

  selectAllBtn.addEventListener('click', () => {
    selected = new Set(collected.map((_, idx) => idx));
    renderGrid();
  });
  selectNoneBtn.addEventListener('click', () => {
    selected = new Set();
    renderGrid();
  });
  invertSelectBtn.addEventListener('click', () => {
    const next = new Set();
    for (let i = 0; i < collected.length; i += 1) {
      if (!selected.has(i)) next.add(i);
    }
    selected = next;
    renderGrid();
  });

  downloadBtn.addEventListener('click', async () => {
    if (!selected.size) {
      setStatus('선택된 이미지가 없습니다.');
      return;
    }
    const baseName = (baseInput.value || '파일').trim();
    const subfolder = saveInFolder.checked ? sanitizeFolderName(folderName.value || '') : '';
    const urls = collected.filter((_, idx) => selected.has(idx));
    setStatus(`선택한 ${urls.length}개 다운로드 시작...`);
    try {
      const reply = await chrome.runtime.sendMessage({
        type: 'DOWNLOAD_IMAGES',
        payload: { urls, baseName, subfolder }
      });
      if (reply && reply.ok) {
        setStatus(`총 ${reply.count}개 다운로드 중... 완료까지 잠시만 기다려주세요.`);
        // Auto-close the window after triggering downloads
        setTimeout(() => { try { window.close(); } catch (_) {} }, 200);
      } else {
        setStatus('다운로드 요청에 실패했습니다.');
      }
    } catch (e) {
      setStatus('백그라운드 통신 오류');
    }
    if (saveInFolder.checked && !subfolder) {
      setStatus('폴더명이 비어 있어 루트(다운로드) 폴더에 저장합니다.');
    }
  });

  // Auto-load on open
  autoLoadImages();
  retryBtn.addEventListener('click', autoLoadImages);

  // Open big centered window (modal-like)
  if (openBigBtn) {
    openBigBtn.addEventListener('click', async () => {
      const width = 1100;
      const height = 820;
      try {
        // capture current page tab id to pass into modal
        const sourceTabId = await getTargetTabId();
        const win = await chrome.windows.getCurrent();
        const left = Math.max(0, Math.floor((win.left || 0) + ((win.width || width) - width) / 2));
        const top = Math.max(0, Math.floor((win.top || 0) + ((win.height || height) - height) / 2));
        await chrome.windows.create({
          url: chrome.runtime.getURL('modal.html') + (sourceTabId ? `?tabId=${sourceTabId}` : ''),
          type: 'popup',
          width,
          height,
          left,
          top
        });
      } catch (_) {
        const sourceTabId = await getTargetTabId();
        await chrome.windows.create({ url: chrome.runtime.getURL('modal.html') + (sourceTabId ? `?tabId=${sourceTabId}` : ''), type: 'popup', width: 1100, height: 820 });
      }
    });
  }

  // Drag selection (marquee) over grid
  let isDragging = false;
  let dragStart = null;
  let baselineSelected = null;
  let dragMode = 'select'; // or 'deselect'
  let gridRect = null;
  let cachedItems = null;
  let dragScrollY = 0;
  let rafScroll = null;

  function rectFromPoints(ax, ay, bx, by) {
    const x = Math.min(ax, bx);
    const y = Math.min(ay, by);
    const w = Math.abs(ax - bx);
    const h = Math.abs(ay - by);
    return { x, y, w, h };
  }

  function rectsIntersect(a, b) {
    return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
  }

  function getItemRects() {
    const nodes = Array.from(grid.querySelectorAll('.item'));
    const rects = nodes.map((el, idx) => {
      const r = el.getBoundingClientRect();
      return { idx, el, rect: { x: r.left - gridRect.left, y: r.top - gridRect.top, w: r.width, h: r.height } };
    });
    return rects;
  }

  function applyDragSelection(currentRect) {
    if (!baselineSelected) return;
    const items = cachedItems || getItemRects();
    const next = new Set(baselineSelected);
    for (const it of items) {
      const r = it.rect;
      if (rectsIntersect(currentRect, r)) {
        if (dragMode === 'select') next.add(it.idx);
        else next.delete(it.idx);
      }
    }
    selected = next;
    // Update classes
    items.forEach(it => {
      if (selected.has(it.idx)) it.el.classList.add('selected');
      else it.el.classList.remove('selected');
      it.el.setAttribute('aria-pressed', selected.has(it.idx) ? 'true' : 'false');
    });
    updateCounts();
  }

  grid.addEventListener('mousedown', (e) => {
    if (e.button !== 0) return; // only left
    // Determine mode by the initial target
    const itemEl = e.target.closest && e.target.closest('.item');
    if (itemEl) e.preventDefault(); // prevent image drag
    const allItems = Array.from(grid.querySelectorAll('.item'));
    const idx = itemEl ? allItems.indexOf(itemEl) : -1;
    dragMode = idx >= 0 && selected.has(idx) ? 'deselect' : 'select';
    isDragging = true;
    baselineSelected = new Set(selected);
    gridRect = grid.getBoundingClientRect();
    cachedItems = getItemRects();
    const startX = e.clientX - gridRect.left;
    const startY = e.clientY - gridRect.top;
    dragStart = { x: startX, y: startY };
    if (marquee) {
      marquee.style.display = 'block';
      marquee.style.left = startX + 'px';
      marquee.style.top = startY + 'px';
      marquee.style.width = '0px';
      marquee.style.height = '0px';
    }
  });

  function ensureScrollLoop() {
    if (rafScroll) return;
    const step = () => {
      if (!isDragging) { rafScroll = null; return; }
      if (dragScrollY !== 0) {
        grid.scrollTop += dragScrollY;
        // grid moved; update baseline rect and cached rects
        gridRect = grid.getBoundingClientRect();
        cachedItems = getItemRects();
      }
      rafScroll = requestAnimationFrame(step);
    };
    rafScroll = requestAnimationFrame(step);
  }

  window.addEventListener('mousemove', (e) => {
    if (!isDragging || !dragStart) return;
    // Modifier overrides
    if (e.altKey) dragMode = 'deselect';
    else if (e.shiftKey) dragMode = 'select';

    const x = e.clientX - gridRect.left;
    const y = e.clientY - gridRect.top;
    const rect = rectFromPoints(dragStart.x, dragStart.y, x, y);
    if (marquee) {
      marquee.style.display = 'block';
      marquee.style.left = rect.x + 'px';
      marquee.style.top = rect.y + 'px';
      marquee.style.width = rect.w + 'px';
      marquee.style.height = rect.h + 'px';
    }
    applyDragSelection(rect);

    // Autoscroll when near edges
    const EDGE = 30;
    dragScrollY = 0;
    if (y < EDGE) dragScrollY = -10;
    else if (y > gridRect.height - EDGE) dragScrollY = 10;
    if (dragScrollY !== 0) ensureScrollLoop();
  });

  function endDrag() {
    if (!isDragging) return;
    isDragging = false;
    dragStart = null;
    baselineSelected = null;
    if (marquee) marquee.style.display = 'none';
  }

  window.addEventListener('mouseup', endDrag);
  window.addEventListener('blur', endDrag);

  // Keyboard shortcuts
  window.addEventListener('keydown', (e) => {
    // Ignore when typing in inputs/selects
    const tag = (e.target && e.target.tagName) || '';
    if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
    const isAccel = e.ctrlKey || e.metaKey;
    if (isAccel && (e.key === 'a' || e.key === 'A')) {
      e.preventDefault();
      selected = new Set(collected.map((_, idx) => idx));
      renderGrid();
    } else if (isAccel && (e.key === 'i' || e.key === 'I')) {
      e.preventDefault();
      const next = new Set();
      for (let i = 0; i < collected.length; i += 1) {
        if (!selected.has(i)) next.add(i);
      }
      selected = next;
      renderGrid();
    } else if (e.key === 'Escape') {
      selected = new Set();
      renderGrid();
    }
  });
});
