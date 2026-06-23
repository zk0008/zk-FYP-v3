import {
  View,
  Text,
  TextInput,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  Platform,
  StyleSheet,
} from "react-native";
import { useRouter, Stack } from "expo-router";
import DateTimePicker from "@react-native-community/datetimepicker";
import { useEffect, useState } from "react";
import { useAuth } from "../hooks/useAuth";

const API_BASE = process.env.EXPO_PUBLIC_API_URL ?? "http://127.0.0.1:8001";

const PICKER_MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

function formatPickerDisplay(date: Date, time: string): string {
  return `${date.getDate()} ${PICKER_MONTHS[date.getMonth()]} ${date.getFullYear()}, ${time || "--:--"}`;
}

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
    is_late: boolean;
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
    next_deadline_dt: string;
    frequency: string;
    is_hard: boolean;
    set_by: string | null;
  } | null>(null);
  const [frequency, setFrequency] = useState<"once" | "weekly" | "biweekly">("once");
  const [isHard, setIsHard] = useState(false);
  // default to tomorrow at 23:59 in device local time — sensible starting point for a deadline
  const [pickerDate, setPickerDate] = useState<Date>(() => {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    d.setHours(23, 59, 0, 0);
    return d;
  });
  // Android only — date picker is a modal dialog, so track whether it's open
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [timeText, setTimeText] = useState("23:59");
  const [timeError, setTimeError] = useState("");
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
      .then((data) => {
        setDeadline(data);
        // seed the pill selectors so they reflect the current deadline on reload
        if (data) {
          setIsHard(data.is_hard ?? false);
          setFrequency(data.frequency ?? "once");
        }
      })
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
    setTimeError("");

    // validate the typed time before building the final datetime
    const [hStr, mStr] = timeText.split(":");
    const h = parseInt(hStr ?? "", 10);
    const m = parseInt(mStr ?? "", 10);
    if (!/^\d{2}:\d{2}$/.test(timeText) || h < 0 || h > 23 || m < 0 || m > 59) {
      setTimeError("Enter a valid time as HH:MM (e.g. 23:59)");
      setDeadlineStatus("idle");
      return;
    }

    // merge the typed time into the date chosen by the date picker
    const merged = new Date(pickerDate);
    merged.setHours(h, m, 0, 0);

    try {
      const res = await fetch(`${API_BASE}/deadline`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          start_dt: merged.toISOString(),
          frequency,
          is_hard: isHard,
        }),
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
    <View style={styles.container}>
      <Stack.Screen
        options={{
          headerShown: true,
          title: "Coordinator Dashboard",
          headerStyle: { backgroundColor: "#ffffff" },
          headerTitleStyle: { fontSize: 17, fontWeight: "700", color: "#1a1a1a" },
          headerShadowVisible: true,
          headerLeft: () => (
            <TouchableOpacity
              onPress={() => router.navigate("/groups")}
              style={styles.backBtn}
              activeOpacity={0.7}
            >
              <Text style={styles.backBtnText} numberOfLines={1}>‹ Groups</Text>
            </TouchableOpacity>
          ),
        }}
      />

      <ScrollView contentContainerStyle={styles.scroll}>

        {/* ── Section A: Deadline Setter ────────────────────────── */}
        <Text style={styles.sectionLabel}>Deadline</Text>
        <View style={styles.card}>
          {deadline ? (
            <Text style={styles.deadlineText}>
              Current:{" "}
              <Text style={{ fontWeight: "600" }}>
                {toSGT(deadline.next_deadline_dt)}
              </Text>
              {"  ·  "}
              <Text style={{ color: deadline.is_hard ? "#d32f2f" : "#1976d2" }}>
                {deadline.is_hard ? "Hard deadline" : "Soft deadline"}
              </Text>
              {deadline.frequency !== "once" ? `  ·  ${deadline.frequency}` : ""}
              {deadline.set_by ? `  ·  set by ${deadline.set_by}` : ""}
            </Text>
          ) : (
            <Text style={styles.mutedText}>No deadline set yet.</Text>
          )}

          {/* show the selected date + typed time before the coordinator saves */}
          <Text style={styles.pickerSelectedText}>
            Set to: {formatPickerDisplay(pickerDate, timeText)}
          </Text>

          {/* compact date picker + time text input side by side */}
          <View style={styles.pickerRow}>
            {Platform.OS === "ios" ? (
              <DateTimePicker
                value={pickerDate}
                mode="date"
                display="compact"
                onChange={(_e, date) => {
                  if (date) {
                    const next = new Date(pickerDate);
                    next.setFullYear(date.getFullYear(), date.getMonth(), date.getDate());
                    setPickerDate(next);
                  }
                }}
                style={styles.datePickerIOS}
              />
            ) : (
              <TouchableOpacity
                style={[styles.outlineBtn, { flex: 1 }]}
                onPress={() => setShowDatePicker(true)}
                activeOpacity={0.8}
              >
                <Text style={styles.outlineBtnText}>Select Date</Text>
              </TouchableOpacity>
            )}
            <TextInput
              style={[styles.timeInput, timeError ? styles.timeInputError : undefined]}
              value={timeText}
              onChangeText={(v) => { setTimeText(v); if (timeError) setTimeError(""); }}
              placeholder="23:59"
              placeholderTextColor="#9e9e9e"
              keyboardType="numbers-and-punctuation"
              maxLength={5}
            />
          </View>
          {timeError ? <Text style={styles.errorText}>{timeError}</Text> : null}

          {/* Android date picker modal — only mounted when triggered */}
          {Platform.OS === "android" && showDatePicker && (
            <DateTimePicker
              value={pickerDate}
              mode="date"
              display="default"
              onChange={(_e, date) => {
                setShowDatePicker(false);
                if (date) {
                  const next = new Date(pickerDate);
                  next.setFullYear(date.getFullYear(), date.getMonth(), date.getDate());
                  setPickerDate(next);
                }
              }}
            />
          )}

          {/* Frequency selector — pill buttons matching the week selector style */}
          <Text style={styles.settingLabel}>Frequency</Text>
          <View style={styles.pillRow}>
            {(["once", "weekly", "biweekly"] as const).map((opt) => (
              <TouchableOpacity
                key={opt}
                style={[styles.pill, frequency === opt && styles.pillActive]}
                onPress={() => setFrequency(opt)}
                activeOpacity={0.8}
              >
                <Text style={[styles.pillText, frequency === opt && styles.pillTextActive]}>
                  {opt.charAt(0).toUpperCase() + opt.slice(1)}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          {/* Hard/Soft deadline pill selector */}
          <Text style={styles.settingLabel}>Deadline type</Text>
          <View style={styles.pillRow}>
            {([false, true] as const).map((hard) => (
              <TouchableOpacity
                key={hard ? "hard" : "soft"}
                style={[styles.pill, isHard === hard && styles.pillActive]}
                onPress={() => setIsHard(hard)}
                activeOpacity={0.8}
              >
                <Text style={[styles.pillText, isHard === hard && styles.pillTextActive]}>
                  {hard ? "Hard" : "Soft"}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
          <Text style={styles.toggleHint}>
            {isHard
              ? "Students cannot submit after the deadline."
              : "Students can submit late — marked as late."}
          </Text>

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
                    <View style={{ alignItems: "flex-end" }}>
                      {group.student_summary?.is_submitted ? (
                        <View style={styles.badgeGreen}>
                          <Text style={styles.badgeText}>Submitted</Text>
                        </View>
                      ) : (
                        <View style={styles.badgeAmber}>
                          <Text style={styles.badgeText}>Not submitted</Text>
                        </View>
                      )}
                      {group.student_summary?.is_submitted &&
                        group.student_summary.submitted_at && (
                          <View style={styles.submittedAtRow}>
                            <Text style={styles.submittedAtText}>
                              {toSGT(group.student_summary.submitted_at)}
                            </Text>
                            {group.student_summary.is_late && (
                              <View style={styles.lateBadge}>
                                <Text style={styles.lateBadgeText}>Late</Text>
                              </View>
                            )}
                          </View>
                        )}
                    </View>
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
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#f0f4f8",
  },
  backBtn: {
    flexDirection: "row",
    alignItems: "center",
  },
  backBtnText: {
    color: "#1976d2",
    fontSize: 14,
    fontWeight: "600",
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
    borderRadius: 14,
    padding: 16,
    marginBottom: 12,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 6,
    elevation: 2,
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
    color: "#1a1a1a",
    marginBottom: 12,
  },
  primaryBtn: {
    backgroundColor: "#1976d2",
    borderRadius: 10,
    paddingVertical: 11,
    minHeight: 44,
    justifyContent: "center",
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
  pickerSelectedText: {
    fontSize: 14,
    fontWeight: "600",
    color: "#1a1a1a",
    marginBottom: 10,
  },
  pickerRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginBottom: 4,
  },
  datePickerIOS: {
    flex: 1,
  },
  timeInput: {
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
    textAlign: "center",
  },
  timeInputError: {
    borderColor: "#d32f2f",
    backgroundColor: "#fff5f5",
  },
  settingLabel: {
    fontSize: 12,
    fontWeight: "600",
    color: "#757575",
    textTransform: "uppercase",
    letterSpacing: 0.6,
    marginTop: 14,
    marginBottom: 8,
  },
  pillRow: {
    flexDirection: "row",
    gap: 8,
    marginBottom: 14,
  },
  pill: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: "#e0e0e0",
    backgroundColor: "#f5f5f5",
  },
  pillActive: {
    backgroundColor: "#1976d2",
    borderColor: "#1976d2",
  },
  pillText: {
    fontSize: 13,
    fontWeight: "600",
    color: "#757575",
  },
  pillTextActive: {
    color: "#ffffff",
  },
  toggleHint: {
    fontSize: 12,
    color: "#9e9e9e",
    marginBottom: 14,
  },
  groupCardHeader: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 6,
  },
  groupName: {
    fontSize: 16,
    fontWeight: "600",
    color: "#1a1a1a",
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
  submittedAtRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    marginTop: 4,
  },
  submittedAtText: {
    fontSize: 11,
    color: "#757575",
  },
  lateBadge: {
    backgroundColor: "#f59e0b",
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 1,
  },
  lateBadgeText: {
    color: "#ffffff",
    fontSize: 10,
    fontWeight: "700",
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
    borderColor: "#e8edf2",
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 6,
    backgroundColor: "#ffffff",
    minHeight: 44,
    justifyContent: "center",
    alignItems: "center",
  },
  weekBtnActive: {
    borderColor: "#1565c0",
    backgroundColor: "#1565c0",
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
    color: "#1a1a1a",
  },
  barTrack: {
    flex: 1,
    height: 18,
    backgroundColor: "#f0f4f8",
    borderRadius: 6,
    overflow: "hidden",
  },
  barFill: {
    height: "100%",
    backgroundColor: "#1976d2",
    borderRadius: 6,
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
    borderRadius: 10,
    paddingVertical: 10,
    minHeight: 44,
    justifyContent: "center",
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
    borderRadius: 10,
    padding: 12,
    borderWidth: 1,
    borderColor: "#e8edf2",
  },
  analysisText: {
    fontSize: 13,
    color: "#1a1a1a",
    lineHeight: 20,
  },
});

