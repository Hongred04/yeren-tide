#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
野人量化 · APK 出厂校验

把踩过的坑变成断言，每次打包强制跑一遍：
  1. 条目名不得含反斜杠（Windows 上 aapt2 -A 会写出 \\，导致 ERR_FILE_NOT_FOUND）
  2. assets/www 下每个文件都要在包里，且内容哈希一致
  3. resources.arsc 必须 STORED（targetSdk 30+ 的硬要求）
  4. classes.dex 存在且包含最新壳代码的字符串（防止 javac 失败却打出旧 dex）
"""
import sys
import os
import hashlib
import zipfile

# 必须能在 dex 里找到的字符串，用来确认 Java 层真的重新编译过
EXPECTED_DEX_STRINGS = [b'showBootError', b'showFatal', b'onReceivedError']

errors = []
notes = []


def fail(msg):
    errors.append(msg)


def main():
    if len(sys.argv) != 3:
        print('usage: verify_apk.py <apk> <www_dir>')
        return 2
    apk, www = sys.argv[1], sys.argv[2]

    if not os.path.isfile(apk):
        print('✗ 找不到 APK: ' + apk)
        return 1

    z = zipfile.ZipFile(apk)
    names = z.namelist()

    # 1) 分隔符
    bad_sep = [n for n in names if '\\' in n]
    if bad_sep:
        fail('条目名含反斜杠（Android 读不到）: %r' % bad_sep[:5])
    else:
        notes.append('条目分隔符全部为正斜杠（%d 个条目）' % len(names))

    # 2) assets 完整性与内容比对
    if 'assets/www/index.html' not in names:
        fail('缺少 assets/www/index.html')
    else:
        html = z.read('assets/www/index.html')
        if b'<html' not in html.lower():
            fail('assets/www/index.html 内容异常')
        else:
            notes.append('index.html 可读（%d 字节）' % len(html))

    missing, mismatch = [], []
    for root, _d, files in os.walk(www):
        for fn in files:
            full = os.path.join(root, fn)
            rel = os.path.relpath(full, www).replace(os.sep, '/').replace('\\', '/')
            arc = 'assets/www/' + rel
            if arc not in names:
                missing.append(rel)
                continue
            a = hashlib.md5(z.read(arc)).hexdigest()
            b = hashlib.md5(open(full, 'rb').read()).hexdigest()
            if a != b:
                mismatch.append(rel)
    if missing:
        fail('assets 缺失: %r' % missing[:5])
    if mismatch:
        fail('assets 内容不一致: %r' % mismatch[:5])
    if not missing and not mismatch:
        notes.append('assets 与源码逐文件哈希一致')

    # 3) resources.arsc 压缩方式
    if 'resources.arsc' not in names:
        fail('缺少 resources.arsc')
    else:
        info = z.getinfo('resources.arsc')
        if info.compress_type != zipfile.ZIP_STORED:
            fail('resources.arsc 被压缩了，targetSdk 30+ 会读不到资源')
        else:
            notes.append('resources.arsc 未压缩（STORED）')

    # 4) dex 与代码新鲜度
    if 'classes.dex' not in names:
        fail('缺少 classes.dex')
    else:
        dex = z.read('classes.dex')
        if len(dex) < 4000:
            fail('classes.dex 过小（%d 字节），可能是编译失败的产物' % len(dex))
        else:
            lost = [s.decode() for s in EXPECTED_DEX_STRINGS if s not in dex]
            if lost:
                fail('dex 里找不到 %r，Java 层没有真正重新编译' % lost)
            else:
                notes.append('classes.dex %d 字节，壳代码已更新' % len(dex))

    print('—— APK 校验 ——')
    for n in notes:
        print('  ✓ ' + n)
    for e in errors:
        print('  ✗ ' + e)

    if errors:
        print('\n校验失败，拒绝出厂')
        return 1
    print('\n全部通过')
    return 0


if __name__ == '__main__':
    sys.exit(main())
