import { useState, useCallback } from "react";
import {
  View,
  Text,
  TextInput,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  FlatList,
  Platform,
  StyleSheet,
} from "react-native";
import { useGlobalSearchParams, useFocusEffect } from "expo-router";
import { useHeaderHeight } from "@react-navigation/elements";
import { useAuth } from "../../../hooks/useAuth";

const API_BASE = process.env.EXPO_PUBLIC_API_URL ?? "http://127.0.0.1:8001";

type HistoryItem = {
  id: number;
  summary_text: string;
  created_at: string;
};

function formatDate(iso: string): string {
  // backend returns UTC without a timezone suffix — append Z so the JS engine
  // treats it as UTC rather than local time, matching the pattern used elsewhere
  let ts = iso.trim();
  const hasTimezone =
    ts.endsWith("Z") ||
    /[+-]\d{2}:\d{2}$/.test(ts) ||
    /[+-]\d{4}$/.test(ts);
  if (!hasTimezone) {
    ts = ts.split(".")[0] + "Z";
  }
  return new Intl.DateTimeFormat("en-SG", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Asia/Singapore",
  }).format(new Date(ts));
}

export default function StudentOverview() {
  const { groupId } = useGlobalSearchParams<{ groupId: string }>();
  const { token } = useAuth();
  const headerHeight = useHeaderHeight();

  // savedText is what the server has; editText is what the user is typing
  const [savedText, setSavedText] = useState("");
  const [editText, setEditText] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // history state
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [historyModalVisible, setHistoryModalVisible] = useState(false);
  const [expandedHistoryId, setExpandedHistoryId] = useState<number | null>(null);

  const loadSummary = useCallback(async () => {
    if (!token) return;
    setIsLoading(true);
    setFetchError(null);
    try {
      const [summaryRes, historyRes] = await Promise.all([
        fetch(`${API_BASE}/groups/${groupId}/student-summary`, {
          headers: { Authorization: `Bearer ${token}` },
        }),
        fetch(`${API_BASE}/groups/${groupId}/student-summary/history`, {
          headers: { Authorization: `Bearer ${token}` },
        }),
      ]);
      if (!summaryRes.ok) throw new Error(`Failed to load summary (${summaryRes.status})`);
      const data = await summaryRes.json();
      const text = data.summary_text ?? "";
      setSavedText(text);
      setEditText(text);
      if (historyRes.ok) {
        const histData: HistoryItem[] = await historyRes.json();
        setHistory(histData);
      }
    } catch (e: any) {
      setFetchError(e.message ?? "Failed to load summary");
    } finally {
      setIsLoading(false);
    }
  }, [groupId, token]);

  // Reload every time the tab comes into focus
  useFocusEffect(
    useCallback(() => {
      loadSummary();
    }, [loadSummary])
  );

  const handleSave = async () => {
    if (!token) return;
    setSaving(true);
    setSaveError(null);
    try {
      const res = await fetch(
        `${API_BASE}/groups/${groupId}/student-summary`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ summary_text: editText }),
        }
      );
      if (!res.ok) throw new Error(`Save failed (${res.status})`);
      const data = await res.json();
      // update savedText so the Save button goes back to disabled
      setSavedText(data.summary_text ?? editText);
      // reload history so the new entry appears immediately
      const histRes = await fetch(
        `${API_BASE}/groups/${groupId}/student-summary/history`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      if (histRes.ok) {
        const histData: HistoryItem[] = await histRes.json();
        setHistory(histData);
      }
    } catch (e: any) {
      setSaveError(e.message ?? "Save failed");
    } finally {
      setSaving(false);
    }
  };

  const hasChanges = editText !== savedText;

  const toggleHistoryItem = (id: number) => {
    setExpandedHistoryId((prev) => (prev === id ? null : id));
  };

  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === "ios" ? "padding" : "height"}
      keyboardVerticalOffset={headerHeight}
    >
      {/* Header row: title left, History + Save buttons right */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Student Summary</Text>
        <View style={styles.headerButtons}>
          <TouchableOpacity
            style={styles.historyBtn}
            onPress={() => {
              setExpandedHistoryId(null);
              setHistoryModalVisible(true);
            }}
            activeOpacity={0.8}
          >
            <Text style={styles.historyBtnText}>History</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[
              styles.saveBtn,
              (!hasChanges || saving || isLoading) && styles.saveBtnDisabled,
            ]}
            onPress={handleSave}
            disabled={!hasChanges || saving || isLoading}
            activeOpacity={0.8}
          >
            {saving ? (
              <ActivityIndicator size="small" color="#ffffff" />
            ) : (
              <Text style={styles.saveBtnText}>Save</Text>
            )}
          </TouchableOpacity>
        </View>
      </View>

      {/* Save error banner — stays above the input so it doesn't block it */}
      {saveError !== null && (
        <View style={styles.errorBanner}>
          <Text style={styles.errorBannerText}>{saveError}</Text>
        </View>
      )}

      {/* Initial load spinner */}
      {isLoading && (
        <View style={styles.center}>
          <ActivityIndicator size="large" color="#1976d2" />
        </View>
      )}

      {/* Initial load failure — full-screen with retry */}
      {!isLoading && fetchError !== null && (
        <View style={styles.center}>
          <Text style={styles.fetchErrorText}>{fetchError}</Text>
          <TouchableOpacity style={styles.retryBtn} onPress={loadSummary}>
            <Text style={styles.retryText}>Retry</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Editable area — takes all remaining space */}
      {!isLoading && fetchError === null && (
        <ScrollView
          style={styles.flex}
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
        >
          <View style={styles.card}>
            <TextInput
              style={styles.input}
              multiline
              textAlignVertical="top"
              value={editText}
              onChangeText={setEditText}
              placeholder="Write a collaborative summary for your group..."
              placeholderTextColor="#9e9e9e"
              scrollEnabled={false}
            />
          </View>
        </ScrollView>
      )}

      {/* History modal */}
      <Modal
        visible={historyModalVisible}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setHistoryModalVisible(false)}
      >
        <View style={styles.modalContainer}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>Summary History</Text>
            <TouchableOpacity
              onPress={() => setHistoryModalVisible(false)}
              style={styles.modalCloseBtn}
              activeOpacity={0.8}
            >
              <Text style={styles.modalCloseBtnText}>Close</Text>
            </TouchableOpacity>
          </View>
          {history.length === 0 ? (
            <View style={styles.center}>
              <Text style={styles.emptyText}>No history yet.</Text>
            </View>
          ) : (
            <FlatList
              data={history}
              keyExtractor={(item) => String(item.id)}
              contentContainerStyle={styles.modalList}
              ItemSeparatorComponent={() => <View style={styles.separator} />}
              renderItem={({ item }) => {
                const isExpanded = expandedHistoryId === item.id;
                return (
                  <TouchableOpacity
                    style={styles.historyRow}
                    onPress={() => toggleHistoryItem(item.id)}
                    activeOpacity={0.7}
                  >
                    <View style={styles.historyRowHeader}>
                      <Text style={styles.historyRowDate}>
                        {formatDate(item.created_at)}
                      </Text>
                      <Text style={styles.chevron}>{isExpanded ? "▲" : "▼"}</Text>
                    </View>
                    {isExpanded && (
                      <Text style={styles.historyRowText}>
                        {item.summary_text}
                      </Text>
                    )}
                  </TouchableOpacity>
                );
              }}
            />
          )}
        </View>
      </Modal>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
    backgroundColor: "#f0f4f8",
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    backgroundColor: "#ffffff",
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: "#e0e0e0",
  },
  headerTitle: {
    fontSize: 16,
    fontWeight: "700",
    color: "#1a1a1a",
  },
  headerButtons: {
    flexDirection: "row",
    gap: 8,
  },
  historyBtn: {
    backgroundColor: "#f5f5f5",
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderWidth: 1,
    borderColor: "#e0e0e0",
    alignItems: "center",
  },
  historyBtnText: {
    color: "#1a1a1a",
    fontSize: 13,
    fontWeight: "600",
  },
  saveBtn: {
    backgroundColor: "#1976d2",
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 8,
    minWidth: 60,
    alignItems: "center",
  },
  saveBtnDisabled: {
    backgroundColor: "#90bce8",
  },
  saveBtnText: {
    color: "#ffffff",
    fontSize: 13,
    fontWeight: "600",
  },
  errorBanner: {
    backgroundColor: "#ffebee",
    borderLeftWidth: 4,
    borderLeftColor: "#d32f2f",
    marginHorizontal: 16,
    marginTop: 12,
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  errorBannerText: {
    color: "#d32f2f",
    fontSize: 13,
  },
  center: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: 32,
  },
  fetchErrorText: {
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
  scrollContent: {
    padding: 16,
    flexGrow: 1,
  },
  card: {
    backgroundColor: "#ffffff",
    borderRadius: 12,
    padding: 16,
    flexGrow: 1,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 4,
    elevation: 2,
  },
  input: {
    fontSize: 14,
    color: "#1a1a1a",
    lineHeight: 22,
    minHeight: 200,
  },
  emptyText: {
    color: "#9e9e9e",
    fontSize: 15,
    textAlign: "center",
  },
  // modal styles
  modalContainer: {
    flex: 1,
    backgroundColor: "#f0f4f8",
  },
  modalHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    backgroundColor: "#ffffff",
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: "#e0e0e0",
  },
  modalTitle: {
    fontSize: 16,
    fontWeight: "700",
    color: "#1a1a1a",
  },
  modalCloseBtn: {
    backgroundColor: "#f5f5f5",
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderWidth: 1,
    borderColor: "#e0e0e0",
  },
  modalCloseBtnText: {
    fontSize: 13,
    color: "#1a1a1a",
    fontWeight: "600",
  },
  modalList: {
    marginHorizontal: 16,
    marginTop: 16,
    backgroundColor: "#ffffff",
    borderRadius: 12,
    overflow: "hidden",
  },
  separator: {
    height: 1,
    backgroundColor: "#f0f0f0",
  },
  historyRow: {
    padding: 16,
  },
  historyRowHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  historyRowDate: {
    fontSize: 14,
    fontWeight: "600",
    color: "#1a1a1a",
  },
  chevron: {
    fontSize: 11,
    color: "#9e9e9e",
  },
  historyRowText: {
    marginTop: 12,
    fontSize: 14,
    color: "#1a1a1a",
    lineHeight: 22,
  },
});
