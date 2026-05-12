import { Tabs, Stack, useLocalSearchParams, useRouter } from "expo-router";
import { TouchableOpacity, Text } from "react-native";

export default function GroupTabLayout() {
  const { name } = useLocalSearchParams<{ name?: string }>();
  const groupName = name ?? "Group";
  const router = useRouter();

  return (
    <>
      {/* Tells the parent Stack (chat/_layout.tsx) what to show in the header */}
      <Stack.Screen
        options={{
          title: groupName,
          headerStyle: { backgroundColor: "#ffffff" },
          headerTintColor: "#1976d2",
          headerTitleStyle: { fontWeight: "700", color: "#1a1a1a" },
          headerLeft: () => (
            <TouchableOpacity onPress={() => router.navigate("/groups")} style={{ paddingRight: 8 }}>
              <Text style={{ color: "#1976d2", fontSize: 16 }}>‹ Groups</Text>
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
            borderTopColor: "#e0e0e0",
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
            // hide the tab bar when the keyboard opens so the input is never covered
            tabBarHideOnKeyboard: true,
          }}
        />
        <Tabs.Screen name="documents" options={{ title: "Documents" }} />
        <Tabs.Screen name="ai-overview" options={{ title: "AI Overview" }} />
        <Tabs.Screen
          name="student-overview"
          options={{ title: "Student" }}
        />
      </Tabs>
    </>
  );
}
