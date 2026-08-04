import { memo, useState, useRef, useEffect } from "react";
import { View, Text, Image, StyleSheet, TouchableOpacity, Animated, Linking, Pressable } from "react-native";
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
  isThinking?: boolean;
  is_deleted?: boolean;
  onLongPress?: () => void;
};

const URL_REGEX = /(https?:\/\/[^\s]+|www\.[^\s]+)/gi;

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

// for ) and ] we only strip when they're unbalanced — Wikipedia-style URLs like /wiki/Foo_(bar) are legitimate.
// periods, commas, etc. are always stripped since real URLs don't end in those in normal prose.
function stripTrailingPunct(url: string): { url: string; stripped: string } {
  let stripped = "";
  let u = url;
  let keepStripping = true;
  while (keepStripping && u.length > 0) {
    keepStripping = false;
    const last = u[u.length - 1];
    if (".,:!?;'\"".includes(last)) {
      stripped = last + stripped;
      u = u.slice(0, -1);
      keepStripping = true;
    } else if (last === ")") {
      const opens = (u.match(/\(/g) ?? []).length;
      const closes = (u.match(/\)/g) ?? []).length;
      if (closes > opens) { stripped = last + stripped; u = u.slice(0, -1); keepStripping = true; }
    } else if (last === "]") {
      const opens = (u.match(/\[/g) ?? []).length;
      const closes = (u.match(/\]/g) ?? []).length;
      if (closes > opens) { stripped = last + stripped; u = u.slice(0, -1); keepStripping = true; }
    }
  }
  return { url: u, stripped };
}

function linkifyText(text: string, linkStyle?: object) {
  const parts = text.split(URL_REGEX);
  // split with a capturing group interleaves results: [plain, url, plain, url, ...]
  // so every odd-indexed entry is a URL match — no need to test each part separately

  // strip trailing punctuation from each URL and give it back to the following plain-text chunk
  for (let i = 1; i < parts.length; i += 2) {
    const { url, stripped } = stripTrailingPunct(parts[i]);
    parts[i] = url;
    if (stripped) parts[i + 1] = stripped + (parts[i + 1] ?? "");
  }

  return parts.map((part, i) => {
    if (!part) return undefined;
    if (i % 2 === 1) {
      const href = part.startsWith("www.") ? `https://${part}` : part;
      return (
        <Text key={i} style={linkStyle ?? styles.link} onPress={() => Linking.openURL(href)}>
          {part}
        </Text>
      );
    }
    return part;
  });
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
          <Text style={styles.bold}>{linkifyText(headerMatch[1])}</Text>
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
      return <Text key={lineIdx}>{linkifyText(bulleted)}{sep}</Text>;
    }

    return (
      <Text key={lineIdx}>
        {parts.map((part, pi) =>
          part.startsWith("**") && part.endsWith("**") && part.length > 4 ? (
            <Text key={pi} style={styles.bold}>{part.slice(2, -2)}</Text>
          ) : (
            <Text key={pi}>{linkifyText(part)}</Text>
          )
        )}
        {sep}
      </Text>
    );
  });
}

function ThinkingDots() {
  const dot1 = useRef(new Animated.Value(0.3)).current;
  const dot2 = useRef(new Animated.Value(0.3)).current;
  const dot3 = useRef(new Animated.Value(0.3)).current;

  useEffect(() => {
    const anim = Animated.loop(
      Animated.stagger(200, [
        Animated.sequence([
          Animated.timing(dot1, { toValue: 1, duration: 400, useNativeDriver: true }),
          Animated.timing(dot1, { toValue: 0.3, duration: 400, useNativeDriver: true }),
        ]),
        Animated.sequence([
          Animated.timing(dot2, { toValue: 1, duration: 400, useNativeDriver: true }),
          Animated.timing(dot2, { toValue: 0.3, duration: 400, useNativeDriver: true }),
        ]),
        Animated.sequence([
          Animated.timing(dot3, { toValue: 1, duration: 400, useNativeDriver: true }),
          Animated.timing(dot3, { toValue: 0.3, duration: 400, useNativeDriver: true }),
        ]),
      ])
    );
    anim.start();
    return () => anim.stop();
  }, []);

  return (
    <View style={{ flexDirection: "row", gap: 4, paddingVertical: 4 }}>
      <Animated.View style={[styles.thinkingDot, { opacity: dot1 }]} />
      <Animated.View style={[styles.thinkingDot, { opacity: dot2 }]} />
      <Animated.View style={[styles.thinkingDot, { opacity: dot3 }]} />
    </View>
  );
}

// memo prevents re-renders when the parent ScrollView re-renders for unrelated reasons
export default memo(function MessageBubble({ sender, text, is_bot, isOwn, isTagged, timestamp, message_type, image_url, isThinking, is_deleted, onLongPress }: Props) {
  const timeLabel = formatSGT(timestamp);
  const isImage = message_type === "image" && !!image_url;
  const [showFullImage, setShowFullImage] = useState(false);

  if (isOwn) {
    return (
      <View style={styles.rowRight}>
        {is_deleted ? (
          <View style={[styles.bubble, styles.ownBubble]}>
            <Text style={styles.deletedText}>This message was deleted</Text>
          </View>
        ) : isImage ? (
          <TouchableOpacity
            onPress={() => setShowFullImage(true)}
            onLongPress={onLongPress}
            activeOpacity={0.9}
          >
            <Image source={{ uri: image_url }} style={[styles.imageThumbnail, styles.imageThumbnailOwn]} />
          </TouchableOpacity>
        ) : (
          <Pressable onLongPress={onLongPress}>
            <View style={[styles.bubble, styles.ownBubble]}>
              <Text style={styles.ownText}>{linkifyText(text, styles.linkOwn)}</Text>
            </View>
          </Pressable>
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
        <Pressable onLongPress={onLongPress}>
          <View style={[styles.bubble, styles.botBubble]}>
            {is_deleted
              ? <Text style={styles.deletedText}>This message was deleted</Text>
              : isThinking
              ? <ThinkingDots />
              : <Text style={styles.otherText}>{renderPlainText(text)}</Text>
            }
          </View>
        </Pressable>
        {!isThinking && <Text style={styles.timestamp}>{timeLabel}</Text>}
      </View>
    );
  }

  return (
    <View style={styles.rowLeft}>
      <Text style={styles.senderLabel}>{sender}</Text>
      {is_deleted ? (
        <View style={[styles.bubble, styles.otherBubble]}>
          <Text style={styles.deletedText}>This message was deleted</Text>
        </View>
      ) : isImage ? (
        <TouchableOpacity
          onPress={() => setShowFullImage(true)}
          onLongPress={onLongPress}
          activeOpacity={0.9}
        >
          <Image source={{ uri: image_url }} style={[styles.imageThumbnail, styles.imageThumbnailOther]} />
        </TouchableOpacity>
      ) : (
        <Pressable onLongPress={onLongPress}>
          <View style={[styles.bubble, styles.otherBubble, isTagged && styles.taggedBubble]}>
            <Text style={styles.otherText}>{linkifyText(text)}</Text>
          </View>
        </Pressable>
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
  thinkingDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: "#7e57c2",
  },
  deletedText: {
    color: "#9e9e9e",
    fontSize: 15,
    fontStyle: "italic",
    lineHeight: 20,
  },
  link: {
    color: "#1565c0",
    textDecorationLine: "underline",
  },
  // own bubble is already blue, so use white underlined instead of dark blue
  linkOwn: {
    color: "#ffffff",
    textDecorationLine: "underline",
  },
});
