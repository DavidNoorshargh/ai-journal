# My AI Journal

The phone app. Open it in Expo Go on the Android emulator. Sign-in stores a session in the keychain so the notes stay behind that gate. It does not call Cognito yet.

This machine needs Node.js 22.13 or newer. The virtual device used here is `Medium_Phone_API_37.0`. List others with `"$ANDROID_HOME/emulator/emulator" -list-avds`.

In one terminal, start the emulator:

```bash
export ANDROID_HOME="$HOME/Library/Android/sdk"
export PATH="$ANDROID_HOME/platform-tools:$PATH"
"$ANDROID_HOME/emulator/emulator" -avd Medium_Phone_API_37.0
```

Wait until the phone home screen is visible. In a second terminal, from this directory:

```bash
export ANDROID_HOME="$HOME/Library/Android/sdk"
export PATH="$ANDROID_HOME/platform-tools:$PATH"
npm start
```

Press `a`. Expo installs Expo Go on the emulator if it is missing, then opens the journal. Leave `npm start` running. JavaScript changes refresh on their own.
