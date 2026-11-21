package com.yeren.quant;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.Intent;
import android.graphics.Color;
import android.content.pm.PackageInfo;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.view.KeyEvent;
import android.view.View;
import android.view.Window;
import android.webkit.JavascriptInterface;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

/**
 * 野人量化 · Android 壳
 *
 * 设计取舍：不引 androidx、不引 Gradle，只用系统 WebView 加载本地 assets。
 * 原因是整个应用是纯前端 + JSONP 直连，没有任何需要原生补齐的能力，
 * 壳越薄越不容易在低端机上出问题。
 *
 * 关键设置：
 *  - setAllowUniversalAccessFromFileURLs：file:// 页面才能往 https 接口注入 script
 *  - setDomStorageEnabled：localStorage（主题、持仓、复盘缓存）依赖它
 *  - setMixedContentMode：避免部分 ROM 把 https 请求判成混合内容拦掉
 */
public class MainActivity extends Activity {

    private static final String HOME_URL = "file:///android_asset/www/index.html";
    private static final String DEFAULT_BG = "#0b0d10";

    private WebView web;
    private Updater updater;

    @SuppressLint({"SetJavaScriptEnabled", "AddJavascriptInterface"})
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        // 任何初始化异常都转成可读页面，绝不让用户看到闪退
        try {
            setup();
        } catch (Throwable t) {
            showBootError(t);
        }
    }

    private void setup() {
        web = new WebView(this);
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setAllowFileAccess(true);
        s.setAllowContentAccess(true);

        // file:// 页面访问网络接口所需（JSONP 注入 script 标签）
        s.setAllowFileAccessFromFileURLs(true);
        s.setAllowUniversalAccessFromFileURLs(true);

        s.setJavaScriptCanOpenWindowsAutomatically(false);
        s.setSupportMultipleWindows(false);
        s.setLoadWithOverviewMode(true);
        s.setUseWideViewPort(true);
        s.setBuiltInZoomControls(false);
        s.setDisplayZoomControls(false);
        s.setSupportZoom(false);
        s.setTextZoom(100);
        s.setCacheMode(WebSettings.LOAD_DEFAULT);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
            s.setMixedContentMode(WebSettings.MIXED_CONTENT_ALWAYS_ALLOW);
        }

        web.setBackgroundColor(Color.parseColor(DEFAULT_BG));
        web.setOverScrollMode(View.OVER_SCROLL_NEVER);
        web.addJavascriptInterface(new Bridge(), "AndroidBridge");

        web.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, String url) {
                return handleUrl(url);
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest req) {
                return handleUrl(req.getUrl() == null ? null : req.getUrl().toString());
            }

            /** API 23+ 的主框架加载失败 */
            @Override
            public void onReceivedError(WebView view, WebResourceRequest req, WebResourceError err) {
                if (req != null && req.isForMainFrame()) {
                    showFatal(view, "页面资源加载失败",
                        err.getErrorCode() + " " + err.getDescription());
                }
            }

            /** API < 23 的兜底 */
            @Override
            public void onReceivedError(WebView view, int errorCode, String description, String failingUrl) {
                if (failingUrl != null && failingUrl.equals(HOME_URL)) {
                    showFatal(view, "页面资源加载失败", errorCode + " " + description);
                }
            }
        });

        web.setWebChromeClient(new WebChromeClient());

        setContentView(web);
        applyBarColor(DEFAULT_BG);
        web.loadUrl(HOME_URL);
    }

    /** 初始化阶段抛异常时的兜底显示，避免直接闪退 */
    private void showBootError(Throwable t) {
        String msg = t.getClass().getSimpleName() + ": " + String.valueOf(t.getMessage());
        try {
            if (web == null) {
                web = new WebView(this);
                setContentView(web);
            }
            showFatal(web, "启动时发生异常", msg);
        } catch (Throwable t2) {
            android.widget.TextView tv = new android.widget.TextView(this);
            tv.setText("野人量化 启动失败\n\n" + msg
                + "\n\n请截图反馈给开发者。");
            tv.setTextColor(Color.parseColor("#E9EDF2"));
            tv.setBackgroundColor(Color.parseColor(DEFAULT_BG));
            tv.setTextSize(14);
            tv.setPadding(56, 120, 56, 56);
            setContentView(tv);
        }
    }

    /** 起不来时给一个能看懂、能反馈的页面，而不是系统的 "网页无法打开" */
    private void showFatal(WebView view, String title, String detail) {
        String html =
            "<html><head><meta name='viewport' content='width=device-width,initial-scale=1'>"
            + "<style>body{background:#0b0d10;color:#e9edf2;font-family:sans-serif;"
            + "padding:28px 22px;line-height:1.75;margin:0}"
            + "h2{font-size:17px;margin:0 0 14px;font-weight:700}"
            + "p{color:#98a3b0;font-size:13px;margin:8px 0}"
            + "code{background:#1a1f26;padding:3px 7px;border-radius:5px;"
            + "font-size:12px;color:#f0b90b;word-break:break-all}"
            + "</style></head><body>"
            + "<h2>野人量化 启动失败</h2>"
            + "<p>" + title + "</p>"
            + "<p><code>" + detail + "</code></p>"
            + "<p style='margin-top:22px;font-size:12px'>请把这一屏截图反馈给开发者。"
            + "如果是安装包不完整，卸载后重新安装通常能解决。</p>"
            + "</body></html>";
        view.loadDataWithBaseURL(null, html, "text/html", "utf-8", null);
    }

    /** 站内请求留在 WebView，外链交给系统浏览器 */
    private boolean handleUrl(String url) {
        if (url == null) return false;
        if (url.startsWith("file://") || url.startsWith("about:")) return false;
        try {
            startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(url)));
        } catch (Exception ignored) {
        }
        return true;
    }

    /** 前后端约定：JS 侧切主题时把背景色同步给状态栏 */
    public class Bridge {
        @JavascriptInterface
        public void setTheme(String bgColor) {
            final String c = bgColor;
            runOnUiThread(new Runnable() {
                @Override
                public void run() {
                    applyBarColor(c);
                }
            });
        }

        @JavascriptInterface
        public void exit() {
            runOnUiThread(new Runnable() {
                @Override
                public void run() {
                    finish();
                }
            });
        }

        /* ---------- 版本信息：以 AndroidManifest 为唯一真源 ---------- */

        @JavascriptInterface
        public String versionName() {
            try {
                PackageInfo pi = getPackageManager().getPackageInfo(getPackageName(), 0);
                return pi.versionName == null ? "" : pi.versionName;
            } catch (Exception e) {
                return "";
            }
        }

        @JavascriptInterface
        public int versionCode() {
            try {
                PackageInfo pi = getPackageManager().getPackageInfo(getPackageName(), 0);
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
                    return (int) pi.getLongVersionCode();
                }
                return pi.versionCode;
            } catch (Exception e) {
                return 0;
            }
        }

        /**
         * 下载并安装更新。
         *
         * @param urlsJson  候选地址的 JSON 数组，按优先级排列（镜像在前，直链兜底）
         * @param verCode   目标版本号，用于判断缓存里的包是不是同一个
         * @param sha256    期望的内容摘要，空串表示不校验
         */
        @JavascriptInterface
        public void installUpdate(String urlsJson, int verCode, String sha256) {
            String[] list;
            try {
                org.json.JSONArray arr = new org.json.JSONArray(urlsJson);
                list = new String[arr.length()];
                for (int i = 0; i < arr.length(); i++) list[i] = arr.getString(i);
            } catch (Exception e) {
                callJs("__installFail", jsonStr("地址解析失败"));
                return;
            }
            if (updater != null) updater.cancel();

            updater = new Updater(MainActivity.this, verCode, list, sha256, new Updater.Sink() {
                @Override
                public void progress(long done, long total, String msg) {
                    callJs("__progress", done + "," + total + "," + jsonStr(msg));
                }

                @Override
                public void done(String msg) {
                    callJs("__installed", jsonStr(msg));
                }

                @Override
                public void fail(String msg) {
                    callJs("__installFail", jsonStr(msg));
                }
            });
            new Thread(updater, "yb-update").start();
        }
    }

    /** 调 JS 侧 YB.update 的内部回调，任何异常都不许冒到原生 */
    private void callJs(final String fn, final String args) {
        if (web == null) return;
        final String js = "try{(window.YB&&YB.update&&YB.update." + fn + ")(" + args + ")}catch(e){}";
        runOnUiThread(new Runnable() {
            @Override
            public void run() {
                try {
                    web.evaluateJavascript(js, null);
                } catch (Exception ignored) {
                }
            }
        });
    }

    /** 最小化的 JSON 字符串转义，够回调传文案用 */
    private static String jsonStr(String s) {
        if (s == null) return "\"\"";
        StringBuilder b = new StringBuilder(s.length() + 8);
        b.append('"');
        for (int i = 0; i < s.length(); i++) {
            char c = s.charAt(i);
            switch (c) {
                case '"': b.append("\\\""); break;
                case '\\': b.append("\\\\"); break;
                case '\n': b.append("\\n"); break;
                case '\r': b.append("\\r"); break;
                case '\t': b.append("\\t"); break;
                default:
                    if (c < 0x20) b.append(String.format("\\u%04x", (int) c));
                    else b.append(c);
            }
        }
        b.append('"');
        return b.toString();
    }

    private void applyBarColor(String bgColor) {
        try {
            int c = Color.parseColor(bgColor);
            Window w = getWindow();
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
                w.setStatusBarColor(c);
                w.setNavigationBarColor(c);
            }
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                boolean light = isLight(c);
                View dv = w.getDecorView();
                int flags = dv.getSystemUiVisibility();
                if (light) {
                    flags |= View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR;
                } else {
                    flags &= ~View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR;
                }
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                    if (light) {
                        flags |= View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR;
                    } else {
                        flags &= ~View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR;
                    }
                }
                dv.setSystemUiVisibility(flags);
            }
            if (web != null) web.setBackgroundColor(c);
        } catch (Exception ignored) {
        }
    }

    /** 相对亮度判断，用于决定状态栏图标用深色还是浅色 */
    private boolean isLight(int c) {
        double r = Color.red(c) / 255.0;
        double g = Color.green(c) / 255.0;
        double b = Color.blue(c) / 255.0;
        return (0.299 * r + 0.587 * g + 0.114 * b) > 0.6;
    }

    @Override
    public boolean onKeyDown(int keyCode, KeyEvent event) {
        if (keyCode == KeyEvent.KEYCODE_BACK && web != null) {
            // 先问网页：不在首页就切回首页，在首页才退出
            web.evaluateJavascript(
                "(function(){try{return window.__ybBack?window.__ybBack():'exit'}catch(e){return 'exit'}})()",
                new ValueCallback<String>() {
                    @Override
                    public void onReceiveValue(String value) {
                        if (value == null || value.indexOf("exit") >= 0) {
                            finish();
                        }
                    }
                });
            return true;
        }
        return super.onKeyDown(keyCode, event);
    }

    @Override
    protected void onDestroy() {
        if (updater != null) {
            updater.cancel();
            updater = null;
        }
        if (web != null) {
            web.setVisibility(View.GONE);
            web.destroy();
            web = null;
        }
        super.onDestroy();
    }
}
