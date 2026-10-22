package org.samsucks.humax;

import android.app.Activity;
import android.os.Bundle;
import android.graphics.Color;
import android.widget.FrameLayout;
import android.widget.TextView;
import android.view.Gravity;
import android.view.KeyEvent;
import android.view.View;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;
import androidx.webkit.WebViewAssetLoader;
import androidx.webkit.WebViewClientCompat;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;

public final class MainActivity extends Activity {
    private WebView web;
    private TextView diagnostics;
    @Override public void onCreate(Bundle saved) {
        super.onCreate(saved);
        getWindow().getDecorView().setSystemUiVisibility(5894 | View.SYSTEM_UI_FLAG_LAYOUT_STABLE);
        web = new WebView(this);
        web.setBackgroundColor(0xff0b0d12);
        web.setFocusable(true);
        web.setFocusableInTouchMode(true);
        FrameLayout layout = new FrameLayout(this);
        layout.addView(web, new FrameLayout.LayoutParams(-1, -1));
        diagnostics = new TextView(this);
        diagnostics.setText("HumaxPlex DIAG-4 | WebView initializing");
        diagnostics.setTextSize(13);
        diagnostics.setTextColor(Color.WHITE);
        diagnostics.setBackgroundColor(0xe6000000);
        diagnostics.setPadding(12, 7, 12, 7);
        FrameLayout.LayoutParams tag = new FrameLayout.LayoutParams(-2, -2, Gravity.TOP | Gravity.LEFT);
        layout.addView(diagnostics, tag);
        setContentView(layout);
        WebSettings settings = web.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setUseWideViewPort(true);
        settings.setLoadWithOverviewMode(false);
        settings.setDomStorageEnabled(true);
        settings.setMediaPlaybackRequiresUserGesture(false);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_ALWAYS_ALLOW);
        final WebViewAssetLoader loader = new WebViewAssetLoader.Builder()
            .addPathHandler("/assets/", new WebViewAssetLoader.AssetsPathHandler(this)).build();
        web.setWebViewClient(new WebViewClientCompat() {
            @Override public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                return loader.shouldInterceptRequest(request.getUrl());
            }
        });
        web.setWebChromeClient(new WebChromeClient());
        web.loadUrl("https://appassets.androidplatform.net/assets/index.html");
        web.postDelayed(new Runnable() {
            @Override public void run() {
                if (web == null || diagnostics == null) return;
                final int width = web.getWidth(), height = web.getHeight();
                final float density = getResources().getDisplayMetrics().density;
                String js = "(function(){return JSON.stringify({inner:[innerWidth,innerHeight],screen:[screen.width,screen.height],dpr:devicePixelRatio,body:[Math.round(document.body.getBoundingClientRect().width),Math.round(document.body.getBoundingClientRect().height)],transform:document.body.style.transform})})()";
                web.evaluateJavascript(js, result -> diagnostics.setText("HumaxPlex DIAG-4 | native " + width + "x" + height + " density " + density + "\\nJS " + result));
            }
        }, 3000);
        web.requestFocus();
    }
    private String action(int code) {
        switch(code) {
            case KeyEvent.KEYCODE_DPAD_LEFT: return "left";
            case KeyEvent.KEYCODE_DPAD_RIGHT: return "right";
            case KeyEvent.KEYCODE_DPAD_UP: return "up";
            case KeyEvent.KEYCODE_DPAD_DOWN: return "down";
            case KeyEvent.KEYCODE_DPAD_CENTER: case KeyEvent.KEYCODE_ENTER: case KeyEvent.KEYCODE_NUMPAD_ENTER: return "enter";
            case KeyEvent.KEYCODE_BACK: case KeyEvent.KEYCODE_ESCAPE: return "back";
            case KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE: return "playpause";
            case KeyEvent.KEYCODE_MEDIA_PLAY: return "play";
            case KeyEvent.KEYCODE_MEDIA_PAUSE: return "pause";
            case KeyEvent.KEYCODE_MEDIA_STOP: return "stop";
            case KeyEvent.KEYCODE_MEDIA_FAST_FORWARD: return "ff";
            case KeyEvent.KEYCODE_MEDIA_REWIND: return "rw";
            case KeyEvent.KEYCODE_CHANNEL_UP: return "pageup";
            case KeyEvent.KEYCODE_CHANNEL_DOWN: return "pagedown";
            default: return null;
        }
    }
    @Override public boolean onKeyDown(int code, KeyEvent event) {
        String a = action(code);
        if (a != null && web != null) {
            web.evaluateJavascript("window.__androidAction && window.__androidAction('" + a + "')", null);
            return true;
        }
        return super.onKeyDown(code, event);
    }
    @Override public void onBackPressed() {
        if (web != null) web.evaluateJavascript("window.__androidAction && window.__androidAction('back')", null);
        else super.onBackPressed();
    }
    @Override protected void onDestroy() {
        if (web != null) { web.destroy(); web = null; }
        super.onDestroy();
    }
}
