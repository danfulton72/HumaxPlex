# Build & testing

## Windows

Install [Git](https://git-scm.com/download/win), [Python 3](https://www.python.org/downloads/windows/), and [Android Studio](https://developer.android.com/studio) with SDK Platform 35, SDK Build-Tools and JDK 17. Clone this repository and run `powershell -ExecutionPolicy Bypass -File .\prepare-windows.ps1`. Open `android/` in Android Studio, select the required Gradle 8.7 distribution if requested, sync and select **Build > Build APK(s)**. This project does not ship a Gradle wrapper. Output: `android/app/build/outputs/apk/debug/HumaxPlex-debug.apk`.

## Linux/macOS

Run `./prepare.sh` (Git and Python 3 required), then open `android/` in Android Studio. Or, with Gradle 8.7+ available, run `cd android && gradle assembleDebug`.

## GitHub Actions

Go to **Actions > Build HumaxPlex debug APK > Run workflow**. If the build succeeds, download the **HumaxPlex-debug-apk** artifact from the run page. This is an automatically built debug APK, not a device-verified release. A workflow run must be triggered manually. `actions/upload-artifact` stores the APK as a ZIP artifact; extract the APK before installing.

## Installation

Copy the APK onto a USB stick, open it through the device's allowed APK installer and grant installation permission if prompted. You do **not** need root. Do not enable network ADB just to install if USB installation already works.

## Known limitations

The original UI is loaded into an Android WebView. Plex playback may require native Media3/ExoPlayer for reliable HLS; CORS, remote-control keys, search keyboard, and transcoding must be tested on the FVP-4KGTR. Never treat a successful Gradle build as proof of playback compatibility. Please capture `adb logcat` (only when ADB is already enabled) and describe which UI or playback step fails.
