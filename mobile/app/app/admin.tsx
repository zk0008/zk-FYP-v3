import {
  View,
  Text,
  ScrollView,
  FlatList,
  TouchableOpacity,
  TextInput,
  Switch,
  ActivityIndicator,
  Modal,
  Alert,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
} from "react-native";
import { useRouter, Stack } from "expo-router";
import { useEffect, useState } from "react";
import { useAuth } from "../hooks/useAuth";
import { Ionicons } from "@expo/vector-icons";
import * as XLSX from "xlsx";
import * as FileSystem from "expo-file-system/legacy";
import * as DocumentPicker from "expo-document-picker";

const API_BASE = process.env.EXPO_PUBLIC_API_URL ?? "http://127.0.0.1:8001";

type AdminUser = {
  id: number;
  username: string;
  email: string | null;
  full_name: string | null;
  role: string;
  is_active: boolean;
  created_at: string;
};

type AdminGroup = {
  id: number;
  name: string;
  string_id: string;
};

type GroupMember = {
  id: number;
  username: string;
  full_name: string | null;
  role: string;
};

type FeedbackItem = {
  id: number;
  content: string;
  feedback_type: string;
  submitted_by: string | null;
  is_resolved: boolean;
  created_at: string;
};

const ROLES = ["admin", "coordinator", "supervisor", "student"] as const;
type Role = (typeof ROLES)[number];

function roleBadgeColor(role: string): string {
  switch (role) {
    case "admin":       return "#1976d2";
    case "coordinator": return "#7c3aed";
    case "supervisor":  return "#22c55e";
    case "student":     return "#f59e0b";
    default:            return "#9e9e9e";
  }
}

export default function Admin() {
  const { token } = useAuth();
  const router = useRouter();

  const [users, setUsers] = useState<AdminUser[]>([]);
  const [usersLoading, setUsersLoading] = useState(true);
  const [usersError, setUsersError] = useState("");

  const [showAddUser, setShowAddUser] = useState(false);
  const [addUsername, setAddUsername] = useState("");
  const [addPassword, setAddPassword] = useState("");
  const [addFullName, setAddFullName] = useState("");
  const [addEmail, setAddEmail] = useState("");
  const [addRole, setAddRole] = useState<Role>("student");
  const [addStatus, setAddStatus] = useState<"idle" | "saving" | "success" | "error">("idle");
  const [addError, setAddError] = useState("");

  const [showEditUser, setShowEditUser] = useState(false);
  const [editUser, setEditUser] = useState<AdminUser | null>(null);
  const [editFullName, setEditFullName] = useState("");
  const [editEmail, setEditEmail] = useState("");
  const [editRole, setEditRole] = useState<Role>("student");
  const [editIsActive, setEditIsActive] = useState(true);
  const [editStatus, setEditStatus] = useState<"idle" | "saving" | "success" | "error">("idle");
  const [editError, setEditError] = useState("");

  const [groups, setGroups] = useState<AdminGroup[]>([]);
  const [groupsLoading, setGroupsLoading] = useState(true);
  const [expandedGroupId, setExpandedGroupId] = useState<number | null>(null);
  const [groupMembers, setGroupMembers] = useState<Record<number, GroupMember[]>>({});
  const [membersLoading, setMembersLoading] = useState<Record<number, boolean>>({});
  const [groupFeedback, setGroupFeedback] = useState<Record<number, { msg: string; ok: boolean }>>({});

  const [selectedUserId, setSelectedUserId] = useState<Record<number, number | null>>({});
  const [showUserPicker, setShowUserPicker] = useState<Record<number, boolean>>({});
  const [addMemberSaving, setAddMemberSaving] = useState<Record<number, boolean>>({});
  const [removeSaving, setRemoveSaving] = useState<Record<string, boolean>>({});

  const [showImport, setShowImport] = useState(false);
  const [importFile, setImportFile] = useState<{ name: string; uri: string } | null>(null);
  const [importPreview, setImportPreview] = useState<{ matric_number: string; full_name: string; group_name: string }[]>([]);
  const [importParsed, setImportParsed] = useState<{ username: string; matric_number: string; full_name: string; email: string; group_name: string; supervisor_email?: string }[]>([]);
  const [importStatus, setImportStatus] = useState<"idle" | "parsing" | "importing" | "done" | "error">("idle");
  const [importError, setImportError] = useState("");
  const [importResult, setImportResult] = useState<{ created: string[]; skipped: string[]; errors: string[] } | null>(null);

  const [feedbackItems, setFeedbackItems] = useState<FeedbackItem[]>([]);
  const [feedbackLoading, setFeedbackLoading] = useState(true);
  const [showAllFeedback, setShowAllFeedback] = useState(false);
  const [feedbackError, setFeedbackError] = useState("");

  useEffect(() => {
    if (!token) return;
    loadUsers();
    loadGroups();
    loadFeedback();
  }, [token]);

  function loadUsers() {
    setUsersLoading(true);
    setUsersError("");
    fetch(`${API_BASE}/admin/users`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((res) => {
        if (!res.ok) throw new Error("Failed to load users");
        return res.json() as Promise<AdminUser[]>;
      })
      .then(setUsers)
      .catch((e: Error) => setUsersError(e.message))
      .finally(() => setUsersLoading(false));
  }

  function loadGroups() {
    setGroupsLoading(true);
    fetch(`${API_BASE}/admin/groups`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((res) => {
        if (!res.ok) throw new Error("Failed to load groups");
        return res.json() as Promise<AdminGroup[]>;
      })
      .then(setGroups)
      .catch(() => {})
      .finally(() => setGroupsLoading(false));
  }

  function loadGroupMembers(groupId: number) {
    setMembersLoading((prev) => ({ ...prev, [groupId]: true }));
    fetch(`${API_BASE}/admin/groups/${groupId}/members`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((res) => {
        if (!res.ok) throw new Error("Failed");
        return res.json() as Promise<GroupMember[]>;
      })
      .then((data) => setGroupMembers((prev) => ({ ...prev, [groupId]: data })))
      .catch(() => {})
      .finally(() => setMembersLoading((prev) => ({ ...prev, [groupId]: false })));
  }

  function openAddUser() {
    setAddUsername("");
    setAddPassword("");
    setAddFullName("");
    setAddEmail("");
    setAddRole("student");
    setAddStatus("idle");
    setAddError("");
    setShowAddUser(true);
  }

  function openEditUser(u: AdminUser) {
    setEditUser(u);
    setEditFullName(u.full_name ?? "");
    setEditEmail(u.email ?? "");
    setEditRole(u.role as Role);
    setEditIsActive(u.is_active);
    setEditStatus("idle");
    setEditError("");
    setShowEditUser(true);
  }

  async function handleAddUser() {
    if (!addUsername.trim() || !addPassword.trim()) {
      setAddError("Username and password are required.");
      return;
    }
    setAddStatus("saving");
    setAddError("");
    try {
      const res = await fetch(`${API_BASE}/admin/users`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          username: addUsername.trim(),
          password: addPassword,
          full_name: addFullName.trim() || null,
          email: addEmail.trim() || null,
          role: addRole,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ detail: "Unknown error" }));
        throw new Error(err.detail ?? "Unknown error");
      }
      setAddStatus("success");
      loadUsers();
      setTimeout(() => { setShowAddUser(false); setAddStatus("idle"); }, 1200);
    } catch (e: unknown) {
      setAddStatus("error");
      setAddError(e instanceof Error ? e.message : "Unknown error");
    }
  }

  async function handleEditUser() {
    if (!editUser) return;
    setEditStatus("saving");
    setEditError("");
    try {
      const res = await fetch(`${API_BASE}/admin/users/${editUser.id}`, {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          full_name: editFullName.trim() || null,
          email: editEmail.trim() || null,
          role: editRole,
          is_active: editIsActive,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ detail: "Unknown error" }));
        throw new Error(err.detail ?? "Unknown error");
      }
      setEditStatus("success");
      loadUsers();
      setTimeout(() => { setShowEditUser(false); setEditStatus("idle"); }, 1200);
    } catch (e: unknown) {
      setEditStatus("error");
      setEditError(e instanceof Error ? e.message : "Unknown error");
    }
  }

  function handleHardDeleteUser() {
    if (!editUser) return;
    Alert.alert(
      "Delete Permanently",
      "Are you sure? This cannot be undone.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: async () => {
            try {
              const res = await fetch(`${API_BASE}/admin/users/${editUser.id}/permanent`, {
                method: "DELETE",
                headers: { Authorization: `Bearer ${token}` },
              });
              if (!res.ok) {
                const err = await res.json().catch(() => ({ detail: "Unknown error" }));
                throw new Error(err.detail ?? "Unknown error");
              }
              setShowEditUser(false);
              loadUsers();
            } catch (e: unknown) {
              setEditStatus("error");
              setEditError(e instanceof Error ? e.message : "Unknown error");
            }
          },
        },
      ]
    );
  }

  function toggleGroup(groupId: number) {
    if (expandedGroupId === groupId) {
      setExpandedGroupId(null);
    } else {
      setExpandedGroupId(groupId);
      if (!groupMembers[groupId]) {
        loadGroupMembers(groupId);
      }
    }
  }

  async function handleAddMember(groupId: number) {
    const userId = selectedUserId[groupId];
    if (!userId) return;
    setAddMemberSaving((prev) => ({ ...prev, [groupId]: true }));
    try {
      const res = await fetch(`${API_BASE}/admin/groups/${groupId}/members`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ user_id: userId }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ detail: "Unknown error" }));
        throw new Error(err.detail ?? "Unknown error");
      }
      setGroupFeedback((prev) => ({ ...prev, [groupId]: { msg: "User added.", ok: true } }));
      setSelectedUserId((prev) => ({ ...prev, [groupId]: null }));
      loadGroupMembers(groupId);
    } catch (e: unknown) {
      setGroupFeedback((prev) => ({
        ...prev,
        [groupId]: { msg: e instanceof Error ? e.message : "Error", ok: false },
      }));
    } finally {
      setAddMemberSaving((prev) => ({ ...prev, [groupId]: false }));
      setTimeout(
        () => setGroupFeedback((prev) => ({ ...prev, [groupId]: { msg: "", ok: true } })),
        3000
      );
    }
  }

  async function handleRemoveMember(groupId: number, userId: number) {
    const key = `${groupId}-${userId}`;
    setRemoveSaving((prev) => ({ ...prev, [key]: true }));
    try {
      const res = await fetch(
        `${API_BASE}/admin/groups/${groupId}/members/${userId}`,
        { method: "DELETE", headers: { Authorization: `Bearer ${token}` } }
      );
      if (!res.ok) {
        const err = await res.json().catch(() => ({ detail: "Unknown error" }));
        throw new Error(err.detail ?? "Unknown error");
      }
      setGroupFeedback((prev) => ({ ...prev, [groupId]: { msg: "User removed.", ok: true } }));
      loadGroupMembers(groupId);
    } catch (e: unknown) {
      setGroupFeedback((prev) => ({
        ...prev,
        [groupId]: { msg: e instanceof Error ? e.message : "Error", ok: false },
      }));
    } finally {
      setRemoveSaving((prev) => ({ ...prev, [key]: false }));
      setTimeout(
        () => setGroupFeedback((prev) => ({ ...prev, [groupId]: { msg: "", ok: true } })),
        3000
      );
    }
  }

  function openImport() {
    setShowImport(true);
    setImportFile(null);
    setImportPreview([]);
    setImportParsed([]);
    setImportStatus("idle");
    setImportError("");
    setImportResult(null);
  }

  async function handleSelectFile() {
    const result = await DocumentPicker.getDocumentAsync({
      type: ["application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "application/octet-stream", "*/*"],
      copyToCacheDirectory: true,
    });
    if (result.canceled || !result.assets?.[0]) return;
    const asset = result.assets[0];
    setImportFile({ name: asset.name, uri: asset.uri });
    setImportStatus("parsing");
    setImportError("");
    setImportResult(null);
    setImportPreview([]);
    setImportParsed([]);
    try {
      const base64 = await FileSystem.readAsStringAsync(asset.uri, {
        encoding: "base64",
      });
      const wb = XLSX.read(base64, { type: "base64" });
      const sheet = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(sheet, { defval: "" }) as Record<string, unknown>[];
      const parsed = rows
        .map((row) => {
          const norm: Record<string, string> = {};
          for (const key of Object.keys(row)) {
            norm[key.toLowerCase().trim()] = String(row[key] ?? "").trim();
          }
          return {
            username: norm["username"] ?? "",
            matric_number: norm["matric_number"] ?? "",
            full_name: norm["full_name"] ?? "",
            email: norm["email"] ?? "",
            group_name: norm["group_name"] ?? "",
            supervisor_email: norm["supervisor_email"] || undefined,
          };
        })
        .filter((r) => r.username && r.matric_number && r.email && r.group_name);
      setImportParsed(parsed);
      setImportPreview(
        parsed.slice(0, 5).map((r) => ({
          matric_number: r.matric_number,
          full_name: r.full_name,
          group_name: r.group_name,
        }))
      );
      setImportStatus("idle");
    } catch {
      setImportStatus("error");
      setImportError("Failed to parse file. Make sure it is a valid .xlsx file.");
    }
  }

  async function handleImport() {
    if (!importParsed.length) return;
    setImportStatus("importing");
    try {
      const res = await fetch(`${API_BASE}/admin/students/import`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(importParsed),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ detail: "Unknown error" }));
        throw new Error(err.detail ?? "Unknown error");
      }
      const data = await res.json();
      setImportResult(data);
      setImportStatus("done");
      loadUsers();
      loadGroups();
    } catch (e: unknown) {
      setImportStatus("error");
      setImportError(e instanceof Error ? e.message : "Unknown error");
    }
  }

  function loadFeedback() {
    setFeedbackLoading(true);
    fetch(`${API_BASE}/admin/feedback`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((res) => {
        if (!res.ok) throw new Error("Failed to load feedback");
        return res.json() as Promise<FeedbackItem[]>;
      })
      .then(setFeedbackItems)
      .catch(() => {})
      .finally(() => setFeedbackLoading(false));
  }

  async function handleToggleResolved(id: number) {
    setFeedbackError("");
    try {
      const res = await fetch(`${API_BASE}/admin/feedback/${id}/resolve`, {
        method: "PUT",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const updated = await res.json() as FeedbackItem;
        setFeedbackItems((prev) => prev.map((f) => (f.id === updated.id ? updated : f)));
      }
    } catch {
      setFeedbackError("Failed to update. Please try again.");
      setTimeout(() => setFeedbackError(""), 3000);
    }
  }

  function formatFeedbackDate(iso: string): string {
    return new Intl.DateTimeFormat("en-SG", {
      timeZone: "Asia/Singapore",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    }).format(new Date(iso));
  }

  return (
    <View style={styles.container}>
      <Stack.Screen
        options={{
          headerShown: true,
          title: "Admin Dashboard",
          headerStyle: { backgroundColor: "#ffffff" },
          headerTitleAlign: "center",
          headerTitleStyle: { fontSize: 17, fontWeight: "700", color: "#1a1a1a" },
          headerShadowVisible: true,
          headerLeft: () => (
            <TouchableOpacity
              onPress={() => router.navigate("/groups")}
              style={styles.backBtn}
              activeOpacity={0.7}
            >
              <Ionicons name="chevron-back" size={20} color="#1976d2" />
              <Text style={styles.backBtnText}> Groups</Text>
            </TouchableOpacity>
          ),
        }}
      />

      {/* ── Add User Modal ─────────────────────────────────────── */}
      <Modal
        visible={showAddUser}
        transparent
        animationType="slide"
        onRequestClose={() => setShowAddUser(false)}
      >
        <TouchableOpacity style={styles.modalOverlay} activeOpacity={1} onPress={() => setShowAddUser(false)}>
          <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "height"}>
            <TouchableOpacity activeOpacity={1} onPress={(e) => e.stopPropagation()}>
            <View style={styles.modalContent}>
              <ScrollView keyboardShouldPersistTaps="handled">
            <Text style={styles.modalTitle}>Add User</Text>

            <Text style={styles.fieldLabel}>Username *</Text>
            <TextInput
              style={styles.textInput}
              value={addUsername}
              onChangeText={setAddUsername}
              placeholder="username"
              placeholderTextColor="#9e9e9e"
              autoCapitalize="none"
            />

            <Text style={styles.fieldLabel}>Password *</Text>
            <TextInput
              style={styles.textInput}
              value={addPassword}
              onChangeText={setAddPassword}
              placeholder="password"
              placeholderTextColor="#9e9e9e"
              secureTextEntry
            />

            <Text style={styles.fieldLabel}>Full Name</Text>
            <TextInput
              style={styles.textInput}
              value={addFullName}
              onChangeText={setAddFullName}
              placeholder="optional"
              placeholderTextColor="#9e9e9e"
            />

            <Text style={styles.fieldLabel}>Email</Text>
            <TextInput
              style={styles.textInput}
              value={addEmail}
              onChangeText={setAddEmail}
              placeholder="optional"
              placeholderTextColor="#9e9e9e"
              autoCapitalize="none"
              keyboardType="email-address"
            />

            <Text style={styles.fieldLabel}>Role</Text>
            <View style={styles.roleRow}>
              {ROLES.map((r) => (
                <TouchableOpacity
                  key={r}
                  style={[
                    styles.rolePill,
                    addRole === r && {
                      backgroundColor: roleBadgeColor(r),
                      borderColor: roleBadgeColor(r),
                    },
                  ]}
                  onPress={() => setAddRole(r)}
                  activeOpacity={0.8}
                >
                  <Text style={[styles.rolePillText, addRole === r && styles.rolePillTextActive]}>
                    {r.charAt(0).toUpperCase() + r.slice(1)}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            {addStatus === "error" && <Text style={styles.errorText}>{addError}</Text>}
            {addStatus === "success" && <Text style={styles.successText}>✓ User created.</Text>}

            <View style={styles.modalActions}>
              <TouchableOpacity
                style={styles.outlineBtn}
                onPress={() => setShowAddUser(false)}
                activeOpacity={0.8}
              >
                <Text style={styles.outlineBtnText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[
                  styles.primaryBtn,
                  { flex: 1 },
                  addStatus === "saving" && styles.btnDisabled,
                ]}
                onPress={handleAddUser}
                activeOpacity={0.8}
                disabled={addStatus === "saving"}
              >
                {addStatus === "saving" ? (
                  <ActivityIndicator size="small" color="#ffffff" />
                ) : (
                  <Text style={styles.primaryBtnText}>Save</Text>
                )}
              </TouchableOpacity>
            </View>
              </ScrollView>
            </View>
            </TouchableOpacity>
          </KeyboardAvoidingView>
        </TouchableOpacity>
      </Modal>

      {/* ── Edit User Modal ────────────────────────────────────── */}
      <Modal
        visible={showEditUser}
        transparent
        animationType="slide"
        onRequestClose={() => setShowEditUser(false)}
      >
        <TouchableOpacity style={styles.modalOverlay} activeOpacity={1} onPress={() => setShowEditUser(false)}>
          <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "height"}>
            <TouchableOpacity activeOpacity={1} onPress={(e) => e.stopPropagation()}>
            <View style={styles.modalContent}>
              <ScrollView keyboardShouldPersistTaps="handled">
            <Text style={styles.modalTitle}>Edit User</Text>
            {editUser && (
              <Text style={styles.mutedText}>@{editUser.username}</Text>
            )}

            <Text style={styles.fieldLabel}>Full Name</Text>
            <TextInput
              style={styles.textInput}
              value={editFullName}
              onChangeText={setEditFullName}
              placeholder="optional"
              placeholderTextColor="#9e9e9e"
            />

            <Text style={styles.fieldLabel}>Email</Text>
            <TextInput
              style={styles.textInput}
              value={editEmail}
              onChangeText={setEditEmail}
              placeholder="optional"
              placeholderTextColor="#9e9e9e"
              autoCapitalize="none"
              keyboardType="email-address"
            />

            <Text style={styles.fieldLabel}>Role</Text>
            <View style={styles.roleRow}>
              {ROLES.map((r) => (
                <TouchableOpacity
                  key={r}
                  style={[
                    styles.rolePill,
                    editRole === r && {
                      backgroundColor: roleBadgeColor(r),
                      borderColor: roleBadgeColor(r),
                    },
                  ]}
                  onPress={() => setEditRole(r)}
                  activeOpacity={0.8}
                >
                  <Text style={[styles.rolePillText, editRole === r && styles.rolePillTextActive]}>
                    {r.charAt(0).toUpperCase() + r.slice(1)}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            <View style={styles.toggleRow}>
              <Text style={styles.fieldLabel}>Active</Text>
              <Switch
                value={editIsActive}
                onValueChange={setEditIsActive}
                trackColor={{ false: "#e0e0e0", true: "#1976d2" }}
                thumbColor="#ffffff"
              />
            </View>

            {editStatus === "error" && <Text style={styles.errorText}>{editError}</Text>}
            {editStatus === "success" && <Text style={styles.successText}>✓ Saved.</Text>}

            <View style={styles.modalActions}>
              <TouchableOpacity
                style={styles.outlineBtn}
                onPress={() => setShowEditUser(false)}
                activeOpacity={0.8}
              >
                <Text style={styles.outlineBtnText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[
                  styles.primaryBtn,
                  { flex: 1 },
                  editStatus === "saving" && styles.btnDisabled,
                ]}
                onPress={handleEditUser}
                activeOpacity={0.8}
                disabled={editStatus === "saving"}
              >
                {editStatus === "saving" ? (
                  <ActivityIndicator size="small" color="#ffffff" />
                ) : (
                  <Text style={styles.primaryBtnText}>Save</Text>
                )}
              </TouchableOpacity>
            </View>

            <TouchableOpacity
              style={styles.deleteBtn}
              onPress={handleHardDeleteUser}
              activeOpacity={0.8}
            >
              <Text style={styles.deleteBtnText}>Delete Permanently</Text>
            </TouchableOpacity>
              </ScrollView>
            </View>
            </TouchableOpacity>
          </KeyboardAvoidingView>
        </TouchableOpacity>
      </Modal>

      {/* ── Import Students Modal ──────────────────────────────── */}
      <Modal
        visible={showImport}
        transparent
        animationType="slide"
        onRequestClose={() => setShowImport(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>Import Students</Text>
            <Text style={styles.importInstructions}>
              Select an Excel file (.xlsx) with columns: matric_number, full_name, email, group_name, supervisor_email (optional).
              Password will be set to the last 4 characters of the matric number.
            </Text>

            <TouchableOpacity
              style={[styles.outlineBtn, { marginTop: 12 }]}
              onPress={handleSelectFile}
              activeOpacity={0.8}
              disabled={importStatus === "importing"}
            >
              <Text style={styles.outlineBtnText} numberOfLines={1}>
                {importFile ? importFile.name : "Select File"}
              </Text>
            </TouchableOpacity>

            {importPreview.length > 0 && (
              <View style={styles.previewCard}>
                <Text style={styles.previewLabel}>
                  Preview · {importParsed.length} row{importParsed.length !== 1 ? "s" : ""} total
                </Text>
                {importPreview.map((row, i) => (
                  <View key={i} style={styles.previewRow}>
                    <Text style={styles.previewMatric}>{row.matric_number}</Text>
                    <Text style={styles.previewName} numberOfLines={1}>{row.full_name}</Text>
                    <Text style={styles.previewGroup} numberOfLines={1}>{row.group_name}</Text>
                  </View>
                ))}
              </View>
            )}

            {importStatus === "error" && (
              <Text style={styles.errorText}>{importError}</Text>
            )}

            {importStatus === "done" && importResult && (
              <View style={{ marginTop: 10 }}>
                <Text style={styles.successText}>
                  {importResult.created.length} created, {importResult.skipped.length} skipped.
                </Text>
                {importResult.errors.map((e, i) => (
                  <Text key={i} style={styles.errorText}>{e}</Text>
                ))}
              </View>
            )}

            <View style={styles.modalActions}>
              <TouchableOpacity
                style={styles.outlineBtn}
                onPress={() => setShowImport(false)}
                activeOpacity={0.8}
              >
                <Text style={styles.outlineBtnText}>Close</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[
                  styles.primaryBtn,
                  { flex: 1 },
                  (!importParsed.length || importStatus === "importing") && styles.btnDisabled,
                ]}
                onPress={handleImport}
                activeOpacity={0.8}
                disabled={!importParsed.length || importStatus === "importing"}
              >
                {importStatus === "importing" ? (
                  <ActivityIndicator size="small" color="#ffffff" />
                ) : (
                  <Text style={styles.primaryBtnText}>Import</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      <ScrollView contentContainerStyle={styles.scroll}>

        {/* ── Section A: Users ──────────────────────────────────── */}
        <Text style={styles.sectionLabel}>Users</Text>

        <TouchableOpacity
          style={[styles.outlineBtn, { marginBottom: 8 }]}
          onPress={openImport}
          activeOpacity={0.8}
        >
          <Text style={styles.outlineBtnText}>Import Students (.xlsx)</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.primaryBtn, { marginBottom: 10 }]}
          onPress={openAddUser}
          activeOpacity={0.8}
        >
          <Text style={styles.primaryBtnText}>+ Add User</Text>
        </TouchableOpacity>

        <View style={styles.card}>
          {usersLoading && (
            <ActivityIndicator size="small" color="#1976d2" style={{ marginVertical: 8 }} />
          )}
          {!usersLoading && usersError !== "" && (
            <Text style={styles.errorText}>{usersError}</Text>
          )}
          {!usersLoading &&
            usersError === "" &&
            users.map((u, idx) => (
              <TouchableOpacity
                key={u.id}
                style={[styles.userRow, idx < users.length - 1 && styles.userRowBorder]}
                onPress={() => openEditUser(u)}
                activeOpacity={0.7}
              >
                <View style={{ flex: 1 }}>
                  <Text style={[styles.userDisplayName, !u.is_active && styles.mutedText]}>
                    {u.full_name || u.username}
                  </Text>
                  <Text style={styles.userUsername}>@{u.username}</Text>
                </View>
                <View style={styles.userRowRight}>
                  <View style={[styles.roleBadge, { backgroundColor: roleBadgeColor(u.role) }]}>
                    <Text style={styles.roleBadgeText}>{u.role}</Text>
                  </View>
                  {!u.is_active && <Text style={styles.inactiveLabel}>inactive</Text>}
                </View>
              </TouchableOpacity>
            ))}
        </View>

        {/* ── Section B: Group Allocation ───────────────────────── */}
        <Text style={styles.sectionLabel}>Group Allocation</Text>

        {groupsLoading && (
          <ActivityIndicator size="large" color="#1976d2" style={{ marginVertical: 16 }} />
        )}

        {!groupsLoading &&
          groups.map((group) => {
            const isExpanded = expandedGroupId === group.id;
            const members = groupMembers[group.id] ?? [];
            const isLoadingMembers = !!membersLoading[group.id];
            const feedback = groupFeedback[group.id];
            const pickerOpen = !!showUserPicker[group.id];
            const pickedUid = selectedUserId[group.id] ?? null;
            const pickedUser = pickedUid ? users.find((u) => u.id === pickedUid) : null;

            return (
              <View key={group.id} style={styles.card}>
                {/* User picker modal for this group */}
                <Modal
                  visible={pickerOpen}
                  transparent
                  animationType="fade"
                  onRequestClose={() =>
                    setShowUserPicker((prev) => ({ ...prev, [group.id]: false }))
                  }
                >
                  <TouchableOpacity
                    style={styles.pickerOverlay}
                    activeOpacity={1}
                    onPress={() =>
                      setShowUserPicker((prev) => ({ ...prev, [group.id]: false }))
                    }
                  >
                    <View style={styles.pickerContent}>
                      <FlatList
                        data={users}
                        keyExtractor={(u) => String(u.id)}
                        renderItem={({ item: u }) => (
                          <TouchableOpacity
                            style={styles.pickerItem}
                            onPress={() => {
                              setSelectedUserId((prev) => ({ ...prev, [group.id]: u.id }));
                              setShowUserPicker((prev) => ({ ...prev, [group.id]: false }));
                            }}
                            activeOpacity={0.7}
                          >
                            <Text style={styles.pickerItemText} numberOfLines={1}>
                              {u.username}
                              {u.full_name ? ` · ${u.full_name}` : ""}
                            </Text>
                            <View
                              style={[
                                styles.roleBadge,
                                { backgroundColor: roleBadgeColor(u.role) },
                              ]}
                            >
                              <Text style={styles.roleBadgeText}>{u.role}</Text>
                            </View>
                          </TouchableOpacity>
                        )}
                      />
                    </View>
                  </TouchableOpacity>
                </Modal>

                {/* Group header — tap to expand */}
                <TouchableOpacity
                  style={styles.groupHeader}
                  onPress={() => toggleGroup(group.id)}
                  activeOpacity={0.7}
                >
                  <Text style={styles.groupName}>{group.name}</Text>
                  <Text style={styles.chevron}>{isExpanded ? "▲" : "▼"}</Text>
                </TouchableOpacity>

                {isExpanded && (
                  <View style={styles.expandedContent}>
                    {isLoadingMembers && (
                      <ActivityIndicator
                        size="small"
                        color="#1976d2"
                        style={{ marginVertical: 8 }}
                      />
                    )}

                    {!isLoadingMembers && members.length === 0 && (
                      <Text style={styles.mutedText}>No members yet.</Text>
                    )}

                    {!isLoadingMembers &&
                      members.map((m) => {
                        const removeKey = `${group.id}-${m.id}`;
                        return (
                          <View key={m.id} style={styles.memberRow}>
                            <View style={{ flex: 1 }}>
                              <Text style={styles.memberName}>{m.username}</Text>
                              {m.full_name ? (
                                <Text style={styles.memberSub}>{m.full_name}</Text>
                              ) : null}
                            </View>
                            <View
                              style={[
                                styles.roleBadge,
                                { backgroundColor: roleBadgeColor(m.role) },
                              ]}
                            >
                              <Text style={styles.roleBadgeText}>{m.role}</Text>
                            </View>
                            <TouchableOpacity
                              style={styles.removeBtn}
                              onPress={() => handleRemoveMember(group.id, m.id)}
                              activeOpacity={0.8}
                              disabled={!!removeSaving[removeKey]}
                            >
                              {removeSaving[removeKey] ? (
                                <ActivityIndicator size="small" color="#d32f2f" />
                              ) : (
                                <Text style={styles.removeBtnText}>Remove</Text>
                              )}
                            </TouchableOpacity>
                          </View>
                        );
                      })}

                    {/* Add member row */}
                    <View style={styles.addMemberRow}>
                      <TouchableOpacity
                        style={[styles.outlineBtn, { flex: 1 }]}
                        onPress={() =>
                          setShowUserPicker((prev) => ({ ...prev, [group.id]: true }))
                        }
                        activeOpacity={0.8}
                      >
                        <Text style={styles.outlineBtnText} numberOfLines={1}>
                          {pickedUser ? pickedUser.username : "Select a user…"}
                        </Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={[
                          styles.primaryBtn,
                          { paddingHorizontal: 16 },
                          (!pickedUser || !!addMemberSaving[group.id]) && styles.btnDisabled,
                        ]}
                        onPress={() => handleAddMember(group.id)}
                        activeOpacity={0.8}
                        disabled={!pickedUser || !!addMemberSaving[group.id]}
                      >
                        {addMemberSaving[group.id] ? (
                          <ActivityIndicator size="small" color="#ffffff" />
                        ) : (
                          <Text style={styles.primaryBtnText}>Add</Text>
                        )}
                      </TouchableOpacity>
                    </View>

                    {feedback?.msg ? (
                      <Text style={feedback.ok ? styles.successText : styles.errorText}>
                        {feedback.msg}
                      </Text>
                    ) : null}
                  </View>
                )}
              </View>
            );
          })}

        {/* ── Section C: Feedback ─────────────────────────────── */}
        <Text style={styles.sectionLabel}>Feedback</Text>
        {feedbackError !== "" && (
          <Text style={styles.errorText}>{feedbackError}</Text>
        )}

        {feedbackLoading && (
          <ActivityIndicator size="large" color="#1976d2" style={{ marginVertical: 16 }} />
        )}

        {!feedbackLoading && feedbackItems.length === 0 && (
          <Text style={[styles.mutedText, { marginBottom: 12 }]}>No feedback submitted yet.</Text>
        )}

        {!feedbackLoading &&
          (showAllFeedback ? feedbackItems : feedbackItems.slice(0, 5)).map((item) => (
            <View key={item.id} style={[styles.card, item.is_resolved && styles.feedbackCardResolved]}>
              <View style={styles.feedbackCardHeader}>
                <View style={[styles.feedbackTypeBadge, item.feedback_type === "bug" ? styles.feedbackTypeBadgeBug : styles.feedbackTypeBadgeGeneral]}>
                  <Text style={styles.feedbackTypeBadgeText}>
                    {item.feedback_type === "bug" ? "Bug Report" : "General"}
                  </Text>
                </View>
                <TouchableOpacity
                  style={styles.resolveBtn}
                  onPress={() => handleToggleResolved(item.id)}
                  activeOpacity={0.8}
                >
                  <Text style={styles.resolveBtnText}>
                    {item.is_resolved ? "Mark Unresolved" : "Mark Resolved"}
                  </Text>
                </TouchableOpacity>
              </View>
              <Text style={[styles.feedbackItemContent, item.is_resolved && styles.feedbackItemContentResolved]}>
                {item.content}
              </Text>
              <Text style={styles.feedbackItemMeta}>
                {item.submitted_by ?? "Anonymous"} · {formatFeedbackDate(item.created_at)}
              </Text>
            </View>
          ))}

        {!feedbackLoading && feedbackItems.length > 5 && (
          <TouchableOpacity
            style={styles.feedbackToggleBtn}
            onPress={() => setShowAllFeedback((v) => !v)}
            activeOpacity={0.8}
          >
            <Text style={styles.feedbackToggleBtnText}>
              {showAllFeedback ? "Show Less" : `View More (${feedbackItems.length - 5} more)`}
            </Text>
          </TouchableOpacity>
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
    fontWeight: "700",
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
  primaryBtn: {
    backgroundColor: "#1976d2",
    borderRadius: 10,
    paddingVertical: 11,
    minHeight: 44,
    justifyContent: "center",
    alignItems: "center",
  },
  primaryBtnText: {
    color: "#ffffff",
    fontWeight: "600",
    fontSize: 14,
  },
  btnDisabled: {
    opacity: 0.6,
  },
  outlineBtn: {
    borderWidth: 1,
    borderColor: "#1976d2",
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: 12,
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
  mutedText: {
    fontSize: 13,
    color: "#9e9e9e",
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
  // user list
  userRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 12,
  },
  userRowBorder: {
    borderBottomWidth: 1,
    borderBottomColor: "#f0f4f8",
  },
  userDisplayName: {
    fontSize: 15,
    fontWeight: "500",
    color: "#1a1a1a",
  },
  userUsername: {
    fontSize: 12,
    color: "#9e9e9e",
    marginTop: 2,
  },
  userRowRight: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  roleBadge: {
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  roleBadgeText: {
    color: "#ffffff",
    fontSize: 11,
    fontWeight: "600",
  },
  inactiveLabel: {
    fontSize: 11,
    color: "#9e9e9e",
    fontStyle: "italic",
  },
  // modals
  deleteBtn: {
    borderWidth: 1,
    borderColor: "#d32f2f",
    borderRadius: 10,
    paddingVertical: 11,
    minHeight: 44,
    justifyContent: "center",
    alignItems: "center",
    marginTop: 10,
  },
  deleteBtnText: {
    color: "#d32f2f",
    fontWeight: "600",
    fontSize: 14,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.45)",
    justifyContent: "flex-end",
  },
  modalContent: {
    backgroundColor: "#ffffff",
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 24,
    paddingBottom: 40,
  },
  modalTitle: {
    fontSize: 17,
    fontWeight: "700",
    color: "#1a1a1a",
    marginBottom: 16,
  },
  fieldLabel: {
    fontSize: 12,
    fontWeight: "600",
    color: "#757575",
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginBottom: 6,
    marginTop: 12,
  },
  textInput: {
    borderWidth: 1,
    borderColor: "#e0e0e0",
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
    fontSize: 15,
    lineHeight: Platform.OS === "android" ? 20 : undefined,
    textAlignVertical: "center",
    color: "#1a1a1a",
    backgroundColor: "#f5f5f5",
    minHeight: 44,
  },
  roleRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginBottom: 4,
  },
  rolePill: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: "#e0e0e0",
    backgroundColor: "#f5f5f5",
  },
  rolePillText: {
    fontSize: 13,
    fontWeight: "600",
    color: "#757575",
  },
  rolePillTextActive: {
    color: "#ffffff",
  },
  toggleRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: 12,
    marginBottom: 4,
  },
  modalActions: {
    flexDirection: "row",
    gap: 10,
    marginTop: 20,
  },
  // group allocation
  groupHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  groupName: {
    fontSize: 16,
    fontWeight: "600",
    color: "#1a1a1a",
  },
  chevron: {
    fontSize: 11,
    color: "#9e9e9e",
  },
  expandedContent: {
    marginTop: 12,
    borderTopWidth: 1,
    borderTopColor: "#f0f4f8",
    paddingTop: 12,
  },
  memberRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 8,
    gap: 8,
  },
  memberName: {
    fontSize: 14,
    fontWeight: "500",
    color: "#1a1a1a",
  },
  memberSub: {
    fontSize: 12,
    color: "#9e9e9e",
    marginTop: 1,
  },
  removeBtn: {
    borderWidth: 1,
    borderColor: "#d32f2f",
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 5,
    minHeight: 32,
    justifyContent: "center",
    alignItems: "center",
  },
  removeBtnText: {
    color: "#d32f2f",
    fontSize: 12,
    fontWeight: "600",
  },
  addMemberRow: {
    flexDirection: "row",
    gap: 8,
    marginTop: 12,
    alignItems: "center",
  },
  pickerOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.4)",
    justifyContent: "center",
    alignItems: "center",
  },
  pickerContent: {
    backgroundColor: "#ffffff",
    borderRadius: 14,
    maxHeight: 360,
    width: 300,
    overflow: "hidden",
  },
  pickerItem: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 13,
    borderBottomWidth: 1,
    borderBottomColor: "#f0f4f8",
  },
  pickerItemText: {
    fontSize: 14,
    color: "#1a1a1a",
    flex: 1,
    marginRight: 8,
  },
  // import modal
  importInstructions: {
    fontSize: 13,
    color: "#757575",
    lineHeight: 18,
    marginBottom: 4,
  },
  previewCard: {
    backgroundColor: "#f0f4f8",
    borderRadius: 10,
    padding: 12,
    marginTop: 12,
  },
  previewLabel: {
    fontSize: 11,
    fontWeight: "600",
    color: "#9e9e9e",
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginBottom: 8,
  },
  previewRow: {
    flexDirection: "row",
    gap: 8,
    paddingVertical: 3,
  },
  previewMatric: {
    fontSize: 12,
    fontWeight: "600",
    color: "#1a1a1a",
    width: 90,
  },
  previewName: {
    fontSize: 12,
    color: "#1a1a1a",
    flex: 1,
  },
  previewGroup: {
    fontSize: 12,
    color: "#757575",
    width: 80,
    textAlign: "right",
  },
  // feedback section
  feedbackCardResolved: {
    opacity: 0.5,
  },
  feedbackCardHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 8,
  },
  feedbackTypeBadge: {
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  feedbackTypeBadgeGeneral: {
    backgroundColor: "#1976d2",
  },
  feedbackTypeBadgeBug: {
    backgroundColor: "#d32f2f",
  },
  feedbackTypeBadgeText: {
    color: "#ffffff",
    fontSize: 11,
    fontWeight: "600",
  },
  resolveBtn: {
    borderWidth: 1,
    borderColor: "#9e9e9e",
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 5,
    minHeight: 32,
    justifyContent: "center",
    alignItems: "center",
  },
  resolveBtnText: {
    color: "#9e9e9e",
    fontSize: 12,
    fontWeight: "600",
  },
  feedbackItemContent: {
    fontSize: 14,
    color: "#1a1a1a",
    lineHeight: 20,
    marginBottom: 6,
  },
  feedbackItemContentResolved: {
    color: "#9e9e9e",
  },
  feedbackItemMeta: {
    fontSize: 12,
    color: "#9e9e9e",
  },
  feedbackToggleBtn: {
    alignItems: "center",
    paddingVertical: 10,
    marginBottom: 4,
  },
  feedbackToggleBtnText: {
    fontSize: 13,
    color: "#1976d2",
    fontWeight: "600",
  },
});
