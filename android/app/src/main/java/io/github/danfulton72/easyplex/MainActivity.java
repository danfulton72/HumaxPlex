package io.github.danfulton72.easyplex;

import android.app.Activity;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.graphics.Color;
import android.widget.FrameLayout;
import android.widget.TextView;
import android.widget.LinearLayout;
import android.widget.ProgressBar;
import java.util.Locale;
import android.view.Gravity;
import android.webkit.JavascriptInterface;
import androidx.media3.common.MediaItem;
import androidx.media3.common.Player;
import androidx.media3.common.C;
import androidx.media3.common.Tracks;
import androidx.media3.common.TrackSelectionOverride;
import androidx.media3.common.TrackSelectionParameters;
import android.app.AlertDialog;
import android.app.Dialog;
import android.graphics.drawable.GradientDrawable;
import android.util.TypedValue;
import java.util.function.Consumer;
import java.util.ArrayList;
import androidx.media3.common.PlaybackException;
import androidx.media3.exoplayer.ExoPlayer;
import androidx.media3.ui.PlayerView;
import android.view.KeyEvent;
import android.view.View;
import android.view.WindowManager;
import android.view.inputmethod.InputMethodManager;
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
    private Dialog settingsDialog;
    private LinearLayout playbackHud;
    private ProgressBar playbackProgress;
    private TextView playbackTimes;
    private long hudShownAt;
    private int imageFailures = 0;
    private String lastImageIssue = "none";
    private String videoStats = "video idle";
    private long sentDuration = -1;
    private String playbackError = null;
    private long playbackStartedAt = 0;
    private String playbackKind = "unknown";
    // Live TV: set by EasyPlexVideo.setLiveBanner() after open(); cleared by closeVideo().
    // In live mode channel keys go to the web app and the HUD shows now/next.
    private boolean liveMode = false;
    // Films/shows: the web player supplies the HUD text (title, times, seek
    // preview) because it knows the real position across HLS restarts.
    private TextView playbackTitle;
    private String vodTitle = null, vodLine = null;
    private int vodProgress = -1;
    private boolean vodSticky = false;
    private long lastRepeatSent = 0;
    private String liveBanner = null;
    private int liveProgress = -1;
    private final Handler updateHandler = new Handler(Looper.getMainLooper());
    @Override public void onCreate(Bundle saved) {
        super.onCreate(saved);
        android.util.Log.w("EPLX-DBG", "[LIFE] onCreate");
        getWindow().getDecorView().setSystemUiVisibility(5894 | View.SYSTEM_UI_FLAG_LAYOUT_STABLE);
        web = new WebView(this);
        web.setBackgroundColor(0xff0b0d12);
        web.setFocusable(true);
        web.setFocusableInTouchMode(true);
        layout = new FrameLayout(this);
        layout.addView(web, new FrameLayout.LayoutParams(-1, -1));
        diagnostics = new TextView(this);
        diagnostics.setText("EasyPlex DIAG-4 | WebView initializing");
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
                            android.util.Log.w("EasyPlex", "Image proxy HTTP " + code);
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
                        android.util.Log.w("EasyPlex", "Image proxy failed: " + ex.getClass().getSimpleName());
                        return new WebResourceResponse("text/plain", "UTF-8",
                            new java.io.ByteArrayInputStream(new byte[0]));
                    }
                }
                return loader.shouldInterceptRequest(uri);
            }
            @Override public void onPageStarted(WebView view, String url, android.graphics.Bitmap favicon) {
                android.util.Log.w("EPLX-DBG", "[WEB] onPageStarted " + url);
            }
            @Override public void onPageFinished(WebView view, String url) {
                android.util.Log.w("EPLX-DBG", "[WEB] onPageFinished " + url);
            }
            @Override public void onReceivedError(WebView view, int errorCode, String description, String failingUrl) {
                android.util.Log.w("EPLX-DBG", "[WEB] onReceivedError code=" + errorCode + " desc=" + description + " url=" + failingUrl);
            }
        });
        web.setWebChromeClient(new WebChromeClient());
        web.addJavascriptInterface(new NativeVideoBridge(), "EasyPlexVideo");
        web.loadUrl("https://appassets.androidplatform.net/assets/index.html");
        web.postDelayed(new Runnable() {
            @Override public void run() {
                if (web == null || diagnostics == null) return;
                final int width = web.getWidth(), height = web.getHeight();
                final float density = getResources().getDisplayMetrics().density;
                String js = "(function(){return JSON.stringify({inner:[innerWidth,innerHeight],screen:[screen.width,screen.height],dpr:devicePixelRatio,body:[Math.round(document.body.getBoundingClientRect().width),Math.round(document.body.getBoundingClientRect().height)],transform:document.body.style.transform})})()";
                web.evaluateJavascript(js, result -> diagnostics.setText("EasyPlex DIAG-4 | native " + width + "x" + height + " density " + density + "\\nJS " + result));
            }
        }, 3000);
        diagnostics.setVisibility(View.GONE);
        web.requestFocus();
        updateHandler.post(new Runnable() {
            @Override public void run() {
                if (nativePlayer != null) {
                    js("time", String.valueOf(nativePlayer.getCurrentPosition()));
                    long knownDuration = nativePlayer.getDuration();
                    if (knownDuration > 0 && knownDuration != sentDuration) {
                        sentDuration = knownDuration;
                        js("duration", String.valueOf(knownDuration));
                    }
                    androidx.media3.common.Format fmt = nativePlayer.getVideoFormat();
                    androidx.media3.exoplayer.DecoderCounters counts = nativePlayer.getVideoDecoderCounters();
                    updatePlaybackHud();
                    videoStats = fmt == null ? "video initializing" :
                        "video " + fmt.width + "x" + fmt.height + " fps=" + fmt.frameRate +
                        " codec=" + fmt.sampleMimeType + " bitrate=" + fmt.bitrate +
                        " dropped=" + (counts == null ? "?" : counts.droppedBufferCount);
                }
                if (diagnostics != null && diagnostics.getVisibility() == View.VISIBLE) diagnostics.setText(
                    "EasyPlex DIAG-6 | Images failed: " + imageFailures +
                    " last: " + lastImageIssue + "\\n" + videoStats);
                if (web != null) updateHandler.postDelayed(this, 500);
            }
        });
    }

    private String clock(long ms) {
        long sec = Math.max(0, ms / 1000);
        if (sec >= 3600) return String.format(Locale.UK, "%d:%02d:%02d", sec/3600, sec/60%60, sec%60);
        return String.format(Locale.UK, "%02d:%02d", sec/60, sec%60);
    }
    private void showPlaybackHud() {
        if (playbackHud != null) {
            hudShownAt = android.os.SystemClock.uptimeMillis();
            playbackHud.setVisibility(View.VISIBLE);
        }
    }
    private void updatePlaybackHud() {
        if (nativePlayer == null || playbackHud == null) return;
        if (playbackError != null) {
            playbackTimes.setText("Playback failed: " + playbackError);
            playbackHud.setVisibility(View.VISIBLE);
            return;
        }
        if (nativePlayer.getPlaybackState() == Player.STATE_BUFFERING && playbackStartedAt > 0 &&
                android.os.SystemClock.uptimeMillis() - playbackStartedAt > 25000) {
            playbackTimes.setText("Waiting for Plex Live TV stream (25s+) — press Back to exit");
            playbackHud.setVisibility(View.VISIBLE);
            return;
        }
        if (liveMode) {
            playbackTimes.setText(liveBanner == null ? "Live TV" : liveBanner);
            if (liveProgress >= 0) {
                playbackProgress.setVisibility(View.VISIBLE);
                playbackProgress.setProgress(Math.min(1000, liveProgress));
            } else {
                playbackProgress.setVisibility(View.GONE);
            }
            if (nativePlayer.isPlaying() && android.os.SystemClock.uptimeMillis()-hudShownAt>5000)
                playbackHud.setVisibility(View.GONE);
            return;
        }
        if (vodLine != null) {
            playbackTitle.setText(vodTitle == null ? "" : vodTitle);
            playbackTitle.setVisibility(vodTitle == null || vodTitle.isEmpty() ? View.GONE : View.VISIBLE);
            playbackTimes.setText(vodLine);
            playbackProgress.setVisibility(vodProgress >= 0 ? View.VISIBLE : View.GONE);
            if (vodProgress >= 0) playbackProgress.setProgress(Math.min(1000, vodProgress));
            if (!vodSticky && nativePlayer.isPlaying() && android.os.SystemClock.uptimeMillis()-hudShownAt>5000)
                playbackHud.setVisibility(View.GONE);
            return;
        }
        long pos = Math.max(0, nativePlayer.getCurrentPosition());
        long duration = nativePlayer.getDuration();
        if (duration > 0) {
            playbackProgress.setProgress((int)Math.min(1000, pos * 1000.0 / duration));
            long remaining = Math.max(0, duration-pos);
            String end = new java.text.SimpleDateFormat("HH:mm", Locale.UK).format(new java.util.Date(System.currentTimeMillis()+remaining));
            playbackTimes.setText(clock(pos)+" / "+clock(duration)+"  •  Left "+clock(remaining)+"  •  Ends "+end);
        } else {
            playbackTimes.setText(clock(pos)+" / --:--");
        }
        if (nativePlayer.isPlaying() && android.os.SystemClock.uptimeMillis()-hudShownAt>5000)
            playbackHud.setVisibility(View.GONE);
    }
    private void js(String event, String argument) {
        if (web == null) return;
        web.evaluateJavascript("window.__easyplexVideoEvent && window.__easyplexVideoEvent('" +
            event + "'," + argument + ")", null);
    }
    private void setPlaybackAwake(boolean awake) {
        if (awake) getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        else getWindow().clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
    }
    private void closeVideo() {
        setPlaybackAwake(false);
        liveMode = false;
        liveBanner = null;
        liveProgress = -1;
        vodTitle = null; vodLine = null; vodProgress = -1; vodSticky = false;
        if (nativePlayer != null) {
            nativePlayer.release();
            nativePlayer = null;
        }
        if (playbackHud != null) { layout.removeView(playbackHud); playbackHud = null; }
        if (nativeView != null) {
            web.setVisibility(View.VISIBLE);
            layout.removeView(nativeView);
            nativeView = null;
        }
    }
    public final class NativeVideoBridge {
        // Read Tube Archivist metadata off the UI thread. Only the app's own
        // bundled JavaScript can access this bridge; no tokens enter URLs.
        @JavascriptInterface public void fetchSponsor(String endpoint, String token, String requestId) {
            new Thread(() -> {
                int status = 500;
                String response = "";
                HttpURLConnection conn = null;
                try {
                    URL url = new URL(endpoint);
                    String scheme = url.getProtocol();
                    if (!("http".equals(scheme) || "https".equals(scheme)) ||
                        !url.getPath().matches("/api/video/[A-Za-z0-9_-]{11}/")) {
                        throw new IllegalArgumentException("Invalid SponsorBlock endpoint");
                    }
                    conn = (HttpURLConnection) url.openConnection();
                    conn.setConnectTimeout(7000);
                    conn.setReadTimeout(7000);
                    conn.setInstanceFollowRedirects(false); // never send a token to a redirect
                    conn.setRequestProperty("Authorization", "Token " + token);
                    status = conn.getResponseCode();
                    if (status == 200) {
                        try (InputStream in = conn.getInputStream();
                             java.io.ByteArrayOutputStream out = new java.io.ByteArrayOutputStream()) {
                            byte[] bytes = new byte[4096];
                            int n;
                            while ((n = in.read(bytes)) >= 0) {
                                if (out.size() + n > 1024 * 1024) throw new java.io.IOException("Response too large");
                                out.write(bytes, 0, n);
                            }
                            response = out.toString("UTF-8");
                        }
                    }
                } catch (Exception e) {
                    android.util.Log.w("EasyPlex", "SponsorBlock request failed: " + e.getClass().getSimpleName());
                } finally {
                    if (conn != null) conn.disconnect();
                }
                final int resultStatus = status;
                final String resultBody = response;
                runOnUiThread(() -> {
                    if (web != null) web.evaluateJavascript(
                        "window.__easyplexSponsorCallbacks && window.__easyplexSponsorCallbacks[" +
                        org.json.JSONObject.quote(requestId) + "] && window.__easyplexSponsorCallbacks[" +
                        org.json.JSONObject.quote(requestId) + "](" + resultStatus + "," +
                        org.json.JSONObject.quote(resultBody) + ")", null);
                });
            }).start();
        }
        @JavascriptInterface public void imageFailed(String path) {
            runOnUiThread(() -> {
                imageFailures++;
                lastImageIssue = path.length() > 85 ? path.substring(0, 85) : path;
            });
        }
        @JavascriptInterface public void open(String url) {
            runOnUiThread(() -> {
                closeVideo();
                sentDuration = -1;
                playbackError = null;
                playbackKind = url.contains("/video/:/transcode/") ? "Plex HLS transcode" : (url.contains("/livetv/") ? "Live session" : "Direct media");
                playbackStartedAt = android.os.SystemClock.uptimeMillis();
                // Note: no artificial video-size cap here — Media3 has no per-player
                // "max decode size" knob, and a bare live TS has no track selection to
                // constrain. Undecodable channels (4K/HDR HEVC) are handled by the
                // decode watchdog below (BUFFERING >8s => NATIVE_STALL => JS fallback),
                // which fails fast instead of hanging.
                nativePlayer = new ExoPlayer.Builder(MainActivity.this).build();
                nativePlayer.setTrackSelectionParameters(nativePlayer.getTrackSelectionParameters()
                    .buildUpon().setTrackTypeDisabled(C.TRACK_TYPE_TEXT, true).build());
                nativeView = new PlayerView(MainActivity.this);
                nativeView.setUseController(false);
                nativeView.setPlayer(nativePlayer);
                nativeView.setFocusable(false);
                nativeView.setFocusableInTouchMode(false);
                nativeView.setClickable(false);
                layout.addView(nativeView, new FrameLayout.LayoutParams(-1, -1));
                web.setVisibility(View.INVISIBLE);

                playbackHud = new LinearLayout(MainActivity.this);
                playbackHud.setOrientation(LinearLayout.VERTICAL);
                playbackHud.setBackgroundColor(0xcc10141d);
                playbackHud.setPadding(32, 16, 32, 24);
                playbackTitle = new TextView(MainActivity.this);
                playbackTitle.setTextColor(Color.WHITE);
                playbackTitle.setTextSize(22);
                playbackTitle.setTypeface(android.graphics.Typeface.DEFAULT_BOLD);
                playbackTitle.setVisibility(View.GONE);
                playbackHud.addView(playbackTitle);
                playbackTimes = new TextView(MainActivity.this);
                playbackTimes.setTextColor(Color.WHITE);
                playbackTimes.setTextSize(17);
                playbackTimes.setText("00:00 / --:--");
                playbackHud.addView(playbackTimes);
                playbackProgress = new ProgressBar(MainActivity.this, null, android.R.attr.progressBarStyleHorizontal);
                playbackProgress.setMax(1000);
                playbackHud.addView(playbackProgress, new LinearLayout.LayoutParams(-1, 12));
                layout.addView(playbackHud, new FrameLayout.LayoutParams(-1, -2, Gravity.BOTTOM));
                showPlaybackHud();
                // Keep the diagnostic overlay above video during testing.
                diagnostics.bringToFront();
                web.requestFocus();
                nativePlayer.addListener(new Player.Listener() {
                    private long bufferSince = 0;
                    @Override public void onPlaybackStateChanged(int state) {
                        if (state == Player.STATE_READY) {
                            bufferSince = 0;
                            js("ready", "null");
                        } else if (state == Player.STATE_ENDED) {
                            js("end", "null");
                        } else if (state == Player.STATE_BUFFERING) {
                            if (bufferSince == 0) bufferSince = android.os.SystemClock.uptimeMillis();
                            // Decode watchdog: a live TS that can't be decoded sits in
                            // BUFFERING forever. After 8s, tell JS native failed so it
                            // can run its fallback ladder instead of hanging.
                            if (bufferSince > 0 &&
                                android.os.SystemClock.uptimeMillis() - bufferSince > 8000) {
                                bufferSince = 0;
                                playbackError = "Native decode stalled (no video after 8s)";
                                showPlaybackHud();
                                js("error", org.json.JSONObject.quote("NATIVE_STALL"));
                                web.evaluateJavascript(
                                    "window.__easyplexLivePlayError && window.__easyplexLivePlayError(\"NATIVE_STALL\")", null);
                            } else {
                                js("buffer", "true");
                            }
                        }
                    }
                    @Override public void onIsPlayingChanged(boolean playing) {
                        setPlaybackAwake(playing);
                        if (playing) js("buffer", "false");
                    }
                    @Override public void onPlayerError(PlaybackException error) {
                        setPlaybackAwake(false);
                        playbackError = error.getErrorCodeName() + ": " +
                            (error.getMessage() == null ? "unknown" : error.getMessage());
                        Throwable source = error.getCause();
                        while (source != null) {
                            if (source instanceof androidx.media3.datasource.HttpDataSource.InvalidResponseCodeException) {
                                androidx.media3.datasource.HttpDataSource.InvalidResponseCodeException http =
                                    (androidx.media3.datasource.HttpDataSource.InvalidResponseCodeException) source;
                                playbackError = playbackKind + " · HTTP " + http.responseCode;
                                break;
                            }
                            source = source.getCause();
                        }
                        showPlaybackHud();
                        js("error", org.json.JSONObject.quote(error.getMessage() == null ? "Media3 playback failed" : error.getMessage()));
                        // Also notify the Live TV screen's own error hook (it drives
                        // playback directly, not through the main player listener).
                        web.evaluateJavascript(
                            "window.__easyplexLivePlayError && window.__easyplexLivePlayError(" +
                            org.json.JSONObject.quote(playbackError) + ")", null);
                    }
                });
                nativePlayer.setMediaItem(new MediaItem.Builder().setUri(url)
                    .setMimeType(url.contains("/proxy/ts/") ? androidx.media3.common.MimeTypes.VIDEO_MP2T : null)
                    .build());
                nativePlayer.prepare();
                nativePlayer.play();
            });
        }
        @JavascriptInterface public void loadHdhrLineup(String deviceUri) {
            new Thread(() -> {
                String result;
                try {
                    Uri base = Uri.parse(deviceUri);
                    if (!"https".equalsIgnoreCase(base.getScheme()) &&
                        !"http".equalsIgnoreCase(base.getScheme()))
                        throw new IllegalArgumentException("Tuner URL must be HTTP(S)");
                    String path = base.getPath() == null ? "" : base.getPath().replaceAll("/+$", "");
                    if (!path.endsWith("/hdhr"))
                        throw new IllegalArgumentException("Tuner URL does not end in /hdhr");
                    URL endpoint = new URL(base.buildUpon().path(path + "/lineup.json").clearQuery().build().toString());
                    HttpURLConnection conn = (HttpURLConnection) endpoint.openConnection();
                    conn.setConnectTimeout(9000);
                    conn.setReadTimeout(12000);
                    conn.setInstanceFollowRedirects(false);
                    int status = conn.getResponseCode();
                    if (status != 200) throw new java.io.IOException("HDHR lineup HTTP " + status);
                    try (InputStream stream = conn.getInputStream()) {
                        java.io.ByteArrayOutputStream bytes = new java.io.ByteArrayOutputStream();
                        byte[] buffer = new byte[8192];
                        int n;
                        while ((n = stream.read(buffer)) != -1) {
                            if (bytes.size() + n > 500000) throw new java.io.IOException("Lineup too large");
                            bytes.write(buffer,0,n);
                        }
                        result = bytes.toString("UTF-8");
                        new org.json.JSONArray(result);
                    } finally { conn.disconnect(); }
                } catch (Exception e) {
                    result = "{\"error\":" + org.json.JSONObject.quote(
                        e.getClass().getSimpleName()+": "+e.getMessage()) + "}";
                }
                final String payload = result;
                runOnUiThread(() -> web.evaluateJavascript(
                    "window.__easyplexHdhrLineup && window.__easyplexHdhrLineup(" +
                    org.json.JSONObject.quote(payload) + ")", null));
            }).start();
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
        // Identity of this box for Plex: manufacturer, model, Android and app version.
        @JavascriptInterface public String deviceInfo() {
            org.json.JSONObject out = new org.json.JSONObject();
            try {
                out.put("manufacturer", android.os.Build.MANUFACTURER);
                out.put("model", android.os.Build.MODEL);
                out.put("release", android.os.Build.VERSION.RELEASE);
                String version = "";
                try { version = getPackageManager().getPackageInfo(getPackageName(), 0).versionName; }
                catch (Exception ignored) { /* leave blank */ }
                out.put("appVersion", version == null ? "" : version);
            } catch (org.json.JSONException ignored) { /* return what we have */ }
            return out.toString();
        }
        // Does this box have a decoder for the given MIME type (e.g. "video/av01")?
        // Used to decide whether an exotic codec can be direct-played instead of
        // transcoded. Returns "1"/"0"; empty string if the query itself failed.
        @JavascriptInterface public String canDecode(String mimeType) {
            try {
                android.media.MediaCodecList list = new android.media.MediaCodecList(android.media.MediaCodecList.ALL_CODECS);
                for (android.media.MediaCodecInfo info : list.getCodecInfos()) {
                    if (!info.isEncoder()) {
                        String[] types = info.getSupportedTypes();
                        for (int i = 0; i < types.length; i++) {
                            if (types[i] != null && types[i].equalsIgnoreCase(mimeType)) return "1";
                        }
                    }
                }
                return "0";
            } catch (Exception e) {
                return "";
            }
        }
        // Like canDecode, but only counts HARDWARE decoders. The generic Android
        // fallback decoder is named "android.<codec>.decoder" or
        // "c2.android.<codec>.decoder" and runs in software (it pegs the CPU and
        // drops frames on mid-range boxes). Real hardware decoders carry the SoC
        // vendor prefix (c2.mtk.*, c2.qcom.*, c2.samsung.*, ...). We use this to
        // avoid direct-playing a codec that only has a slow software path.
        // Returns "1"/"0"; empty string if the query itself failed.
        @JavascriptInterface public String canDecodeHW(String mimeType) {
            try {
                android.media.MediaCodecList list = new android.media.MediaCodecList(android.media.MediaCodecList.ALL_CODECS);
                for (android.media.MediaCodecInfo info : list.getCodecInfos()) {
                    if (info.isEncoder()) continue;
                    String name = info.getName() == null ? "" : info.getName().toLowerCase();
                    // Skip the generic software decoder(s).
                    if (name.startsWith("android.") || name.startsWith("c2.android.")) continue;
                    String[] types = info.getSupportedTypes();
                    for (int i = 0; i < types.length; i++) {
                        if (types[i] != null && types[i].equalsIgnoreCase(mimeType)) return "1";
                    }
                }
                return "0";
            } catch (Exception e) {
                return "";
            }
        }
        // Film/show HUD text from the web player. progress is 0-1000 or -1;
        // show brings the HUD up; sticky keeps it up (paused, seeking).
        @JavascriptInterface public void setHud(String title, String line, int progress, boolean show, boolean sticky) {
            runOnUiThread(() -> {
                if (nativePlayer == null || liveMode) return;
                vodTitle = title; vodLine = line; vodProgress = progress; vodSticky = sticky;
                if (show) showPlaybackHud();
                updatePlaybackHud();
            });
        }
        // Text fields: remote keys are handled here and passed to the page as
        // actions, so focusing an <input> from script never counts as the user
        // selecting it and Android won't raise the keyboard by itself.
        @JavascriptInterface public void showKeyboard() {
            runOnUiThread(() -> {
                if (web == null) return;
                web.requestFocus();
                InputMethodManager imm = (InputMethodManager) getSystemService(INPUT_METHOD_SERVICE);
                if (imm == null) return;
                if (!imm.showSoftInput(web, InputMethodManager.SHOW_IMPLICIT))
                    imm.showSoftInput(web, InputMethodManager.SHOW_FORCED);
            });
        }
        @JavascriptInterface public void hideKeyboard() {
            runOnUiThread(() -> {
                InputMethodManager imm = (InputMethodManager) getSystemService(INPUT_METHOD_SERVICE);
                if (imm != null && web != null) imm.hideSoftInputFromWindow(web.getWindowToken(), 0);
            });
        }
        @JavascriptInterface public void hideHud() {
            runOnUiThread(() -> { vodSticky = false; if (playbackHud != null) playbackHud.setVisibility(View.GONE); });
        }
        // A list of choices shown natively (usable over video, where the web UI
        // is hidden). The chosen index is passed to window.__easyplexMenuChoice.
        @JavascriptInterface public void showMenu(String title, String itemsJson) {
            runOnUiThread(() -> {
                try {
                    org.json.JSONArray arr = new org.json.JSONArray(itemsJson);
                    String[] labels = new String[arr.length()];
                    for (int i = 0; i < arr.length(); i++) labels[i] = arr.getString(i);
                    showOptions(title, labels, i -> {
                        if (web != null) web.evaluateJavascript("window.__easyplexMenuChoice && window.__easyplexMenuChoice(" + i + ")", null);
                    });
                } catch (org.json.JSONException ignored) { /* bad list: show nothing */ }
            });
        }
        // Back on the home screen leaves the app.
        @JavascriptInterface public void exit() { android.util.Log.w("EPLX-DBG", "[BRIDGE] exit() called -> finish()"); runOnUiThread(() -> finish()); }
        // Marks the current stream as live TV and shows a now/next banner over it.
        // progress is 0-1000 through the current programme, or -1 to hide the bar.
        @JavascriptInterface public void setLiveBanner(String text, int progress) {
            runOnUiThread(() -> {
                if (nativePlayer == null) return;
                liveMode = true;
                liveBanner = text;
                liveProgress = progress;
                showPlaybackHud();
                updatePlaybackHud();
            });
        }
    }


    private int dp(int n) {
        return (int) TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, n,
            getResources().getDisplayMetrics());
    }
    private void showOptions(String title, String[] options, Consumer<Integer> callback) {
        if (settingsDialog != null) settingsDialog.dismiss();
        Dialog dialog = new Dialog(this);
        settingsDialog = dialog;
        LinearLayout panel = new LinearLayout(this);
        panel.setOrientation(LinearLayout.VERTICAL);
        panel.setPadding(dp(22), dp(20), dp(22), dp(20));
        GradientDrawable bg = new GradientDrawable();
        bg.setColor(0xf51a202c);
        bg.setCornerRadius(dp(20));
        bg.setStroke(dp(1), 0xff424c5e);
        panel.setBackground(bg);
        TextView heading = new TextView(this);
        heading.setText(title);
        heading.setTextSize(23);
        heading.setTextColor(Color.WHITE);
        heading.setPadding(dp(8), 0, dp(8), dp(12));
        panel.addView(heading);
        for (int i = 0; i < options.length; i++) {
            final int index = i;
            TextView option = new TextView(this);
            option.setText(options[i]);
            option.setTextSize(17);
            option.setTextColor(0xfff7f4ef);
            option.setFocusable(true);
            option.setClickable(true);
            option.setPadding(dp(14), dp(10), dp(14), dp(10));
            GradientDrawable item = new GradientDrawable();
            item.setColor(0xff293242);
            item.setCornerRadius(dp(10));
            option.setBackground(item);
            LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(-1, -2);
            lp.bottomMargin = dp(5);
            panel.addView(option, lp);
            option.setOnFocusChangeListener((view, focused) -> {
                item.setColor(focused ? 0xffc84552 : 0xff293242);
                option.invalidate();
            });
            option.setOnClickListener(v -> {
                dialog.dismiss();
                if (settingsDialog == dialog) settingsDialog = null;
                callback.accept(index);
            });
            if (i == 0) option.requestFocus();
        }
        dialog.setContentView(panel);
        dialog.getWindow().setBackgroundDrawableResource(android.R.color.transparent);
        dialog.getWindow().setLayout(dp(500), -2);
        dialog.setOnDismissListener(d -> {
            if (settingsDialog == dialog) settingsDialog = null;
        });
        dialog.show();
        dialog.getWindow().setLayout(Math.min(dp(500), getResources().getDisplayMetrics().widthPixels - dp(60)), -2);
    }
    private void requestQuality(int bitrate, String resolution) {
        if (nativePlayer == null) return;
        String statement = "window.__easyplexSetQuality && window.__easyplexSetQuality(" +
            bitrate + "," + org.json.JSONObject.quote(resolution) + ")";
        web.evaluateJavascript(statement, null);
        showPlaybackHud();
    }
    private void chooseQuality() {
        showOptions("Video quality", new String[]{
            "Original • Direct play when supported",
            "1080p • 12 Mbps (transcode)",
            "1080p • 8 Mbps (transcode)",
            "720p • 4 Mbps (transcode)",
            "480p • 2 Mbps (transcode)"
        }, choice -> {
            switch (choice) {
                case 0: requestQuality(0, "original"); break;
                case 1: requestQuality(12000, "1920x1080"); break;
                case 2: requestQuality(8000, "1920x1080"); break;
                case 3: requestQuality(4000, "1280x720"); break;
                case 4: requestQuality(2000, "854x480"); break;
            }
        });
    }
    private void showTrackMenu() {
        if (nativePlayer == null) return;
        showOptions("Playback settings", new String[]{
            "Audio tracks", "Subtitles", "Video quality", "Video information"
        }, choice -> {
            if (choice == 0) chooseTracks(C.TRACK_TYPE_AUDIO);
            if (choice == 1) chooseTracks(C.TRACK_TYPE_TEXT);
            if (choice == 2) chooseQuality();
            if (choice == 3) {
                androidx.media3.common.Format fmt = nativePlayer.getVideoFormat();
                showOptions("Video information",
                    new String[]{fmt == null ? "Not available" : fmt.width + "x" + fmt.height +
                        " • " + fmt.sampleMimeType + " • " + fmt.frameRate + " fps", "Back"},
                    selected -> showTrackMenu());
            }
        });
    }
    private void chooseTracks(int type) {
        if (nativePlayer == null) return;
        ArrayList<String> labels = new ArrayList<>();
        ArrayList<Tracks.Group> groups = new ArrayList<>();
        ArrayList<Integer> indices = new ArrayList<>();
        if (type == C.TRACK_TYPE_TEXT) labels.add("Off");
        for (Tracks.Group group : nativePlayer.getCurrentTracks().getGroups()) {
            if (group.getType() != type) continue;
            for (int i = 0; i < group.length; i++) {
                if (!group.isTrackSupported(i)) continue;
                androidx.media3.common.Format fmt = group.getTrackFormat(i);
                labels.add((fmt.language == null ? "Unknown" : fmt.language) +
                    " - " + (fmt.label == null ? String.valueOf(fmt.sampleMimeType) : fmt.label));
                groups.add(group);
                indices.add(i);
            }
        }
        if (labels.isEmpty()) {
            new AlertDialog.Builder(this).setMessage("No selectable tracks")
                .setPositiveButton("OK", null).show();
            return;
        }
        showOptions(type == C.TRACK_TYPE_AUDIO ? "Audio tracks" : "Subtitles",
            labels.toArray(new String[0]), selected -> {
                TrackSelectionParameters.Builder b = nativePlayer.getTrackSelectionParameters().buildUpon();
                if (type == C.TRACK_TYPE_TEXT && selected == 0) {
                    b.setTrackTypeDisabled(C.TRACK_TYPE_TEXT, true);
                } else {
                    int n = selected - (type == C.TRACK_TYPE_TEXT ? 1 : 0);
                    b.setTrackTypeDisabled(type, false);
                    b.clearOverridesOfType(type);
                    b.addOverride(new TrackSelectionOverride(groups.get(n).getMediaTrackGroup(), indices.get(n)));
                }
                nativePlayer.setTrackSelectionParameters(b.build());
                showPlaybackHud();
            });
    }
    private String action(int code) {
        if (code >= KeyEvent.KEYCODE_0 && code <= KeyEvent.KEYCODE_9) return "digit" + (code - KeyEvent.KEYCODE_0);
        if (code >= KeyEvent.KEYCODE_NUMPAD_0 && code <= KeyEvent.KEYCODE_NUMPAD_9) return "digit" + (code - KeyEvent.KEYCODE_NUMPAD_0);
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
            case KeyEvent.KEYCODE_MEDIA_RECORD: case KeyEvent.KEYCODE_PROG_RED: case KeyEvent.KEYCODE_R: return "record";
            case KeyEvent.KEYCODE_CHANNEL_UP: return "pageup";
            case KeyEvent.KEYCODE_CHANNEL_DOWN: return "pagedown";
            case KeyEvent.KEYCODE_PROG_GREEN: return "green";
            case KeyEvent.KEYCODE_PROG_YELLOW: return "yellow";
            case KeyEvent.KEYCODE_PROG_BLUE: return "blue";
            case KeyEvent.KEYCODE_INFO: return "info";
            case KeyEvent.KEYCODE_LAST_CHANNEL: return "last";
            case KeyEvent.KEYCODE_MENU: return "menu";
            default: return null;
        }
    }
    // OK/Select: a short press is "enter" (sent on release); holding it for
    // LONG_PRESS_MS sends "menu" instead. Remotes without colour or record keys
    // (e.g. Google TV remotes) reach Live TV options this way.
    private static final long LONG_PRESS_MS = 600;
    private static final long SEEK_REPEAT_MS = 150;
    private boolean selectHeld = false, selectLongSent = false;
    // Holding OK: options list in the web UI, or playback settings over a film/show.
    private final Runnable selectLongPress = () -> {
        if (!selectHeld || web == null) return;
        selectLongSent = true;
        if (isVodPlaying()) showTrackMenu();
        else sendAction("menu");
    };
    private void sendAction(String a) {
        if (web != null) web.evaluateJavascript("window.__androidAction && window.__androidAction('" + a + "')", null);
    }
    private boolean isSelectKey(int code) {
        return code == KeyEvent.KEYCODE_DPAD_CENTER || code == KeyEvent.KEYCODE_ENTER || code == KeyEvent.KEYCODE_NUMPAD_ENTER;
    }
    private boolean isVodPlaying() {
        return nativePlayer != null && !liveMode && nativePlayer.getPlaybackState() != Player.STATE_IDLE;
    }
    @Override public boolean dispatchKeyEvent(KeyEvent event) {
        if (settingsDialog != null && settingsDialog.isShowing()) return super.dispatchKeyEvent(event);
        // Route remote keys before the Media3 video view can consume them.
        String a = action(event.getKeyCode());
        if (a == null || web == null) return super.dispatchKeyEvent(event);
        // OK/Select: short press = "enter" on release, hold = options.
        if (isSelectKey(event.getKeyCode())) {
            if (event.getAction() == KeyEvent.ACTION_DOWN && event.getRepeatCount() == 0) {
                selectHeld = true;
                selectLongSent = false;
                updateHandler.postDelayed(selectLongPress, LONG_PRESS_MS);
            } else if (event.getAction() == KeyEvent.ACTION_UP) {
                updateHandler.removeCallbacks(selectLongPress);
                boolean wasHeld = selectHeld;
                selectHeld = false;
                if (wasHeld && !selectLongSent) {
                    if (liveMode && nativePlayer != null) showPlaybackHud();
                    sendAction("enter");
                }
            }
            return true;
        }
        if (event.getAction() != KeyEvent.ACTION_DOWN) return true;
        if (nativePlayer != null && nativePlayer.getPlaybackState() != Player.STATE_IDLE) {
            if (liveMode) {
                showPlaybackHud();
                // Live TV: Right opens audio/subtitles; play/pause act directly;
                // every other key (channels, last, now/next, menu, back) goes to JS.
                switch (a) {
                    case "right": if (event.getRepeatCount() == 0) showTrackMenu(); return true;
                    case "playpause": if (event.getRepeatCount() == 0) { if (nativePlayer.isPlaying()) nativePlayer.pause(); else nativePlayer.play(); } return true;
                    case "play": nativePlayer.play(); return true;
                    case "pause": nativePlayer.pause(); return true;
                }
                sendAction(a);
                return true;
            }
            // Films/shows: Down opens playback settings natively; everything
            // else goes to the web player, which drives seeking, pause (and
            // reports both to Plex) and the HUD text. Held seek keys repeat at
            // a steady pace so the web player's accelerating steps stay usable.
            if ("down".equals(a)) { if (event.getRepeatCount() == 0) showTrackMenu(); return true; }
            if (event.getRepeatCount() > 0) {
                boolean seekKey = "left".equals(a) || "right".equals(a) || "ff".equals(a) || "rw".equals(a);
                long now = android.os.SystemClock.uptimeMillis();
                if (!seekKey || now - lastRepeatSent < SEEK_REPEAT_MS) return true;
                lastRepeatSent = now;
            }
            sendAction(a);
            return true;
        }
        sendAction(a);
        return true;
    }
    // Leaving the app (Home, input switch, screen off): films pause, live TV
    // stops so the Dispatcharr stream is released. The web UI decides what
    // that means for its screens through window.__easyplexLifecycle.
    @Override protected void onStop() {
        android.util.Log.w("EPLX-DBG", "[LIFE] onStop  (activity going to background)");
        if (nativePlayer != null) {
            if (liveMode) closeVideo();
            else nativePlayer.pause();
        }
        if (web != null) web.evaluateJavascript("window.__easyplexLifecycle && window.__easyplexLifecycle('stop')", null);
        super.onStop();
    }
    @Override protected void onStart() {
        android.util.Log.w("EPLX-DBG", "[LIFE] onStart");
        super.onStart();
        if (web != null) web.evaluateJavascript("window.__easyplexLifecycle && window.__easyplexLifecycle('start')", null);
    }
    @Override protected void onPause() {
        android.util.Log.w("EPLX-DBG", "[LIFE] onPause");
        super.onPause();
        if (web != null) web.onPause();
    }
    @Override protected void onResume() {
        android.util.Log.w("EPLX-DBG", "[LIFE] onResume (activity foregrounded)");
        super.onResume();
        if (web != null) web.onResume();
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
        android.util.Log.w("EPLX-DBG", "[LIFE] onDestroy (activity being destroyed)");
        closeVideo();
        if (web != null) { web.destroy(); web = null; }
        super.onDestroy();
    }
}
