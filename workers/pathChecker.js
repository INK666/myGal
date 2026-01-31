const { parentPort, workerData } = require('worker_threads');
const fs = require('fs').promises;

/**
 * Worker 线程：批量检查文件路径是否存在
 * 不阻塞主进程，支持进度报告
 */

const checkPathExists = async (path) => {
  try {
    await fs.access(path);
    return true;
  } catch {
    return false;
  }
};

const checkPathsBatch = async (paths, batchSize = 50) => {
  const results = new Map();
  const total = paths.length;
  let processed = 0;

  for (let i = 0; i < paths.length; i += batchSize) {
    const batch = paths.slice(i, i + batchSize);
    const batchResults = await Promise.all(
      batch.map(async (path) => ({
        path,
        exists: await checkPathExists(path)
      }))
    );

    batchResults.forEach(({ path, exists }) => {
      results.set(path, exists);
    });

    processed += batch.length;

    // 发送进度更新
    parentPort.postMessage({
      type: 'progress',
      processed,
      total
    });
  }

  return results;
};

// 执行检查
(async () => {
  try {
    const { paths } = workerData;
    const results = await checkPathsBatch(paths);

    // 转换 Map 为普通对象以便传输
    const resultsObj = {};
    results.forEach((exists, path) => {
      resultsObj[path] = exists;
    });

    // 发送最终结果
    parentPort.postMessage({
      type: 'complete',
      results: resultsObj
    });
  } catch (error) {
    parentPort.postMessage({
      type: 'error',
      error: error.message
    });
  }
})();
