import {
  View,
  Text,
  TextInput,
  ScrollView,
  FlatList,
  TouchableOpacity,
  ActivityIndicator,
  Modal,
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


// format a YYYY-MM-DD string as "1 Jan 2026" without any timezone conversion
function formatDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return `${d} ${PICKER_MONTHS[(m as number) - 1]} ${y}`;
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
  const [showDeadlineDatePicker, setShowDeadlineDatePicker] = useState(false);
  const [timeText, setTimeText] = useState("23:59");
  const [timeError, setTimeError] = useState("");
  const [deadlineStatus, setDeadlineStatus] = useState<
    "idle" | "saving" | "success" | "error"
  >("idle");
  const [deadlineError, setDeadlineError] = useState("");

  const [coursePeriod, setCoursePeriod] = useState<{
    start_date: string;
    end_date: string;
    set_by: string | null;
  } | null>(null);
  const [cpStartDate, setCpStartDate] = useState<Date>(() => new Date());
  const [cpEndDate, setCpEndDate] = useState<Date>(() => {
    const d = new Date();
    d.setDate(d.getDate() + 30);
    return d;
  });
  const [activeCpPicker, setActiveCpPicker] = useState<null | "start" | "end">(null);
  const [courseStatus, setCourseStatus] = useState<
    "idle" | "saving" | "success" | "error"
  >("idle");
  const [courseError, setCourseError] = useState("");

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

  const [overviewWeekFrom, setOverviewWeekFrom] = useState(1);
  const [overviewWeekTo, setOverviewWeekTo] = useState(1);
  const [showFromPicker, setShowFromPicker] = useState(false);
  const [showToPicker, setShowToPicker] = useState(false);

  const [compWeekFrom, setCompWeekFrom] = useState(1);
  const [compWeekTo, setCompWeekTo] = useState(1);
  const [showCompFromPicker, setShowCompFromPicker] = useState(false);
  const [showCompToPicker, setShowCompToPicker] = useState(false);

  const [comparisonData, setComparisonData] = useState<Record<string, number>>({});
  const [comparisonLoading, setComparisonLoading] = useState(false);

  useEffect(() => {
    if (!token) return;
    loadDeadline();
    loadCoursePeriod();
    loadOverview();
  }, [token]);

  // Re-fetch contributions whenever the expanded group or window selection changes,
  // but skip if we already have a cached result for this combination
  useEffect(() => {
    if (!expandedGroupId || !token) return;
    const key = coursePeriod
      ? `${expandedGroupId}-${overviewWeekFrom}-${overviewWeekTo}`
      : `${expandedGroupId}-${selectedWeeks}`;
    if (contributions[key]) return;
    loadContributions(expandedGroupId);
  }, [expandedGroupId, selectedWeeks, overviewWeekFrom, overviewWeekTo, token, coursePeriod]);

  function loadDeadline() {
    fetch(`${API_BASE}/deadline`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        setDeadline(data);
        // seed pickers so they reflect the current deadline on reload
        if (data) {
          setIsHard(data.is_hard ?? false);
          setFrequency(data.frequency ?? "once");
          const dt = new Date(data.next_deadline_dt);
          setPickerDate(dt);
          const p = (n: number) => String(n).padStart(2, "0");
          const sgtH = dt.getHours();
          const sgtM = dt.getMinutes();
          setTimeText(`${p(sgtH)}:${p(sgtM)}`);
        }
      })
      .catch(() => {});
  }

  function loadCoursePeriod() {
    fetch(`${API_BASE}/course-period`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        setCoursePeriod(data);
        if (data) {
          // parse as local date parts to avoid UTC midnight shifting the day
          const [sy, sm, sd] = data.start_date.split("-").map(Number);
          const [ey, em, ed] = data.end_date.split("-").map(Number);
          setCpStartDate(new Date(sy, sm - 1, sd));
          setCpEndDate(new Date(ey, em - 1, ed));
          const totalW = Math.ceil(
            (new Date(data.end_date).getTime() - new Date(data.start_date).getTime()) /
            (7 * 24 * 60 * 60 * 1000)
          );
          const seedTo = totalW > 0 ? totalW : 1;
          setOverviewWeekTo(seedTo);
          setCompWeekTo(seedTo);
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

  function loadContributions(groupId: string) {
    const key = coursePeriod
      ? `${groupId}-${overviewWeekFrom}-${overviewWeekTo}`
      : `${groupId}-${selectedWeeks}`;
    const url = coursePeriod
      ? `${API_BASE}/coordinator/groups/${groupId}/contributions?week_from=${overviewWeekFrom}&week_to=${overviewWeekTo}`
      : `${API_BASE}/coordinator/groups/${groupId}/contributions?weeks=${selectedWeeks}`;
    setContribLoading((prev) => ({ ...prev, [key]: true }));
    fetch(url, { headers: { Authorization: `Bearer ${token}` } })
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

  function loadAnalysis(groupId: string) {
    const key = coursePeriod
      ? `${groupId}-${overviewWeekFrom}-${overviewWeekTo}`
      : `${groupId}-${selectedWeeks}`;
    // guard against double-tap while a request is already in flight
    if (analysisLoading[key]) return;
    const url = coursePeriod
      ? `${API_BASE}/coordinator/groups/${groupId}/analysis?week_from=${overviewWeekFrom}&week_to=${overviewWeekTo}`
      : `${API_BASE}/coordinator/groups/${groupId}/analysis?weeks=${selectedWeeks}`;
    setAnalysisLoading((prev) => ({ ...prev, [key]: true }));
    fetch(url, { headers: { Authorization: `Bearer ${token}` } })
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

  async function loadComparison() {
    if (!coursePeriod || overview.length === 0 || !token) return;
    setComparisonLoading(true);
    try {
      const results = await Promise.all(
        overview.map((group) =>
          fetch(
            `${API_BASE}/coordinator/groups/${group.string_id}/contributions?week_from=${compWeekFrom}&week_to=${compWeekTo}`,
            { headers: { Authorization: `Bearer ${token}` } }
          )
            .then((res) => (res.ok ? res.json() : { total_messages: 0 }))
            .then((data) => ({ string_id: group.string_id, total: (data.total_messages ?? 0) as number }))
        )
      );
      const map: Record<string, number> = {};
      for (const r of results) {
        map[r.string_id] = r.total;
      }
      setComparisonData(map);
    } catch {
      // silently fail — comparison stays on last known data
    } finally {
      setComparisonLoading(false);
    }
  }

  useEffect(() => {
    if (!coursePeriod || overview.length === 0 || !token) return;
    loadComparison();
  }, [coursePeriod, compWeekFrom, compWeekTo, overview.length, token]);

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

  async function handleSetCoursePeriod() {
    setCourseStatus("saving");
    setCourseError("");

    if (cpEndDate <= cpStartDate) {
      setCourseError("End date must be after start date.");
      setCourseStatus("error");
      return;
    }

    // send dates as YYYY-MM-DD strings — backend expects date type, not datetime
    const fmtDate = (d: Date) => {
      const p = (n: number) => String(n).padStart(2, "0");
      return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
    };

    try {
      const res = await fetch(`${API_BASE}/course-period`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          start_date: fmtDate(cpStartDate),
          end_date: fmtDate(cpEndDate),
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ detail: "Unknown error" }));
        throw new Error(err.detail ?? "Unknown error");
      }
      const data = await res.json();
      setCoursePeriod(data);
      setCourseStatus("success");
      setTimeout(() => setCourseStatus("idle"), 3000);
    } catch (e: unknown) {
      setCourseStatus("error");
      setCourseError(e instanceof Error ? e.message : "Unknown error");
    }
  }

  function toggleGroup(groupId: string) {
    setExpandedGroupId((prev) => (prev === groupId ? null : groupId));
  }

  // widest bar in the comparison chart is 100%; others scale proportionally
  const maxMessages = Math.max(...overview.map((g) => g.total_messages), 1);
  const maxComparisonCount = Math.max(...overview.map((g) => comparisonData[g.string_id] ?? 0), 1);
  const totalWeeks = coursePeriod
    ? Math.ceil(
        (new Date(coursePeriod.end_date).getTime() - new Date(coursePeriod.start_date).getTime()) /
        (7 * 24 * 60 * 60 * 1000)
      )
    : 0;

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

      {/* From week picker modal */}
      <Modal
        visible={showFromPicker}
        transparent
        animationType="fade"
        onRequestClose={() => setShowFromPicker(false)}
      >
        <TouchableOpacity
          style={styles.cpModalOverlay}
          activeOpacity={1}
          onPress={() => setShowFromPicker(false)}
        >
          <View style={[styles.cpModalContent, { maxHeight: 320, width: 240 }]}>
            <FlatList
              data={Array.from({ length: totalWeeks }, (_, i) => i + 1)}
              keyExtractor={(item) => String(item)}
              renderItem={({ item: w }) => (
                <TouchableOpacity
                  style={styles.weekPickerItem}
                  onPress={() => {
                    setOverviewWeekFrom(w);
                    if (w > overviewWeekTo) setOverviewWeekTo(w);
                    setShowFromPicker(false);
                  }}
                  activeOpacity={0.7}
                >
                  <Text style={[styles.weekPickerItemText, overviewWeekFrom === w && styles.weekPickerItemActive]}>
                    Week {w}
                  </Text>
                </TouchableOpacity>
              )}
            />
          </View>
        </TouchableOpacity>
      </Modal>

      {/* To week picker modal */}
      <Modal
        visible={showToPicker}
        transparent
        animationType="fade"
        onRequestClose={() => setShowToPicker(false)}
      >
        <TouchableOpacity
          style={styles.cpModalOverlay}
          activeOpacity={1}
          onPress={() => setShowToPicker(false)}
        >
          <View style={[styles.cpModalContent, { maxHeight: 320, width: 240 }]}>
            <FlatList
              data={Array.from({ length: totalWeeks }, (_, i) => i + 1).filter((w) => w >= overviewWeekFrom)}
              keyExtractor={(item) => String(item)}
              renderItem={({ item: w }) => (
                <TouchableOpacity
                  style={styles.weekPickerItem}
                  onPress={() => {
                    setOverviewWeekTo(w);
                    setShowToPicker(false);
                  }}
                  activeOpacity={0.7}
                >
                  <Text style={[styles.weekPickerItemText, overviewWeekTo === w && styles.weekPickerItemActive]}>
                    Week {w}
                  </Text>
                </TouchableOpacity>
              )}
            />
          </View>
        </TouchableOpacity>
      </Modal>

      {/* Comparison From week picker modal */}
      <Modal
        visible={showCompFromPicker}
        transparent
        animationType="fade"
        onRequestClose={() => setShowCompFromPicker(false)}
      >
        <TouchableOpacity
          style={styles.cpModalOverlay}
          activeOpacity={1}
          onPress={() => setShowCompFromPicker(false)}
        >
          <View style={[styles.cpModalContent, { maxHeight: 320, width: 240 }]}>
            <FlatList
              data={Array.from({ length: totalWeeks }, (_, i) => i + 1)}
              keyExtractor={(item) => String(item)}
              renderItem={({ item: w }) => (
                <TouchableOpacity
                  style={styles.weekPickerItem}
                  onPress={() => {
                    setCompWeekFrom(w);
                    if (w > compWeekTo) setCompWeekTo(w);
                    setShowCompFromPicker(false);
                  }}
                  activeOpacity={0.7}
                >
                  <Text style={[styles.weekPickerItemText, compWeekFrom === w && styles.weekPickerItemActive]}>
                    Week {w}
                  </Text>
                </TouchableOpacity>
              )}
            />
          </View>
        </TouchableOpacity>
      </Modal>

      {/* Comparison To week picker modal */}
      <Modal
        visible={showCompToPicker}
        transparent
        animationType="fade"
        onRequestClose={() => setShowCompToPicker(false)}
      >
        <TouchableOpacity
          style={styles.cpModalOverlay}
          activeOpacity={1}
          onPress={() => setShowCompToPicker(false)}
        >
          <View style={[styles.cpModalContent, { maxHeight: 320, width: 240 }]}>
            <FlatList
              data={Array.from({ length: totalWeeks }, (_, i) => i + 1).filter((w) => w >= compWeekFrom)}
              keyExtractor={(item) => String(item)}
              renderItem={({ item: w }) => (
                <TouchableOpacity
                  style={styles.weekPickerItem}
                  onPress={() => {
                    setCompWeekTo(w);
                    setShowCompToPicker(false);
                  }}
                  activeOpacity={0.7}
                >
                  <Text style={[styles.weekPickerItemText, compWeekTo === w && styles.weekPickerItemActive]}>
                    Week {w}
                  </Text>
                </TouchableOpacity>
              )}
            />
          </View>
        </TouchableOpacity>
      </Modal>

      <ScrollView contentContainerStyle={styles.scroll}>

        {/* ── Course Period ──────────────────────────────────────── */}
        <Text style={styles.sectionLabel}>Course Period</Text>
        <View style={styles.card}>
          {coursePeriod ? (
            <Text style={styles.deadlineText}>
              <Text style={{ fontWeight: "600" }}>
                {"Start: " + formatDate(coursePeriod.start_date) + " — End: " + formatDate(coursePeriod.end_date)}
              </Text>
              {coursePeriod.set_by ? `  ·  set by ${coursePeriod.set_by}` : ""}
            </Text>
          ) : (
            <Text style={styles.mutedText}>No course period set yet.</Text>
          )}

          <View style={styles.cpPickerRow}>
            <View style={styles.cpPickerCol}>
              <Text style={styles.cpPickerLabel}>Start Date</Text>
              <TouchableOpacity
                style={styles.outlineBtn}
                onPress={() => setActiveCpPicker("start")}
                activeOpacity={0.8}
              >
                <Text style={styles.outlineBtnText}>
                  {cpStartDate.getDate()} {PICKER_MONTHS[cpStartDate.getMonth()]} {cpStartDate.getFullYear()}
                </Text>
              </TouchableOpacity>
            </View>
            <View style={styles.cpPickerCol}>
              <Text style={styles.cpPickerLabel}>End Date</Text>
              <TouchableOpacity
                style={styles.outlineBtn}
                onPress={() => setActiveCpPicker("end")}
                activeOpacity={0.8}
              >
                <Text style={styles.outlineBtnText}>
                  {cpEndDate.getDate()} {PICKER_MONTHS[cpEndDate.getMonth()]} {cpEndDate.getFullYear()}
                </Text>
              </TouchableOpacity>
            </View>
          </View>

          <Modal
            visible={activeCpPicker !== null}
            transparent
            animationType="fade"
            onRequestClose={() => setActiveCpPicker(null)}
          >
            <TouchableOpacity
              style={styles.cpModalOverlay}
              activeOpacity={1}
              onPress={() => setActiveCpPicker(null)}
            >
              <View style={styles.cpModalContent}>
                <DateTimePicker
                  value={activeCpPicker === "start" ? cpStartDate : cpEndDate}
                  mode="date"
                  display="spinner"
                  onChange={(_e, date) => {
                    if (date) {
                      if (activeCpPicker === "start") setCpStartDate(date);
                      else setCpEndDate(date);
                    }
                  }}
                />
              </View>
            </TouchableOpacity>
          </Modal>

          <TouchableOpacity
            style={[
              styles.primaryBtn,
              courseStatus === "saving" && styles.btnDisabled,
            ]}
            onPress={handleSetCoursePeriod}
            activeOpacity={0.8}
            disabled={courseStatus === "saving"}
          >
            {courseStatus === "saving" ? (
              <ActivityIndicator size="small" color="#ffffff" />
            ) : (
              <Text style={styles.primaryBtnText}>Set Course Period</Text>
            )}
          </TouchableOpacity>
          {courseStatus === "success" && (
            <Text style={styles.successText}>✓ Course period updated.</Text>
          )}
          {courseStatus === "error" && (
            <Text style={styles.errorText}>{courseError}</Text>
          )}
        </View>

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

          {/* date button + time text input side by side */}
          <View style={styles.pickerRow}>
            <TouchableOpacity
              style={[styles.outlineBtn, { flex: 1 }]}
              onPress={() => setShowDeadlineDatePicker(true)}
              activeOpacity={0.8}
            >
              <Text style={styles.outlineBtnText}>
                {pickerDate.getDate()} {PICKER_MONTHS[pickerDate.getMonth()]} {pickerDate.getFullYear()}
              </Text>
            </TouchableOpacity>
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

          <Modal
            visible={showDeadlineDatePicker}
            transparent
            animationType="fade"
            onRequestClose={() => setShowDeadlineDatePicker(false)}
          >
            <TouchableOpacity
              style={styles.cpModalOverlay}
              activeOpacity={1}
              onPress={() => setShowDeadlineDatePicker(false)}
            >
              <View style={styles.cpModalContent}>
                <DateTimePicker
                  value={pickerDate}
                  mode="date"
                  display="spinner"
                  onChange={(_e, date) => {
                    if (date) {
                      const next = new Date(pickerDate);
                      next.setFullYear(date.getFullYear(), date.getMonth(), date.getDate());
                      setPickerDate(next);
                    }
                  }}
                />
              </View>
            </TouchableOpacity>
          </Modal>

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
            const cKey = coursePeriod
              ? `${group.string_id}-${overviewWeekFrom}-${overviewWeekTo}`
              : `${group.string_id}-${selectedWeeks}`;
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
                    {coursePeriod ? (
                      <>
                        <View style={styles.weekPickerRow}>
                          <Text style={styles.weekPickerLabel}>From</Text>
                          <TouchableOpacity
                            style={[styles.outlineBtn, { flex: 0, alignSelf: "flex-start", paddingHorizontal: 16 }]}
                            onPress={() => setShowFromPicker(true)}
                            activeOpacity={0.8}
                          >
                            <Text style={styles.outlineBtnText}>Week {overviewWeekFrom}</Text>
                          </TouchableOpacity>
                        </View>
                        <View style={styles.weekPickerRow}>
                          <Text style={styles.weekPickerLabel}>To</Text>
                          <TouchableOpacity
                            style={[styles.outlineBtn, { flex: 0, alignSelf: "flex-start", paddingHorizontal: 16 }]}
                            onPress={() => setShowToPicker(true)}
                            activeOpacity={0.8}
                          >
                            <Text style={styles.outlineBtnText}>Week {overviewWeekTo}</Text>
                          </TouchableOpacity>
                        </View>
                      </>
                    ) : (
                      <>
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
                        <Text style={styles.mutedText}>
                          Set a course period to enable week-based view
                        </Text>
                      </>
                    )}

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
                          loadAnalysis(group.string_id)
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
              {coursePeriod ? (
                <>
                  <View style={styles.weekPickerRow}>
                    <Text style={styles.weekPickerLabel}>From</Text>
                    <TouchableOpacity
                      style={[styles.outlineBtn, { flex: 0, alignSelf: "flex-start", paddingHorizontal: 16 }]}
                      onPress={() => setShowCompFromPicker(true)}
                      activeOpacity={0.8}
                    >
                      <Text style={styles.outlineBtnText}>Week {compWeekFrom}</Text>
                    </TouchableOpacity>
                  </View>
                  <View style={styles.weekPickerRow}>
                    <Text style={styles.weekPickerLabel}>To</Text>
                    <TouchableOpacity
                      style={[styles.outlineBtn, { flex: 0, alignSelf: "flex-start", paddingHorizontal: 16 }]}
                      onPress={() => setShowCompToPicker(true)}
                      activeOpacity={0.8}
                    >
                      <Text style={styles.outlineBtnText}>Week {compWeekTo}</Text>
                    </TouchableOpacity>
                  </View>
                  <Text style={styles.subsectionLabel}>
                    Messages (Week {compWeekFrom}–{compWeekTo})
                  </Text>
                  {comparisonLoading ? (
                    <ActivityIndicator size="small" color="#1976d2" style={{ marginVertical: 12 }} />
                  ) : (
                    overview.map((group) => {
                      const count = comparisonData[group.string_id] ?? 0;
                      const barPct = Math.round((count / maxComparisonCount) * 100);
                      return (
                        <View key={group.string_id} style={styles.barRow}>
                          <Text style={styles.barLabel}>{group.name}</Text>
                          <View style={styles.barTrack}>
                            <View style={[styles.barFill, styles.barFillAmber, { width: `${barPct}%` }]} />
                          </View>
                          <Text style={styles.barValue}>{count}</Text>
                        </View>
                      );
                    })
                  )}
                </>
              ) : (
                <>
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
                </>
              )}
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
  weekPickerRow: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 8,
  },
  weekPickerLabel: {
    fontSize: 12,
    fontWeight: "600",
    color: "#757575",
    width: 52,
    marginRight: 8,
    textTransform: "uppercase",
    letterSpacing: 0.6,
  },
  weekPickerItem: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: "#f0f4f8",
  },
  weekPickerItemText: {
    fontSize: 15,
    color: "#1a1a1a",
  },
  weekPickerItemActive: {
    color: "#1976d2",
    fontWeight: "700",
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
  cpPickerRow: {
    flexDirection: "row",
    gap: 10,
    marginTop: 10,
    marginBottom: 12,
  },
  cpPickerCol: {
    flex: 1,
  },
  cpPickerLabel: {
    fontSize: 12,
    fontWeight: "600",
    color: "#757575",
    textTransform: "uppercase",
    letterSpacing: 0.6,
    marginBottom: 6,
  },
  cpModalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0, 0, 0, 0.4)",
    justifyContent: "center",
    alignItems: "center",
  },
  cpModalContent: {
    backgroundColor: "#ffffff",
    borderRadius: 14,
    overflow: "hidden",
  },
});

