import React, { useCallback, useEffect, useRef, useState } from "react";
import { Platform, StyleSheet, View } from "react-native";
import { WebView } from "react-native-webview";
import * as Notifications from "expo-notifications";
import Constants from "expo-constants";
import * as Device from "expo-device";

const APP_URL = "https://main.d1vzl1fu2jafco.amplifyapp.com/";

// Camera/mic access for calls and Go Live: react-native-webview's Android
// WebChromeClient already requests RECORD_AUDIO/CAMERA at the OS level and
// grants the page's getUserMedia() call automatically the moment it's
// needed - see RNCWebChromeClient#onPermissionRequest in the library
// itself. Nothing to wire up here; it only works because AndroidManifest.xml
// declares those two permissions (see android/app/src/main/AndroidManifest.xml).

// Incoming calls, missed-call notices, etc. should still surface as a
// heads-up notification even while the app is in the foreground - the
// in-app ringing overlay (voip-app's IncomingCallWatcher) is driven by its
// own signal polling, so a redundant system notification is harmless, but a
// suppressed one while foregrounded would mean silently missing calls that
// arrive while on a different tab of the app.
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

// Registers for push and returns an Expo push token, or null if the user
// declined notification permission (or this is a simulator, which can't
// receive real pushes at all). Best-effort throughout - a user who never
// grants this still gets calls/livestream fully working via the in-app
// poll whenever the app itself is open, they just won't be woken up by an
// OS notification while it's backgrounded.
async function getExpoPushToken() {
  if (!Device.isDevice) return null;

  const existing = await Notifications.getPermissionsAsync();
  let status = existing.status;
  if (status !== "granted") {
    const requested = await Notifications.requestPermissionsAsync();
    status = requested.status;
  }
  if (status !== "granted") return null;

  if (Platform.OS === "android") {
    await Notifications.setNotificationChannelAsync("default", {
      name: "Calls & messages",
      importance: Notifications.AndroidImportance.HIGH,
      vibrationPattern: [0, 250, 250, 250],
    });
  }

  const projectId = Constants.expoConfig?.extra?.eas?.projectId;
  try {
    const { data: token } = await Notifications.getExpoPushTokenAsync({ projectId });
    return token;
  } catch (e) {
    console.warn("[VoipApp] Failed to get Expo push token:", e);
    return null;
  }
}

export default function App() {
  const webviewRef = useRef(null);
  const webviewReadyRef = useRef(false);
  const [pushToken, setPushToken] = useState(null);

  useEffect(() => {
    getExpoPushToken().then(setPushToken).catch(() => {});

    // Tapping a notification (incoming call, missed call, etc.) brings this
    // Activity to the foreground by default Android/iOS behaviour - once
    // foregrounded, voip-app's own visibility-triggered poll picks the call
    // up immediately, so no deep-link routing is needed here.
    const sub = Notifications.addNotificationResponseReceivedListener(() => {});
    return () => sub.remove();
  }, []);

  // Hands the Expo push token to the web app running inside the WebView, so
  // it can register it against the signed-in user's account (mynger-backend
  // already knows how to deliver to it - see PushNotificationService's
  // sendExpoPush - the web app just needs to tell it whose token this is).
  // The web app's own JS can't reach expo-notifications directly (that's a
  // native module, invisible to page script inside a WebView), so this is
  // the only way it learns its token.
  const sendTokenToWebView = useCallback((token) => {
    if (!token || !webviewRef.current) return;
    webviewRef.current.postMessage(JSON.stringify({ type: "NATIVE_PUSH_TOKEN", token }));
  }, []);

  useEffect(() => {
    if (webviewReadyRef.current) sendTokenToWebView(pushToken);
  }, [pushToken, sendTokenToWebView]);

  const handleLoadEnd = () => {
    webviewReadyRef.current = true;
    sendTokenToWebView(pushToken);
  };

  if (Platform.OS === "web") {
    return (
      <View style={styles.container}>
        <iframe
          src={APP_URL}
          style={styles.iframe}
          title="VoipApp"
          allow="camera; microphone"
        />
      </View>
    );
  }

  return (
    <WebView
      ref={webviewRef}
      source={{ uri: APP_URL }}
      style={styles.container}
      onLoadEnd={handleLoadEnd}
      mediaPlaybackRequiresUserAction={false}
      javaScriptEnabled
      domStorageEnabled
    />
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    width: "100%",
    backgroundColor: "white",
  },
  iframe: {
    flex: 1,
    width: "100%",
    height: "100%",
    border: "none",
  },
});
