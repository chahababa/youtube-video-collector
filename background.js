// background.js — Service Worker 中樞控制器
importScripts('storage.js');

// 浮動提示注入函式（在指定分頁顯示提示訊息）
function showToast(tabId, message) {
  chrome.scripting.executeScript({
    target: { tabId },
    args: [message],
    func: (msg) => {
      // 移除已存在的提示
      const existing = document.getElementById('yt-collector-toast');
      if (existing) existing.remove();

      const toast = document.createElement('div');
      toast.id = 'yt-collector-toast';
      toast.textContent = msg;
      Object.assign(toast.style, {
        position: 'fixed',
        top: '20px',
        right: '20px',
        backgroundColor: '#323232',
        color: '#fff',
        padding: '12px 20px',
        borderRadius: '8px',
        fontSize: '14px',
        fontFamily: 'sans-serif',
        zIndex: '2147483647',
        boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
        maxWidth: '350px',
        wordBreak: 'break-word',
        transition: 'opacity 0.3s ease',
        opacity: '0'
      });

      document.body.appendChild(toast);
      // 淡入
      requestAnimationFrame(() => { toast.style.opacity = '1'; });
      // 3 秒後淡出並移除
      setTimeout(() => {
        toast.style.opacity = '0';
        setTimeout(() => toast.remove(), 300);
      }, 3000);
    }
  }).catch(err => {
    console.warn('無法在分頁顯示提示：', err);
  });
}

// 判斷分頁是否可注入腳本（排除 chrome://, edge://, about: 等受限頁面）
function isInjectableTab(tab) {
  const url = tab.url || '';
  return url.startsWith('http://') || url.startsWith('https://');
}

// 取得下一個活動分頁（用於收納成功後顯示提示）
async function getNextActiveTab(windowId) {
  const tabs = await chrome.tabs.query({ windowId, active: true });
  if (tabs.length > 0 && isInjectableTab(tabs[0])) return tabs[0];
  // fallback：找第一個可注入的分頁
  const allTabs = await chrome.tabs.query({ windowId });
  return allTabs.find(t => isInjectableTab(t)) || null;
}

// ====== 右鍵選單 ======
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: 'batch-save',
    title: '收納此視窗所有 YouTube 影片',
    contexts: ['action']
  });
  chrome.contextMenus.create({
    id: 'open-panel',
    title: '已收納的影片槽',
    contexts: ['action']
  });
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId === 'batch-save') {
    await handleBatchSave(tab);
  } else if (info.menuItemId === 'open-panel') {
    chrome.sidePanel.open({ windowId: tab.windowId });
  }
});

async function handleBatchSave(activeTab) {
  const windowId = activeTab.windowId;
  const allTabs = await chrome.tabs.query({ windowId });

  // 篩選 YouTube 影片分頁，排除活動分頁
  const ytTabs = allTabs.filter(t =>
    t.id !== activeTab.id &&
    t.url &&
    t.url.includes('youtube.com/watch')
  );

  if (ytTabs.length === 0) {
    if (isInjectableTab(activeTab)) {
      showToast(activeTab.id, '這個視窗沒有 YouTube 影片分頁');
    }
    return;
  }

  // 逐一注入 content script 擷取資料，用 Promise.allSettled 避免單一失敗中斷
  const extractResults = await Promise.allSettled(
    ytTabs.map(t => extractVideoFromTab(t))
  );

  // 收集成功擷取的影片
  const videosToSave = [];
  const successTabIds = [];

  for (let i = 0; i < extractResults.length; i++) {
    const result = extractResults[i];
    if (result.status === 'fulfilled' && result.value) {
      videosToSave.push({
        ...result.value,
        savedAt: Date.now()
      });
      successTabIds.push(ytTabs[i].id);
    }
  }

  if (videosToSave.length === 0) {
    if (isInjectableTab(activeTab)) {
      showToast(activeTab.id, '沒有成功擷取到任何影片資料');
    }
    return;
  }

  // 批次存入 Storage
  const saveResult = await StorageHelper.saveVideos(videosToSave);

  // 關閉已成功收納的分頁（重複的也關閉，因為已經在清單裡了）
  if (successTabIds.length > 0) {
    await chrome.tabs.remove(successTabIds);
  }

  // 組裝提示訊息
  let msg = `已收納 ${saveResult.savedCount} 部`;
  if (saveResult.duplicateCount > 0) {
    msg += `，跳過 ${saveResult.duplicateCount} 部重複`;
  }
  msg += '，已跳過你正在看的分頁';

  if (isInjectableTab(activeTab)) {
    showToast(activeTab.id, msg);

    // 滿載提醒
    if (saveResult.totalVideos >= StorageHelper.CAPACITY_WARNING_THRESHOLD) {
      setTimeout(() => {
        showToast(activeTab.id, `空間快滿了，目前有 ${saveResult.totalVideos} 部影片，建議去清理一下`);
      }, 3500);
    }
  }
}

// 從單一分頁擷取影片資料（用於批次收納）
function extractVideoFromTab(tab) {
  return new Promise(async (resolve) => {
    batchProcessingTabIds.add(tab.id);

    const cleanup = () => {
      batchProcessingTabIds.delete(tab.id);
      chrome.runtime.onMessage.removeListener(listener);
      clearTimeout(timeout);
    };

    const timeout = setTimeout(() => { cleanup(); resolve(null); }, 8000);

    const listener = (message, sender) => {
      if (sender.tab?.id !== tab.id) return;
      if (message.type === 'VIDEO_DATA') {
        cleanup();
        resolve(message.data);
      } else if (message.type === 'VIDEO_DATA_ERROR') {
        cleanup();
        resolve(null);
      }
    };
    chrome.runtime.onMessage.addListener(listener);

    try {
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: ['content.js']
      });
    } catch (err) {
      cleanup();
      resolve(null);
    }
  });
}

// ====== 左鍵點擊外掛圖示 ======
chrome.action.onClicked.addListener(async (tab) => {
  // 檢查是否為 YouTube 影片頁面
  const url = tab.url || '';

  if (!url.includes('youtube.com')) {
    if (isInjectableTab(tab)) {
      showToast(tab.id, '目前不在影片頁面');
    }
    return;
  }

  // Shorts 頁面
  if (url.includes('youtube.com/shorts/')) {
    showToast(tab.id, '目前不支援短影片收納');
    return;
  }

  // 非 /watch 頁面
  if (!url.includes('youtube.com/watch')) {
    showToast(tab.id, '目前不在影片頁面');
    return;
  }

  // 注入 content script 擷取影片資料
  try {
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ['content.js']
    });
  } catch (err) {
    console.error('注入 content script 失敗：', err);
    showToast(tab.id, '影片資訊載入中，請稍後再試');
  }
});

// 記錄正在批次處理的分頁 ID，避免全域監聽重複處理
const batchProcessingTabIds = new Set();

// ====== 接收 Content Script 回傳的資料 ======
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // 批次處理中的分頁由 extractVideoFromTab 的個別監聽處理
  if (sender.tab && batchProcessingTabIds.has(sender.tab.id)) return;

  if (message.type === 'VIDEO_DATA') {
    handleVideoData(message.data, sender.tab);
  } else if (message.type === 'VIDEO_DATA_ERROR') {
    if (sender.tab) {
      showToast(sender.tab.id, '影片資訊載入中，請稍後再試');
    }
  }
});

async function handleVideoData(videoData, tab) {
  const video = {
    videoId: videoData.videoId,
    title: videoData.title,
    duration: videoData.duration,
    url: videoData.url,
    savedAt: Date.now()
  };

  const result = await StorageHelper.saveVideo(video);

  if (result.status === 'DUPLICATE') {
    showToast(tab.id, '這部已經在清單裡了');
    return;
  }

  if (result.status === 'SUCCESS') {
    const windowId = tab.windowId;
    const tabId = tab.id;

    // 先在當前分頁顯示確認提示，讓使用者知道已收納成功
    let msg = `已收納：${video.title}`;
    if (result.fallbackToLocal) {
      msg += '\n（目前存在本機，登入 Chrome 後會自動同步）';
    }
    showToast(tabId, msg);

    // 等 1.5 秒讓使用者看到提示，再關閉分頁
    await new Promise(resolve => setTimeout(resolve, 1500));
    await chrome.tabs.remove(tabId);

    // 滿載提醒：顯示在下一個活動分頁
    if (result.totalVideos >= StorageHelper.CAPACITY_WARNING_THRESHOLD) {
      const nextTab = await getNextActiveTab(windowId);
      if (nextTab) {
        showToast(nextTab.id, `空間快滿了，目前有 ${result.totalVideos} 部影片，建議去清理一下`);
      }
    }
  }
}
