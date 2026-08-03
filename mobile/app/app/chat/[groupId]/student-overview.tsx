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
  ai_summary_copy: string | null;
  is_submitted: boolean;
  submitted_at: string | null;
  is_late: boolean;
  created_at: string;
};

const MONTH_NAMES = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

// Manual UTC+8 shift — same approach as formatSGT in MessageBubble, avoids Intl timezone issues on Hermes
function formatDeadlineSGT(isoString: string): string {
  const iso = isoString.includes("Z") || isoString.includes("+") ? isoString : isoString + "Z";
  const sgt = new Date(new Date(iso).getTime() + 8 * 60 * 60 * 1000);
  const day = sgt.getUTCDate();
  const mon = MONTH_NAMES[sgt.getUTCMonth()];
  const year = sgt.getUTCFullYear();
  const h = sgt.getUTCHours();
  const m = sgt.getUTCMinutes().toString().padStart(2, "0");
  const ampm = h >= 12 ? "PM" : "AM";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${day} ${mon} ${year}, ${h12}:${m} ${ampm} SGT`;
}

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
  // same pattern for the editable AI summary copy
  const [aiSavedText, setAiSavedText] = useState("");
  const [aiEditText, setAiEditText] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // history state
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [historyModalVisible, setHistoryModalVisible] = useState(false);
  const [expandedHistoryId, setExpandedHistoryId] = useState<number | null>(null);

  // submission state
  const [deadlineDt, setDeadlineDt] = useState<string | null>(null);
  const [deadlineIsHard, setDeadlineIsHard] = useState(false);
  const [isSubmitted, setIsSubmitted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitSuccess, setSubmitSuccess] = useState(false);
  const [submitLate, setSubmitLate] = useState(false);

  const loadSummary = useCallback(async () => {
    if (!token) return;
    setIsLoading(true);
    setFetchError(null);
    try {
      const [summaryRes, historyRes, deadlineRes] = await Promise.all([
        fetch(`${API_BASE}/groups/${groupId}/student-summary`, {
          headers: { Authorization: `Bearer ${token}` },
        }),
        fetch(`${API_BASE}/groups/${groupId}/student-summary/history`, {
          headers: { Authorization: `Bearer ${token}` },
        }),
        fetch(`${API_BASE}/deadline`, {
          headers: { Authorization: `Bearer ${token}` },
        }),
      ]);
      if (!summaryRes.ok) throw new Error(`Failed to load summary (${summaryRes.status})`);
      const data = await summaryRes.json();
      const text = data.summary_text ?? "";
      setSavedText(text);
      setEditText(text);

      // use the saved AI copy if one exists; otherwise seed from the AI-generated weekly summary
      let aiCopy: string = data.ai_summary_copy ?? "";
      if (!aiCopy) {
        const aiRes = await fetch(
          `${API_BASE}/groups/${groupId}/summary?range=weekly`,
          { headers: { Authorization: `Bearer ${token}` } }
        );
        if (aiRes.ok) {
          const aiData = await aiRes.json();
          aiCopy = aiData.summary_text ?? "";
        }
      }
      setAiSavedText(aiCopy);
      setAiEditText(aiCopy);

      let histData: HistoryItem[] = [];
      if (historyRes.ok) {
        histData = await historyRes.json();
        setHistory(histData);
      }
      let nextDeadlineDt: string | null = null;
      let dlFrequency: string = "once";
      if (deadlineRes.ok) {
        const dlData = await deadlineRes.json();
        nextDeadlineDt = dlData ? dlData.next_deadline_dt : null;
        dlFrequency = dlData ? (dlData.frequency ?? "once") : "once";
        setDeadlineDt(nextDeadlineDt);
        setDeadlineIsHard(dlData ? dlData.is_hard : false);
      }
      // If no deadline exists, fall back to the plain is_submitted flag on the row.
      // If a deadline exists, only disable if the latest submission is within the current window.
      const latestHist = histData[0];
      if (!latestHist) {
        setIsSubmitted(false);
      } else if (!nextDeadlineDt) {
        setIsSubmitted(latestHist.is_submitted ?? false);
      } else {
        const nextDtMs = new Date(
          nextDeadlineDt.includes("Z") || nextDeadlineDt.includes("+")
            ? nextDeadlineDt
            : nextDeadlineDt + "Z"
        ).getTime();
        // window start = next_deadline_dt minus one frequency interval
        let intervalMs = 0;
        if (dlFrequency === "weekly") intervalMs = 7 * 24 * 60 * 60 * 1000;
        else if (dlFrequency === "biweekly") intervalMs = 14 * 24 * 60 * 60 * 1000;
        // "once" keeps intervalMs = 0 — window start = epoch, so any submission counts
        const windowStartMs = intervalMs > 0 ? nextDtMs - intervalMs : 0;
        if (latestHist.is_submitted && latestHist.submitted_at) {
          const submittedMs = new Date(
            latestHist.submitted_at.includes("Z") || latestHist.submitted_at.includes("+")
              ? latestHist.submitted_at
              : latestHist.submitted_at + "Z"
          ).getTime();
          // submitted within this window → already done; before window start → new window, allow resubmit
          setIsSubmitted(submittedMs >= windowStartMs);
        } else {
          setIsSubmitted(false);
        }
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
          body: JSON.stringify({ summary_text: editText, ai_summary_copy: aiEditText }),
        }
      );
      if (!res.ok) throw new Error(`Save failed (${res.status})`);
      const data = await res.json();
      // update saved state so the Save button goes back to disabled
      setSavedText(data.summary_text ?? editText);
      setAiSavedText(data.ai_summary_copy ?? aiEditText);
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

  const hasChanges = editText !== savedText || aiEditText !== aiSavedText;

  const handleSubmit = async () => {
    if (!token) return;
    setSubmitting(true);
    setSubmitError(null);
    setSubmitSuccess(false);
    try {
      // always save current content first, then submit the saved copy
      const saveRes = await fetch(
        `${API_BASE}/groups/${groupId}/student-summary`,
        {
          method: "POST",
          headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
          body: JSON.stringify({ summary_text: editText, ai_summary_copy: aiEditText }),
        }
      );
      if (!saveRes.ok) throw new Error(`Save failed (${saveRes.status})`);
      const saveData = await saveRes.json();
      // sync saved state so hasChanges goes back to false
      const newSummaryText = saveData.summary_text ?? editText;
      const newAiText = saveData.ai_summary_copy ?? aiEditText;
      setSavedText(newSummaryText);
      setAiSavedText(newAiText);
      setEditText(newSummaryText);
      setAiEditText(newAiText);

      const submitRes = await fetch(
        `${API_BASE}/groups/${groupId}/student-summary/submit`,
        {
          method: "POST",
          headers: { Authorization: `Bearer ${token}` },
        }
      );
      if (!submitRes.ok) {
        const errData = await submitRes.json().catch(() => null);
        throw new Error(errData?.detail ?? `Submit failed (${submitRes.status})`);
      }
      const submitData = await submitRes.json();
      setIsSubmitted(true);
      setSubmitSuccess(true);
      setSubmitLate(submitData.is_late ?? false);

      // reload history so the submitted entry appears immediately
      const histRes = await fetch(
        `${API_BASE}/groups/${groupId}/student-summary/history`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      if (histRes.ok) {
        const histData: HistoryItem[] = await histRes.json();
        setHistory(histData);
      }
    } catch (e: any) {
      setSubmitError(e.message ?? "Submit failed");
    } finally {
      setSubmitting(false);
    }
  };

  const deadlinePassed =
    deadlineDt !== null &&
    Date.now() >
      new Date(
        deadlineDt.includes("Z") || deadlineDt.includes("+") ? deadlineDt : deadlineDt + "Z"
      ).getTime();

  // enabled whenever there are unsaved changes (acts as save+submit in one tap)
  // disabled only when already submitted this window with nothing new, or hard deadline has passed
  const submitDisabled =
    history.length === 0 ||
    (deadlinePassed && deadlineIsHard) ||
    submitting ||
    isLoading ||
    (!hasChanges && isSubmitted);

  const toggleHistoryItem = (id: number) => {
    setExpandedHistoryId((prev) => (prev === id ? null : id));
  };

  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      keyboardVerticalOffset={headerHeight}
    >
      {/* Header row: title left, History + Save buttons right */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Group Summary</Text>
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

      {/* Deadline + Submit row — always visible below the header */}
      <View style={styles.deadlineRow}>
        <Text style={styles.deadlineText}>
          {deadlineDt
            ? `Due: ${formatDeadlineSGT(deadlineDt)}`
            : "No deadline set"}
        </Text>
        <TouchableOpacity
          style={[styles.submitBtn, submitDisabled && styles.submitBtnDisabled]}
          onPress={handleSubmit}
          disabled={submitDisabled}
          activeOpacity={0.8}
        >
          {submitting ? (
            <ActivityIndicator size="small" color="#ffffff" />
          ) : (
            <Text style={styles.submitBtnText}>
              {isSubmitted && !hasChanges ? "Submitted" : "Submit"}
            </Text>
          )}
        </TouchableOpacity>
      </View>

      {/* Info strip — soft deadline passed, student hasn't submitted yet */}
      {deadlinePassed && !deadlineIsHard && !isSubmitted && (
        <View style={styles.warningBanner}>
          <Text style={styles.warningBannerText}>
            Submitting after the deadline will be marked as late.
          </Text>
        </View>
      )}

      {/* Save error banner — stays above the input so it doesn't block it */}
      {saveError !== null && (
        <View style={styles.errorBanner}>
          <Text style={styles.errorBannerText}>{saveError}</Text>
        </View>
      )}

      {/* Submit error banner */}
      {submitError !== null && (
        <View style={styles.errorBanner}>
          <Text style={styles.errorBannerText}>{submitError}</Text>
        </View>
      )}

      {/* Submit success banner — amber when late, green when on time */}
      {submitSuccess && (
        <View style={submitLate ? styles.lateBanner : styles.successBanner}>
          <Text style={submitLate ? styles.lateBannerText : styles.successBannerText}>
            {submitLate ? "Submitted late." : "Summary submitted successfully."}
          </Text>
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
          <Text style={styles.sectionLabel}>Additional Information</Text>
          <View style={[styles.card, { marginBottom: 20 }]}>
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

          <Text style={styles.sectionLabel}>AI Summary (editable copy)</Text>
          <View style={[styles.card, styles.cardSecond]}>
            <TextInput
              style={styles.input}
              multiline
              textAlignVertical="top"
              value={aiEditText}
              onChangeText={setAiEditText}
              placeholder="AI-generated summary will appear here…"
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
                      <View style={styles.historyRowBadges}>
                        {item.is_late && (
                          <View style={styles.lateBadge}>
                            <Text style={styles.lateBadgeText}>Late</Text>
                          </View>
                        )}
                        <Text style={styles.chevron}>{isExpanded ? "▲" : "▼"}</Text>
                      </View>
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
    borderBottomColor: "#e8edf2",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 4,
    elevation: 2,
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
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderWidth: 1,
    borderColor: "#e8edf2",
    minHeight: 44,
    justifyContent: "center",
    alignItems: "center",
  },
  historyBtnText: {
    color: "#1a1a1a",
    fontSize: 13,
    fontWeight: "600",
  },
  saveBtn: {
    backgroundColor: "#1976d2",
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 8,
    minWidth: 60,
    minHeight: 44,
    justifyContent: "center",
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
    borderRadius: 10,
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
    borderRadius: 14,
    padding: 16,
    flexGrow: 1,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 6,
    elevation: 2,
  },
  input: {
    fontSize: 14,
    color: "#1a1a1a",
    lineHeight: 22,
    minHeight: 200,
  },
  sectionLabel: {
    fontSize: 12,
    fontWeight: "600",
    color: "#757575",
    marginBottom: 8,
    marginLeft: 2,
    textTransform: "uppercase",
    letterSpacing: 0.8,
  },
  cardSecond: {
    flexGrow: 0,
    marginTop: 0,
  },
  deadlineRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    backgroundColor: "#ffffff",
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: "#e8edf2",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 4,
    elevation: 2,
  },
  deadlineText: {
    fontSize: 13,
    color: "#757575",
    flex: 1,
    marginRight: 12,
  },
  submitBtn: {
    backgroundColor: "#22c55e",
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 8,
    minWidth: 80,
    minHeight: 44,
    justifyContent: "center",
    alignItems: "center",
  },
  submitBtnDisabled: {
    backgroundColor: "#86efac",
  },
  submitBtnText: {
    color: "#ffffff",
    fontSize: 13,
    fontWeight: "600",
  },
  successBanner: {
    backgroundColor: "#f0fdf4",
    borderLeftWidth: 4,
    borderLeftColor: "#22c55e",
    marginHorizontal: 16,
    marginTop: 12,
    marginBottom: 12,
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  successBannerText: {
    color: "#15803d",
    fontSize: 13,
  },
  lateBanner: {
    backgroundColor: "#fffbeb",
    borderLeftWidth: 4,
    borderLeftColor: "#f59e0b",
    marginHorizontal: 16,
    marginTop: 12,
    marginBottom: 12,
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  lateBannerText: {
    color: "#92400e",
    fontSize: 13,
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
    borderBottomColor: "#e8edf2",
  },
  modalTitle: {
    fontSize: 16,
    fontWeight: "700",
    color: "#1a1a1a",
  },
  modalCloseBtn: {
    backgroundColor: "#f5f5f5",
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderWidth: 1,
    borderColor: "#e8edf2",
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
    borderRadius: 14,
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
  historyRowBadges: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  lateBadge: {
    backgroundColor: "#f59e0b",
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  lateBadgeText: {
    color: "#ffffff",
    fontSize: 11,
    fontWeight: "700",
  },
  warningBanner: {
    backgroundColor: "#fffbeb",
    borderLeftWidth: 4,
    borderLeftColor: "#f59e0b",
    marginHorizontal: 16,
    marginTop: 10,
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  warningBannerText: {
    color: "#92400e",
    fontSize: 13,
  },
});
