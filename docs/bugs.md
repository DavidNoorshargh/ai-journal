# Bugs

Open items seen on the phone. One stays open until it is checked on a new install.

## 1. The keyboard covers the note being written

Fixed. Checked on the Android install on 10 Nov 2026. Seen on the Write screen.

Once the note is long enough for the caret to meet the keyboard, the keyboard covers the line being typed. The tags and Save sit below the field, so they are covered too. The screen does not shrink, and it does not scroll the caret into the open space above the keyboard.

Write is a `ScrollView` in [app/src/screens/editor-screen.tsx](../app/src/screens/editor-screen.tsx). Nothing on that screen reads the keyboard height. This Expo SDK draws edge to edge on Android, so the window stays full height while the keyboard opens on top of it.

**Fix.** `react-native-keyboard-controller` is installed. Reanimated was already in the app. The root stack is wrapped in `KeyboardProvider`.

Write uses `KeyboardAwareScrollView` instead of `ScrollView`. The caret stays 24 points above the keyboard, and the extra inset lets the tags and Save scroll into that space. `keyboardShouldPersistTaps="handled"` so a tap on a tag or Save lands while the keyboard is open.

Leave the Android window mode as it is. Do not set `softwareKeyboardLayoutMode` to `pan`, and do not pad the screen from a keyboard listener. The keyboard moves on its own curve, and a timed padding change lags behind it.

Checked on the phone. A long note keeps the caret above the keyboard.
