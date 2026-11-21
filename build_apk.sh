#!/usr/bin/env bash
# ============================================================
# 野人量化 · APK 打包脚本（不依赖 Gradle / Android Studio）
#
# 流程：aapt2 compile → aapt2 link → javac → d8 → aapt add → zipalign → apksigner
# 依赖本仓库 .toolchain 下已解压的 JDK17 / platform-35 / build-tools
#
# 注意：aapt2 在中文路径下会报 "failed to open directory"，
#      因此全部构建在英文临时目录里进行，最后把 APK 拷回 build/。
# ============================================================
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TC="$ROOT/.toolchain"
JDK="$TC/jdk-17.0.21+9"
BT="$TC/sdk/android-15"
PLATFORM="$TC/sdk/android-35/android.jar"
APP="$ROOT/android"
KS="$ROOT/keystore/yeren.jks"
KS_PASS="yerenquant"

# 英文工作目录
WORK="${TEMP:-/tmp}/yb-apk-build"
WORK="$(cygpath -m "$WORK" 2>/dev/null || echo "$WORK")"

export JAVA_HOME="$JDK"
export PATH="$JAVA_HOME/bin:$PATH"

die() { echo "✗ $1" >&2; exit 1; }

[ -x "$BT/aapt2.exe" ]  || die "缺少 build-tools，请先解压到 .toolchain/sdk"
[ -f "$PLATFORM" ]      || die "缺少 android.jar"
[ -x "$JDK/bin/javac" ] || die "缺少 JDK"

echo "▸ 1/8 准备构建目录  $WORK"
rm -rf "$WORK"
mkdir -p "$WORK/android" "$WORK/out/gen" "$WORK/out/classes" "$WORK/out/dex"

cp -r "$APP/res" "$WORK/android/res"
cp "$APP/AndroidManifest.xml" "$WORK/android/"
cp -r "$APP/java" "$WORK/android/java"
mkdir -p "$WORK/android/assets"
cp -r "$ROOT/www" "$WORK/android/assets/www"

# aapt2 同样读不了中文路径下的 android.jar，一并拷到英文目录
cp "$PLATFORM" "$WORK/android.jar"
PLATFORM="$WORK/android.jar"

echo "▸ 2/8 编译资源 (aapt2 compile)"
"$BT/aapt2.exe" compile --dir "$WORK/android/res" -o "$WORK/out/res.zip"

echo "▸ 3/8 链接资源与清单 (aapt2 link)"
# 注意：这里刻意不传 -A。Windows 上 aapt2 -A 会把 assets 条目名写成反斜杠，
# Android 的 AssetManager 认不出，运行时会 ERR_FILE_NOT_FOUND。
# assets 由 tools/pack_apk.py 在组包阶段写入（强制正斜杠）。
"$BT/aapt2.exe" link \
  -o "$WORK/out/res.apk" \
  -I "$PLATFORM" \
  --manifest "$WORK/android/AndroidManifest.xml" \
  --java "$WORK/out/gen" \
  --min-sdk-version 23 \
  --target-sdk-version 34 \
  "$WORK/out/res.zip"

echo "▸ 4/8 编译 Java (javac)"
find "$WORK/out/gen" "$WORK/android/java" -name "*.java" > "$WORK/out/sources.txt"
# 注意：这里绝不能吞掉 javac 的退出码。上一版就是因为漏了 import 却继续往下走，
# 打出个残缺 dex，装上直接闪退。
if ! javac -encoding UTF-8 -source 8 -target 8 -nowarn \
      -bootclasspath "$PLATFORM" \
      -d "$WORK/out/classes" @"$WORK/out/sources.txt" > "$WORK/out/javac.log" 2>&1; then
  grep -v "bootstrap class path" "$WORK/out/javac.log" | head -40 >&2
  die "javac 编译失败，已中止（见上面的报错行）"
fi
[ -n "$(find "$WORK/out/classes" -name '*.class' -print -quit)" ] || die "javac 没有产出任何 class 文件"

echo "▸ 5/8 转 dex (d8)"
find "$WORK/out/classes" -name "*.class" > "$WORK/out/classes.txt"
java -cp "$BT/lib/d8.jar" com.android.tools.r8.D8 \
  --lib "$PLATFORM" --min-api 21 --release \
  --output "$WORK/out/dex" $(cat "$WORK/out/classes.txt")

echo "▸ 6/8 组包 + 对齐"
PY_BIN="$(command -v python3 || command -v python)"
[ -n "$PY_BIN" ] || die "需要 python3 来组包（aapt add 会写坏条目名）"
"$PY_BIN" "$ROOT/tools/pack_apk.py" \
  "$WORK/out/res.apk" "$WORK/out/dex/classes.dex" \
  "$WORK/android/assets" "$WORK/out/unsigned.apk"
[ -s "$WORK/out/dex/classes.dex" ] || die "d8 没有产出 classes.dex"
"$BT/zipalign.exe" -f -p 4 "$WORK/out/unsigned.apk" "$WORK/out/aligned.apk"

echo "▸ 7/8 签名 (apksigner)"
mkdir -p "$ROOT/keystore"
if [ ! -f "$KS" ]; then
  echo "  · 生成签名密钥（首次运行）"
  keytool -genkeypair -v \
    -keystore "$KS" -storepass "$KS_PASS" -keypass "$KS_PASS" \
    -alias yeren -keyalg RSA -keysize 2048 -validity 10000 \
    -dname "CN=Yeren Quant, OU=Mobile, O=Yeren, L=Shanghai, ST=Shanghai, C=CN" \
    > /dev/null 2>&1
fi

mkdir -p "$ROOT/build"
APK="$ROOT/build/yeren-quant-v1.0.apk"
java -jar "$BT/lib/apksigner.jar" sign \
  --ks "$KS" --ks-pass "pass:$KS_PASS" --key-pass "pass:$KS_PASS" \
  --ks-key-alias yeren \
  --min-sdk-version 23 \
  --out "$WORK/out/signed.apk" "$WORK/out/aligned.apk"

echo "▸ 8/8 校验并输出"
java -jar "$BT/lib/apksigner.jar" verify --min-sdk-version 23 "$WORK/out/signed.apk"
cp "$WORK/out/signed.apk" "$APK"

echo "▸ 9/9 出厂校验"
"$PY_BIN" "$ROOT/tools/verify_apk.py" "$APK" "$ROOT/www" || die "APK 校验未通过"

SIZE=$(du -h "$APK" | cut -f1)
echo ""
echo "✓ 打包完成：$APK  ($SIZE)"
