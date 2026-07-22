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
  Alert,
  Modal,
  Image,
  Pressable,
} from "react-native";
import * as ImagePicker from "expo-image-picker";
import { useGlobalSearchParams, useFocusEffect } from "expo-router";
import { useHeaderHeight } from "@react-navigation/elements";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useAuth } from "../../../hooks/useAuth";
import { useWebSocket } from "../../../hooks/useWebSocket";
import MessageBubble from "../../../components/MessageBubble";
import { Ionicons } from "@expo/vector-icons";

const API_BASE = process.env.EXPO_PUBLIC_API_URL ?? "http://127.0.0.1:8001";

const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// plain YYYY-MM-DD in SGT so day-boundary comparisons don't need Intl
function sgtDateKey(isoString: string): string {
  const iso = isoString.includes("Z") || isoString.includes("+") ? isoString : isoString + "Z";
  const sgt = new Date(new Date(iso).getTime() + 8 * 60 * 60 * 1000);
  const y = sgt.getUTCFullYear();
  const mo = String(sgt.getUTCMonth() + 1).padStart(2, "0");
  const d = String(sgt.getUTCDate()).padStart(2, "0");
  return `${y}-${mo}-${d}`;
}

// "Today", "Yesterday", or "12 May 2025" — all in SGT, no Intl needed.
function dateSeparatorLabel(isoString: string): string {
  const todayKey = sgtDateKey(new Date().toISOString());
  const key = sgtDateKey(isoString);
  if (key === todayKey) return "Today";
  const [ty, tm, td] = todayKey.split("-").map(Number);
  const [ky, km, kd] = key.split("-").map(Number);
  // compare as calendar days — Date.UTC lets us diff without timezone tricks
  const diff = (Date.UTC(ty, tm - 1, td) - Date.UTC(ky, km - 1, kd)) / 86400000;
  if (diff === 1) return "Yesterday";
  return `${kd} ${MONTH_NAMES[km - 1]} ${ky}`;
}

type Message = {
  id: number | string;
  sender: string;
  text: string | null;
  is_bot: boolean;
  timestamp: string;
  message_type?: string;
  image_url?: string;
  isThinking?: boolean;
  is_deleted?: boolean;
};

type Member = { username: string; full_name?: string };

export default function Chats() {
  // useGlobalSearchParams needed here — groupId is a parent-route segment ([groupId]/_layout),
  // so useLocalSearchParams (scoped to the current tab screen) doesn't see it
  const { groupId } = useGlobalSearchParams<{ groupId: string }>();
  const { token, user } = useAuth();
  const headerHeight = useHeaderHeight();
  const insets = useSafeAreaInsets();

  const [messages, setMessages] = useState<Message[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [inputText, setInputText] = useState("");
  const [showScrollDown, setShowScrollDown] = useState(false);
  // hidden until the initial scroll completes so the user doesn't see the list jump
  const [isScrollReady, setIsScrollReady] = useState(false);
  const [keyboardHeight, setKeyboardHeight] = useState(0);
  const [pendingImage, setPendingImage] = useState<{ uri: string; filename: string; mimeType: string } | null>(null);
  const [showImagePreview, setShowImagePreview] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [selectedMessageForMenu, setSelectedMessageForMenu] = useState<{ id: number | string; isOwn: boolean; top: number } | null>(null);

  const scrollViewRef = useRef<ScrollView>(null);
  // true when the user is within 100px of the bottom — controls auto-scroll on new messages
  const isAtBottomRef = useRef(true);
  // Y positions captured by onLayout for each message — keyed by message id
  const messageYsRef = useRef<Record<string, number>>({});
  // current scroll offset — updated on every onScroll so the popup can convert content-Y to viewport-Y
  const scrollOffsetRef = useRef(0);
  // id of the first unread message to jump to on load, or null = jump to end
  const firstUnreadIdRef = useRef<number | null>(null);
  // skip /read in useFocusEffect on the very first focus — load effect handles it instead
  const isFirstFocusRef = useRef(true);
  // holds the 60-second safety timer for the thinking bubble — cleared when the real reply arrives
  const thinkingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // true between send() and the user's own WS echo arriving — tells onMessage to insert the thinking bubble
  const pendingAiMessageRef = useRef(false);
  // flipped to true after the initial scroll position is set — prevents message updates from re-triggering it
  const hasPositionedRef = useRef(false);

  // When the keyboard slides up, scroll to the bottom so the latest message stays visible
  useEffect(() => {
    const sub = Keyboard.addListener("keyboardDidShow", () => {
      setTimeout(() => scrollViewRef.current?.scrollToEnd({ animated: true }), 50);
    });
    return () => sub.remove();
  }, []);

  // on Android, track keyboard height so the inputBar can manually lift above it
  useEffect(() => {
    if (Platform.OS !== "android") return;
    const showSub = Keyboard.addListener("keyboardDidShow", (e) => {
      setKeyboardHeight(e.endCoordinates.height + insets.bottom);
    });
    const hideSub = Keyboard.addListener("keyboardDidHide", () => {
      setKeyboardHeight(0);
    });
    return () => {
      showSub.remove();
      hideSub.remove();
    };
  }, []);

  // Fetch the group member list once on mount so the @mention picker has names to show
  useEffect(() => {
    if (!token || !groupId) return;
    fetch(`${API_BASE}/groups/${groupId}/members`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((res) => (res.ok ? res.json() : []))
      .then((data: Member[]) => setMembers(data))
      .catch(() => {});
  }, [groupId, token]);

  // Fetch messages + unread count in parallel, then mark as read.
  // Unread count must be captured before /read resets last_read_message_id on the server.
  useEffect(() => {
    if (!token || !groupId) return;
    setIsLoading(true);
    setFetchError(null);
    setIsScrollReady(false);
    messageYsRef.current = {};
    hasPositionedRef.current = false;

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
    if (hasPositionedRef.current) return;
    if (isLoading || fetchError !== null) return;

    if (messages.length === 0) {
      hasPositionedRef.current = true;
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
      hasPositionedRef.current = true;
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
      if (!token || !groupId) return;
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
      if (msg.is_bot && thinkingTimeoutRef.current) {
        clearTimeout(thinkingTimeoutRef.current);
        thinkingTimeoutRef.current = null;
      }

      // needs to be outside the updater so the timeout below can capture it
      let tempId: string | null = null;
      if (!msg.is_bot && pendingAiMessageRef.current) {
        pendingAiMessageRef.current = false;
        tempId = `temp-ai-${Date.now()}`;
      }

      setMessages((prev) => {
        // same message can arrive twice if the socket reconnects mid-broadcast — skip it
        if (prev.some((m) => m.id === msg.id)) return prev;
        if (tempId !== null) {
          // user's own @ai echo arrived — append it then immediately append the thinking bubble
          return [...prev, msg, {
            id: tempId,
            sender: "AI Bot",
            text: "",
            is_bot: true,
            isThinking: true,
            timestamp: new Date().toISOString(),
          }];
        }
        // real bot reply arriving — drop the thinking bubble before appending
        const withoutThinking = msg.is_bot
          ? prev.filter((m) => !m.isThinking)
          : prev;
        return [...withoutThinking, msg];
      });

      if (tempId !== null) {
        if (thinkingTimeoutRef.current) clearTimeout(thinkingTimeoutRef.current);
        thinkingTimeoutRef.current = setTimeout(() => {
          setMessages((prev) =>
            prev.map((m) =>
              m.id === tempId
                ? { ...m, isThinking: false, text: "AI is taking longer than expected..." }
                : m
            )
          );
          thinkingTimeoutRef.current = null;
        }, 60000);
      }

      // only auto-scroll if the user is already near the bottom
      if (isAtBottomRef.current) {
        setTimeout(() => scrollViewRef.current?.scrollToEnd({ animated: true }), 50);
      }
      // advance last_read_message_id so incoming messages aren't counted as unread
      // on the group list — also clears any @mention notification for this message
      fetch(`${API_BASE}/groups/${groupId}/read`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      }).catch(() => {});
    }, []),
    onNotification: useCallback(() => {
      // cross-group @mention badge — groups screen re-fetches on focus, nothing to do here
    }, []),
    onMessageDeleted: useCallback((payload) => {
      setMessages((prev) =>
        prev.map((m) => m.id === payload.message_id ? { ...m, is_deleted: true } : m)
      );
    }, []),
  });

  // Replace the trailing @partial in the input with the chosen @username and close the picker
  const handleMentionSelect = (username: string) => {
    setInputText((prev) => prev.replace(/@\w*$/, `@${username} `));
  };

  const handleSend = () => {
    const text = inputText.trim();
    if (!text || !isConnected) return;
    pendingAiMessageRef.current = text.toLowerCase().includes("@ai");
    send(text);
    setInputText("");
    // keyboard shrinks the viewport which can flip isAtBottomRef; reset so the WS echo scrolls
    isAtBottomRef.current = true;
    setTimeout(() => scrollViewRef.current?.scrollToEnd({ animated: true }), 200);
  };

  // POST the picked image to the backend; WS broadcast delivers it to all clients
  const handleImageUpload = async (uri: string, filename: string, mimeType: string) => {
    if (!token || !groupId) return;
    const formData = new FormData();
    formData.append("file", { uri, name: filename, type: mimeType } as any);
    try {
      const response = await fetch(`${API_BASE}/groups/${groupId}/messages/image`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: formData,
      });
      if (!response.ok) {
        let detail = "Could not upload the image.";
        try {
          const body = await response.json();
          if (typeof body?.detail === "string") detail = body.detail;
        } catch {}
        Alert.alert("Upload failed", detail);
      }
    } catch {
      Alert.alert("Upload failed", "Could not send the image. Please try again.");
    }
  };

  const handleAttach = () => {
    Alert.alert("Send Image", "Choose a source", [
      {
        text: "Photo Library",
        onPress: async () => {
          const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
          if (status !== "granted") {
            Alert.alert("Permission required", "Allow photo library access in Settings to send images.");
            return;
          }
          const result = await ImagePicker.launchImageLibraryAsync({
            mediaTypes: ["images"],
            allowsEditing: false,
            quality: 0.8,
          });
          if (result.canceled || result.assets.length === 0) return;
          const asset = result.assets[0];
          // frontend size check — 5 MB limit
          if (asset.fileSize && asset.fileSize > 5 * 1024 * 1024) {
            Alert.alert("Image too large", "Please choose an image under 5 MB.");
            return;
          }
          const ext = asset.mimeType === "image/png" ? ".png" : ".jpg";
          const filename = asset.fileName ?? `photo${ext}`;
          setPendingImage({ uri: asset.uri, filename, mimeType: asset.mimeType ?? "image/jpeg" });
          setShowImagePreview(true);
        },
      },
      {
        text: "Take Photo",
        onPress: async () => {
          const { status } = await ImagePicker.requestCameraPermissionsAsync();
          if (status !== "granted") {
            Alert.alert("Permission required", "Allow camera access in Settings to take photos.");
            return;
          }
          const result = await ImagePicker.launchCameraAsync({
            mediaTypes: ["images"],
            allowsEditing: false,
            quality: 0.8,
          });
          if (result.canceled || result.assets.length === 0) return;
          const asset = result.assets[0];
          if (asset.fileSize && asset.fileSize > 5 * 1024 * 1024) {
            Alert.alert("Image too large", "Please take a photo under 5 MB.");
            return;
          }
          const ext = asset.mimeType === "image/png" ? ".png" : ".jpg";
          const filename = asset.fileName ?? `photo${ext}`;
          setPendingImage({ uri: asset.uri, filename, mimeType: asset.mimeType ?? "image/jpeg" });
          setShowImagePreview(true);
        },
      },
      { text: "Cancel", style: "cancel" },
    ]);
  };

  const handleDeleteMessage = (messageId: number | string) => {
    Alert.alert(
      "Delete this message?",
      undefined,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: async () => {
            try {
              const res = await fetch(`${API_BASE}/groups/${groupId}/messages/${messageId}`, {
                method: "DELETE",
                headers: { Authorization: `Bearer ${token}` },
              });
              if (!res.ok) {
                Alert.alert("Error", "Could not delete the message. Please try again.");
              }
              // state update comes from the message_deleted WS broadcast, not here
            } catch {
              Alert.alert("Error", "Could not delete the message. Please try again.");
            }
          },
        },
      ]
    );
  };

  const handleScroll = (event: any) => {
    const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent;
    scrollOffsetRef.current = contentOffset.y;
    const distanceFromBottom =
      contentSize.height - layoutMeasurement.height - contentOffset.y;
    const atBottom = distanceFromBottom < 100;
    isAtBottomRef.current = atBottom;
    setShowScrollDown(!atBottom);
  };

  // Look for a trailing @word in the input — if found, show matching members in the picker
  const mentionMatch = inputText.match(/@(\w*)$/);
  const mentionQuery = mentionMatch ? mentionMatch[1].toLowerCase() : null;
  const mentionMatches =
    mentionQuery !== null
      ? members.filter((m) => m.username.toLowerCase().startsWith(mentionQuery))
      : [];

  const inputBarStyle =
    Platform.OS === "android"
      ? [styles.inputBar, { marginBottom: keyboardHeight }]
      : styles.inputBar;

  const content = (
    <>
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
          <View
            style={[styles.listWrapper, !isScrollReady && styles.hidden]}
          >
            <ScrollView
              ref={scrollViewRef}
              contentContainerStyle={styles.listContent}
              onScroll={handleScroll}
              scrollEventThrottle={16}
              keyboardShouldPersistTaps="handled"
            >
              {messages.map((msg, idx) => {
                const isOwn = msg.sender === user?.username;
                const isTagged =
                  !isOwn &&
                  !msg.is_bot &&
                  !!user?.username &&
                  !!msg.text &&
                  msg.text.includes(`@${user.username}`);
                // show a date pill whenever the SGT day changes between consecutive messages
                const prevMsg = messages[idx - 1];
                const showSeparator =
                  !prevMsg || sgtDateKey(prevMsg.timestamp) !== sgtDateKey(msg.timestamp);
                return (
                  <View
                    key={msg.id}
                    onLayout={(e) => {
                      // capture Y so we can jump to this message by id (same as web's element id)
                      messageYsRef.current[msg.id] = e.nativeEvent.layout.y;
                    }}
                  >
                    {showSeparator && (
                      <View style={styles.dateSeparator}>
                        <Text style={styles.dateSeparatorText}>
                          {dateSeparatorLabel(msg.timestamp)}
                        </Text>
                      </View>
                    )}
                    <MessageBubble
                      sender={msg.sender}
                      text={msg.text ?? ""}
                      is_bot={msg.is_bot}
                      isOwn={isOwn}
                      isTagged={isTagged}
                      timestamp={msg.timestamp}
                      message_type={msg.message_type}
                      isThinking={msg.isThinking}
                      is_deleted={msg.is_deleted}
                      onLongPress={
                        !msg.is_bot && isOwn
                          ? () => setSelectedMessageForMenu({ id: msg.id, isOwn, top: (messageYsRef.current[msg.id] ?? 0) - scrollOffsetRef.current - 40 + (showSeparator ? 44 : 0) })
                          : undefined
                      }
                      image_url={
                        msg.image_url
                          ? // Token goes in the query string because React Native's Image
                            // component can't set custom request headers — no better option here.
                            `${API_BASE}${msg.image_url}?token=${token ?? ""}`
                          : undefined
                      }
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
                <Ionicons name="chevron-down" size={18} color="#ffffff" />
              </TouchableOpacity>
            )}
            {selectedMessageForMenu !== null && (
              <Pressable
                style={StyleSheet.absoluteFillObject}
                onPress={() => setSelectedMessageForMenu(null)}
              />
            )}
            {selectedMessageForMenu !== null && (
              <View style={[
                styles.deletePopupContainer,
                { top: selectedMessageForMenu.top },
                selectedMessageForMenu.isOwn ? { right: 16 } : { left: 16 },
                { alignItems: selectedMessageForMenu.isOwn ? "flex-end" : "flex-start" },
              ]}>
                <View style={styles.deletePopup}>
                  <TouchableOpacity
                    onPress={() => {
                      const id = selectedMessageForMenu.id;
                      setSelectedMessageForMenu(null);
                      handleDeleteMessage(id as number);
                    }}
                    activeOpacity={0.7}
                  >
                    <Text style={styles.deletePopupText}>Delete</Text>
                  </TouchableOpacity>
                </View>
                <View style={[
                  styles.deletePopupArrow,
                  selectedMessageForMenu.isOwn ? { marginRight: 10 } : { marginLeft: 10 },
                ]} />
              </View>
            )}
          </View>
          {!isScrollReady && (
            <View style={styles.settlingOverlay}>
              <ActivityIndicator size="large" color="#1976d2" />
            </View>
          )}
        </>
      )}

      {mentionMatches.length > 0 && (
        <View style={styles.mentionPicker}>
          <ScrollView keyboardShouldPersistTaps="always">
            {mentionMatches.map((m) => (
              <TouchableOpacity
                key={m.username}
                style={styles.mentionItem}
                onPress={() => handleMentionSelect(m.username)}
              >
                <Text
                  style={[
                    styles.mentionItemText,
                    m.username === "ai" && styles.mentionItemAi,
                  ]}
                >
                  {m.full_name ?? `@${m.username}`}
                </Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        </View>
      )}

      <View style={inputBarStyle}>
        <TouchableOpacity
          style={styles.attachBtn}
          onPress={handleAttach}
          activeOpacity={0.8}
        >
          <Text style={styles.attachBtnText}>+</Text>
        </TouchableOpacity>
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
          {/* size=22 keeps the icon at 50% of the 44px container, matching the scroll-down button's 18/36 ratio */}
          <Ionicons name="arrow-up" size={22} color="#ffffff" />
        </TouchableOpacity>
      </View>

      {/* Image send confirmation */}
      <Modal
        visible={showImagePreview}
        transparent
        animationType="fade"
        onRequestClose={() => {
          if (!isUploading) {
            setShowImagePreview(false);
            setPendingImage(null);
          }
        }}
      >
        <TouchableOpacity
          style={styles.previewOverlay}
          activeOpacity={1}
          onPress={() => {
            if (!isUploading) {
              setShowImagePreview(false);
              setPendingImage(null);
            }
          }}
        >
          <TouchableOpacity activeOpacity={1} onPress={(e) => e.stopPropagation()}>
            <View style={styles.previewContent}>
              <Text style={styles.previewTitle}>Send this image?</Text>
              {pendingImage && (
                <Image
                  source={{ uri: pendingImage.uri }}
                  style={styles.previewImage}
                  resizeMode="contain"
                />
              )}
              <View style={styles.previewActions}>
                <TouchableOpacity
                  style={styles.previewCancelBtn}
                  onPress={() => {
                    setShowImagePreview(false);
                    setPendingImage(null);
                  }}
                  disabled={isUploading}
                  activeOpacity={0.8}
                >
                  <Text style={styles.previewCancelText}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.previewSendBtn, isUploading && styles.previewBtnDisabled]}
                  onPress={async () => {
                    if (!pendingImage) return;
                    setIsUploading(true);
                    await handleImageUpload(pendingImage.uri, pendingImage.filename, pendingImage.mimeType);
                    setIsUploading(false);
                    setShowImagePreview(false);
                    setPendingImage(null);
                  }}
                  disabled={isUploading}
                  activeOpacity={0.8}
                >
                  {isUploading
                    ? <ActivityIndicator size="small" color="#ffffff" />
                    : <Text style={styles.previewSendText}>Send</Text>
                  }
                </TouchableOpacity>
              </View>
            </View>
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>
    </>
  );

  if (Platform.OS === "ios") {
    return (
      <KeyboardAvoidingView
        style={styles.outer}
        behavior="padding"
        keyboardVerticalOffset={headerHeight}
      >
        {content}
      </KeyboardAvoidingView>
    );
  }

  return <View style={styles.outer}>{content}</View>;
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
  inputBar: {
    flexDirection: "row",
    alignItems: "flex-end",
    backgroundColor: "#ffffff",
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderTopWidth: 1,
    borderTopColor: "#e8edf2",
    gap: 8,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: -2 },
    shadowOpacity: 0.06,
    shadowRadius: 4,
    elevation: 2,
  },
  input: {
    flex: 1,
    minHeight: 40,
    maxHeight: 120,
    borderWidth: 1,
    borderColor: "#e8edf2",
    borderRadius: 22,
    paddingHorizontal: 14,
    paddingVertical: 8,
    fontSize: 15,
    lineHeight: 20,
    textAlignVertical: "center",
    color: "#1a1a1a",
    backgroundColor: "#fafafa",
  },
  sendBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: "#1976d2",
    justifyContent: "center",
    alignItems: "center",
  },
  sendBtnDisabled: {
    backgroundColor: "#90bce8",
  },
  dateSeparator: {
    alignItems: "center",
    marginVertical: 10,
  },
  dateSeparatorText: {
    backgroundColor: "#dde3ec",
    color: "#4a5568",
    fontSize: 12,
    paddingHorizontal: 14,
    paddingVertical: 4,
    borderRadius: 12,
    overflow: "hidden",
  },
  attachBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: "#e8edf2",
    justifyContent: "center",
    alignItems: "center",
  },
  attachBtnText: {
    color: "#4a4a4a",
    fontSize: 22,
    lineHeight: 26,
  },
  mentionPicker: {
    backgroundColor: "#ffffff",
    borderTopWidth: 1,
    borderTopColor: "#e8edf2",
    maxHeight: 160,
  },
  mentionItem: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "#e8edf2",
  },
  mentionItemText: {
    fontSize: 14,
    color: "#1a1a1a",
  },
  mentionItemAi: {
    // purple so @ai stands out from regular member names — matches the AI bubble colour
    color: "#7e57c2",
    fontWeight: "600",
  },
  previewOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.45)",
    justifyContent: "center",
    paddingHorizontal: 24,
  },
  previewContent: {
    backgroundColor: "#ffffff",
    borderRadius: 14,
    padding: 24,
  },
  previewTitle: {
    fontSize: 17,
    fontWeight: "700",
    color: "#1a1a1a",
    marginBottom: 16,
    textAlign: "center",
  },
  previewImage: {
    width: 250,
    height: 250,
    alignSelf: "center",
    borderRadius: 8,
    marginBottom: 4,
  },
  previewActions: {
    flexDirection: "row",
    gap: 10,
    marginTop: 20,
  },
  previewCancelBtn: {
    borderWidth: 1,
    borderColor: "#1976d2",
    borderRadius: 10,
    paddingVertical: 11,
    paddingHorizontal: 16,
    minHeight: 44,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "#ffffff",
  },
  previewCancelText: {
    color: "#1976d2",
    fontWeight: "600",
    fontSize: 14,
  },
  previewSendBtn: {
    flex: 1,
    backgroundColor: "#1976d2",
    borderRadius: 10,
    paddingVertical: 11,
    minHeight: 44,
    justifyContent: "center",
    alignItems: "center",
  },
  previewSendText: {
    color: "#ffffff",
    fontWeight: "600",
    fontSize: 14,
  },
  previewBtnDisabled: {
    opacity: 0.6,
  },
  deletePopupContainer: {
    position: "absolute",
  },
  deletePopup: {
    backgroundColor: "#1a1a1a",
    borderRadius: 8,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  deletePopupText: {
    color: "#ffffff",
    fontSize: 14,
    fontWeight: "600",
  },
  deletePopupArrow: {
    width: 0,
    height: 0,
    borderLeftWidth: 6,
    borderRightWidth: 6,
    borderTopWidth: 6,
    borderLeftColor: "transparent",
    borderRightColor: "transparent",
    borderTopColor: "#1a1a1a",
  },
});
