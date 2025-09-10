async function getActiveTab() {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  return tabs[0];
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
  const downloadBtn = document.getElementById('downloadSelectedBtn');
  const selectAllBtn = document.getElementById('selectAllBtn');
  const selectNoneBtn = document.getElementById('selectNoneBtn');
  const counts = document.getElementById('counts');
  const grid = document.getElementById('grid');
  const saveDirect = document.getElementById('saveDirect');
  const saveInFolder = document.getElementById('saveInFolder');
  const folderName = document.getElementById('folderName');
  const folderPreset = document.getElementById('folderPreset');
  const addFolderBtn = document.getElementById('addFolderBtn');
  const deleteFolderBtn = document.getElementById('deleteFolderBtn');

  // state
  let collected = [];
  let selected = new Set();

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
  async function loadPresets() {
    try {
      const obj = await chrome.storage.local.get(PRESET_KEY);
      return Array.isArray(obj[PRESET_KEY]) ? obj[PRESET_KEY] : [];
    } catch (_) {
      return [];
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

  let presets = [];
  function renderPresets() {
    const cur = folderPreset.value;
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
    // try keep selection
    folderPreset.value = presets.includes(cur) ? cur : '';
  }

  // Initialize presets
  (async () => {
    presets = await loadPresets();
    renderPresets();
  })();

  // Preset interactions
  folderPreset.addEventListener('change', () => {
    const chosen = folderPreset.value;
    if (chosen) {
      saveInFolder.checked = true;
      updateFolderEnabled();
      folderName.value = chosen;
    }
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
      return;
    }
    presets.push(name);
    presets.sort((a,b)=>a.localeCompare(b));
    await savePresets(presets);
    renderPresets();
    folderPreset.value = name;
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
    for (let i = 0; i < collected.length; i += 1) {
      const url = collected[i];
      const item = document.createElement('div');
      item.className = 'item';
      if (selected.has(i)) item.classList.add('selected');
      item.addEventListener('click', () => {
        if (selected.has(i)) {
          selected.delete(i);
          item.classList.remove('selected');
        } else {
          selected.add(i);
          item.classList.add('selected');
        }
        updateCounts();
      });

      const img = document.createElement('img');
      img.src = url;
      img.alt = `image-${i+1}`;

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
    const tab = await getActiveTab();
    if (!tab || !tab.id) {
      setStatus('활성 탭을 찾지 못했습니다.');
      return;
    }
    try {
      const res = await chrome.tabs.sendMessage(tab.id, {
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

  downloadBtn.addEventListener('click', async () => {
    if (!selected.size) {
      setStatus('선택된 이미지가 없습니다.');
      return;
    }
    const baseName = (baseInput.value || '파일').trim();
    const subfolder = saveInFolder.checked ? (folderName.value || baseName).trim() : '';
    const urls = collected.filter((_, idx) => selected.has(idx));
    setStatus(`선택한 ${urls.length}개 다운로드 시작...`);
    try {
      const reply = await chrome.runtime.sendMessage({
        type: 'DOWNLOAD_IMAGES',
        payload: { urls, baseName, subfolder }
      });
      if (reply && reply.ok) {
        setStatus(`총 ${reply.count}개 다운로드 중... 완료까지 잠시만 기다려주세요.`);
      } else {
        setStatus('다운로드 요청에 실패했습니다.');
      }
    } catch (e) {
      setStatus('백그라운드 통신 오류');
    }
  });

  // Auto-load on open
  autoLoadImages();
});
