#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
野人量化 · APK 组包

为什么不用 aapt2 -A / aapt add：
  在 Windows 上，aapt2 link -A 会把 assets 的条目名写成反斜杠
  （ assets/www\\js\\app.js ），而 Android 的 AssetManager 只认正斜杠，
  结果是 file:///android_asset/www/index.html 直接 ERR_FILE_NOT_FOUND。
  aapt add 同样不可靠。所以这里自己组包，条目名一律使用 '/'。

要点：
  - 从 aapt2 产物里复制条目时保留原 compress_type，
    resources.arsc 必须保持不压缩（targetSdk 30+ 的硬要求），
    否则会被 zipalign 对齐到错误位置、运行时读不到资源。
  - assets 全部 DEFLATE。
"""
import sys
import os
import zipfile

if len(sys.argv) != 5:
    print('usage: pack_apk.py <res.apk> <classes.dex> <assets_dir> <out.apk>')
    sys.exit(2)

res_apk, dex_path, assets_dir, out_apk = sys.argv[1:5]

FIXED_TIME = (2026, 1, 1, 0, 0, 0)


def add_file(zout, arcname, payload, compress=zipfile.ZIP_DEFLATED):
    """arcname 必须是正斜杠路径"""
    if '\\' in arcname:
        raise ValueError('条目名含反斜杠: ' + arcname)
    zi = zipfile.ZipInfo(arcname, date_time=FIXED_TIME)
    zi.compress_type = compress
    zi.external_attr = 0o644 << 16
    zout.writestr(zi, payload)


def main():
    if not os.path.isfile(res_apk):
        raise SystemExit('找不到 aapt2 产物: ' + res_apk)
    if not os.path.isfile(dex_path):
        raise SystemExit('找不到 classes.dex: ' + dex_path)
    if not os.path.isdir(assets_dir):
        raise SystemExit('找不到 assets 目录: ' + assets_dir)

    if os.path.exists(out_apk):
        os.remove(out_apk)

    zout = zipfile.ZipFile(out_apk, 'w', zipfile.ZIP_DEFLATED)

    # 1) aapt2 产物：清单 + 资源表 + 图标，保持原压缩方式
    n_res = 0
    with zipfile.ZipFile(res_apk, 'r') as zin:
        for info in zin.infolist():
            if info.is_dir():
                continue
            data = zin.read(info.filename)
            zi = zipfile.ZipInfo(info.filename, date_time=FIXED_TIME)
            zi.compress_type = info.compress_type   # 关键：resources.arsc 保持 STORED
            zi.external_attr = info.external_attr
            zout.writestr(zi, data)
            n_res += 1

    # 2) 字节码
    with open(dex_path, 'rb') as f:
        add_file(zout, 'classes.dex', f.read())

    # 3) assets：遍历目录，一律转成正斜杠
    base = os.path.abspath(assets_dir)
    n_assets = 0
    for root, _dirs, files in os.walk(base):
        for fn in sorted(files):
            full = os.path.join(root, fn)
            rel = os.path.relpath(full, base).replace(os.sep, '/').replace('\\', '/')
            with open(full, 'rb') as f:
                add_file(zout, 'assets/' + rel, f.read())
            n_assets += 1

    zout.close()

    # 4) 自检：必须能按正斜杠路径读到入口文件
    with zipfile.ZipFile(out_apk, 'r') as z:
        names = z.namelist()
        if 'assets/www/index.html' not in names:
            raise SystemExit('组包失败：assets/www/index.html 不在包内\n' + '\n'.join(names[:30]))
        backslash = [n for n in names if '\\' in n]
        if backslash:
            raise SystemExit('组包失败：仍有反斜杠条目 ' + repr(backslash[:5]))
        # 真读一遍，确认不是只有目录能列出来
        html = z.read('assets/www/index.html')
        if b'<html' not in html.lower():
            raise SystemExit('组包失败：index.html 内容异常')

    size = os.path.getsize(out_apk)
    print('   条目 %d（资源 %d + assets %d），%.1f KB'
          % (len(names), n_res, n_assets, size / 1024.0))


if __name__ == '__main__':
    main()
