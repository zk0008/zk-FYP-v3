import { useEffect, useRef, useState, useCallback } from "react";
import { AppState } from "react-native";

const WS_BASE = process.env.EXPO_PUBLIC_WS_URL ?? "ws://127.0.0.1:8001";

// Start at 2s, double on each failure, cap at 30s
const INITIAL_DELAY_MS = 2000;
const MAX_DELAY_MS = 30000;

export type MessagePayload = {
  type: "message";
  id: number;
  sender: string;
  text: string;
  is_bot: boolean;
  group_string_id: string;
};

export type NotificationPayload = {
  type: "notification";
  id: number;
  sender_id: number;
  message_id: number;
  group_id: number;
  group_string_id: string;
  created_at: string;
};

type Options = {
  groupId: string;
  token: string;
  onMessage: (msg: MessagePayload) => void;
  onNotification: (notif: NotificationPayload) => void;
};

export function useWebSocket({ groupId, token, onMessage, onNotification }: Options) {
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectCountRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // flag set during intentional cleanup so the onclose handler doesn't reconnect
  const intentionalCloseRef = useRef(false);

  // Keep callbacks in refs so the connect() closure never goes stale
  const onMessageRef = useRef(onMessage);
  const onNotificationRef = useRef(onNotification);
  useEffect(() => { onMessageRef.current = onMessage; }, [onMessage]);
  useEffect(() => { onNotificationRef.current = onNotification; }, [onNotification]);

  const [isConnected, setIsConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const connect = useCallback(() => {
    // don't stack connections
    if (wsRef.current?.readyState === WebSocket.OPEN ||
        wsRef.current?.readyState === WebSocket.CONNECTING) return;
    // groupId can be undefined during Expo Router state restore — don't connect until it's real
    if (!groupId || !token) return;

    const url = `${WS_BASE}/ws/groups/${groupId}?token=${token}`;
    const ws = new WebSocket(url);
    wsRef.current = ws;

    ws.onopen = () => {
      setIsConnected(true);
      setError(null);
      reconnectCountRef.current = 0;
    };

    ws.onmessage = (event) => {
      try {
        const payload = JSON.parse(event.data as string);
        if (payload.type === "message") {
          onMessageRef.current(payload as MessagePayload);
        } else if (payload.type === "notification") {
          onNotificationRef.current(payload as NotificationPayload);
        }
      } catch {
        // malformed frame — skip it
      }
    };

    ws.onerror = () => {
      setError("Connection error — retrying…");
    };

    ws.onclose = (event) => {
      setIsConnected(false);
      // 1000 = we closed intentionally (unmount/navigate away)
      if (event.code === 1000 || intentionalCloseRef.current) return;
      // exponential backoff — 2s, 4s, 8s… capped at 30s, no hard limit
      const delay = Math.min(
        INITIAL_DELAY_MS * Math.pow(2, reconnectCountRef.current),
        MAX_DELAY_MS
      );
      reconnectCountRef.current += 1;
      timerRef.current = setTimeout(connect, delay);
    };
  }, [groupId, token]);

  // Connect on mount, reconnect if groupId/token change
  useEffect(() => {
    intentionalCloseRef.current = false;
    connect();
    return () => {
      intentionalCloseRef.current = true;
      timerRef.current && clearTimeout(timerRef.current);
      wsRef.current?.close(1000);
    };
  }, [connect]);

  // Reconnect when the app comes back to the foreground — iOS can silently
  // kill the socket while the device is locked or the app is backgrounded
  useEffect(() => {
    const sub = AppState.addEventListener("change", (nextState) => {
      if (nextState === "active") {
        if (wsRef.current?.readyState !== WebSocket.OPEN &&
            wsRef.current?.readyState !== WebSocket.CONNECTING) {
          timerRef.current && clearTimeout(timerRef.current);
          reconnectCountRef.current = 0;
          connect();
        }
      }
    });
    return () => sub.remove();
  }, [connect]);

  const send = useCallback((text: string) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ content: text }));
    }
  }, []);

  return { isConnected, error, send };
}
