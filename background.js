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

async function downloadSequential(urls, baseName = "파일", subfolder = "") {
  const safeBase = sanitizeBaseName(baseName);
  const safeFolder = sanitizeFolderName(subfolder);

  // Helper to wait for a download to finish or fail
  function waitForDownload(id) {
    return new Promise((resolve) => {
      const listener = (delta) => {
        if (delta.id === id && delta.state && delta.state.current) {
          const s = delta.state.current;
          if (s === "complete" || s === "interrupted") {
            chrome.downloads.onChanged.removeListener(listener);
            resolve(s);
          }
        }
      };
      chrome.downloads.onChanged.addListener(listener);
    });
  }

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
      await waitForDownload(id);
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
