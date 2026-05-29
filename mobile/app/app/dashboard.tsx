import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  Platform,
  StyleSheet,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter, Stack } from "expo-router";
import DateTimePicker from "@react-native-community/datetimepicker";
import { useEffect, useState } from "react";
import { useAuth } from "../hooks/useAuth";

const API_BASE = process.env.EXPO_PUBLIC_API_URL ?? "http://127.0.0.1:8001";

// +8 hours to convert UTC to SGT
function toSGT(iso: string): string {
  const norm = iso.includes("Z") || iso.includes("+") ? iso : iso + "Z";
  const d = new Date(new Date(norm).getTime() + 8 * 60 * 60 * 1000);
  const p = (n: number) => String(n).padStart(2, "0");
  return (
    `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())} ` +
    `${p(d.getUTCHours())}:${p(d.getUTCMinutes())} SGT`
  );
}


type GroupOverview = {
  id: number;
  name: string;
  string_id: string;
  ai_summary: { summary_text: string; created_at: string } | null;
  student_summary: {
    summary_text: string;
    is_submitted: boolean;
    submitted_at: string | null;
  } | null;
  total_messages: number;
};

type Contribution = {
  username: string;
  message_count: number;
  percentage: number;
};

type ContributionData = {
  contributions: Contribution[];
  total_messages: number;
  date_range: { start: string; end: string };
};

const WEEK_OPTIONS = [1, 2, 4, 8] as const;

export default function Dashboard() {
  const { token } = useAuth();
  const router = useRouter();

  const [deadline, setDeadline] = useState<{
    deadline_dt: string;
    set_by: string | null;
  } | null>(null);
  // default to tomorrow at 23:59 in device local time — sensible starting point for a deadline
  const [pickerDate, setPickerDate] = useState<Date>(() => {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    d.setHours(23, 59, 0, 0);
    return d;
  });
  // Android only — pickers are modal dialogs, so we track whether each one is open
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [showTimePicker, setShowTimePicker] = useState(false);
  const [deadlineStatus, setDeadlineStatus] = useState<
    "idle" | "saving" | "success" | "error"
  >("idle");
  const [deadlineError, setDeadlineError] = useState("");

  const [overview, setOverview] = useState<GroupOverview[]>([]);
  const [overviewLoading, setOverviewLoading] = useState(true);
  const [overviewError, setOverviewError] = useState("");

  // which group card is expanded, and the week selector shared by C + D
  const [expandedGroupId, setExpandedGroupId] = useState<string | null>(null);
  const [selectedWeeks, setSelectedWeeks] = useState(4);

  const [contributions, setContributions] = useState<
    Record<string, ContributionData>
  >({});
  const [contribLoading, setContribLoading] = useState<
    Record<string, boolean>
  >({});

  const [analysis, setAnalysis] = useState<Record<string, string>>({});
  const [analysisLoading, setAnalysisLoading] = useState<
    Record<string, boolean>
  >({});

  useEffect(() => {
    if (!token) return;
    loadDeadline();
    loadOverview();
  }, [token]);

  // Re-fetch contributions whenever the expanded group or week count changes,
  // but skip if we already have a cached result for this combination
  useEffect(() => {
    if (!expandedGroupId || !token) return;
    const key = `${expandedGroupId}-${selectedWeeks}`;
    if (contributions[key]) return;
    loadContributions(expandedGroupId, selectedWeeks);
  }, [expandedGroupId, selectedWeeks, token]);

  function loadDeadline() {
    fetch(`${API_BASE}/deadline`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => setDeadline(data))
      .catch(() => {});
  }

  function loadOverview() {
    setOverviewLoading(true);
    setOverviewError("");
    fetch(`${API_BASE}/coordinator/groups/overview`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((res) => {
        if (!res.ok) throw new Error("Failed to load group overview");
        return res.json() as Promise<GroupOverview[]>;
      })
      .then((data) => setOverview(data))
      .catch((e: Error) => setOverviewError(e.message))
      .finally(() => setOverviewLoading(false));
  }

  function loadContributions(groupId: string, weeks: number) {
    const key = `${groupId}-${weeks}`;
    setContribLoading((prev) => ({ ...prev, [key]: true }));
    fetch(
      `${API_BASE}/coordinator/groups/${groupId}/contributions?weeks=${weeks}`,
      { headers: { Authorization: `Bearer ${token}` } }
    )
      .then((res) => {
        if (!res.ok) throw new Error("Failed to load contributions");
        return res.json() as Promise<ContributionData>;
      })
      .then((data) =>
        setContributions((prev) => ({ ...prev, [key]: data }))
      )
      .catch(() => {})
      .finally(() =>
        setContribLoading((prev) => ({ ...prev, [key]: false }))
      );
  }

  function loadAnalysis(groupId: string, weeks: number) {
    const key = `${groupId}-${weeks}`;
    // guard against double-tap while a request is already in flight
    if (analysisLoading[key]) return;
    setAnalysisLoading((prev) => ({ ...prev, [key]: true }));
    fetch(
      `${API_BASE}/coordinator/groups/${groupId}/analysis?weeks=${weeks}`,
      { headers: { Authorization: `Bearer ${token}` } }
    )
      .then((res) => {
        if (!res.ok) throw new Error("Failed to generate analysis");
        return res.json() as Promise<{
          analysis_text: string;
          generated_at: string;
          date_range: { start: string; end: string };
        }>;
      })
      .then((data) =>
        setAnalysis((prev) => ({ ...prev, [key]: data.analysis_text }))
      )
      .catch((e: Error) =>
        setAnalysis((prev) => ({ ...prev, [key]: `Error: ${e.message}` }))
      )
      .finally(() =>
        setAnalysisLoading((prev) => ({ ...prev, [key]: false }))
      );
  }

  async function handleSetDeadline() {
    setDeadlineStatus("saving");
    setDeadlineError("");
    try {
      // pickerDate is a JS Date — toISOString() is always the correct UTC equivalent
      const res = await fetch(`${API_BASE}/deadline`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ deadline_dt: pickerDate.toISOString() }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ detail: "Unknown error" }));
        throw new Error(err.detail ?? "Unknown error");
      }
      const data = await res.json();
      setDeadline(data);
      setDeadlineStatus("success");
      // clear the success message after 3 seconds
      setTimeout(() => setDeadlineStatus("idle"), 3000);
    } catch (e: unknown) {
      setDeadlineStatus("error");
      setDeadlineError(e instanceof Error ? e.message : "Unknown error");
    }
  }

  function toggleGroup(groupId: string) {
    setExpandedGroupId((prev) => (prev === groupId ? null : groupId));
  }

  // widest bar in the comparison chart is 100%; others scale proportionally
  const maxMessages = Math.max(...overview.map((g) => g.total_messages), 1);

  return (
    <SafeAreaView style={styles.container}>
      {/* tell Expo Router's Stack navigator to hide its own header for this screen */}
      <Stack.Screen options={{ headerShown: false }} />

      {/* ── Header ──────────────────────────────────────────────── */}
      <View style={styles.header}>
        <TouchableOpacity
          onPress={() => router.back()}
          style={styles.backBtn}
          activeOpacity={0.7}
        >
          <Text style={styles.backText}>← Back</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Coordinator Dashboard</Text>
        {/* spacer keeps the title visually centred */}
        <View style={styles.headerSpacer} />
      </View>

      <ScrollView contentContainerStyle={styles.scroll}>

        {/* ── Section A: Deadline Setter ────────────────────────── */}
        <Text style={styles.sectionLabel}>Deadline</Text>
        <View style={styles.card}>
          {deadline ? (
            <Text style={styles.deadlineText}>
              Current:{" "}
              <Text style={{ fontWeight: "600" }}>
                {toSGT(deadline.deadline_dt)}
              </Text>
              {deadline.set_by ? `  · set by ${deadline.set_by}` : ""}
            </Text>
          ) : (
            <Text style={styles.mutedText}>No deadline set yet.</Text>
          )}
          {/* show what the coordinator is about to set, always in SGT */}
          <Text style={styles.pickerSelectedText}>
            Set to: {toSGT(pickerDate.toISOString())}
          </Text>

          {/* iOS: render both pickers inline as spinning wheels */}
          {Platform.OS === "ios" && (
            <>
              <DateTimePicker
                value={pickerDate}
                mode="date"
                display="spinner"
                onChange={(_e, date) => { if (date) setPickerDate(date); }}
              />
              <DateTimePicker
                value={pickerDate}
                mode="time"
                display="spinner"
                onChange={(_e, date) => { if (date) setPickerDate(date); }}
              />
            </>
          )}

          {/* Android: pickers are modal dialogs — show buttons to trigger each one */}
          {Platform.OS === "android" && (
            <View style={styles.pickerBtnRow}>
              <TouchableOpacity
                style={[styles.outlineBtn, { flex: 1, marginRight: 6 }]}
                onPress={() => setShowDatePicker(true)}
                activeOpacity={0.8}
              >
                <Text style={styles.outlineBtnText}>Select Date</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.outlineBtn, { flex: 1 }]}
                onPress={() => setShowTimePicker(true)}
                activeOpacity={0.8}
              >
                <Text style={styles.outlineBtnText}>Select Time</Text>
              </TouchableOpacity>
            </View>
          )}

          {/* Android date picker modal — only mounted when triggered */}
          {Platform.OS === "android" && showDatePicker && (
            <DateTimePicker
              value={pickerDate}
              mode="date"
              display="default"
              onChange={(_e, date) => {
                setShowDatePicker(false);
                if (date) setPickerDate(date);
              }}
            />
          )}
          {/* Android time picker modal */}
          {Platform.OS === "android" && showTimePicker && (
            <DateTimePicker
              value={pickerDate}
              mode="time"
              display="default"
              onChange={(_e, date) => {
                setShowTimePicker(false);
                if (date) setPickerDate(date);
              }}
            />
          )}
          <TouchableOpacity
            style={[
              styles.primaryBtn,
              deadlineStatus === "saving" && styles.btnDisabled,
            ]}
            onPress={handleSetDeadline}
            activeOpacity={0.8}
            disabled={deadlineStatus === "saving"}
          >
            {deadlineStatus === "saving" ? (
              <ActivityIndicator size="small" color="#ffffff" />
            ) : (
              <Text style={styles.primaryBtnText}>Set Deadline</Text>
            )}
          </TouchableOpacity>
          {deadlineStatus === "success" && (
            <Text style={styles.successText}>✓ Deadline updated.</Text>
          )}
          {deadlineStatus === "error" && (
            <Text style={styles.errorText}>{deadlineError}</Text>
          )}
        </View>

        {/* ── Section B: Group Overview ──────────────────────────── */}
        <Text style={styles.sectionLabel}>Group Overview</Text>

        {overviewLoading && (
          <ActivityIndicator
            size="large"
            color="#1976d2"
            style={{ marginVertical: 24 }}
          />
        )}
        {!overviewLoading && overviewError !== "" && (
          <Text style={styles.errorText}>{overviewError}</Text>
        )}

        {!overviewLoading &&
          overviewError === "" &&
          overview.map((group) => {
            const isExpanded = expandedGroupId === group.string_id;
            const cKey = `${group.string_id}-${selectedWeeks}`;
            const contribData = contributions[cKey];
            const isContribLoading = !!contribLoading[cKey];
            const analysisText = analysis[cKey];
            const isAnalysisLoading = !!analysisLoading[cKey];

            return (
              <View key={group.string_id} style={styles.card}>
                {/* Tap the header row to expand or collapse */}
                <TouchableOpacity
                  onPress={() => toggleGroup(group.string_id)}
                  activeOpacity={0.7}
                  style={styles.groupCardHeader}
                >
                  <View style={{ flex: 1 }}>
                    <Text style={styles.groupName}>{group.name}</Text>
                    <Text style={styles.mutedText}>
                      {group.total_messages} messages total
                    </Text>
                  </View>
                  <View style={styles.groupCardRight}>
                    {group.student_summary?.is_submitted ? (
                      <View style={styles.badgeGreen}>
                        <Text style={styles.badgeText}>Submitted</Text>
                      </View>
                    ) : (
                      <View style={styles.badgeAmber}>
                        <Text style={styles.badgeText}>Not submitted</Text>
                      </View>
                    )}
                    <Text style={styles.chevron}>{isExpanded ? "▲" : "▼"}</Text>
                  </View>
                </TouchableOpacity>

                {/* One-line AI summary status */}
                <Text style={styles.summaryLine}>
                  {group.ai_summary
                    ? `AI summary: ${toSGT(group.ai_summary.created_at)}`
                    : "AI summary: No summary yet"}
                </Text>

                {/* ── Expanded: sections C + D ─────────────────── */}
                {isExpanded && (
                  <View style={styles.expandedContent}>

                    {/* Week selector — shared by contributions and analysis */}
                    <View style={styles.weekRow}>
                      {WEEK_OPTIONS.map((w) => (
                        <TouchableOpacity
                          key={w}
                          style={[
                            styles.weekBtn,
                            selectedWeeks === w && styles.weekBtnActive,
                          ]}
                          onPress={() => setSelectedWeeks(w)}
                          activeOpacity={0.7}
                        >
                          <Text
                            style={[
                              styles.weekBtnText,
                              selectedWeeks === w && styles.weekBtnTextActive,
                            ]}
                          >
                            {w}W
                          </Text>
                        </TouchableOpacity>
                      ))}
                    </View>

                    {/* Section C — Contribution bar chart */}
                    <Text style={styles.subsectionLabel}>Contributions</Text>
                    {isContribLoading && (
                      <ActivityIndicator
                        size="small"
                        color="#1976d2"
                        style={{ marginVertical: 12 }}
                      />
                    )}
                    {!isContribLoading && contribData && (
                      <>
                        {contribData.contributions.length === 0 ? (
                          <Text style={styles.mutedText}>
                            No messages in this period.
                          </Text>
                        ) : (
                          contribData.contributions.map((item) => (
                            <View key={item.username} style={styles.barRow}>
                              <Text style={styles.barLabel}>
                                {item.username}
                              </Text>
                              <View style={styles.barTrack}>
                                <View
                                  style={[
                                    styles.barFill,
                                    { width: `${item.percentage}%` },
                                  ]}
                                />
                              </View>
                              <Text style={styles.barValue}>
                                {item.percentage}%
                              </Text>
                            </View>
                          ))
                        )}
                        <Text style={styles.dateRange}>
                          {toSGT(contribData.date_range.start)}
                          {" → "}
                          {toSGT(contribData.date_range.end)}
                          {"  ·  "}
                          {contribData.total_messages} messages
                        </Text>
                      </>
                    )}

                    {/* Section D — AI Analysis */}
                    <Text style={[styles.subsectionLabel, { marginTop: 16 }]}>
                      AI Analysis
                    </Text>
                    {!analysisText && !isAnalysisLoading && (
                      <TouchableOpacity
                        style={styles.outlineBtn}
                        onPress={() =>
                          loadAnalysis(group.string_id, selectedWeeks)
                        }
                        activeOpacity={0.8}
                      >
                        <Text style={styles.outlineBtnText}>
                          Generate Analysis
                        </Text>
                      </TouchableOpacity>
                    )}
                    {isAnalysisLoading && (
                      <View style={styles.analysisSpinnerRow}>
                        <ActivityIndicator size="small" color="#1976d2" />
                        <Text style={[styles.mutedText, { marginLeft: 8 }]}>
                          Analysing…
                        </Text>
                      </View>
                    )}
                    {analysisText && !isAnalysisLoading && (
                      <View style={styles.analysisCard}>
                        <Text style={styles.analysisText}>{analysisText}</Text>
                      </View>
                    )}
                  </View>
                )}
              </View>
            );
          })}

        {/* ── Section E: Group Comparison ───────────────────────── */}
        {!overviewLoading && overview.length > 0 && (
          <>
            <Text style={styles.sectionLabel}>Group Comparison</Text>
            <View style={styles.card}>
              <Text style={styles.subsectionLabel}>
                Total messages (all time)
              </Text>
              {overview.map((group) => {
                const barPct = Math.round(
                  (group.total_messages / maxMessages) * 100
                );
                return (
                  <View key={group.string_id} style={styles.barRow}>
                    <Text style={styles.barLabel}>{group.name}</Text>
                    <View style={styles.barTrack}>
                      <View
                        style={[
                          styles.barFill,
                          styles.barFillAmber,
                          { width: `${barPct}%` },
                        ]}
                      />
                    </View>
                    <Text style={styles.barValue}>{group.total_messages}</Text>
                  </View>
                );
              })}
            </View>
          </>
        )}

        <View style={{ height: 32 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#f0f4f8",
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: "#ffffff",
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: "#e0e0e0",
  },
  backBtn: {
    width: 64,
  },
  backText: {
    color: "#1976d2",
    fontSize: 14,
    fontWeight: "600",
  },
  headerTitle: {
    fontSize: 17,
    fontWeight: "700",
    color: "#1e293b",
    textAlign: "center",
    flex: 1,
  },
  // matches backBtn width so title sits in the true centre
  headerSpacer: {
    width: 64,
  },
  scroll: {
    paddingHorizontal: 16,
    paddingTop: 16,
  },
  sectionLabel: {
    fontSize: 12,
    fontWeight: "600",
    color: "#9e9e9e",
    textTransform: "uppercase",
    letterSpacing: 0.8,
    marginBottom: 8,
    marginTop: 8,
  },
  subsectionLabel: {
    fontSize: 12,
    fontWeight: "600",
    color: "#9e9e9e",
    textTransform: "uppercase",
    letterSpacing: 0.6,
    marginBottom: 10,
  },
  card: {
    backgroundColor: "#ffffff",
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
  },
  mutedText: {
    fontSize: 13,
    color: "#757575",
    marginBottom: 6,
  },
  errorText: {
    color: "#d32f2f",
    fontSize: 13,
    marginTop: 6,
  },
  successText: {
    color: "#22c55e",
    fontSize: 13,
    fontWeight: "500",
    marginTop: 6,
  },
  deadlineText: {
    fontSize: 14,
    color: "#1e293b",
    marginBottom: 12,
  },
  primaryBtn: {
    backgroundColor: "#1976d2",
    borderRadius: 8,
    paddingVertical: 11,
    alignItems: "center",
  },
  btnDisabled: {
    opacity: 0.6,
  },
  primaryBtnText: {
    color: "#ffffff",
    fontWeight: "600",
    fontSize: 14,
  },
  // confirmed selection shown above the pickers so the coordinator can see what they're setting
  pickerSelectedText: {
    fontSize: 14,
    fontWeight: "600",
    color: "#1e293b",
    marginBottom: 10,
  },
  // side-by-side "Select Date" / "Select Time" buttons on Android
  pickerBtnRow: {
    flexDirection: "row",
    marginBottom: 12,
  },
  groupCardHeader: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 6,
  },
  groupName: {
    fontSize: 16,
    fontWeight: "600",
    color: "#1e293b",
    marginBottom: 2,
  },
  groupCardRight: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  badgeGreen: {
    backgroundColor: "#22c55e",
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  badgeAmber: {
    backgroundColor: "#f59e0b",
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  badgeText: {
    color: "#ffffff",
    fontSize: 11,
    fontWeight: "600",
  },
  chevron: {
    fontSize: 11,
    color: "#9e9e9e",
  },
  summaryLine: {
    fontSize: 12,
    color: "#757575",
  },
  expandedContent: {
    marginTop: 14,
    borderTopWidth: 1,
    borderTopColor: "#f0f4f8",
    paddingTop: 14,
  },
  weekRow: {
    flexDirection: "row",
    gap: 8,
    marginBottom: 14,
  },
  weekBtn: {
    borderWidth: 1,
    borderColor: "#e0e0e0",
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 6,
    backgroundColor: "#ffffff",
  },
  weekBtnActive: {
    borderColor: "#1976d2",
    backgroundColor: "#1976d2",
  },
  weekBtnText: {
    fontSize: 13,
    color: "#757575",
    fontWeight: "600",
  },
  weekBtnTextActive: {
    color: "#ffffff",
  },
  barRow: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 8,
  },
  barLabel: {
    width: 88,
    fontSize: 13,
    color: "#1e293b",
  },
  barTrack: {
    flex: 1,
    height: 18,
    backgroundColor: "#f0f4f8",
    borderRadius: 4,
    overflow: "hidden",
  },
  barFill: {
    height: "100%",
    backgroundColor: "#1976d2",
    borderRadius: 4,
  },
  barFillAmber: {
    backgroundColor: "#f59e0b",
  },
  barValue: {
    width: 48,
    textAlign: "right",
    fontSize: 13,
    color: "#757575",
  },
  dateRange: {
    fontSize: 11,
    color: "#9e9e9e",
    marginTop: 2,
    marginBottom: 4,
  },
  outlineBtn: {
    borderWidth: 1,
    borderColor: "#1976d2",
    borderRadius: 8,
    paddingVertical: 10,
    alignItems: "center",
    backgroundColor: "#ffffff",
  },
  outlineBtnText: {
    color: "#1976d2",
    fontWeight: "600",
    fontSize: 14,
  },
  analysisSpinnerRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 12,
  },
  analysisCard: {
    backgroundColor: "#f8fafc",
    borderRadius: 8,
    padding: 12,
    borderWidth: 1,
    borderColor: "#e0e0e0",
  },
  analysisText: {
    fontSize: 13,
    color: "#1e293b",
    lineHeight: 20,
  },
});

