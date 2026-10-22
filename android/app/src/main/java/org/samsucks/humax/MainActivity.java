package org.samsucks.humax;

import android.app.Activity;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.graphics.Color;
import android.widget.FrameLayout;
import android.widget.TextView;
import android.view.Gravity;
import android.webkit.JavascriptInterface;
import androidx.media3.common.MediaItem;
import androidx.media3.common.Player;
import androidx.media3.common.PlaybackException;
import androidx.media3.exoplayer.ExoPlayer;
import androidx.media3.ui.PlayerView;
import android.view.KeyEvent;
import android.view.View;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;
import androidx.webkit.WebViewAssetLoader;
import androidx.webkit.WebViewClientCompat;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.net.Uri;
import java.net.HttpURLConnection;
import java.net.URL;
import java.io.InputStream;

public final class MainActivity extends Activity {
    private WebView web;
    private TextView diagnostics;
    private FrameLayout layout;
    private PlayerView nativeView;
    private ExoPlayer nativePlayer;
    private int imageFailures = 0;
    private String lastImageIssue = "none";
    private String videoStats = "video idle";
    private final Handler updateHandler = new Handler(Looper.getMainLooper());
    @Override public void onCreate(Bundle saved) {
        super.onCreate(saved);
        getWindow().getDecorView().setSystemUiVisibility(5894 | View.SYSTEM_UI_FLAG_LAYOUT_STABLE);
        web = new WebView(this);
        web.setBackgroundColor(0xff0b0d12);
        web.setFocusable(true);
        web.setFocusableInTouchMode(true);
        layout = new FrameLayout(this);
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
                Uri uri = request.getUrl();
                if ("appassets.androidplatform.net".equals(uri.getHost()) &&
                    "/pleximg".equals(uri.getPath())) {
                    String remote = uri.getQueryParameter("url");
                    if (remote == null || !(remote.startsWith("http://") || remote.startsWith("https://"))) {
                        return new WebResourceResponse("text/plain", "UTF-8", 400,
                            "Bad image URL", java.util.Collections.emptyMap(),
                            new java.io.ByteArrayInputStream(new byte[0]));
                    }
                    try {
                        HttpURLConnection conn = (HttpURLConnection) new URL(remote).openConnection();
                        conn.setConnectTimeout(8000);
                        conn.setReadTimeout(12000);
                        conn.setInstanceFollowRedirects(true);
                        int code = conn.getResponseCode();
                        if (code < 200 || code >= 300) {
                            android.util.Log.w("HumaxPlex", "Image proxy HTTP " + code);
                            conn.disconnect();
                            return new WebResourceResponse("text/plain", "UTF-8", code,
                                "Image HTTP error", java.util.Collections.emptyMap(),
                                new java.io.ByteArrayInputStream(new byte[0]));
                        }
                        String mime = conn.getContentType();
                        if (mime != null) mime = mime.split(";")[0];
                        if (mime == null || !mime.startsWith("image/")) mime = "image/jpeg";
                        InputStream stream = conn.getInputStream();
                        return new WebResourceResponse(mime, null, stream);
                    } catch (Exception ex) {
                        android.util.Log.w("HumaxPlex", "Image proxy failed: " + ex.getClass().getSimpleName());
                        return new WebResourceResponse("text/plain", "UTF-8",
                            new java.io.ByteArrayInputStream(new byte[0]));
                    }
                }
                return loader.shouldInterceptRequest(uri);
            }
        });
        web.setWebChromeClient(new WebChromeClient());
        web.addJavascriptInterface(new NativeVideoBridge(), "HumaxVideo");
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
        // Diagnostics remain visible during this test.
        web.requestFocus();
        updateHandler.post(new Runnable() {
            @Override public void run() {
                if (nativePlayer != null) {
                    js("time", String.valueOf(nativePlayer.getCurrentPosition()));
                    androidx.media3.common.Format fmt = nativePlayer.getVideoFormat();
                    androidx.media3.exoplayer.DecoderCounters counts = nativePlayer.getVideoDecoderCounters();
                    videoStats = fmt == null ? "video initializing" :
                        "video " + fmt.width + "x" + fmt.height + " fps=" + fmt.frameRate +
                        " codec=" + fmt.sampleMimeType + " bitrate=" + fmt.bitrate +
                        " dropped=" + (counts == null ? "?" : counts.droppedBufferCount);
                }
                if (diagnostics != null) diagnostics.setText(
                    "HumaxPlex DIAG-6 | Images failed: " + imageFailures +
                    " last: " + lastImageIssue + "\\n" + videoStats);
                if (web != null) updateHandler.postDelayed(this, 500);
            }
        });
    }
    private void js(String event, String argument) {
        if (web == null) return;
        web.evaluateJavascript("window.__humaxVideoEvent && window.__humaxVideoEvent('" +
            event + "'," + argument + ")", null);
    }
    private void closeVideo() {
        if (nativePlayer != null) {
            nativePlayer.release();
            nativePlayer = null;
        }
        if (nativeView != null) {
            layout.removeView(nativeView);
            nativeView = null;
        }
    }
    public final class NativeVideoBridge {
        @JavascriptInterface public void imageFailed(String path) {
            runOnUiThread(() -> {
                imageFailures++;
                lastImageIssue = path.length() > 85 ? path.substring(0, 85) : path;
            });
        }
        @JavascriptInterface public void open(String url) {
            runOnUiThread(() -> {
                closeVideo();
                nativePlayer = new ExoPlayer.Builder(MainActivity.this).build();
                nativeView = new PlayerView(MainActivity.this);
                nativeView.setUseController(false);
                nativeView.setPlayer(nativePlayer);
                nativeView.setFocusable(false);
                nativeView.setFocusableInTouchMode(false);
                nativeView.setClickable(false);
                layout.addView(nativeView, new FrameLayout.LayoutParams(-1, -1));
                // Keep the diagnostic overlay above video during testing.
                diagnostics.bringToFront();
                web.requestFocus();
                nativePlayer.addListener(new Player.Listener() {
                    @Override public void onPlaybackStateChanged(int state) {
                        if (state == Player.STATE_READY) js("ready", "null");
                        else if (state == Player.STATE_ENDED) js("end", "null");
                        else if (state == Player.STATE_BUFFERING) js("buffer", "true");
                    }
                    @Override public void onIsPlayingChanged(boolean playing) {
                        if (playing) js("buffer", "false");
                    }
                    @Override public void onPlayerError(PlaybackException error) {
                        js("error", org.json.JSONObject.quote(error.getMessage() == null ? "Media3 playback failed" : error.getMessage()));
                    }
                });
                nativePlayer.setMediaItem(MediaItem.fromUri(url));
                nativePlayer.prepare();
                nativePlayer.play();
            });
        }
        @JavascriptInterface public void play() {
            runOnUiThread(() -> { if (nativePlayer != null) nativePlayer.play(); });
        }
        @JavascriptInterface public void pause() {
            runOnUiThread(() -> { if (nativePlayer != null) nativePlayer.pause(); });
        }
        @JavascriptInterface public void seek(long milliseconds) {
            runOnUiThread(() -> { if (nativePlayer != null) nativePlayer.seekTo(milliseconds); });
        }
        @JavascriptInterface public long time() {
            // Position is updated asynchronously via JS timer; see polling below.
            return nativePlayer == null ? 0 : nativePlayer.getCurrentPosition();
        }
        @JavascriptInterface public void close() { runOnUiThread(() -> closeVideo()); }
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
    @Override public boolean dispatchKeyEvent(KeyEvent event) {
        // Route remote keys before the Media3 video view can consume them.
        String a = action(event.getKeyCode());
        if (a != null && web != null) {
            if (event.getAction() == KeyEvent.ACTION_DOWN) {
                // The native player overlays the HTML controls. Handle playback keys
                // here so pause/seek work even when WebView cannot show the OSD.
                if (nativePlayer != null && nativePlayer.getPlaybackState() != Player.STATE_IDLE) {
                    switch (a) {
                        case "playpause":
                        case "enter":
                            if (event.getRepeatCount() == 0) {
                                if (nativePlayer.isPlaying()) nativePlayer.pause();
                                else nativePlayer.play();
                            }
                            return true;
                        case "play": nativePlayer.play(); return true;
                        case "pause": nativePlayer.pause(); return true;
                        case "left": case "rw":
                            if (event.getRepeatCount() == 0)
                                nativePlayer.seekTo(Math.max(0, nativePlayer.getCurrentPosition() - 10000));
                            return true;
                        case "right": case "ff":
                            if (event.getRepeatCount() == 0)
                                nativePlayer.seekTo(Math.min(nativePlayer.getDuration() > 0 ? nativePlayer.getDuration() : Long.MAX_VALUE,
                                    nativePlayer.getCurrentPosition() + 10000));
                            return true;
                    }
                }
                web.evaluateJavascript("window.__androidAction && window.__androidAction('" + a + "')", null);
            }
            return true;
        }
        return super.dispatchKeyEvent(event);
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
        closeVideo();
        if (web != null) { web.destroy(); web = null; }
        super.onDestroy();
    }
}
