import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  ActivityIndicator,
  StyleSheet,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter, useFocusEffect } from "expo-router";
import { useCallback, useEffect } from "react";
import { useAuth } from "../hooks/useAuth";
import { useGroups, type Group } from "../hooks/useGroups";

// Defined outside so the function reference is stable across renders
const Separator = () => <View style={separatorStyle} />;
const separatorStyle = { height: 1, backgroundColor: "#f0f0f0", marginLeft: 16 };

export default function Groups() {
  const { user, logout, isAuthenticated, isLoading: isAuthLoading } = useAuth();
  const { groups, isLoading, error, refresh } = useGroups();
  const router = useRouter();

  // Refresh immediately on focus, then poll every 15s while this screen is active
  // so badge counts stay current without needing a WebSocket on the groups page
  useFocusEffect(useCallback(() => {
    refresh();
    const interval = setInterval(refresh, 15000);
    return () => clearInterval(interval);
  }, [refresh]));

  // If useGroups detected a 401 and called logout(), isAuthenticated goes false → send to login
  useEffect(() => {
    if (!isAuthLoading && !isAuthenticated) {
      router.replace("/login");
    }
  }, [isAuthenticated, isAuthLoading]);

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
      {/* Custom header */}
      <View style={styles.header}>
        <View>
          <Text style={styles.headerTitle}>MS3015 Chat</Text>
          <Text style={styles.headerSub}>
            {user?.username ?? ""} · {user?.role ?? ""}
          </Text>
        </View>
        <TouchableOpacity
          style={styles.logoutBtn}
          onPress={handleLogout}
          activeOpacity={0.8}
        >
          <Text style={styles.logoutText}>Logout</Text>
        </TouchableOpacity>
      </View>

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
        <FlatList
          data={groups}
          keyExtractor={(g) => g.id}
          renderItem={renderGroup}
          contentContainerStyle={styles.list}
          ItemSeparatorComponent={Separator}
        />
      )}
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
    justifyContent: "space-between",
    alignItems: "center",
    backgroundColor: "#ffffff",
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: "#e0e0e0",
  },
  headerTitle: {
    fontSize: 18,
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
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderWidth: 1,
    borderColor: "#e0e0e0",
  },
  logoutText: {
    fontSize: 13,
    color: "#d32f2f",
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
  list: {
    marginHorizontal: 16,
    backgroundColor: "#ffffff",
    borderRadius: 12,
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
    fontSize: 16,
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
    borderRadius: 10,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  badgeOrange: {
    backgroundColor: "#e65100",
    borderRadius: 10,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  badgeText: {
    color: "#ffffff",
    fontSize: 12,
    fontWeight: "600",
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
});
