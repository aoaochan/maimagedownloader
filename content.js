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
  for (const img of imgs) {
    const candidates = [img.currentSrc, img.src, img.getAttribute('src')];
    for (const c of candidates) {
      const abs = absoluteUrl(c);
      if (abs) {
        urls.push(abs);
        break;
      }
    }
  }
  return urls;
}

function extractBackgroundImages() {
  const urls = [];
  const all = Array.from(document.querySelectorAll('*'));
  for (const el of all) {
    const style = getComputedStyle(el);
    const bg = style.backgroundImage;
    if (!bg || bg === 'none') continue;
    // Handles multiple backgrounds: url("a"), linear-gradient(...), url('b')
    const matches = bg.match(/url\((?:"([^"]*)"|'([^']*)'|([^\)]*))\)/g);
    if (!matches) continue;
    for (const m of matches) {
      const inner = m.replace(/^url\((.*)\)$/i, '$1').trim().replace(/^"|"$|^'|'$/g, '');
      const abs = absoluteUrl(inner);
      if (abs) urls.push(abs);
    }
  }
  return urls;
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
  const fromImgs = extractFromImgTags();
  const fromBg = options.includeBackground ? extractBackgroundImages() : [];
  const combined = [...fromImgs, ...fromBg];
  const urls = uniqueStable(combined);
  const skippedBlobCount = combined.filter((u) => u && u.startsWith('blob:')).length;
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

