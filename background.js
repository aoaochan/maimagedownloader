// Background service worker for sequential image downloads

// Utility: derive file extension from URL or data URL
function getExtension(url) {
  try {
    if (!url) return ".jpg";
    if (url.startsWith("data:")) {
      const match = url.match(/^data:([^;,]+)/i);
      if (match && match[1]) {
        const mime = match[1].toLowerCase();
        if (mime.includes("jpeg")) return ".jpg";
        if (mime.includes("png")) return ".png";
        if (mime.includes("gif")) return ".gif";
        if (mime.includes("webp")) return ".webp";
        if (mime.includes("svg")) return ".svg";
        if (mime.includes("bmp")) return ".bmp";
      }
      return ".jpg";
    }
    const u = new URL(url, "https://example.com");
    const pathname = u.pathname;
    const last = pathname.split("/").pop() || "";
    const dot = last.lastIndexOf(".");
    if (dot > -1 && dot < last.length - 1) {
      let ext = last.substring(dot).toLowerCase();
      // sanitize query-like extensions
      ext = ext.split(/[?#]/)[0];
      return ext.match(/^\.[a-z0-9]{1,5}$/) ? ext : ".jpg";
    }
    return ".jpg";
  } catch (e) {
    return ".jpg";
  }
}

function sanitizeBaseName(name) {
  const trimmed = (name || "파일").toString().trim();
  const safe = trimmed.replace(/[\\/:*?"<>|]/g, "-");
  return safe || "파일";
}

function sanitizeFolderName(name) {
  const trimmed = (name || "").toString().trim();
  if (!trimmed) return "";
  // Remove path separators and invalid chars, collapse spaces
  let safe = trimmed
    .replace(/[\\/:*?"<>|]/g, "-")
    .replace(/\.\.+/g, ".")
    .replace(/\s+/g, " ")
    .replace(/^\.+|\.+$/g, "");
  // Prevent relative paths
  if (safe === "." || safe === "..") safe = "";
  // Limit length
  if (safe.length > 100) safe = safe.slice(0, 100);
  return safe;
}

// Helper: query current state of a download id
function queryDownloadState(id) {
  return new Promise((resolve) => {
    try {
      chrome.downloads.search({ id }, (results) => {
        if (chrome.runtime.lastError) return resolve(undefined);
        const item = results && results[0];
        resolve(item && item.state);
      });
    } catch (_) {
      resolve(undefined);
    }
  });
}

// Wait for a download to finish with race protection and timeout
function waitForDownload(id, timeoutMs = 60000) {
  return new Promise(async (resolve) => {
    // Initial quick check in case it already finished
    const initial = await queryDownloadState(id);
    if (initial === "complete" || initial === "interrupted") {
      return resolve(initial);
    }

    let settled = false;
    const listener = async (delta) => {
      if (delta.id !== id || !delta.state) return;
      const s = delta.state.current;
      if (s === "complete" || s === "interrupted") {
        if (!settled) {
          settled = true;
          try { chrome.downloads.onChanged.removeListener(listener); } catch (_) {}
          try { clearTimeout(timer); } catch (_) {}
          resolve(s);
        }
      }
    };
    chrome.downloads.onChanged.addListener(listener);

    const timer = setTimeout(async () => {
      if (settled) return;
      const now = await queryDownloadState(id);
      settled = true;
      try { chrome.downloads.onChanged.removeListener(listener); } catch (_) {}
      resolve(now || "timeout");
    }, timeoutMs);
  });
}

async function downloadSequential(urls, baseName = "파일", subfolder = "") {
  const safeBase = sanitizeBaseName(baseName);
  const safeFolder = sanitizeFolderName(subfolder);

  for (let i = 0; i < urls.length; i += 1) {
    const url = urls[i];
    const index = i + 1;
    const ext = getExtension(url);
    const filenameOnly = `${safeBase}-${index}${ext}`;
    const filename = safeFolder ? `${safeFolder}/${filenameOnly}` : filenameOnly;
    try {
      const id = await new Promise((resolve, reject) => {
        chrome.downloads.download(
          {
            url,
            filename,
            conflictAction: "uniquify",
            saveAs: false,
          },
          (downloadId) => {
            if (chrome.runtime.lastError || typeof downloadId !== "number") {
              reject(chrome.runtime.lastError || new Error("download failed"));
            } else {
              resolve(downloadId);
            }
          }
        );
      });
      const state = await waitForDownload(id);
      if (state === "timeout") {
        console.warn("Download timeout for", url);
      }
    } catch (err) {
      // Continue with next download on error
      console.warn("Download failed for", url, err);
    }
  }
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg && msg.type === "DOWNLOAD_IMAGES") {
    const { urls, baseName, subfolder } = msg.payload || {};
    if (Array.isArray(urls) && urls.length) {
      downloadSequential(urls, baseName, subfolder || "");
      sendResponse({ ok: true, count: urls.length });
    } else {
      sendResponse({ ok: false, error: "No URLs provided" });
    }
    // indicate async response allowed (though we already responded)
    return true;
  }
  return false;
});

// Always open big centered window when clicking the extension icon
chrome.action.onClicked.addListener(async (tab) => {
  try {
    const width = 1100;
    const height = 820;
    let left = undefined;
    let top = undefined;
    try {
      if (tab && tab.windowId != null) {
        const win = await chrome.windows.get(tab.windowId);
        if (win && typeof win.left === 'number' && typeof win.top === 'number' && typeof win.width === 'number' && typeof win.height === 'number') {
          left = Math.max(0, Math.floor((win.left || 0) + ((win.width || width) - width) / 2));
          top = Math.max(0, Math.floor((win.top || 0) + ((win.height || height) - height) / 2));
        }
      }
    } catch (_) {}
    await chrome.windows.create({
      url: chrome.runtime.getURL('modal.html') + (tab && tab.id ? `?tabId=${tab.id}` : ''),
      type: 'popup',
      width,
      height,
      left,
      top
    });
  } catch (e) {
    console.warn('Failed to open big window', e);
  }
});
