// Content script: collect image URLs from the page in DOM order

function absoluteUrl(u) {
  try {
    if (!u) return null;
    if (u.startsWith("data:")) return u;
    if (u.startsWith("blob:")) return null; // cannot be downloaded reliably via downloads API
    return new URL(u, location.href).toString();
  } catch (_) {
    return null;
  }
}

function extractFromImgTags() {
  const imgs = Array.from(document.querySelectorAll('img'));
  const urls = [];
  let blobCount = 0;
  for (const img of imgs) {
    const rawCandidates = [img.currentSrc, img.src, img.getAttribute('src')].filter(Boolean);
    let picked = null;
    let sawBlob = false;
    for (const raw of rawCandidates) {
      if (typeof raw === 'string' && raw.startsWith('blob:')) {
        sawBlob = true;
        continue;
      }
      const abs = absoluteUrl(raw);
      if (abs) { picked = abs; break; }
    }
    if (picked) urls.push(picked);
    else if (sawBlob) blobCount += 1; // only count when blob prevented inclusion
  }
  return { urls, blobCount };
}

function isVisible(el) {
  const rect = el.getBoundingClientRect();
  const area = Math.max(0, rect.width) * Math.max(0, rect.height);
  const style = getComputedStyle(el);
  return (
    area > 400 && // ~20x20 이상만
    style.visibility !== 'hidden' &&
    style.display !== 'none'
  );
}

function extractBackgroundImages() {
  const urls = [];
  let blobCount = 0;
  const all = Array.from(document.querySelectorAll('*'));
  const MAX_SCAN = 5000;
  let scanned = 0;
  for (const el of all) {
    if (scanned >= MAX_SCAN) break;
    scanned++;
    if (!isVisible(el)) continue;
    const style = getComputedStyle(el);
    const bg = style.backgroundImage;
    if (!bg || bg === 'none') continue;
    // Handles multiple backgrounds: url("a"), linear-gradient(...), url('b')
    const matches = bg.match(/url\((?:"([^"]*)"|'([^']*)'|([^\)]*))\)/g);
    if (!matches) continue;
    for (const m of matches) {
      const inner = m.replace(/^url\((.*)\)$/i, '$1').trim().replace(/^"|"$|^'|'$/g, '');
      if (inner.startsWith('blob:')) { blobCount += 1; continue; }
      const abs = absoluteUrl(inner);
      if (abs) urls.push(abs);
    }
  }
  return { urls, blobCount };
}

function uniqueStable(arr) {
  const seen = new Set();
  const out = [];
  for (const u of arr) {
    if (!seen.has(u)) {
      seen.add(u);
      out.push(u);
    }
  }
  return out;
}

function collectImages(options = { includeBackground: false }) {
  const { urls: imgUrls, blobCount: imgBlobs } = extractFromImgTags();
  let bgUrls = [];
  let bgBlobs = 0;
  if (options.includeBackground) {
    const bg = extractBackgroundImages();
    bgUrls = bg.urls;
    bgBlobs = bg.blobCount;
  }
  const combined = [...imgUrls, ...bgUrls];
  const urls = uniqueStable(combined);
  const skippedBlobCount = imgBlobs + bgBlobs;
  return { urls, skippedBlobCount };
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg && msg.type === 'COLLECT_IMAGES') {
    const { includeBackground } = msg.payload || {};
    const { urls, skippedBlobCount } = collectImages({ includeBackground: !!includeBackground });
    sendResponse({ urls, skippedBlobCount });
    return true;
  }
  return false;
});
