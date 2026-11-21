#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
生成更新分发目录 dist/。

做四件事：
  1. 从 AndroidManifest 读版本号（唯一真源，避免两处写死后对不上）
  2. 把 APK 复制成固定文件名 dist/yeren-quant.apk
  3. 生成 dist/update.js —— 客户端用 <script> 注入它，天然绕过 CORS
  4. 生成 dist/update.json —— 给人看，也给脚本用

为什么 APK 要进仓库而不是只放 Release：
  jsDelivr 会把仓库里的文件当 CDN 资源发。APK 只有 150KB，远低于 20MB 上限，
  于是国内可以直接从 jsDelivr 节点下载，不必碰 github.com。
  Release 仍然发一份，作为正式渠道和镜像全挂时的兜底。
"""
import hashlib
import io
import json
import os
import re
import shutil
import sys
from datetime import datetime, timezone, timedelta

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MANIFEST = os.path.join(ROOT, 'android', 'AndroidManifest.xml')
BUILD_APK = os.path.join(ROOT, 'build', 'yeren-quant-v1.0.apk')
DIST = os.path.join(ROOT, 'dist')
APK_NAME = 'yeren-quant.apk'
CHANGELOG = os.path.join(ROOT, 'CHANGELOG.md')
REPO = 'Hongred04/yeren-tide'


def read_version():
    s = io.open(MANIFEST, encoding='utf-8').read()
    code = re.search(r'android:versionCode="(\d+)"', s)
    name = re.search(r'android:versionName="([^"]+)"', s)
    if not code or not name:
        sys.exit('读不到 AndroidManifest 里的版本号')
    return int(code.group(1)), name.group(1)


def read_notes():
    """取 CHANGELOG 最上面那一节的所有 '-' 条目"""
    if not os.path.exists(CHANGELOG):
        return []
    s = io.open(CHANGELOG, encoding='utf-8').read().splitlines()
    notes, started = [], False
    for line in s:
        if line.startswith('## '):
            if started:
                break
            started = True
            continue
        if not started:
            continue
        t = line.strip()
        if t.startswith('- '):
            notes.append(t[2:].strip())
    return notes


def sha256_of(path):
    h = hashlib.sha256()
    with open(path, 'rb') as f:
        for chunk in iter(lambda: f.read(1 << 16), b''):
            h.update(chunk)
    return h.hexdigest()


def main():
    code, name = read_version()

    src = BUILD_APK
    if len(sys.argv) > 1 and not sys.argv[1].startswith('-'):
        src = sys.argv[1]
    if not os.path.exists(src):
        sys.exit('找不到 APK：%s（先跑 build_apk.sh）' % src)

    if not os.path.isdir(DIST):
        os.makedirs(DIST)

    dst = os.path.join(DIST, APK_NAME)
    shutil.copyfile(src, dst)

    size = os.path.getsize(dst)
    digest = sha256_of(dst)
    tz = timezone(timedelta(hours=8))
    released = datetime.now(tz).strftime('%Y-%m-%dT%H:%M:%S+08:00')

    meta = {
        'versionCode': code,
        'versionName': name,
        'size': size,
        'sha256': digest,
        'releasedAt': released,
        'apk': 'dist/' + APK_NAME,
        'page': 'https://github.com/%s/releases/latest' % REPO,
        'notes': read_notes(),
    }

    # JSON：给人看 / 给脚本用
    with io.open(os.path.join(DIST, 'update.json'), 'w', encoding='utf-8', newline='\n') as f:
        f.write(json.dumps(meta, ensure_ascii=False, indent=2) + '\n')

    # JS：给客户端注入用。前缀带注释，避免被当成纯数据文件
    body = json.dumps(meta, ensure_ascii=False, indent=2)
    with io.open(os.path.join(DIST, 'update.js'), 'w', encoding='utf-8', newline='\n') as f:
        f.write('/* 由 tools/make_dist.py 生成，请勿手改 */\n')
        f.write('window.YB_UPDATE = ' + body + ';\n')

    # 让网页预览也能显示正确版本（原生环境是从 PackageManager 读的，不依赖它）
    uj = os.path.join(ROOT, 'www', 'js', 'update.js')
    if os.path.exists(uj):
        s = io.open(uj, encoding='utf-8').read()
        new = re.sub(r"var FALLBACK = \{ code: \d+, name: '[^']*' \};",
                     "var FALLBACK = { code: %d, name: '%s' };" % (code, name), s)
        if new != s:
            io.open(uj, 'w', encoding='utf-8', newline='\n').write(new)

    print('✓ dist/ 已生成')
    print('  版本      v%s (%d)' % (name, code))
    print('  体积      %.0f KB' % (size / 1024.0))
    print('  sha256    %s' % digest[:32] + '…')
    print('  说明      %d 条' % len(meta['notes']))


if __name__ == '__main__':
    main()
