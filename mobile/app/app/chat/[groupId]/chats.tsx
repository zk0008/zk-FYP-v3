import { useState, useRef, useCallback, useEffect } from "react";
import {
  View,
  Text,
  ScrollView,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  KeyboardAvoidingView,
  Keyboard,
  Platform,
  StyleSheet,
} from "react-native";
import { useGlobalSearchParams, useFocusEffect } from "expo-router";
import { useHeaderHeight } from "@react-navigation/elements";
import { useAuth } from "../../../hooks/useAuth";
import { useWebSocket } from "../../../hooks/useWebSocket";
import MessageBubble from "../../../components/MessageBubble";

const API_BASE = process.env.EXPO_PUBLIC_API_URL ?? "http://127.0.0.1:8001";

type Message = {
  id: number;
  sender: string;
  text: string;
  is_bot: boolean;
};

export default function Chats() {
  // useGlobalSearchParams needed here — groupId is a parent-route segment ([groupId]/_layout),
  // so useLocalSearchParams (scoped to the current tab screen) doesn't see it
  const { groupId } = useGlobalSearchParams<{ groupId: string }>();
  const { token, user } = useAuth();
  // height of the Stack header above this screen — KAV needs this so iOS calculates
  // the keyboard offset from the right baseline (bottom of header, not top of screen)
  const headerHeight = useHeaderHeight();

  const [messages, setMessages] = useState<Message[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [inputText, setInputText] = useState("");
  const [showScrollDown, setShowScrollDown] = useState(false);
  // hidden until the initial scroll completes so the user doesn't see the list jump
  const [isScrollReady, setIsScrollReady] = useState(false);

  const scrollViewRef = useRef<ScrollView>(null);
  // true when the user is within 100px of the bottom — controls auto-scroll on new messages
  const isAtBottomRef = useRef(true);
  // Y positions captured by onLayout for each message — keyed by message id
  const messageYsRef = useRef<{ [id: number]: number }>({});
  // id of the first unread message to jump to on load, or null = jump to end
  const firstUnreadIdRef = useRef<number | null>(null);
  // skip /read in useFocusEffect on the very first focus — load effect handles it instead
  const isFirstFocusRef = useRef(true);

  // When the keyboard slides up, scroll to the bottom so the latest message stays visible
  useEffect(() => {
    const sub = Keyboard.addListener("keyboardDidShow", () => {
      setTimeout(() => scrollViewRef.current?.scrollToEnd({ animated: true }), 50);
    });
    return () => sub.remove();
  }, []);

  // Fetch messages + unread count in parallel, then mark as read.
  // Unread count must be captured before /read resets last_read_message_id on the server.
  useEffect(() => {
    if (!token) return;
    setIsLoading(true);
    setFetchError(null);
    setIsScrollReady(false);
    messageYsRef.current = {};

    Promise.all([
      fetch(`${API_BASE}/groups/${groupId}/messages`, {
        headers: { Authorization: `Bearer ${token}` },
      }).then((res) => {
        if (!res.ok) throw new Error("Failed to load messages");
        return res.json() as Promise<Message[]>;
      }),
      fetch(`${API_BASE}/groups/${groupId}/unread`, {
        headers: { Authorization: `Bearer ${token}` },
      }).then((res) => (res.ok ? res.json() : { unread_messages: 0 })),
    ])
      .then(([msgs, unread]) => {
        const unreadCount: number = unread.unread_messages ?? 0;
        if (unreadCount > 0 && msgs.length > 0) {
          // first unread is at index (total - unreadCount), same formula as the web
          const idx = Math.max(0, msgs.length - unreadCount);
          firstUnreadIdRef.current = msgs[idx]?.id ?? null;
        } else {
          firstUnreadIdRef.current = null; // no unread — scroll to end
        }
        setMessages(msgs);
        // mark read now — unread count is already captured above
        fetch(`${API_BASE}/groups/${groupId}/read`, {
          method: "POST",
          headers: { Authorization: `Bearer ${token}` },
        }).catch(() => {});
      })
      .catch((err: any) =>
        setFetchError(err.message ?? "Failed to load messages")
      )
      .finally(() => setIsLoading(false));
  }, [groupId, token]);

  // After messages render, onLayout populates messageYsRef. Wait one tick (50ms) for layout
  // to settle — same approach as the web frontend — then jump to the right position.
  useEffect(() => {
    if (isLoading || fetchError !== null) return;

    if (messages.length === 0) {
      setIsScrollReady(true);
      return;
    }

    const timer = setTimeout(() => {
      const targetId = firstUnreadIdRef.current;
      if (targetId !== null) {
        const y = messageYsRef.current[targetId];
        if (y !== undefined) {
          scrollViewRef.current?.scrollTo({ y, animated: false });
        }
        firstUnreadIdRef.current = null;
      } else {
        scrollViewRef.current?.scrollToEnd({ animated: false });
      }
      setIsScrollReady(true);
    }, 50);

    return () => clearTimeout(timer);
  }, [isLoading, fetchError, messages]);

  // Mark as read when the user returns to this tab from another tab.
  // Skip the very first focus — the load effect already called /read.
  useFocusEffect(
    useCallback(() => {
      if (isFirstFocusRef.current) {
        isFirstFocusRef.current = false;
        return;
      }
      if (!token) return;
      fetch(`${API_BASE}/groups/${groupId}/read`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      }).catch(() => {});
    }, [groupId, token])
  );

  const { isConnected, error: wsError, send } = useWebSocket({
    groupId,
    token: token ?? "",
    onMessage: useCallback((msg) => {
      setMessages((prev) => {
        // same message can arrive twice if the socket reconnects mid-broadcast — skip it
        if (prev.some((m) => m.id === msg.id)) return prev;
        return [...prev, msg];
      });
      // only auto-scroll if the user is already near the bottom
      if (isAtBottomRef.current) {
        setTimeout(() => scrollViewRef.current?.scrollToEnd({ animated: true }), 50);
      }
    }, []),
    onNotification: useCallback(() => {
      // cross-group @mention badge — groups screen re-fetches on focus, nothing to do here
    }, []),
  });

  const handleSend = () => {
    const text = inputText.trim();
    if (!text || !isConnected) return;
    send(text);
    setInputText("");
    // keyboard shrinks the viewport which can flip isAtBottomRef; reset so the WS echo scrolls
    isAtBottomRef.current = true;
    setTimeout(() => scrollViewRef.current?.scrollToEnd({ animated: true }), 200);
  };

  const handleScroll = (event: any) => {
    const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent;
    const distanceFromBottom =
      contentSize.height - layoutMeasurement.height - contentOffset.y;
    const atBottom = distanceFromBottom < 100;
    isAtBottomRef.current = atBottom;
    setShowScrollDown(!atBottom);
  };

  return (
    <KeyboardAvoidingView
      style={styles.outer}
      behavior={Platform.OS === "ios" ? "padding" : "height"}
      keyboardVerticalOffset={headerHeight}
    >
      {wsError !== null && (
        <View style={styles.wsBanner}>
          <Text style={styles.wsBannerText}>{wsError}</Text>
        </View>
      )}

      {isLoading && (
        <View style={styles.center}>
          <ActivityIndicator size="large" color="#1976d2" />
        </View>
      )}

      {!isLoading && fetchError !== null && (
        <View style={styles.center}>
          <Text style={styles.errorText}>{fetchError}</Text>
        </View>
      )}

      {/* ScrollView renders all messages at once (no windowing) so scrollTo always lands exactly.
          Hidden until the initial jump completes; overlay keeps the spinner visible until then. */}
      {!isLoading && fetchError === null && (
        <>
          <View style={[styles.listWrapper, !isScrollReady && styles.hidden]}>
            <ScrollView
              ref={scrollViewRef}
              contentContainerStyle={styles.listContent}
              onScroll={handleScroll}
              scrollEventThrottle={16}
              keyboardShouldPersistTaps="handled"
            >
              {messages.map((msg) => {
                const isOwn = msg.sender === user?.username;
                const isTagged =
                  !isOwn &&
                  !msg.is_bot &&
                  !!user?.username &&
                  msg.text.includes(`@${user.username}`);
                return (
                  <View
                    key={msg.id}
                    onLayout={(e) => {
                      // capture Y so we can jump to this message by id (same as web's element id)
                      messageYsRef.current[msg.id] = e.nativeEvent.layout.y;
                    }}
                  >
                    <MessageBubble
                      sender={msg.sender}
                      text={msg.text}
                      is_bot={msg.is_bot}
                      isOwn={isOwn}
                      isTagged={isTagged}
                    />
                  </View>
                );
              })}
            </ScrollView>
            {showScrollDown && (
              <TouchableOpacity
                style={styles.scrollDownBtn}
                onPress={() => scrollViewRef.current?.scrollToEnd({ animated: true })}
                activeOpacity={0.8}
              >
                <Text style={styles.scrollDownIcon}>↓</Text>
              </TouchableOpacity>
            )}
          </View>
          {!isScrollReady && (
            <View style={styles.settlingOverlay}>
              <ActivityIndicator size="large" color="#1976d2" />
            </View>
          )}
        </>
      )}

      <View style={styles.inputBar}>
        <TextInput
          style={styles.input}
          placeholder={isConnected ? "Message…" : "Connecting…"}
          placeholderTextColor="#9e9e9e"
          value={inputText}
          onChangeText={setInputText}
          onSubmitEditing={handleSend}
          returnKeyType="send"
          blurOnSubmit={false}
          editable={isConnected}
          multiline
        />
        <TouchableOpacity
          style={[
            styles.sendBtn,
            (!isConnected || !inputText.trim()) && styles.sendBtnDisabled,
          ]}
          onPress={handleSend}
          disabled={!isConnected || !inputText.trim()}
          activeOpacity={0.8}
        >
          <Text style={styles.sendBtnText}>↑</Text>
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  outer: {
    flex: 1,
    backgroundColor: "#f0f4f8",
  },
  wsBanner: {
    backgroundColor: "#d32f2f",
    paddingVertical: 6,
    paddingHorizontal: 16,
  },
  wsBannerText: {
    color: "#ffffff",
    fontSize: 13,
    textAlign: "center",
  },
  center: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: 32,
  },
  errorText: {
    color: "#d32f2f",
    fontSize: 15,
    textAlign: "center",
  },
  listWrapper: {
    flex: 1,
  },
  hidden: {
    opacity: 0,
  },
  settlingOverlay: {
    // covers the invisible ScrollView while it positions — same visual as the load spinner
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: "#f0f4f8",
    justifyContent: "center",
    alignItems: "center",
  },
  listContent: {
    paddingVertical: 12,
  },
  scrollDownBtn: {
    position: "absolute",
    bottom: 12,
    right: 16,
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: "#1976d2",
    justifyContent: "center",
    alignItems: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
    elevation: 4,
  },
  scrollDownIcon: {
    color: "#ffffff",
    fontSize: 18,
    lineHeight: 20,
  },
  inputBar: {
    flexDirection: "row",
    alignItems: "flex-end",
    backgroundColor: "#ffffff",
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderTopWidth: 1,
    borderTopColor: "#e0e0e0",
    gap: 8,
  },
  input: {
    flex: 1,
    minHeight: 40,
    maxHeight: 120,
    borderWidth: 1,
    borderColor: "#e0e0e0",
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 8,
    fontSize: 15,
    color: "#1a1a1a",
    backgroundColor: "#fafafa",
  },
  sendBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: "#1976d2",
    justifyContent: "center",
    alignItems: "center",
  },
  sendBtnDisabled: {
    backgroundColor: "#90bce8",
  },
  sendBtnText: {
    color: "#ffffff",
    fontSize: 20,
    lineHeight: 24,
  },
});
