// content.js — 注入 YouTube 頁面擷取影片資料
(async () => {
  try {
    const videoData = await extractVideoData();
    chrome.runtime.sendMessage({
      type: 'VIDEO_DATA',
      data: videoData
    });
  } catch (err) {
    chrome.runtime.sendMessage({
      type: 'VIDEO_DATA_ERROR',
      error: err.message
    });
  }
})();

function extractVideoData() {
  return new Promise((resolve, reject) => {
    // 從 URL 擷取 videoId
    const urlParams = new URLSearchParams(window.location.search);
    const videoId = urlParams.get('v');
    if (!videoId) {
      reject(new Error('無法取得影片 ID'));
      return;
    }

    // 清理 URL：只保留 watch?v={videoId}
    const cleanUrl = `https://www.youtube.com/watch?v=${videoId}`;

    // 嘗試立即擷取，如果失敗則用 MutationObserver 等待
    const immediateResult = tryExtract();
    if (immediateResult) {
      resolve({ ...immediateResult, videoId, url: cleanUrl });
      return;
    }

    // 用 MutationObserver 等待 DOM 元素出現
    let resolved = false;
    const timeout = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        observer.disconnect();
        // 超時仍嘗試用 document.title 作為 fallback
        const fallbackTitle = document.title.replace(/ - YouTube$/, '').trim();
        if (fallbackTitle) {
          resolve({
            videoId,
            title: fallbackTitle,
            duration: '--:--',
            url: cleanUrl
          });
        } else {
          reject(new Error('擷取超時'));
        }
      }
    }, 5000);

    const observer = new MutationObserver(() => {
      if (resolved) return;
      const result = tryExtract();
      if (result) {
        resolved = true;
        observer.disconnect();
        clearTimeout(timeout);
        resolve({ ...result, videoId, url: cleanUrl });
      }
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true
    });
  });
}

function tryExtract() {
  // 擷取標題
  const titleEl = document.querySelector('h1.ytd-watch-metadata yt-formatted-string');
  const title = titleEl?.textContent?.trim();
  if (!title) return null;

  // 擷取時長
  const durationEl = document.querySelector('.ytp-time-duration');
  let duration = durationEl?.textContent?.trim() || '';

  // 直播判斷：時長元素不存在或為 "0:00"
  if (!duration || duration === '0:00') {
    duration = '直播';
  }

  return { title, duration };
}
