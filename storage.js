// storage.js — 分片儲存模組
// 供 background.js (importScripts) 和 sidepanel (script tag) 共用

const StorageHelper = (() => {
  const CHUNK_SIZE = 30;
  const CAPACITY_WARNING_THRESHOLD = 280;

  // 偵測可用的 storage area
  let storageArea = chrome.storage.sync;

  function getStorage() {
    return storageArea;
  }

  function switchToLocal() {
    storageArea = chrome.storage.local;
  }

  // 讀取 meta 資訊
  async function getMeta() {
    const result = await getStorage().get('meta');
    return result.meta || { chunkCount: 0, totalVideos: 0 };
  }

  // 讀取所有影片
  async function readAllVideos() {
    const meta = await getMeta();
    if (meta.chunkCount === 0) return [];

    const keys = [];
    for (let i = 0; i < meta.chunkCount; i++) {
      keys.push(`savedVideos_${i}`);
    }

    const result = await getStorage().get(keys);
    let videos = [];
    for (let i = 0; i < meta.chunkCount; i++) {
      const chunk = result[`savedVideos_${i}`] || [];
      videos = videos.concat(chunk);
    }
    return videos;
  }

  // 將陣列切成 chunks
  function splitIntoChunks(arr, size) {
    const chunks = [];
    for (let i = 0; i < arr.length; i += size) {
      chunks.push(arr.slice(i, i + size));
    }
    return chunks;
  }

  // 寫入所有 chunks + meta（含清理舊 chunk）
  async function writeAllVideos(allVideos, oldChunkCount) {
    const chunks = allVideos.length > 0 ? splitIntoChunks(allVideos, CHUNK_SIZE) : [];
    const newChunkCount = chunks.length;

    const dataToSet = {
      meta: { chunkCount: newChunkCount, totalVideos: allVideos.length }
    };
    for (let i = 0; i < newChunkCount; i++) {
      dataToSet[`savedVideos_${i}`] = chunks[i];
    }

    // 清除多餘的舊 chunk key
    const keysToRemove = [];
    for (let i = newChunkCount; i < oldChunkCount; i++) {
      keysToRemove.push(`savedVideos_${i}`);
    }

    try {
      await getStorage().set(dataToSet);
      if (keysToRemove.length > 0) {
        await getStorage().remove(keysToRemove);
      }
    } catch (err) {
      // sync 寫入失敗，降級為 local
      if (storageArea === chrome.storage.sync) {
        console.warn('storage.sync 寫入失敗，降級為 storage.local', err);
        switchToLocal();
        await getStorage().set(dataToSet);
        if (keysToRemove.length > 0) {
          await getStorage().remove(keysToRemove);
        }
        return { fallbackToLocal: true };
      }
      throw err;
    }
    return { fallbackToLocal: false };
  }

  // 儲存單部影片
  async function saveVideo(newVideo) {
    const allVideos = await readAllVideos();
    const meta = await getMeta();

    // 重複檢查
    if (allVideos.find(v => v.videoId === newVideo.videoId)) {
      return { status: 'DUPLICATE' };
    }

    // 插入最前面（最新在上）
    allVideos.unshift(newVideo);
    const result = await writeAllVideos(allVideos, meta.chunkCount);

    return {
      status: 'SUCCESS',
      totalVideos: allVideos.length,
      fallbackToLocal: result.fallbackToLocal
    };
  }

  // 批次儲存多部影片
  async function saveVideos(newVideos) {
    const allVideos = await readAllVideos();
    const meta = await getMeta();

    let savedCount = 0;
    let duplicateCount = 0;

    for (const video of newVideos) {
      if (allVideos.find(v => v.videoId === video.videoId)) {
        duplicateCount++;
      } else {
        allVideos.unshift(video);
        savedCount++;
      }
    }

    if (savedCount > 0) {
      await writeAllVideos(allVideos, meta.chunkCount);
    }

    return {
      savedCount,
      duplicateCount,
      totalVideos: allVideos.length
    };
  }

  // 刪除影片
  async function deleteVideo(videoId) {
    const allVideos = await readAllVideos();
    const meta = await getMeta();
    const filtered = allVideos.filter(v => v.videoId !== videoId);

    if (filtered.length === allVideos.length) {
      return { status: 'NOT_FOUND' };
    }

    await writeAllVideos(filtered, meta.chunkCount);
    return { status: 'DELETED', totalVideos: filtered.length };
  }

  // 取得影片總數
  async function getVideoCount() {
    const meta = await getMeta();
    return meta.totalVideos;
  }

  return {
    readAllVideos,
    saveVideo,
    saveVideos,
    deleteVideo,
    getVideoCount,
    CAPACITY_WARNING_THRESHOLD
  };
})();

// 讓 Service Worker 的 importScripts 也能用
if (typeof self !== 'undefined' && typeof window === 'undefined') {
  // Service Worker 環境，StorageHelper 已在全域
}
