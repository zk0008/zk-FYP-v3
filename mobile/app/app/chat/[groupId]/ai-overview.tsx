import { useState, useCallback } from "react";
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  Modal,
  FlatList,
  StyleSheet,
} from "react-native";
import { useGlobalSearchParams, useFocusEffect } from "expo-router";
import { useAuth } from "../../../hooks/useAuth";

const API_BASE = process.env.EXPO_PUBLIC_API_URL ?? "http://127.0.0.1:8001";

type Summary = {
  summary_text: string;
  created_at: string | null;
};

type HistoryItem = {
  id: number;
  summary_text: string;
  created_at: string;
  source_message_count: number | null;
};

function formatDate(iso: string): string {
  // the summary backend sends UTC timestamps without a timezone suffix —
  // append Z so new Date() treats them as UTC, not local time, same fix as
  // web's formatSingaporeTime
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

// Port of web's formatSummaryText — converts leading "- " to "• ", and bolds
// "Key points:" and "Supervisor Action Plan:" wherever they appear in a line
function renderSummaryText(text: string) {
  const bulleted = text.replace(/^(\s*)-\s+/gm, "$1• ");
  const lines = bulleted.split("\n");
  return lines.map((line, idx) => {
    const sep = idx < lines.length - 1 ? "\n" : "";
    const boldPhrases = ["Key points:", "Supervisor Action Plan:", "Student Summary:"];
    for (const phrase of boldPhrases) {
      if (line.includes(phrase)) {
        const [before, after] = line.split(phrase);
        return (
          <Text key={idx}>
            {before}
            <Text style={styles.bold}>{phrase}</Text>
            {after ?? ""}
            {sep}
          </Text>
        );
      }
    }
    return <Text key={idx}>{line}{sep}</Text>;
  });
}

export default function AiOverview() {
  const { groupId } = useGlobalSearchParams<{ groupId: string }>();
  const { token } = useAuth();

  const [summary, setSummary] = useState<Summary | null>(null);
  const [studentSummary, setStudentSummary] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  // separate initial-load error from refresh error so the card stays visible on refresh failure
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [opError, setOpError] = useState<string | null>(null);

  // history state
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [historyModalVisible, setHistoryModalVisible] = useState(false);
  const [expandedHistoryId, setExpandedHistoryId] = useState<number | null>(null);
  // track whether the previous summary card is expanded
  const [prevExpanded, setPrevExpanded] = useState(true);

  const loadSummary = useCallback(async () => {
    if (!token) return;
    setIsLoading(true);
    setFetchError(null);
    try {
      const [summaryRes, historyRes, studentRes] = await Promise.all([
        fetch(`${API_BASE}/groups/${groupId}/summary?range=weekly`, {
          headers: { Authorization: `Bearer ${token}` },
        }),
        fetch(`${API_BASE}/groups/${groupId}/summary/history`, {
          headers: { Authorization: `Bearer ${token}` },
        }),
        fetch(`${API_BASE}/groups/${groupId}/student-summary`, {
          headers: { Authorization: `Bearer ${token}` },
        }),
      ]);
      if (!summaryRes.ok) throw new Error(`Failed to load summary (${summaryRes.status})`);
      const data: Summary = await summaryRes.json();
      setSummary(data);
      if (historyRes.ok) {
        const histData: HistoryItem[] = await historyRes.json();
        setHistory(histData);
      }
      if (studentRes.ok) {
        const studentData = await studentRes.json();
        setStudentSummary(studentData.summary_text || null);
      }
    } catch (e: any) {
      setFetchError(e.message ?? "Failed to load summary");
    } finally {
      setIsLoading(false);
    }
  }, [groupId, token]);

  // Reload every time this tab comes into focus
  useFocusEffect(
    useCallback(() => {
      loadSummary();
    }, [loadSummary])
  );

  const handleRefresh = async () => {
    if (!token) return;
    setRefreshing(true);
    setOpError(null);
    try {
      const res = await fetch(
        `${API_BASE}/groups/${groupId}/summary?range=weekly`,
        { method: "POST", headers: { Authorization: `Bearer ${token}` } }
      );
      if (!res.ok) throw new Error(`Refresh failed (${res.status})`);
      const data: Summary = await res.json();
      setSummary(data);
      // reload history + student summary so both panels update immediately
      const [histRes, studentRes] = await Promise.all([
        fetch(`${API_BASE}/groups/${groupId}/summary/history`, {
          headers: { Authorization: `Bearer ${token}` },
        }),
        fetch(`${API_BASE}/groups/${groupId}/student-summary`, {
          headers: { Authorization: `Bearer ${token}` },
        }),
      ]);
      if (histRes.ok) {
        const histData: HistoryItem[] = await histRes.json();
        setHistory(histData);
      }
      if (studentRes.ok) {
        const studentData = await studentRes.json();
        setStudentSummary(studentData.summary_text || null);
      }
    } catch (e: any) {
      setOpError(e.message ?? "Refresh failed");
    } finally {
      setRefreshing(false);
    }
  };

  // the second item in the history list is the one before the current generation
  const previousSummary = history.length >= 2 ? history[1] : null;

  const toggleHistoryItem = (id: number) => {
    setExpandedHistoryId((prev) => (prev === id ? null : id));
  };

  return (
    <View style={styles.container}>
      {/* Header row: title left, history + refresh buttons right */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Weekly Summary</Text>
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
              styles.refreshBtn,
              (refreshing || isLoading) && styles.refreshBtnDisabled,
            ]}
            onPress={handleRefresh}
            disabled={refreshing || isLoading}
            activeOpacity={0.8}
          >
            {refreshing ? (
              <ActivityIndicator size="small" color="#ffffff" />
            ) : (
              <Text style={styles.refreshBtnText}>Refresh</Text>
            )}
          </TouchableOpacity>
        </View>
      </View>

      {/* Refresh failure — shown above content, does not hide the card */}
      {opError !== null && (
        <View style={styles.errorBanner}>
          <Text style={styles.errorBannerText}>{opError}</Text>
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

      {/* Summary content */}
      {!isLoading && fetchError === null && (
        <ScrollView contentContainerStyle={styles.scrollContent}>
          {summary?.summary_text ? (
            <View style={styles.card}>
              {summary.created_at !== null && (
                <Text style={styles.metaText}>
                  Last updated: {formatDate(summary.created_at)}
                </Text>
              )}
              <Text style={styles.summaryText}>
                {renderSummaryText(summary.summary_text)}
              </Text>
            </View>
          ) : (
            <View style={styles.emptyCard}>
              <Text style={styles.emptyText}>
                No summary available yet. Tap Refresh to generate one.
              </Text>
            </View>
          )}

          {/* Student summary — the same text fed into the AI prompt */}
          {studentSummary ? (
            <View style={styles.prevCard}>
              <View style={styles.prevHeader}>
                <Text style={styles.prevTitle}>Student Summary</Text>
              </View>
              <Text style={styles.summaryText}>
                {renderSummaryText(studentSummary)}
              </Text>
            </View>
          ) : null}

          {/* Previous summary — only shown when a second history entry exists */}
          {previousSummary !== null && (
            <View style={styles.prevCard}>
              <TouchableOpacity
                style={styles.prevHeader}
                onPress={() => setPrevExpanded((v) => !v)}
                activeOpacity={0.7}
              >
                <Text style={styles.prevTitle}>Previous Summary</Text>
                <Text style={styles.prevMeta}>
                  {formatDate(previousSummary.created_at)}{"  "}
                  <Text style={styles.chevron}>{prevExpanded ? "▲" : "▼"}</Text>
                </Text>
              </TouchableOpacity>
              {prevExpanded && (
                <Text style={styles.summaryText}>
                  {renderSummaryText(previousSummary.summary_text)}
                </Text>
              )}
            </View>
          )}
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
                        {renderSummaryText(item.summary_text)}
                      </Text>
                    )}
                  </TouchableOpacity>
                );
              }}
            />
          )}
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
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
  refreshBtn: {
    backgroundColor: "#1976d2",
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 8,
    minWidth: 80,
    alignItems: "center",
  },
  refreshBtnDisabled: {
    backgroundColor: "#90bce8",
  },
  refreshBtnText: {
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
    gap: 16,
  },
  card: {
    backgroundColor: "#ffffff",
    borderRadius: 12,
    padding: 16,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 4,
    elevation: 2,
  },
  metaText: {
    fontSize: 12,
    color: "#757575",
    marginBottom: 12,
  },
  summaryText: {
    fontSize: 14,
    color: "#1a1a1a",
    lineHeight: 22,
  },
  bold: {
    fontWeight: "bold",
  },
  emptyCard: {
    backgroundColor: "#ffffff",
    borderRadius: 12,
    padding: 32,
    alignItems: "center",
  },
  emptyText: {
    color: "#9e9e9e",
    fontSize: 15,
    textAlign: "center",
  },
  prevCard: {
    backgroundColor: "#ffffff",
    borderRadius: 12,
    padding: 16,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 4,
    elevation: 1,
  },
  prevHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    marginBottom: 8,
  },
  prevTitle: {
    fontSize: 13,
    fontWeight: "700",
    color: "#757575",
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  prevMeta: {
    fontSize: 12,
    color: "#9e9e9e",
  },
  chevron: {
    fontSize: 11,
    color: "#9e9e9e",
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
  historyRowText: {
    marginTop: 12,
    fontSize: 14,
    color: "#1a1a1a",
    lineHeight: 22,
  },
});
