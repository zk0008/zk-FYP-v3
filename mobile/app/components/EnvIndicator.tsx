import { View, StyleSheet } from "react-native";

export default function EnvIndicator() {
  const apiUrl = process.env.EXPO_PUBLIC_API_URL ?? "";
  const isProd = apiUrl.includes("azurewebsites.net");

  return (
    <View
      style={[
        styles.dot,
        { backgroundColor: isProd ? "#22c55e" : "#eab308" },
      ]}
    />
  );
}

const styles = StyleSheet.create({
  dot: {
    position: "absolute",
    top: 50,
    right: 12,
    width: 10,
    height: 10,
    borderRadius: 5,
    borderWidth: 1,
    borderColor: "#ffffff",
    zIndex: 999,
    shadowColor: "#000000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.2,
    shadowRadius: 3,
    elevation: 2,
  },
});
