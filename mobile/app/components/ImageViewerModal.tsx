import {
  Modal,
  Image,
  StyleSheet,
  TouchableOpacity,
  Dimensions,
  Text,
  Pressable,
} from "react-native";

type Props = {
  visible: boolean;
  imageUrl: string | null;
  onClose: () => void;
};

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get("window");

export default function ImageViewerModal({ visible, imageUrl, onClose }: Props) {
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
