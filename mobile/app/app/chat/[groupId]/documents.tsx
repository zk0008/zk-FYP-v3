import { useState, useCallback } from "react";
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  StyleSheet,
} from "react-native";
import { useGlobalSearchParams, useFocusEffect } from "expo-router";
import * as DocumentPicker from "expo-document-picker";
import { File, Directory, Paths } from "expo-file-system";
import * as Sharing from "expo-sharing";
import { useAuth } from "../../../hooks/useAuth";

const API_BASE = process.env.EXPO_PUBLIC_API_URL ?? "http://127.0.0.1:8001";

type Doc = {
  id: number;
  filename: string;
  uploaded_at: string;
  uploaded_by: string;
  file_size: number;
};

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(iso: string): string {
  return new Intl.DateTimeFormat("en-SG", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Asia/Singapore",
  }).format(new Date(iso));
}

export default function Documents() {
  const { groupId } = useGlobalSearchParams<{ groupId: string }>();
  const { token } = useAuth();

  const [docs, setDocs] = useState<Doc[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  // separate fetch error (initial load) from op error (upload/download/delete)
  // so the list stays visible when an operation fails after a successful load
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [opError, setOpError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [downloadingId, setDownloadingId] = useState<number | null>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);

  const loadDocs = useCallback(async () => {
    if (!token) return;
    setIsLoading(true);
    setFetchError(null);
    try {
      const res = await fetch(`${API_BASE}/groups/${groupId}/documents`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error(`Failed to load documents (${res.status})`);
      const data: Doc[] = await res.json();
      setDocs(data);
    } catch (e: any) {
      setFetchError(e.message ?? "Failed to load documents");
    } finally {
      setIsLoading(false);
    }
  }, [groupId, token]);

  // Reload every time this tab comes into focus so the list stays fresh
  useFocusEffect(
    useCallback(() => {
      loadDocs();
    }, [loadDocs])
  );

  const handleUpload = async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        // PDF, DOC, and DOCX — matches what the backend accepts
        type: [
          "application/pdf",
          "application/msword",
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        ],
        copyToCacheDirectory: true,
      });
      if (result.canceled) return;

      const file = result.assets[0];
      setUploading(true);
      setOpError(null);

      const formData = new FormData();
      // RN needs the file as a plain object with uri/name/type — not a real File instance
      formData.append("file", {
        uri: file.uri,
        name: file.name,
        type: file.mimeType ?? "application/pdf",
      } as any);

      const res = await fetch(`${API_BASE}/groups/${groupId}/documents`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          // don't set Content-Type — fetch injects the multipart boundary automatically
        },
        body: formData,
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.detail ?? `Upload failed (${res.status})`);
      }

      // refresh the list to show the new document
      await loadDocs();
    } catch (e: any) {
      // document picker cancellation shows as an error on some platforms — skip it
      if (!e.message?.toLowerCase().includes("cancel")) {
        setOpError(e.message ?? "Upload failed");
      }
    } finally {
      setUploading(false);
    }
  };

  const handleDownload = async (doc: Doc) => {
    if (!token) return;
    setDownloadingId(doc.id);
    setOpError(null);
    try {
      // clear any previously cached copy so downloadFileAsync doesn't error on an existing file
      const cached = new File(new Directory(Paths.cache), doc.filename);
      if (cached.exists) cached.delete();

      // static File.downloadFileAsync saves the file into the given directory and returns
      // a File handle — headers carry the JWT so the backend accepts the request
      const downloaded = await File.downloadFileAsync(
        `${API_BASE}/groups/${groupId}/documents/${doc.id}`,
        new Directory(Paths.cache),
        { headers: { Authorization: `Bearer ${token}` } }
      );

      const canShare = await Sharing.isAvailableAsync();
      if (!canShare) throw new Error("Sharing is not available on this device");

      // shareAsync opens the system share/viewer sheet — user can open in a PDF app or save
      await Sharing.shareAsync(downloaded.uri, { mimeType: "application/pdf" });
    } catch (e: any) {
      setOpError(e.message ?? "Download failed");
    } finally {
      setDownloadingId(null);
    }
  };

  const handleDelete = (doc: Doc) => {
    Alert.alert(
      "Delete document",
      `Delete "${doc.filename}"? This cannot be undone.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: async () => {
            setDeletingId(doc.id);
            setOpError(null);
            try {
              const res = await fetch(
                `${API_BASE}/groups/${groupId}/documents/${doc.id}`,
                {
                  method: "DELETE",
                  headers: { Authorization: `Bearer ${token}` },
                }
              );
              if (!res.ok) throw new Error(`Delete failed (${res.status})`);
              // remove from local state immediately — no need to re-fetch
              setDocs((prev) => prev.filter((d) => d.id !== doc.id));
            } catch (e: any) {
              setOpError(e.message ?? "Delete failed");
            } finally {
              setDeletingId(null);
            }
          },
        },
      ]
    );
  };

  const renderDoc = ({ item }: { item: Doc }) => {
    const isDownloading = downloadingId === item.id;
    const isDeleting = deletingId === item.id;
    const busy = isDownloading || isDeleting;

    return (
      <View style={styles.docRow}>
        <View style={styles.docInfo}>
          <Text style={styles.docName} numberOfLines={2}>
            {item.filename}
          </Text>
          <Text style={styles.docMeta}>
            {item.uploaded_by} · {formatDate(item.uploaded_at)} ·{" "}
            {formatSize(item.file_size)}
          </Text>
        </View>
        <View style={styles.docActions}>
          <TouchableOpacity
            style={[
              styles.actionBtn,
              styles.downloadBtn,
              busy && styles.actionBtnDisabled,
            ]}
            onPress={() => handleDownload(item)}
            disabled={busy}
            activeOpacity={0.8}
          >
            {isDownloading ? (
              <ActivityIndicator size="small" color="#ffffff" />
            ) : (
              <Text style={styles.actionBtnText}>↓</Text>
            )}
          </TouchableOpacity>
          <TouchableOpacity
            style={[
              styles.actionBtn,
              styles.deleteBtn,
              busy && styles.actionBtnDisabled,
            ]}
            onPress={() => handleDelete(item)}
            disabled={busy}
            activeOpacity={0.8}
          >
            {isDeleting ? (
              <ActivityIndicator size="small" color="#ffffff" />
            ) : (
              <Text style={styles.actionBtnText}>✕</Text>
            )}
          </TouchableOpacity>
        </View>
      </View>
    );
  };

  return (
    <View style={styles.container}>
      {/* Upload bar sits at the top of the screen, always visible */}
      <View style={styles.uploadBar}>
        <TouchableOpacity
          style={[styles.uploadBtn, uploading && styles.uploadBtnDisabled]}
          onPress={handleUpload}
          disabled={uploading}
          activeOpacity={0.8}
        >
          {uploading ? (
            <>
              <ActivityIndicator
                size="small"
                color="#ffffff"
                style={styles.uploadSpinner}
              />
              <Text style={styles.uploadBtnText}>Uploading…</Text>
            </>
          ) : (
            <Text style={styles.uploadBtnText}>+ Upload Document</Text>
          )}
        </TouchableOpacity>
      </View>

      {/* Operation error (upload/download/delete failure) — shown above the list */}
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

      {/* Initial load failure — full-screen with retry button */}
      {!isLoading && fetchError !== null && (
        <View style={styles.center}>
          <Text style={styles.fetchErrorText}>{fetchError}</Text>
          <TouchableOpacity style={styles.retryBtn} onPress={loadDocs}>
            <Text style={styles.retryText}>Retry</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Empty state */}
      {!isLoading && fetchError === null && docs.length === 0 && (
        <View style={styles.center}>
          <Text style={styles.emptyText}>
            No documents yet. Upload a PDF, DOC, or DOCX to get started.
          </Text>
        </View>
      )}

      {/* Document list */}
      {!isLoading && fetchError === null && docs.length > 0 && (
        <FlatList
          data={docs}
          keyExtractor={(d) => String(d.id)}
          renderItem={renderDoc}
          contentContainerStyle={styles.list}
          ItemSeparatorComponent={() => <View style={styles.separator} />}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#f0f4f8",
  },
  uploadBar: {
    backgroundColor: "#ffffff",
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: "#e0e0e0",
  },
  uploadBtn: {
    flexDirection: "row",
    backgroundColor: "#1976d2",
    borderRadius: 10,
    paddingVertical: 12,
    justifyContent: "center",
    alignItems: "center",
  },
  uploadBtnDisabled: {
    backgroundColor: "#90bce8",
  },
  uploadSpinner: {
    marginRight: 8,
  },
  uploadBtnText: {
    color: "#ffffff",
    fontSize: 15,
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
  emptyText: {
    color: "#9e9e9e",
    fontSize: 15,
    textAlign: "center",
  },
  list: {
    marginHorizontal: 16,
    marginTop: 16,
    marginBottom: 16,
    backgroundColor: "#ffffff",
    borderRadius: 12,
    overflow: "hidden",
  },
  separator: {
    height: 1,
    backgroundColor: "#f0f0f0",
    marginLeft: 16,
  },
  docRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  docInfo: {
    flex: 1,
    marginRight: 12,
  },
  docName: {
    fontSize: 14,
    fontWeight: "600",
    color: "#1a1a1a",
    marginBottom: 4,
  },
  docMeta: {
    fontSize: 12,
    color: "#757575",
  },
  docActions: {
    flexDirection: "row",
    gap: 8,
  },
  actionBtn: {
    width: 36,
    height: 36,
    borderRadius: 8,
    justifyContent: "center",
    alignItems: "center",
  },
  actionBtnDisabled: {
    opacity: 0.5,
  },
  downloadBtn: {
    backgroundColor: "#1976d2",
  },
  deleteBtn: {
    backgroundColor: "#d32f2f",
  },
  actionBtnText: {
    color: "#ffffff",
    fontSize: 16,
    fontWeight: "600",
  },
});
