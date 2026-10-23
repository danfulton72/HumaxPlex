package org.samsucks.humax;

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
    private String playbackError = null;
    private long playbackStartedAt = 0;
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
        diagnostics.setVisibility(View.GONE);
        web.requestFocus();
        updateHandler.post(new Runnable() {
            @Override public void run() {
                if (nativePlayer != null) {
                    js("time", String.valueOf(nativePlayer.getCurrentPosition()));
                    androidx.media3.common.Format fmt = nativePlayer.getVideoFormat();
                    androidx.media3.exoplayer.DecoderCounters counts = nativePlayer.getVideoDecoderCounters();
                    updatePlaybackHud();
                    videoStats = fmt == null ? "video initializing" :
                        "video " + fmt.width + "x" + fmt.height + " fps=" + fmt.frameRate +
                        " codec=" + fmt.sampleMimeType + " bitrate=" + fmt.bitrate +
                        " dropped=" + (counts == null ? "?" : counts.droppedBufferCount);
                }
                if (diagnostics != null && diagnostics.getVisibility() == View.VISIBLE) diagnostics.setText(
                    "HumaxPlex DIAG-6 | Images failed: " + imageFailures +
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
        web.evaluateJavascript("window.__humaxVideoEvent && window.__humaxVideoEvent('" +
            event + "'," + argument + ")", null);
    }
    private void setPlaybackAwake(boolean awake) {
        if (awake) getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        else getWindow().clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
    }
    private void closeVideo() {
        setPlaybackAwake(false);
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
        @JavascriptInterface public void imageFailed(String path) {
            runOnUiThread(() -> {
                imageFailures++;
                lastImageIssue = path.length() > 85 ? path.substring(0, 85) : path;
            });
        }
        @JavascriptInterface public void open(String url) {
            runOnUiThread(() -> {
                closeVideo();
                playbackError = null;
                playbackStartedAt = android.os.SystemClock.uptimeMillis();
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
                    @Override public void onPlaybackStateChanged(int state) {
                        if (state == Player.STATE_READY) js("ready", "null");
                        else if (state == Player.STATE_ENDED) js("end", "null");
                        else if (state == Player.STATE_BUFFERING) js("buffer", "true");
                    }
                    @Override public void onIsPlayingChanged(boolean playing) {
                        setPlaybackAwake(playing);
                        if (playing) js("buffer", "false");
                    }
                    @Override public void onPlayerError(PlaybackException error) {
                        setPlaybackAwake(false);
                        playbackError = error.getErrorCodeName() + ": " +
                            (error.getMessage() == null ? "unknown" : error.getMessage());
                        showPlaybackHud();
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
        String statement = "window.__humaxSetQuality && window.__humaxSetQuality(" +
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
        if (settingsDialog != null && settingsDialog.isShowing()) return super.dispatchKeyEvent(event);
        // Route remote keys before the Media3 video view can consume them.
        String a = action(event.getKeyCode());
        if (a != null && web != null) {
            if (event.getAction() == KeyEvent.ACTION_DOWN) {
                // The native player overlays the HTML controls. Handle playback keys
                // here so pause/seek work even when WebView cannot show the OSD.
                if (nativePlayer != null && nativePlayer.getPlaybackState() != Player.STATE_IDLE) {
                    showPlaybackHud();
                    switch (a) {
                        case "down":
                            if (event.getRepeatCount() == 0) showTrackMenu();
                            return true;
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
