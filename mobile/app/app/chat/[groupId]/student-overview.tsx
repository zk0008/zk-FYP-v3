import { useState, useCallback } from "react";
import {
  View,
  Text,
  TextInput,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
} from "react-native";
import { useGlobalSearchParams, useFocusEffect } from "expo-router";
import { useHeaderHeight } from "@react-navigation/elements";
import { useAuth } from "../../../hooks/useAuth";

const API_BASE = process.env.EXPO_PUBLIC_API_URL ?? "http://127.0.0.1:8001";

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

  const loadSummary = useCallback(async () => {
    if (!token) return;
    setIsLoading(true);
    setFetchError(null);
    try {
      const res = await fetch(
        `${API_BASE}/groups/${groupId}/student-summary`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      if (!res.ok) throw new Error(`Failed to load summary (${res.status})`);
      const data = await res.json();
      const text = data.summary_text ?? "";
      setSavedText(text);
      setEditText(text);
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
    } catch (e: any) {
      setSaveError(e.message ?? "Save failed");
    } finally {
      setSaving(false);
    }
  };

  const hasChanges = editText !== savedText;

  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === "ios" ? "padding" : "height"}
      keyboardVerticalOffset={headerHeight}
    >
      {/* Header row: title on left, Save button on right */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Student Summary</Text>
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
});
