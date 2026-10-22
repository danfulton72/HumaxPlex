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

## Caveats

Android WebView HTML5 playback, CORS from Plex, TV remote keys and text entry may require further work. HLS playback is firmware-dependent. Do not assume the APK works until tested on your box. The device need not be rooted.

See [BUILDING.md](BUILDING.md) for troubleshooting and the optional CI build.
