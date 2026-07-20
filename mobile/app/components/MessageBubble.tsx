import { memo, useState } from "react";
import { View, Text, Image, StyleSheet, TouchableOpacity } from "react-native";
import ImageViewerModal from "./ImageViewerModal";

type Props = {
  sender: string;
  text: string;
  is_bot: boolean;
  isOwn: boolean;
  isTagged: boolean; // current user is @mentioned in this message
  timestamp: string;
  message_type?: string;
  image_url?: string; // fully-constructed authenticated URI, built by chats.tsx
};

// Append Z if the ISO string has no timezone suffix so Date treats it as UTC, not local time.
// Then manually shift to SGT (UTC+8) — avoids Intl timezone support which is patchy in Hermes.
function formatSGT(isoString: string): string {
  const iso = isoString.includes("Z") || isoString.includes("+") ? isoString : isoString + "Z";
  const sgt = new Date(new Date(iso).getTime() + 8 * 60 * 60 * 1000);
  const h = sgt.getUTCHours();
  const m = sgt.getUTCMinutes().toString().padStart(2, "0");
  const ampm = h >= 12 ? "PM" : "AM";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${m} ${ampm}`;
}

// Port of web's formatPlainText — handles ### headings, **bold**, leading bullet dashes,
// and newlines in a way that works with React Native Text (no HTML/dangerouslySetInnerHTML)
function renderPlainText(text: string) {
  const lines = text.split("\n");
  return lines.map((line, lineIdx) => {
    const sep = lineIdx < lines.length - 1 ? "\n" : "";

    // ### heading → bold the whole line
    const headerMatch = line.match(/^###\s+(.*)/);
    if (headerMatch) {
      return (
        <Text key={lineIdx}>
          <Text style={styles.bold}>{headerMatch[1]}</Text>
          {sep}
        </Text>
      );
    }

    // leading - or * turns into a bullet character
    const bulleted = line.replace(/^\s*[-*]\s/, "• ");

    // split on **bold** markers, keeping the matched segments
    const parts = bulleted.split(/(\*\*(?:(?!\*\*).)+?\*\*)/);
    const hasBold = parts.some((p) => p.startsWith("**") && p.endsWith("**"));

    if (!hasBold) {
      return <Text key={lineIdx}>{bulleted}{sep}</Text>;
    }

    return (
      <Text key={lineIdx}>
        {parts.map((part, pi) =>
          part.startsWith("**") && part.endsWith("**") && part.length > 4 ? (
            <Text key={pi} style={styles.bold}>{part.slice(2, -2)}</Text>
          ) : (
            part
          )
        )}
        {sep}
      </Text>
    );
  });
}

// memo prevents re-renders when the parent ScrollView re-renders for unrelated reasons
export default memo(function MessageBubble({ sender, text, is_bot, isOwn, isTagged, timestamp, message_type, image_url }: Props) {
  const timeLabel = formatSGT(timestamp);
  const isImage = message_type === "image" && !!image_url;
  const [showFullImage, setShowFullImage] = useState(false);

  if (isOwn) {
    return (
      <View style={styles.rowRight}>
        {isImage ? (
          <TouchableOpacity onPress={() => setShowFullImage(true)} activeOpacity={0.9}>
            <Image source={{ uri: image_url }} style={[styles.imageThumbnail, styles.imageThumbnailOwn]} />
          </TouchableOpacity>
        ) : (
          <View style={[styles.bubble, styles.ownBubble]}>
            <Text style={styles.ownText}>{text}</Text>
          </View>
        )}
        <Text style={styles.timestamp}>{timeLabel}</Text>
        <ImageViewerModal
          visible={showFullImage}
          imageUrl={image_url ?? null}
          onClose={() => setShowFullImage(false)}
        />
      </View>
    );
  }

  if (is_bot) {
    return (
      <View style={styles.rowLeft}>
        <Text style={styles.senderLabel}>AI Bot</Text>
        <View style={[styles.bubble, styles.botBubble]}>
          <Text style={styles.otherText}>{renderPlainText(text)}</Text>
        </View>
        <Text style={styles.timestamp}>{timeLabel}</Text>
      </View>
    );
  }

  return (
    <View style={styles.rowLeft}>
      <Text style={styles.senderLabel}>{sender}</Text>
      {isImage ? (
        <TouchableOpacity onPress={() => setShowFullImage(true)} activeOpacity={0.9}>
          <Image source={{ uri: image_url }} style={[styles.imageThumbnail, styles.imageThumbnailOther]} />
        </TouchableOpacity>
      ) : (
        <View style={[styles.bubble, styles.otherBubble, isTagged && styles.taggedBubble]}>
          <Text style={styles.otherText}>{text}</Text>
        </View>
      )}
      <Text style={styles.timestamp}>{timeLabel}</Text>
      <ImageViewerModal
        visible={showFullImage}
        imageUrl={image_url ?? null}
        onClose={() => setShowFullImage(false)}
      />
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
    borderRadius: 18,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  ownBubble: {
    backgroundColor: "#1976d2",
    borderBottomRightRadius: 4,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.12,
    shadowRadius: 3,
    elevation: 1,
  },
  botBubble: {
    backgroundColor: "#ede7f6",
    borderBottomLeftRadius: 4,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.08,
    shadowRadius: 3,
    elevation: 1,
  },
  otherBubble: {
    backgroundColor: "#ffffff",
    borderBottomLeftRadius: 4,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.08,
    shadowRadius: 3,
    elevation: 1,
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
  bold: {
    fontWeight: "bold",
  },
  timestamp: {
    fontSize: 11,
    color: "#757575",
    marginTop: 2,
    marginHorizontal: 4,
  },
  imageThumbnail: {
    width: 200,
    height: 200,
    borderRadius: 18,
  },
  imageThumbnailOwn: {
    // matches ownBubble — slightly flattened bottom-right corner
    borderBottomRightRadius: 4,
  },
  imageThumbnailOther: {
    // matches otherBubble — slightly flattened bottom-left corner
    borderBottomLeftRadius: 4,
  },
});
