import { useState } from "react";
import {
  Modal,
  Image,
  StyleSheet,
  TouchableOpacity,
  Dimensions,
  Text,
  Pressable,
  Alert,
  Linking,
  ActivityIndicator,
} from "react-native";
import * as MediaLibrary from "expo-media-library";
import * as FileSystem from "expo-file-system/legacy";

type Props = {
  visible: boolean;
  imageUrl: string | null;
  onClose: () => void;
};

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get("window");

export default function ImageViewerModal({ visible, imageUrl, onClose }: Props) {
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    setSaving(true);
    try {
      const { status } = await MediaLibrary.requestPermissionsAsync();
      if (status !== "granted") {
        Alert.alert(
          "Permission required",
          "Allow CollabGPT to access your photo library in Settings to save images.",
          [
            { text: "Cancel", style: "cancel" },
            { text: "Open Settings", onPress: () => Linking.openSettings() },
          ]
        );
        return;
      }
      // MediaLibrary.saveToLibraryAsync needs a local file — download to cache first
      const localUri = FileSystem.cacheDirectory + `collabgpt_${Date.now()}.jpg`;
      await FileSystem.downloadAsync(imageUrl!, localUri);
      await MediaLibrary.saveToLibraryAsync(localUri);
      Alert.alert("Saved", "Image saved to your photo library.");
    } catch {
      Alert.alert("Error", "Could not save the image. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
      statusBarTranslucent
    >
      {/* tapping anywhere — including on the image — closes the modal */}
      <Pressable style={styles.overlay} onPress={onClose}>
        <Image
          source={{ uri: imageUrl ?? undefined }}
          style={styles.image}
          resizeMode="contain"
          pointerEvents="none"
        />
      </Pressable>
      <TouchableOpacity
        style={[styles.saveButton, saving && { opacity: 0.5 }]}
        onPress={handleSave}
        disabled={saving}
        hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
      >
        {saving
          ? <ActivityIndicator size="small" color="#ffffff" />
          : <Text style={styles.closeText}>⬇</Text>
        }
      </TouchableOpacity>
      <TouchableOpacity
        style={styles.closeButton}
        onPress={onClose}
        hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
      >
        <Text style={styles.closeText}>✕</Text>
      </TouchableOpacity>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.95)",
    justifyContent: "center",
    alignItems: "center",
  },
  image: {
    width: SCREEN_WIDTH,
    height: SCREEN_HEIGHT,
  },
  saveButton: {
    position: "absolute",
    top: 50,
    right: 64,
    backgroundColor: "rgba(0,0,0,0.5)",
    borderRadius: 20,
    width: 40,
    height: 40,
    justifyContent: "center",
    alignItems: "center",
  },
  closeButton: {
    position: "absolute",
    top: 50,
    right: 16,
    backgroundColor: "rgba(0,0,0,0.5)",
    borderRadius: 20,
    width: 40,
    height: 40,
    justifyContent: "center",
    alignItems: "center",
  },
  closeText: {
    color: "#ffffff",
    fontSize: 18,
    fontWeight: "600",
  },
});
