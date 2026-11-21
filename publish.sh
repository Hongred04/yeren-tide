#!/usr/bin/env bash
# ============================================================
# 发布一版
#
# 做四件事：
#   1. 构建 APK（可跳过）
#   2. 生成 dist/（update.js / update.json / apk）
#   3. 提交并推送，打 tag
#   4. 在 GitHub 建 Release 并上传 APK
#
# 为什么要生成 dist/update.js 而不是只发 Release：
#   GitHub 在国内时通时不通。仓库里的文件可以由 jsDelivr 这类 CDN 代理，
#   客户端就多了一条能跑满速度的下载路径。Release 是正式渠道，也是兜底。
#
# 用法：
#   ./publish.sh              构建 + 发布
#   ./publish.sh --no-build   用 build/ 里现成的 APK
#   ./publish.sh --local      只生成 dist 并本地提交，不推送（先看 diff 用）
# ============================================================
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"

PROXY_HOST="127.0.0.1:7897"
NO_BUILD=0
LOCAL_ONLY=0
for a in "$@"; do
  case "$a" in
    --no-build) NO_BUILD=1 ;;
    --local) LOCAL_ONLY=1 ;;
  esac
done

die() { echo "✗ $1" >&2; exit 1; }

PY="$(command -v python3 || command -v python)"

read_ver() {
  "$PY" - <<'PY'
import io, re
s = io.open('android/AndroidManifest.xml', encoding='utf-8').read()
print(re.search(r'android:versionName="([^"]+)"', s).group(1))
PY
}

VER="$(read_ver)"
TAG="v$VER"
echo "▸ 目标版本 $TAG"

# ---------- 1. 构建 ----------
if [ "$NO_BUILD" = "0" ]; then
  echo "▸ 构建 APK"
  bash build_apk.sh 2>&1 | tail -6
else
  echo "▸ 跳过构建（--no-build）"
fi

# ---------- 2. dist ----------
echo "▸ 生成 dist/"
"$PY" tools/make_dist.py

# ---------- 3. 提交 ----------
echo "▸ 提交"
git add -A
if git diff --cached --quiet; then
  echo "  · 没有变更，跳过提交"
else
  git commit -q -m "release: $TAG" -m "$(git diff --cached --stat | tail -1)"
fi

if git rev-parse -q --verify "refs/tags/$TAG" >/dev/null; then
  echo "  · tag $TAG 已存在，跳过"
else
  git tag -a "$TAG" -m "野人量化 $TAG"
  echo "  · 已打 tag $TAG"
fi

if [ "$LOCAL_ONLY" = "1" ]; then
  echo ""
  echo "✓ 已在本地完成（未推送）"
  echo "  检查无误后执行：git push origin main && git push origin $TAG"
  exit 0
fi

# ---------- 4. 推送 ----------
# GitHub 直连不通，必须走本地代理。先探一下，别让 push 跑到一半失败。
if ! curl -s -m 4 -x "http://$PROXY_HOST" -o /dev/null https://github.com 2>/dev/null; then
  die "连不上 GitHub。请先打开代理（Clash / Watt Toolkit），预期端口 $PROXY_HOST"
fi

echo "▸ 推送"
git -c "http.proxy=http://$PROXY_HOST" -c "https.proxy=http://$PROXY_HOST" \
  push origin HEAD --follow-tags

# ---------- 5. Release ----------
if command -v gh >/dev/null 2>&1; then
  echo "▸ 创建 Release"
  NOTES_FILE="$(mktemp)"
  "$PY" - > "$NOTES_FILE" <<'PY'
import io
s = io.open('CHANGELOG.md', encoding='utf-8').read().splitlines()
out, started = [], False
for line in s:
    if line.startswith('## '):
        if started:
            break
        started = True
        continue
    if started:
        out.append(line)
print('\n'.join(out).strip())
PY
  if HTTPS_PROXY="http://$PROXY_HOST" gh release view "$TAG" >/dev/null 2>&1; then
    echo "  · Release $TAG 已存在，只补传附件"
    HTTPS_PROXY="http://$PROXY_HOST" gh release upload "$TAG" dist/yeren-quant.apk --clobber
  else
    HTTPS_PROXY="http://$PROXY_HOST" gh release create "$TAG" \
      dist/yeren-quant.apk \
      --title "野人量化 $TAG" \
      --notes-file "$NOTES_FILE"
  fi
  rm -f "$NOTES_FILE"
else
  echo "  · 未安装 gh，跳过 Release（可手动上传 dist/yeren-quant.apk）"
fi

echo ""
echo "✓ 发布完成 $TAG"
echo "  仓库    https://github.com/Hongred04/yeren-tide"
echo "  发布页  https://github.com/Hongred04/yeren-tide/releases/tag/$TAG"
echo "  清单    https://cdn.jsdelivr.net/gh/Hongred04/yeren-tide@main/dist/update.json"
