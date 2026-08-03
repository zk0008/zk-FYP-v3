import { useEffect } from "react";
import { View, Text, ActivityIndicator, StyleSheet } from "react-native";
import { useRouter } from "expo-router";
import * as WebBrowser from "expo-web-browser";

// Handles the zkfyp://redirect deep link Azure sends after Microsoft login.
// maybeCompleteAuthSession() closes the browser tab, then we bounce back to login.
WebBrowser.maybeCompleteAuthSession();

export default function Redirect() {
  const router = useRouter();

  useEffect(() => {
    const timer = setTimeout(() => {
      router.replace("/login");
    }, 500);
    return () => clearTimeout(timer);
  }, []);

  return (
    <View style={styles.container}>
      <ActivityIndicator size="large" color="#1976d2" />
      <Text style={styles.text}>Signing you in...</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "#f0f4f8",
    gap: 16,
  },
  text: {
    fontSize: 15,
    color: "#757575",
  },
});
