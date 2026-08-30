const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const rootDir = path.resolve(__dirname, '..');
const androidAppDir = path.join(rootDir, 'android-app');
const androidGradleDir = path.join(androidAppDir, 'android');
const releaseOutputDir = path.join(rootDir, 'release');

// 读取版本号
let version = '1.0.0';
try {
  const rootPkg = JSON.parse(fs.readFileSync(path.join(rootDir, 'package.json'), 'utf8'));
  version = rootPkg.version || version;
} catch {}

const args = process.argv.slice(2);
const onlyPc = args.includes('--pc');
const onlyAndroid = args.includes('--android');
const shouldOpen = args.includes('--open');

const buildPc = !onlyAndroid;
const buildAndroid = !onlyPc;

const isWindows = process.platform === 'win32';

function log(title, text = '') {
  console.log(`\x1b[36m[myGal Build]\x1b[0m \x1b[1m${title}\x1b[0m ${text}`);
}

function logSuccess(text) {
  console.log(`\x1b[32m✔ ${text}\x1b[0m`);
}

function logError(text) {
  console.error(`\x1b[31m✖ ${text}\x1b[0m`);
}

function formatBytes(bytes) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

function runCmd(command, cmdArgs, cwd, label = '') {
  return new Promise((resolve, reject) => {
    if (label) log(`正在执行: ${label}...`);
    const proc = spawn(command, cmdArgs, {
      cwd,
      shell: true,
      stdio: 'inherit',
      env: { ...process.env }
    });

    proc.on('close', (code) => {
      if (code === 0) {
        if (label) logSuccess(`${label} 完成`);
        resolve();
      } else {
        const err = new Error(`${label || command} 执行失败，退出码: ${code}`);
        logError(err.message);
        reject(err);
      }
    });

    proc.on('error', (err) => {
      logError(`${label || command} 出现异常: ${err.message}`);
      reject(err);
    });
  });
}

async function main() {
  const startTime = Date.now();
  console.log('\n========================================');
  console.log(` 🚀 myGal 一键打包构建工具 (v${version}) `);
  console.log('========================================\n');

  if (!fs.existsSync(releaseOutputDir)) {
    fs.mkdirSync(releaseOutputDir, { recursive: true });
  }

  const generatedFiles = [];

  try {
    // ----------------------------------------------------
    // 1. 构建 Android 移动端
    // ----------------------------------------------------
    if (buildAndroid) {
      console.log('\n----------------------------------------');
      log('📱 开始构建 Android 移动端...');
      console.log('----------------------------------------\n');

      // 1.1 生成/同步 Android 图标
      const genIconScript = path.join(rootDir, 'scripts', 'generate-android-icons.js');
      if (fs.existsSync(genIconScript)) {
        await runCmd('node', [genIconScript], rootDir, '生成 Android 图标');
      }

      // 1.2 构建移动端 Vite 前端
      await runCmd('npm', ['run', 'build'], androidAppDir, '构建移动端 Web 资源 (Vite)');

      // 1.3 同步 Capacitor Android 工程
      await runCmd('npx', ['cap', 'sync', 'android'], androidAppDir, '同步 Capacitor Android 资产');

      // 1.4 Gradle 打包 APK
      const gradlewCmd = isWindows ? 'gradlew.bat' : './gradlew';
      await runCmd(gradlewCmd, ['assembleRelease'], androidGradleDir, '编译 Android Release APK');

      // 1.5 复制 APK 到 release 目录
      const sourceApk = path.join(androidGradleDir, 'app', 'build', 'outputs', 'apk', 'release', 'app-release.apk');
      const targetApkName = `myGal-Mobile-${version}.apk`;
      const targetApkPath = path.join(releaseOutputDir, targetApkName);

      if (fs.existsSync(sourceApk)) {
        fs.copyFileSync(sourceApk, targetApkPath);
        const stats = fs.statSync(targetApkPath);
        generatedFiles.push({
          platform: 'Android 移动端',
          name: targetApkName,
          path: targetApkPath,
          size: formatBytes(stats.size)
        });
        logSuccess(`Android APK 已输出至: ${targetApkPath} (${formatBytes(stats.size)})`);
      } else {
        logError(`未找到编译好的 APK 文件: ${sourceApk}`);
      }
    }

    // ----------------------------------------------------
    // 2. 构建 PC 端 (Windows Electron)
    // ----------------------------------------------------
    if (buildPc) {
      console.log('\n----------------------------------------');
      log('💻 开始构建 PC 客户端 (Windows)...');
      console.log('----------------------------------------\n');

      // 2.1 生成 PC 图标
      const genPcIconScript = path.join(rootDir, 'scripts', 'generate-icon.js');
      if (fs.existsSync(genPcIconScript)) {
        await runCmd('node', [genPcIconScript], rootDir, '生成 PC 应用图标');
      }

      // 2.2 构建 PC Vite 前端
      await runCmd('npm', ['run', 'build:vite'], rootDir, '构建 PC 端 Web 资源 (Vite)');

      // 2.3 Electron-builder 打包 EXE 安装包
      await runCmd('npx', ['electron-builder'], rootDir, '打包 PC 端 Electron 安装程序');

      const expectedExe = path.join(releaseOutputDir, `myGal Setup ${version}.exe`);
      if (fs.existsSync(expectedExe)) {
        const stats = fs.statSync(expectedExe);
        generatedFiles.push({
          platform: 'PC 桌面端',
          name: `myGal Setup ${version}.exe`,
          path: expectedExe,
          size: formatBytes(stats.size)
        });
      }
    }

    // ----------------------------------------------------
    // 构建成功汇总
    // ----------------------------------------------------
    const elapsedSeconds = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log('\n========================================');
    console.log(' 🎉 打包全部完成！构建成果如下：');
    console.log('========================================');
    generatedFiles.forEach((f) => {
      console.log(` ▶ [${f.platform}] ${f.name} (${f.size})`);
      console.log(`   路径: ${f.path}`);
    });
    console.log(`\n ⏱ 总耗时: ${elapsedSeconds} 秒`);
    console.log(` 📂 输出目录: ${releaseOutputDir}`);
    console.log('========================================\n');

    if (shouldOpen || process.env.AUTO_OPEN_RELEASE === '1') {
      const openCmd = isWindows ? 'explorer' : 'open';
      spawn(openCmd, [releaseOutputDir], { detached: true });
    }
  } catch (err) {
    console.error('\n\x1b[31m[myGal Build] 打包过程中出现错误，构建中止。\x1b[0m\n', err);
    process.exit(1);
  }
}

main();
