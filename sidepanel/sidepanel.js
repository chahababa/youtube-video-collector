// sidepanel.js — 側邊面板邏輯
const videoListEl = document.getElementById('video-list');
const footerEl = document.getElementById('footer');
const searchInput = document.getElementById('search-input');

let allVideos = [];

// 初始載入
init();

// 搜尋
searchInput.addEventListener('input', () => {
  const query = searchInput.value.trim().toLowerCase();
  if (!query) {
    render(allVideos);
    return;
  }
  const filtered = allVideos.filter(v => v.title.toLowerCase().includes(query));
  renderFiltered(filtered);
});

async function init() {
  allVideos = await StorageHelper.readAllVideos();
  render(allVideos);
}

function render(videos) {
  videoListEl.innerHTML = '';

  if (videos.length === 0) {
    videoListEl.innerHTML = '<div class="empty-state">還沒有收納任何影片喔</div>';
    footerEl.textContent = '共 0 部影片';
    return;
  }

  for (const video of videos) {
    videoListEl.appendChild(createVideoItem(video));
  }

  footerEl.textContent = `共 ${allVideos.length} 部影片`;
}

function createVideoItem(video) {
  const item = document.createElement('div');
  item.className = 'video-item';
  item.dataset.videoId = video.videoId;

  // 標題（截斷 80 字元）
  const displayTitle = video.title.length > 80
    ? video.title.slice(0, 80) + '...'
    : video.title;

  // 日期格式化
  const date = new Date(video.savedAt);
  const dateStr = `${date.getFullYear()}/${String(date.getMonth() + 1).padStart(2, '0')}/${String(date.getDate()).padStart(2, '0')}`;

  item.innerHTML = `
    <div class="video-info">
      <a class="video-title" title="${escapeHtml(video.title)}">${escapeHtml(displayTitle)}</a>
      <div class="video-meta">時長：${escapeHtml(video.duration)} ｜ 收納於：${dateStr}</div>
    </div>
    <button class="delete-btn" title="刪除">✕</button>
  `;

  // 點標題開新分頁
  item.querySelector('.video-title').addEventListener('click', () => {
    chrome.tabs.create({ url: video.url });
  });

  // 點 X 刪除
  item.querySelector('.delete-btn').addEventListener('click', async () => {
    await StorageHelper.deleteVideo(video.videoId);
    allVideos = allVideos.filter(v => v.videoId !== video.videoId);
    item.remove();
    if (allVideos.length === 0) {
      videoListEl.innerHTML = '<div class="empty-state">還沒有收納任何影片喔</div>';
    }
    footerEl.textContent = `共 ${allVideos.length} 部影片`;
  });

  return item;
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function renderFiltered(videos) {
  videoListEl.innerHTML = '';
  if (videos.length === 0) {
    videoListEl.innerHTML = '<div class="empty-state">找不到符合的影片</div>';
    footerEl.textContent = '搜尋結果：0 部影片';
    return;
  }
  for (const video of videos) {
    videoListEl.appendChild(createVideoItem(video));
  }
  footerEl.textContent = `搜尋結果：${videos.length} 部影片`;
}

// 監聽 Storage 變動，自動更新清單（收納操作後即時反映）
chrome.storage.onChanged.addListener(async (changes, areaName) => {
  if (areaName === 'sync' || areaName === 'local') {
    if (changes.meta) {
      allVideos = await StorageHelper.readAllVideos();
      render(allVideos);
    }
  }
});
