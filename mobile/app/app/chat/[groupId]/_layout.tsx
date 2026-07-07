import { Tabs, Stack, useLocalSearchParams, useRouter } from "expo-router";
import { TouchableOpacity, Text, StyleSheet } from "react-native";
import { Ionicons } from "@expo/vector-icons";

export default function GroupTabLayout() {
  const { name } = useLocalSearchParams<{ name?: string }>();
  const groupName = name ?? "Group";
  const router = useRouter();

  return (
    <>
      <Stack.Screen
        options={{
          headerShown: true,
          title: groupName,
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
              <Text style={styles.backBtnText} numberOfLines={1}> Groups</Text>
            </TouchableOpacity>
          ),
        }}
      />
      <Tabs
        screenOptions={{
          headerShown: false,
          tabBarActiveTintColor: "#1976d2",
          tabBarInactiveTintColor: "#9e9e9e",
          tabBarStyle: {
            backgroundColor: "#ffffff",
            borderTopColor: "#e8edf2",
          },
          tabBarLabelStyle: {
            fontSize: 11,
            fontWeight: "600",
          },
        }}
      >
        <Tabs.Screen
          name="chats"
          options={{
            title: "Chats",
            tabBarHideOnKeyboard: true,
            tabBarIcon: ({ color }) => <Ionicons name="chatbubbles-outline" size={22} color={color} />,
          }}
        />
        <Tabs.Screen
          name="documents"
          options={{
            title: "Documents",
            tabBarIcon: ({ color }) => <Ionicons name="document-text-outline" size={22} color={color} />,
          }}
        />
        <Tabs.Screen
          name="ai-overview"
          options={{
            title: "AI Overview",
            tabBarIcon: ({ color }) => <Ionicons name="sparkles-outline" size={22} color={color} />,
          }}
        />
        <Tabs.Screen
          name="student-overview"
          options={{
            title: "Student",
            tabBarIcon: ({ color }) => <Ionicons name="person-outline" size={22} color={color} />,
          }}
        />
      </Tabs>
    </>
  );
}

const styles = StyleSheet.create({
  backBtn: {
    flexDirection: "row",
    alignItems: "center",
  },
  backBtnText: {
    color: "#1976d2",
    fontSize: 14,
    fontWeight: "700",
  },
});
