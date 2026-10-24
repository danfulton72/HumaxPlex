# HumaxPlex

Experimental Android 9 TV port of [SamSUCKS](https://github.com/rfaile313/samsucks) for Humax FVP-4KGTR.

**Status:** untested source port; no verified APK yet. Not affiliated with Plex, Samsung or Humax.

## Build on Windows

Install Git for Windows, Python 3, Android Studio with JDK 17, Android SDK Platform 35 and SDK Build-Tools. Clone this repository, then run in PowerShell:

```powershell
powershell -ExecutionPolicy Bypass -File .\prepare-windows.ps1
```

Open `android/` in Android Studio. Configure Gradle 8.7 if required (this project does not include a Gradle wrapper), sync, then **Build > Build APK(s)**. The expected result is `android/app/build/outputs/apk/debug/HumaxPlex-debug.apk`.

The script clones upstream SamSUCKS and applies Android-specific adaptations. Internet access is required. The original Plex UI remains copyright its authors and is licensed under GPL-3.0; see [LICENSE](LICENSE) and [NOTICE.md](NOTICE.md).

## APK updates and permanent signing

The GitHub Actions APK uses a persistent signing certificate and a version code
derived from the GitHub Actions run number. **Four repository Actions secrets
must be configured once before the workflow can produce an APK.** An APK signed
with a different key cannot upgrade a previously installed APK.

1. Generate a keystore on your computer (JDK 17 `keytool`):

   ```bash
   keytool -genkeypair -v -keystore humax-release.jks -alias humaxplex -keyalg RSA -keysize 3072 -validity 10000
   ```

   Choose strong passwords and back up `humax-release.jks` and the passwords
   somewhere safe. Never commit the keystore to GitHub.

2. Encode the keystore to one text line:

   ```bash
   python -c "import base64;print(base64.b64encode(open('humax-release.jks','rb').read()).decode())"
   ```

3. Open [Repository → Settings → Secrets and variables → Actions](https://github.com/danfulton72/HumaxPlex/settings/secrets/actions).
   Create these **repository secrets**:

   | Secret | Value |
   | --- | --- |
   | `HUMAX_KEYSTORE_BASE64` | Full base64 text from step 2 |
   | `HUMAX_KEYSTORE_PASSWORD` | Password chosen for the keystore |
   | `HUMAX_KEY_ALIAS` | `humaxplex` |
   | `HUMAX_KEY_PASSWORD` | Password for the `humaxplex` key (often same as keystore password) |

4. Select **Actions → Build HumaxPlex debug APK → Run workflow**.
   Download the `HumaxPlex-debug-apk` artifact.

You must uninstall the older, differently signed debug APK **once** before
installing the first permanently signed build. Back up your app settings first
if needed. Future builds signed with the **same keystore** can update in place
without uninstalling. Do not regenerate the key: losing it prevents upgrades.

The workflow deliberately fails when signing secrets are missing rather than
silently making a differently signed APK.

## Live TV remote keys

Live TV uses the Plex DVR guide; with a Dispatcharr HDHomeRun tuner, streams play directly from Dispatcharr.

| Where | Key | Action |
| --- | --- | --- |
| Guide | OK / Play | Watch channel |
| Guide | Left / Right | Previous / next programme |
| Guide | Up / Down, CH+ / CH− | Channel / page of channels |
| Guide | Record / Red | Record programme |
| Guide | FF / RW | Forward / back one day |
| Guide | Green · Yellow · Blue | Diagnostics · channel day guide · recordings |
| Watching | Up / CH+, Down / CH− | Next / previous channel |
| Watching | Left / Last | Previous channel |
| Watching | OK / Info | Now & next banner |
| Watching | Right | Audio and subtitle tracks |
| Watching | Back | Return to guide |

## Caveats

Android WebView HTML5 playback, CORS from Plex, TV remote keys and text entry may require further work. HLS playback is firmware-dependent. Do not assume the APK works until tested on your box. The device need not be rooted.

See [BUILDING.md](BUILDING.md) for troubleshooting and the optional CI build.
