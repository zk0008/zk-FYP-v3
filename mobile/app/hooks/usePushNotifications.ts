import { useEffect, useRef } from "react";
import { Platform } from "react-native";
import * as Notifications from "expo-notifications";
import Constants from "expo-constants";
import { useRouter } from "expo-router";

const API_BASE = process.env.EXPO_PUBLIC_API_URL ?? "http://127.0.0.1:8001";

// How notifications appear when the app is already open in the foreground
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldPlaySound: true,
    shouldSetBadge: true,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

async function registerAndSyncToken(authToken: string) {
  // Android needs a notification channel before anything else
  if (Platform.OS === "android") {
    await Notifications.setNotificationChannelAsync("default", {
      name: "MS3015 Chat",
      importance: Notifications.AndroidImportance.MAX,
      vibrationPattern: [0, 250, 250, 250],
      lightColor: "#1976d2",
    });
  }

  const { status } = await Notifications.requestPermissionsAsync();
  if (status !== "granted") return;

  // iOS Simulator doesn't support push tokens — catch and ignore
  try {
    const projectId =
      Constants.expoConfig?.extra?.eas?.projectId ??
      Constants.easConfig?.projectId;

    const tokenData = await Notifications.getExpoPushTokenAsync(
      projectId ? { projectId } : undefined
    );
    const expoPushToken = tokenData.data;

    const res = await fetch(`${API_BASE}/push-token`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${authToken}`,
      },
      body: JSON.stringify({ token: expoPushToken }),
    });
    console.log("[push] token registered with backend, status:", res.status);
  } catch (e) {
    // expected on iOS Simulator; on a real device this means projectId is missing
    console.warn("[push] could not obtain push token:", e);
  }
}

export function usePushNotifications(authToken: string | null) {
  const router = useRouter();
  const responseSub = useRef<Notifications.EventSubscription | null>(null);

  useEffect(() => {
    if (!authToken) return;

    registerAndSyncToken(authToken);

    // Handle tapping a notification when the app is backgrounded or closed
    responseSub.current = Notifications.addNotificationResponseReceivedListener(
      (response) => {
        const data = response.notification.request.content.data as {
          groupId?: string;
          groupName?: string;
        };
        if (data?.groupId) {
          router.push(
            `/chat/${data.groupId}/chats?name=${encodeURIComponent(data.groupName ?? "Group")}`
          );
        }
      }
    );

    return () => {
      responseSub.current?.remove();
    };
  }, [authToken]);

  // Also handle the case where a notification tap LAUNCHED the app (was closed)
  useEffect(() => {
    Notifications.getLastNotificationResponseAsync().then((response) => {
      if (!response) return;
      const data = response.notification.request.content.data as {
        groupId?: string;
        groupName?: string;
      };
      if (data?.groupId) {
        router.push(
          `/chat/${data.groupId}/chats?name=${encodeURIComponent(data.groupName ?? "Group")}`
        );
      }
    });
  }, []);
}
