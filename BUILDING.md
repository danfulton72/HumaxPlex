# Building & testing

## What gets built

`android/` is a small Android app: a full-screen WebView that loads the UI from
`web/` (packaged as APK assets), a Media3/ExoPlayer video player for playback,
and remote-key handling. Edit files in `web/` directly; there is no
code-generation or patch step.

## Building

See the README for GitHub Actions and Android Studio builds. Command line, with
JDK 17, Android SDK 35 and Gradle 8.7+ installed:

```bash
python scripts/make_tv_banner.py   # optional, needs Pillow
cd android && gradle assembleDebug
```

## Trying UI changes quickly

Most UI work can be checked in a desktop browser: serve `web/` with any static
server (for example `python -m http.server -d web 8000`) and open it in Chrome
at 1920×1080. Arrow keys, Enter, Backspace (back) and M (menu) act as the
remote. Plex sign-in works; video playback and Live TV tuning need the Android
app, because they go through the native player.

## Installing

Copy the APK onto a USB stick (or use a "Send files to TV" app), open it with
the device's file manager and allow installation when prompted. Root is not
needed.

## Known limitations

Playback compatibility depends on the box's video decoder and firmware. A
successful Gradle build does not prove playback works; test on the device. If
something fails and ADB is already enabled, `adb logcat` output (filter on
`EasyPlex`) and a description of the failing step help most. Live TV has an
on-screen diagnostics page (Green key, or hold OK → Diagnostics).
