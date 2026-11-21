/* 由 tools/make_dist.py 生成，请勿手改 */
window.YB_UPDATE = {
  "versionCode": 17,
  "versionName": "1.1.6",
  "size": 157594,
  "sha256": "6ec5c61cd6066e6a082b4486d39bfcc5c5de7f348fb5a91e794d5c202c4b28a8",
  "releasedAt": "2026-11-21T10:56:11+08:00",
  "apk": "dist/yeren-quant.apk",
  "apkCdn": "dist/cdn/yeren-quant-1.1.6.apk.js",
  "page": "https://github.com/Hongred04/yeren-tide/releases/latest",
  "notes": [
    "应用内检查更新：设置 → 软件更新，六个镜像并行择优，不再依赖 github.com 的可达性",
    "更新包由原生下载并交给系统安装器，含「允许安装未知应用」引导；同版本包复用缓存",
    "安装包在仓库内保留 CDN 副本（`dist/cdn/*.apk.js`），国内可直接从 jsDelivr 下载",
    "下载后按 sha256 校验内容：镜像会缓存旧包，新旧包大小可能完全一样，只比大小会把旧版装上去",
    "启动后静默检查一次，有更新才提示，一天最多一次",
    "设置页改为显示真实版本号（以 AndroidManifest 为唯一真源）",
    "源码开源发布（MIT）"
  ]
};
