import { Stack } from "expo-router";

// Wraps all chat/[groupId]/* routes in a Stack so the back button
// returns to the groups list and each group can set its own title.
export default function ChatLayout() {
  return <Stack />;
}
