package com.yeren.quant;

import android.app.Activity;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;

import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;

/**
 * 更新下载与安装。
 *
 * 放在原生而不是 WebView 里做的原因：WebView 拿不到可写的落盘位置，
 * 也没法把 APK 交给系统安装器。JS 只负责挑源和显示进度。
 *
 * 两个细节值得记：
 *  - 逐个源串行尝试。镜像可能返回 200 但内容是错误页，所以除了 HTTP 状态
 *    还要校验大小（低于 100KB 一律当失败，正常包 140KB 以上）。
 *  - 下到 .part 再改名。中途断网留下的半包如果直接叫 .apk，
 *    下次会被误判成「已下载」而安装失败。
 */
public class Updater implements Runnable {

    public interface Sink {
        void progress(long done, long total, String msg);
        void done(String msg);
        void fail(String msg);
    }

    private static final int MIN_SIZE = 100 * 1024;

    private final Activity act;
    private final String[] urls;
    private final int versionCode;
    private final String wantSha;
    private final Sink sink;

    private volatile boolean running = true;
    private long lastEmit = 0;

    public Updater(Activity act, int versionCode, String[] urls, String sha256, Sink sink) {
        this.act = act;
        this.versionCode = versionCode;
        this.urls = urls == null ? new String[0] : urls;
        this.wantSha = sha256 == null ? "" : sha256.trim().toLowerCase();
        this.sink = sink;
    }

    /** 同版本的包已经下过就不重复下——用户去开权限再回来时要靠这个 */
    private boolean cachedReady() {
        File f = ApkProvider.fileOf(act);
        File stamp = new File(act.getCacheDir(), "yeren-update.ver");
        if (!f.exists() || f.length() < MIN_SIZE || !stamp.exists()) return false;
        try {
            java.io.BufferedReader r = new java.io.BufferedReader(
                new java.io.InputStreamReader(new java.io.FileInputStream(stamp), "UTF-8"));
            String line = r.readLine();
            r.close();
            if (line == null || !String.valueOf(versionCode).equals(line.trim())) return false;
            return shaOk(f);
        } catch (Exception e) {
            return false;
        }
    }

    /**
     * 校验安装包内容。
     *
     * 这一步不能省：镜像会缓存旧文件，而新旧包的大小可能完全一样
     * （这次就是 157594 字节对 157594 字节），只比大小会把旧版本当成新版本装上去。
     */
    private boolean shaOk(File f) {
        if (wantSha.isEmpty()) return true;
        return wantSha.equals(sha256Of(f));
    }

    private static String sha256Of(File f) {
        try {
            java.security.MessageDigest md = java.security.MessageDigest.getInstance("SHA-256");
            java.io.FileInputStream in = new java.io.FileInputStream(f);
            byte[] buf = new byte[16 * 1024];
            int n;
            while ((n = in.read(buf)) > 0) md.update(buf, 0, n);
            in.close();
            byte[] out = md.digest();
            StringBuilder sb = new StringBuilder(out.length * 2);
            for (int i = 0; i < out.length; i++) {
                String h = Integer.toHexString(out[i] & 0xff);
                if (h.length() == 1) sb.append('0');
                sb.append(h);
            }
            return sb.toString();
        } catch (Exception e) {
            return "";
        }
    }

    private void markCached() {
        try {
            FileOutputStream o = new FileOutputStream(new File(act.getCacheDir(), "yeren-update.ver"));
            o.write(String.valueOf(versionCode).getBytes("UTF-8"));
            o.close();
        } catch (Exception ignored) {
        }
    }

    @Override
    public void run() {
        if (cachedReady()) {
            emitProgress(1, 1, "已下载，准备安装");
            handoffToInstaller();
            return;
        }

        String lastErr = "";
        for (int i = 0; i < urls.length && running; i++) {
            try {
                emitProgress(0, 0, "连接源 " + (i + 1) + "/" + urls.length);
                if (download(urls[i])) {
                    markCached();
                    emitProgress(1, 1, "下载完成");
                    handoffToInstaller();
                    return;
                }
                lastErr = "源 " + (i + 1) + " 内容不完整";
            } catch (Exception e) {
                lastErr = String.valueOf(e.getMessage());
            }
        }

        if (running) sink.fail("下载失败：" + lastErr + "。可到发布页手动下载。");
    }

    /** @return 是否下到了完整文件 */
    private boolean download(String url) throws Exception {
        HttpURLConnection c = null;
        File tmp = new File(act.getCacheDir(), "yeren-update.part");
        File dst = ApkProvider.fileOf(act);

        try {
            c = (HttpURLConnection) new URL(url).openConnection();
            c.setConnectTimeout(8000);
            c.setReadTimeout(20000);
            c.setInstanceFollowRedirects(true);
            c.setRequestProperty("User-Agent", "YerenQuant/" + versionCode);
            c.setRequestProperty("Accept", "*/*");

            int code = c.getResponseCode();
            if (code != 200 && code != 206) throw new Exception("HTTP " + code);

            long total = c.getContentLength();
            InputStream in = c.getInputStream();
            FileOutputStream out = new FileOutputStream(tmp);
            byte[] buf = new byte[16 * 1024];
            long done = 0;
            int n;
            while ((n = in.read(buf)) > 0) {
                if (!running) {
                    out.close();
                    in.close();
                    return false;
                }
                out.write(buf, 0, n);
                done += n;
                emitProgress(done, total, "下载中");
            }
            out.flush();
            out.close();
            in.close();

            if (done < MIN_SIZE) {
                tmp.delete();
                return false;
            }
            if (dst.exists()) dst.delete();
            if (!tmp.renameTo(dst)) throw new Exception("无法写入安装包");

            // 大小对了不算数：镜像缓存的旧包可能大小一样。内容不对就换下一个源。
            if (!shaOk(dst)) {
                dst.delete();
                throw new Exception("内容校验失败（镜像缓存了旧包）");
            }
            return true;
        } finally {
            if (c != null) c.disconnect();
        }
    }

    /** 交给系统安装器。需要「安装未知应用」权限，没开就先带去开 */
    private void handoffToInstaller() {
        try {
            if (Build.VERSION.SDK_INT >= 26
                && !act.getPackageManager().canRequestPackageInstalls()) {
                sink.fail("需要允许安装未知应用。已跳到设置页，开启后回来再点一次安装。");
                try {
                    Intent s = new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
                        Uri.parse("package:" + act.getPackageName()));
                    s.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                    act.startActivity(s);
                } catch (Exception ignored) {
                }
                return;
            }

            Intent i = new Intent(Intent.ACTION_VIEW);
            i.setDataAndType(ApkProvider.uriFor(act), "application/vnd.android.package-archive");
            i.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            act.startActivity(i);
            sink.done("已打开安装程序");
        } catch (Exception e) {
            sink.fail("无法启动安装：" + e.getMessage());
        }
    }

    /** 进度节流到 4Hz，否则 evaluateJavascript 会把主线程刷满 */
    private void emitProgress(long done, long total, String msg) {
        long now = System.currentTimeMillis();
        if (done != 1 && now - lastEmit < 250) return;
        lastEmit = now;
        sink.progress(done, total, msg);
    }

    public void cancel() {
        running = false;
    }
}
