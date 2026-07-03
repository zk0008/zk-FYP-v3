import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  ActivityIndicator,
  Modal,
  TextInput,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  Alert,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter, useFocusEffect } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "../hooks/useAuth";
import { useGroups, type Group } from "../hooks/useGroups";

const API_BASE = process.env.EXPO_PUBLIC_API_URL ?? "http://127.0.0.1:8001";
const WS_BASE = process.env.EXPO_PUBLIC_WS_URL ?? "ws://127.0.0.1:8001";

// Defined outside so the function reference is stable across renders
const Separator = () => <View style={separatorStyle} />;
const separatorStyle = { height: 1, backgroundColor: "#f0f0f0", marginLeft: 16 };

export default function Groups() {
  const { user, logout, isAuthenticated, isLoading: isAuthLoading, token } = useAuth();
  const { groups, isLoading, error, refresh } = useGroups();
  const router = useRouter();
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [showSettings, setShowSettings] = useState(false);
  const [currentPwd, setCurrentPwd] = useState("");
  const [newPwd, setNewPwd] = useState("");
  const [settingsStatus, setSettingsStatus] = useState<"idle" | "saving" | "success" | "error">("idle");
  const [settingsError, setSettingsError] = useState("");

  const [broadcasts, setBroadcasts] = useState<{ id: number; content: string; sent_by: string | null; created_at: string }[]>([]);
  const [showBroadcasts, setShowBroadcasts] = useState(false);
  const [lastSeenBroadcastId, setLastSeenBroadcastId] = useState(0);
  const [broadcastInput, setBroadcastInput] = useState("");
  const [broadcastSending, setBroadcastSending] = useState(false);
  const [broadcastError, setBroadcastError] = useState("");
  const [hasNewBroadcast, setHasNewBroadcast] = useState(false);

  // Refresh immediately on focus, poll every 15s, and open a home WebSocket so
  // cross-group nudges from send_to_user land here and trigger an immediate refresh
  useFocusEffect(useCallback(() => {
    refresh();
    const interval = setInterval(refresh, 15000);

    function openHomeSocket() {
      if (!token) return;
      const ws = new WebSocket(`${WS_BASE}/ws/home?token=${token}`);
      wsRef.current = ws;
      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          if (data.type === "broadcast") {
            // skip if we already have this id — happens when GET /broadcasts and WS replay overlap
            setBroadcasts((prev) =>
              prev.some((b) => b.id === data.id) ? prev : [data, ...prev]
            );
            if (data.id > lastSeenBroadcastId) setHasNewBroadcast(true);
            return;
          }
        } catch {
          // not JSON — fall through to the badge-count refresh below
        }
        // any other event (message nudge, notification) means badge counts changed
        refresh();
      };
      ws.onclose = (event) => {
        // 1000 = intentional close from cleanup — don't reconnect
        if (event.code !== 1000) {
          reconnectTimerRef.current = setTimeout(openHomeSocket, 3000);
        }
      };
    }
    openHomeSocket();

    return () => {
      clearInterval(interval);
      reconnectTimerRef.current && clearTimeout(reconnectTimerRef.current);
      wsRef.current?.close(1000);
      wsRef.current = null;
    };
  }, [refresh, token]));

  // If useGroups detected a 401 and called logout(), isAuthenticated goes false → send to login
  useEffect(() => {
    if (!isAuthLoading && !isAuthenticated) {
      router.replace("/login");
    }
  }, [isAuthenticated, isAuthLoading]);

  function openChangePassword() {
    setCurrentPwd("");
    setNewPwd("");
    setSettingsStatus("idle");
    setSettingsError("");
    setShowSettings(true);
  }

  async function handleChangePassword() {
    if (!currentPwd || !newPwd) return;
    setSettingsStatus("saving");
    setSettingsError("");
    try {
      const res = await fetch(`${API_BASE}/auth/change-password`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ current_password: currentPwd, new_password: newPwd }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ detail: "Unknown error" }));
        throw new Error(err.detail ?? "Unknown error");
      }
      setSettingsStatus("success");
      setTimeout(() => {
        setShowSettings(false);
        setSettingsStatus("idle");
      }, 1500);
    } catch (e: unknown) {
      setSettingsStatus("error");
      setSettingsError(e instanceof Error ? e.message : "Unknown error");
    }
  }

  async function openBroadcasts() {
    setShowBroadcasts(true);
    setBroadcastError("");
    try {
      const res = await fetch(`${API_BASE}/broadcasts`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json();
        setBroadcasts(data);
        if (data.length > 0) setLastSeenBroadcastId(data[0].id);
      }
    } catch {
      // silently fail — list stays as-is
    }
    setHasNewBroadcast(false);
  }

  async function handleSendBroadcast() {
    if (!broadcastInput.trim() || broadcastSending) return;
    setBroadcastSending(true);
    setBroadcastError("");
    try {
      const res = await fetch(`${API_BASE}/broadcast`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ content: broadcastInput.trim() }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ detail: "Unknown error" }));
        throw new Error(err.detail ?? "Unknown error");
      }
      setBroadcastInput("");
      // the WS push from the server will add the new broadcast to the list
    } catch (e: unknown) {
      setBroadcastError(e instanceof Error ? e.message : "Unknown error");
    } finally {
      setBroadcastSending(false);
    }
  }

  function handleDeleteBroadcast(id: number) {
    Alert.alert("Delete this announcement?", "", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: async () => {
          const res = await fetch(`${API_BASE}/broadcasts/${id}`, {
            method: "DELETE",
            headers: { Authorization: `Bearer ${token}` },
          });
          if (res.ok) {
            setBroadcasts((prev) => prev.filter((b) => b.id !== id));
          }
        },
      },
    ]);
  }

  function formatBroadcastDate(iso: string): string {
    return new Intl.DateTimeFormat("en-SG", {
      timeZone: "Asia/Singapore",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    }).format(new Date(iso));
  }

  const handleLogout = async () => {
    await logout();
    router.replace("/login");
  };

  const handleGroupPress = (group: Group) => {
    // Pass group name as a query param so the tab header can show it
    router.push(
      `/chat/${group.id}/chats?name=${encodeURIComponent(group.name)}`
    );
  };

  const renderGroup = ({ item }: { item: Group }) => (
    <TouchableOpacity
      style={styles.row}
      onPress={() => handleGroupPress(item)}
      activeOpacity={0.7}
    >
      <Text style={styles.groupName}>{item.name}</Text>
      <View style={styles.badges}>
        {item.unread_messages > 0 && (
          <View style={styles.badgeBlue}>
            <Text style={styles.badgeText}>{item.unread_messages}</Text>
          </View>
        )}
        {item.unread_tags > 0 && (
          <View style={styles.badgeOrange}>
            <Text style={styles.badgeText}>@{item.unread_tags}</Text>
          </View>
        )}
      </View>
    </TouchableOpacity>
  );

  return (
    <SafeAreaView style={styles.container}>
      {/* ── Change Password Modal ────────────────────────────── */}
      <Modal
        visible={showSettings}
        transparent
        animationType="slide"
        onRequestClose={() => setShowSettings(false)}
      >
        <TouchableOpacity
          style={styles.settingsOverlay}
          activeOpacity={1}
          onPress={() => setShowSettings(false)}
        >
          <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "height"}>
            <TouchableOpacity activeOpacity={1} onPress={(e) => e.stopPropagation()}>
              <View style={styles.settingsContent}>
                <Text style={styles.settingsTitle}>Change Password</Text>

                <Text style={styles.settingsLabel}>Current Password</Text>
                <TextInput
                  style={styles.settingsInput}
                  value={currentPwd}
                  onChangeText={setCurrentPwd}
                  placeholder="current password"
                  placeholderTextColor="#9e9e9e"
                  secureTextEntry
                />

                <Text style={styles.settingsLabel}>New Password</Text>
                <TextInput
                  style={styles.settingsInput}
                  value={newPwd}
                  onChangeText={setNewPwd}
                  placeholder="at least 8 characters"
                  placeholderTextColor="#9e9e9e"
                  secureTextEntry
                />

                {settingsStatus === "error" && (
                  <Text style={styles.settingsError}>{settingsError}</Text>
                )}
                {settingsStatus === "success" && (
                  <Text style={styles.settingsSuccess}>✓ Password updated.</Text>
                )}

                <View style={styles.settingsActions}>
                  <TouchableOpacity
                    style={styles.settingsCancelBtn}
                    onPress={() => setShowSettings(false)}
                    activeOpacity={0.8}
                  >
                    <Text style={styles.settingsCancelText}>Cancel</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[
                      styles.settingsSaveBtn,
                      settingsStatus === "saving" && styles.settingsBtnDisabled,
                    ]}
                    onPress={handleChangePassword}
                    activeOpacity={0.8}
                    disabled={settingsStatus === "saving"}
                  >
                    {settingsStatus === "saving" ? (
                      <ActivityIndicator size="small" color="#ffffff" />
                    ) : (
                      <Text style={styles.settingsSaveText}>Save</Text>
                    )}
                  </TouchableOpacity>
                </View>
              </View>
            </TouchableOpacity>
          </KeyboardAvoidingView>
        </TouchableOpacity>
      </Modal>

      {/* ── Announcements Modal ──────────────────────────────── */}
      <Modal
        visible={showBroadcasts}
        transparent
        animationType="slide"
        onRequestClose={() => setShowBroadcasts(false)}
      >
        <TouchableOpacity
          style={styles.settingsOverlay}
          activeOpacity={1}
          onPress={() => setShowBroadcasts(false)}
        >
          <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "height"}>
            <TouchableOpacity activeOpacity={1} onPress={(e) => e.stopPropagation()}>
              <View style={styles.settingsContent}>
                <Text style={styles.settingsTitle}>Announcements</Text>

                {(user?.role === "coordinator" || user?.role === "admin") && (
                  <View style={styles.broadcastInputRow}>
                    <TextInput
                      style={styles.broadcastTextInput}
                      value={broadcastInput}
                      onChangeText={setBroadcastInput}
                      placeholder="New announcement..."
                      placeholderTextColor="#9e9e9e"
                      multiline
                      maxLength={1000}
                    />
                    <TouchableOpacity
                      style={[styles.broadcastSendBtn, broadcastSending && styles.settingsBtnDisabled]}
                      onPress={handleSendBroadcast}
                      disabled={broadcastSending}
                      activeOpacity={0.8}
                    >
                      {broadcastSending ? (
                        <ActivityIndicator size="small" color="#ffffff" />
                      ) : (
                        <Text style={styles.broadcastSendText}>Send</Text>
                      )}
                    </TouchableOpacity>
                  </View>
                )}

                {broadcastError !== "" && (
                  <Text style={styles.settingsError}>{broadcastError}</Text>
                )}

                {broadcasts.length === 0 ? (
                  <Text style={styles.broadcastEmpty}>No announcements yet.</Text>
                ) : (
                  <FlatList
                    data={broadcasts}
                    keyExtractor={(b) => String(b.id)}
                    style={styles.broadcastList}
                    renderItem={({ item }) => (
                      <View style={styles.broadcastItem}>
                        <Text style={styles.broadcastContent}>{item.content}</Text>
                        <View style={styles.broadcastItemFooter}>
                          <Text style={styles.broadcastMeta}>
                            {item.sent_by ?? "System"} · {formatBroadcastDate(item.created_at)}
                          </Text>
                          {(user?.role === "coordinator" || user?.role === "admin") && (
                            <TouchableOpacity onPress={() => handleDeleteBroadcast(item.id)} activeOpacity={0.7}>
                              <Text style={styles.broadcastDeleteText}>Delete</Text>
                            </TouchableOpacity>
                          )}
                        </View>
                      </View>
                    )}
                    ItemSeparatorComponent={() => <View style={{ height: 1, backgroundColor: "#f0f0f0" }} />}
                  />
                )}
              </View>
            </TouchableOpacity>
          </KeyboardAvoidingView>
        </TouchableOpacity>
      </Modal>

      <View style={styles.header}>
        <View style={{ flex: 1, marginRight: 8 }}>
          <Text style={styles.headerTitle}>MS3015 Chat</Text>
          <View style={styles.headerSubRow}>
            <Text style={styles.headerSub}>
              {user?.username ?? ""} · {user?.role ?? ""}
            </Text>
          </View>
          <TouchableOpacity
            onPress={openChangePassword}
            style={styles.settingsBtn}
            activeOpacity={0.7}
          >
            <Text style={styles.settingsBtnText}>Change Password</Text>
          </TouchableOpacity>
        </View>
        <View style={styles.headerActions}>
          {user?.role === "coordinator" && (
            <TouchableOpacity
              style={styles.dashboardBtn}
              onPress={() => router.push("/dashboard")}
              activeOpacity={0.8}
            >
              <Text style={styles.dashboardText}>Dashboard</Text>
            </TouchableOpacity>
          )}
          {user?.role === "supervisor" && (
            <TouchableOpacity
              style={styles.dashboardBtn}
              onPress={() => router.push("/supervisor-dashboard")}
              activeOpacity={0.8}
            >
              <Text style={styles.dashboardText}>Dashboard</Text>
            </TouchableOpacity>
          )}
          {user?.role === "admin" && (
            <TouchableOpacity
              style={styles.dashboardBtn}
              onPress={() => router.push("/admin")}
              activeOpacity={0.8}
            >
              <Text style={styles.dashboardText}>Admin</Text>
            </TouchableOpacity>
          )}
          <TouchableOpacity
            style={styles.logoutBtn}
            onPress={handleLogout}
            activeOpacity={0.8}
          >
            <Text style={styles.logoutText}>Logout</Text>
          </TouchableOpacity>
        </View>
      </View>

      <View style={styles.contentContainer}>
        {(broadcasts.length > 0 || hasNewBroadcast) && (
          <TouchableOpacity
            style={styles.announcementBanner}
            onPress={openBroadcasts}
            activeOpacity={0.8}
          >
            <View style={styles.announcementContent}>
              <Text style={styles.announcementText} numberOfLines={1} ellipsizeMode="tail">
                {broadcasts[0]?.content ?? ""}
              </Text>
              <Text style={styles.announcementMeta}>
                {broadcasts[0]?.sent_by ?? "System"} · {broadcasts[0] ? formatBroadcastDate(broadcasts[0].created_at) : ""}
              </Text>
            </View>
            <View style={styles.announcementAction}>
              <Text style={styles.announcementActionText}>View All</Text>
              {hasNewBroadcast && <View style={styles.announcementDot} />}
            </View>
          </TouchableOpacity>
        )}

        <Text style={styles.sectionLabel}>Your chatrooms</Text>

        {isLoading && (
          <View style={styles.center}>
            <ActivityIndicator size="large" color="#1976d2" />
          </View>
        )}

        {!isLoading && error !== null && (
          <View style={styles.center}>
            <Text style={styles.errorText}>{error}</Text>
            <TouchableOpacity style={styles.retryBtn} onPress={refresh}>
              <Text style={styles.retryText}>Retry</Text>
            </TouchableOpacity>
          </View>
        )}

        {!isLoading && error === null && (
          <View style={styles.listShadow}>
            <FlatList
              data={groups}
              keyExtractor={(g) => g.id}
              renderItem={renderGroup}
              contentContainerStyle={styles.list}
              ItemSeparatorComponent={Separator}
            />
          </View>
        )}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#ffffff",
  },
  contentContainer: {
    flex: 1,
    backgroundColor: "#f0f4f8",
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    backgroundColor: "#ffffff",
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: "#e8edf2",
  },
  headerTitle: {
    fontSize: 17,
    fontWeight: "700",
    color: "#1a1a1a",
  },
  headerSub: {
    fontSize: 12,
    color: "#757575",
    marginTop: 2,
  },
  logoutBtn: {
    backgroundColor: "#f5f5f5",
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderWidth: 1,
    borderColor: "#e8edf2",
    minHeight: 44,
    justifyContent: "center",
    alignItems: "center",
  },
  logoutText: {
    fontSize: 13,
    color: "#d32f2f",
    fontWeight: "600",
  },
  headerActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  dashboardBtn: {
    backgroundColor: "#ffffff",
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderWidth: 1,
    borderColor: "#1976d2",
    minHeight: 44,
    justifyContent: "center",
    alignItems: "center",
  },
  dashboardText: {
    fontSize: 13,
    color: "#1976d2",
    fontWeight: "600",
  },
  sectionLabel: {
    fontSize: 12,
    fontWeight: "600",
    color: "#9e9e9e",
    textTransform: "uppercase",
    letterSpacing: 0.8,
    marginTop: 20,
    marginBottom: 8,
    marginHorizontal: 20,
  },
  listShadow: {
    marginHorizontal: 16,
    borderRadius: 14,
    backgroundColor: "#ffffff",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 6,
    elevation: 2,
  },
  list: {
    backgroundColor: "#ffffff",
    borderRadius: 14,
    overflow: "hidden",
  },
  row: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 16,
    backgroundColor: "#ffffff",
  },
  groupName: {
    fontSize: 17,
    color: "#1a1a1a",
    fontWeight: "500",
    flex: 1,
  },
  badges: {
    flexDirection: "row",
    gap: 6,
  },
  badgeBlue: {
    backgroundColor: "#1976d2",
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 3,
  },
  badgeOrange: {
    backgroundColor: "#e65100",
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 3,
  },
  badgeText: {
    color: "#ffffff",
    fontSize: 12,
    fontWeight: "700",
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
    marginBottom: 16,
  },
  retryBtn: {
    backgroundColor: "#1976d2",
    borderRadius: 8,
    paddingHorizontal: 24,
    paddingVertical: 10,
  },
  retryText: {
    color: "#ffffff",
    fontWeight: "600",
    fontSize: 14,
  },
  headerSubRow: {
    marginTop: 2,
  },
  settingsBtn: {
    marginTop: 2,
  },
  settingsBtnText: {
    fontSize: 12,
    fontWeight: "600",
    color: "#1976d2",
  },
  // change password modal
  settingsOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.45)",
    justifyContent: "center",
    paddingHorizontal: 24,
  },
  settingsContent: {
    backgroundColor: "#ffffff",
    borderRadius: 14,
    padding: 24,
    paddingBottom: 40,
  },
  settingsTitle: {
    fontSize: 17,
    fontWeight: "700",
    color: "#1a1a1a",
    marginBottom: 16,
  },
  settingsLabel: {
    fontSize: 12,
    fontWeight: "600",
    color: "#757575",
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginBottom: 6,
    marginTop: 12,
  },
  settingsInput: {
    borderWidth: 1,
    borderColor: "#e0e0e0",
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
    color: "#1a1a1a",
    backgroundColor: "#f5f5f5",
    minHeight: 44,
  },
  settingsError: {
    color: "#d32f2f",
    fontSize: 13,
    marginTop: 8,
  },
  settingsSuccess: {
    color: "#22c55e",
    fontSize: 13,
    fontWeight: "500",
    marginTop: 8,
  },
  settingsActions: {
    flexDirection: "row",
    gap: 10,
    marginTop: 20,
  },
  settingsCancelBtn: {
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
  settingsCancelText: {
    color: "#1976d2",
    fontWeight: "600",
    fontSize: 14,
  },
  settingsSaveBtn: {
    flex: 1,
    backgroundColor: "#1976d2",
    borderRadius: 10,
    paddingVertical: 11,
    minHeight: 44,
    justifyContent: "center",
    alignItems: "center",
  },
  settingsSaveText: {
    color: "#ffffff",
    fontWeight: "600",
    fontSize: 14,
  },
  settingsBtnDisabled: {
    opacity: 0.6,
  },
  // announcement banner
  announcementBanner: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#e8f0fd",
    borderLeftWidth: 4,
    borderLeftColor: "#1976d2",
    borderRadius: 8,
    marginHorizontal: 16,
    marginTop: 12,
    padding: 12,
  },
  announcementContent: {
    flex: 1,
    marginRight: 8,
  },
  announcementText: {
    fontSize: 14,
    color: "#1a1a1a",
    fontWeight: "600",
  },
  announcementMeta: {
    fontSize: 12,
    color: "#757575",
    marginTop: 2,
  },
  announcementAction: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  announcementActionText: {
    fontSize: 13,
    color: "#1976d2",
    fontWeight: "600",
  },
  announcementDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: "#d32f2f",
  },
  broadcastInputRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
    marginBottom: 12,
  },
  broadcastTextInput: {
    flex: 1,
    borderWidth: 1,
    borderColor: "#e0e0e0",
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
    color: "#1a1a1a",
    backgroundColor: "#f5f5f5",
    minHeight: 44,
    maxHeight: 100,
  },
  broadcastSendBtn: {
    backgroundColor: "#1976d2",
    borderRadius: 10,
    paddingHorizontal: 16,
    paddingVertical: 11,
    minHeight: 44,
    justifyContent: "center",
    alignItems: "center",
  },
  broadcastSendText: {
    color: "#ffffff",
    fontWeight: "600",
    fontSize: 14,
  },
  broadcastEmpty: {
    color: "#9e9e9e",
    fontSize: 14,
    textAlign: "center",
    paddingVertical: 24,
  },
  broadcastList: {
    maxHeight: 280,
  },
  broadcastItem: {
    paddingVertical: 12,
  },
  broadcastContent: {
    fontSize: 15,
    color: "#1a1a1a",
    lineHeight: 21,
    marginBottom: 4,
  },
  broadcastItemFooter: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginTop: 4,
  },
  broadcastMeta: {
    fontSize: 12,
    color: "#9e9e9e",
  },
  broadcastDeleteText: {
    fontSize: 12,
    color: "#d32f2f",
    fontWeight: "600",
  },
});
