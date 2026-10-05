"""校验 APK 里的前端资源确实是最新构建。

背景：gradle 常秒回 BUILD SUCCESSFUL / 大量 up-to-date，可能只重打包没换 assets，
所以不能凭返回码判断，必须开包核对文件名、大小、哈希，并确认新代码标记字符串在里面。

用法：
  python scripts/verify-apk-assets.py [apk路径] [额外要检查的标记字符串 ...]
"""
import hashlib
import os
import sys
import zipfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
APK_DEFAULT = os.path.join(
    ROOT, 'android-app', 'android', 'app', 'build', 'outputs', 'apk', 'debug', 'app-debug.apk'
)
SYNCED_DIR = os.path.join(ROOT, 'android-app', 'android', 'app', 'src', 'main', 'assets', 'public', 'assets')
DIST_DIR = os.path.join(ROOT, 'android-app', 'dist', 'assets')

# 本轮新增文案：出现在 bundle 里即说明改动真的进了包
DEFAULT_MARKERS = ['cv-auto-list', 'cv-auto-grid3', '继续滚动或点击加载更多', 'min-h-0', 'bg-slate-900/75']

argv = sys.argv[1:]
# 第一个参数只有以 .apk 结尾才当作 APK 路径，否则整串都视为标记字符串（更省事）
if argv and argv[0].lower().endswith('.apk'):
    apk_path, rest = argv[0], argv[1:]
else:
    apk_path, rest = APK_DEFAULT, argv
# 必须过滤空串：空标记会被当成有效参数，而 `b'' in data` 恒为真 → 静默假阳性
rest = [m for m in rest if m and m.strip()]
markers = rest or DEFAULT_MARKERS


def disk_bundles(directory):
    if not os.path.isdir(directory):
        return {}
    out = {}
    for name in os.listdir(directory):
        if name.startswith('index-') and name.endswith('.js'):
            full = os.path.join(directory, name)
            data = open(full, 'rb').read()
            out[name] = (len(data), hashlib.sha256(data).hexdigest()[:12])
    return out


def apk_bundles(path):
    out = {}
    with zipfile.ZipFile(path) as z:
        for n in z.namelist():
            if n.startswith('assets/public/assets/') and n.endswith('.js') and '/index-' in n:
                data = z.read(n)
                out[os.path.basename(n)] = (len(data), hashlib.sha256(data).hexdigest()[:12], data)
    return out


if not os.path.exists(apk_path):
    print('[x] APK 不存在: %s' % apk_path)
    sys.exit(1)

dist = disk_bundles(DIST_DIR)
synced = disk_bundles(SYNCED_DIR)
inside = apk_bundles(apk_path)

print('APK: %s  (%.2f MB, mtime=%s)' % (
    apk_path, os.path.getsize(apk_path) / 1048576,
    __import__('time').strftime('%H:%M:%S', __import__('time').localtime(os.path.getmtime(apk_path))),
))
print('  dist/assets  : %s' % (dist or '(空)'))
print('  cap 已同步到 : %s' % (synced or '(空)'))
print('  APK 包内     : %s' % ({k: v[:2] for k, v in inside.items()} or '(空)'))

ok = True
if not inside:
    print('[x] APK 内没有找到前端 bundle')
    ok = False
else:
    for name, (size, digest, data) in inside.items():
        if name not in dist:
            print('[x] 包内 %s 不在 dist 里（打进了旧资源？）' % name)
            ok = False
            continue
        if dist[name][1] != digest:
            print('[x] %s 哈希不一致: dist=%s 包内=%s' % (name, dist[name][1], digest))
            ok = False
            continue
        print('[v] %s 与 dist 完全一致 (size=%d, sha=%s)' % (name, size, digest))
    # 只包了一个 bundle 的情况：确认没有多余的旧 bundle 残留
    for name in inside:
        if name not in dist and name not in synced:
            print('[!] 包内多出 %s' % name)

for m in markers:
    hit = any(m.encode('utf-8') in data for (_, _, data) in inside.values())
    print('[%s] 标记字符串 %r' % ('v' if hit else 'x', m))
    if not hit:
        ok = False

print('\n结论: %s' % ('APK 资源是最新的' if ok else 'APK 资源有问题，需要排查'))
sys.exit(0 if ok else 1)
