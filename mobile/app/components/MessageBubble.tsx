import { memo } from "react";
import { View, Text, StyleSheet } from "react-native";

type Props = {
  sender: string;
  text: string;
  is_bot: boolean;
  isOwn: boolean;
  isTagged: boolean; // current user is @mentioned in this message
};

// memo prevents re-renders when the parent FlatList re-renders for unrelated reasons
export default memo(function MessageBubble({ sender, text, is_bot, isOwn, isTagged }: Props) {
  if (isOwn) {
    return (
      <View style={styles.rowRight}>
        <View style={[styles.bubble, styles.ownBubble]}>
          <Text style={styles.ownText}>{text}</Text>
        </View>
      </View>
    );
  }

  if (is_bot) {
    return (
      <View style={styles.rowLeft}>
        <Text style={styles.senderLabel}>AI Bot</Text>
        <View style={[styles.bubble, styles.botBubble]}>
          <Text style={styles.otherText}>{text}</Text>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.rowLeft}>
      <Text style={styles.senderLabel}>{sender}</Text>
      <View style={[styles.bubble, styles.otherBubble, isTagged && styles.taggedBubble]}>
        <Text style={styles.otherText}>{text}</Text>
      </View>
    </View>
  );
});

const styles = StyleSheet.create({
  rowRight: {
    alignItems: "flex-end",
    marginVertical: 3,
    marginHorizontal: 12,
  },
  rowLeft: {
    alignItems: "flex-start",
    marginVertical: 3,
    marginHorizontal: 12,
  },
  senderLabel: {
    fontSize: 11,
    color: "#757575",
    marginBottom: 2,
    marginLeft: 4,
  },
  bubble: {
    maxWidth: "80%",
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  ownBubble: {
    backgroundColor: "#1976d2",
    borderBottomRightRadius: 4,
  },
  botBubble: {
    backgroundColor: "#ede7f6",
    borderBottomLeftRadius: 4,
  },
  otherBubble: {
    backgroundColor: "#ffffff",
    borderBottomLeftRadius: 4,
  },
  taggedBubble: {
    // yellow tint so the user spots their @mention at a glance
    backgroundColor: "#fff9c4",
  },
  ownText: {
    color: "#ffffff",
    fontSize: 15,
    lineHeight: 20,
  },
  otherText: {
    color: "#1a1a1a",
    fontSize: 15,
    lineHeight: 20,
  },
});
