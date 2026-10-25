# EasyPlex

A fast, remote-friendly Plex client for Android TV boxes, with a Live TV guide,
DVR recording and direct Dispatcharr playback.

Tested on the Humax FVP-4KGTR (Android 9). Intended to work on other Android TV
and Google TV devices such as the Dangbei DBOX02 (Android 11). Not affiliated
with Plex, Humax, Dangbei or Google.

## Project layout

| Path | What it is |
| --- | --- |
| `web/` | The user interface (HTML, CSS and JavaScript), packaged into the APK as-is |
| `web/js/screens/livetv.js`, `web/css/livetv.css` | Live TV guide, recording and channel zapping |
| `android/` | The Android shell: WebView, Media3 video player and remote-key handling |
| `scripts/make_tv_banner.py` | Generates the Android TV launcher banner from the app icon |

Everything needed to build is in this repository; nothing is downloaded or
patched at build time.

## Build

### GitHub Actions (recommended)

Select **Actions → Build EasyPlex debug APK → Run workflow** (it also runs on
every push to `main`) and download the `EasyPlex-debug-apk` artifact. The
artifact is a ZIP; extract the APK before installing.

### Android Studio

Install Android Studio with JDK 17, SDK Platform 35 and Build-Tools. Optionally
run `python scripts/make_tv_banner.py` (needs Pillow) to generate the launcher
banner. Open `android/`, use Gradle 8.7 if asked (no wrapper is included), sync,
then **Build → Build APK(s)**. Output:
`android/app/build/outputs/apk/debug/EasyPlex-debug.apk`.

## APK updates and permanent signing

The GitHub Actions APK is signed with a persistent certificate and a version
code derived from the run number, so new builds install over old ones. **Four
repository Actions secrets must be configured once.** An APK signed with a
different key cannot upgrade an installed one.

1. Generate a keystore (JDK 17 `keytool`):

   ```bash
   keytool -genkeypair -v -keystore easyplex-release.jks -alias easyplex -keyalg RSA -keysize 3072 -validity 10000
   ```

   Back up `easyplex-release.jks` and its passwords. Never commit the keystore.

2. Encode it to one line:

   ```bash
   python -c "import base64;print(base64.b64encode(open('easyplex-release.jks','rb').read()).decode())"
   ```

3. In **Repository → Settings → Secrets and variables → Actions**, create:

   | Secret | Value |
   | --- | --- |
   | `EASYPLEX_KEYSTORE_BASE64` | Base64 text from step 2 |
   | `EASYPLEX_KEYSTORE_PASSWORD` | Keystore password |
   | `EASYPLEX_KEY_ALIAS` | Key alias (`easyplex` above) |
   | `EASYPLEX_KEY_PASSWORD` | Key password (often the keystore password) |

   Secrets created under the earlier `HUMAX_*` names are still accepted.

The workflow fails deliberately when signing secrets are missing rather than
producing a differently signed APK.

## Installing

Copy the APK to a USB stick or use a file manager / "Send files to TV" app,
then open it and allow installation from that source when prompted. Root and
ADB are not needed. EasyPlex appears in the TV's app list.

EasyPlex has its own package ID (`io.github.danfulton72.easyplex`), so it
installs alongside the older HumaxPlex app rather than replacing it; uninstall
HumaxPlex once you are happy.

## Live TV remote keys

Live TV uses the Plex DVR guide; with a Dispatcharr HDHomeRun tuner, streams
play directly from Dispatcharr. Remotes without colour or record keys (such as
Google TV remotes) can **hold OK** for an options list with the same actions.

| Where | Key | Action |
| --- | --- | --- |
| Guide | OK / Play | Watch channel |
| Guide | Hold OK / Menu | Options: watch, record, recordings, day guide, diagnostics |
| Guide | Left / Right | Previous / next programme |
| Guide | Up / Down, CH+ / CH− | Channel / page of channels |
| Guide | Record / Red | Record: choose episode or series and the library to save into |
| Guide | FF / RW | Forward / back one day |
| Guide | Green · Yellow · Blue | Diagnostics · channel day guide · recordings |
| Recordings | OK / Red | Cancel: one-off recording, skip one episode, or cancel a series |
| Watching | Up / CH+, Down / CH− | Next / previous channel |
| Watching | Left / Last | Previous channel |
| Watching | OK / Info | Now & next banner |
| Watching | Right | Audio and subtitle tracks |
| Watching | Back | Return to guide |

## Licence

EasyPlex is free software under the GNU GPL v3; see [LICENSE](LICENSE) and
[NOTICE.md](NOTICE.md) for attribution. See [BUILDING.md](BUILDING.md) for
troubleshooting.
