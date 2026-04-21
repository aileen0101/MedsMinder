import React, { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Animated, { useSharedValue, useAnimatedStyle, withSpring } from 'react-native-reanimated';
import { Colors, Shadow, BorderRadius, Spacing } from '@/constants/theme';
import ChatbotModal from '@/components/ChatbotModal';

export default function ChatbotFAB() {
  const [modalVisible, setModalVisible] = useState(false);
  const scale = useSharedValue(1);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  function handlePress() {
    scale.value = withSpring(0.92, { damping: 14 }, () => {
      scale.value = withSpring(1, { damping: 12 });
    });
    setModalVisible(true);
  }

  return (
    <>
      <Animated.View style={[styles.wrapper, animatedStyle]} pointerEvents="box-none">
        <Pressable onPress={handlePress} style={styles.fab}>
          <View style={styles.inner}>
            <Ionicons name="sparkles" size={22} color={Colors.textOnPrimary} />
          </View>
        </Pressable>
      </Animated.View>

      <ChatbotModal visible={modalVisible} onClose={() => setModalVisible(false)} />
    </>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    position: 'absolute',
    bottom: Spacing.xl + 40,
    right: Spacing.lg,
  },
  fab: {
    width: 52,
    height: 52,
    borderRadius: BorderRadius.pill,
    backgroundColor: Colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    ...Shadow.md,
  },
  inner: {
    alignItems: 'center',
    justifyContent: 'center',
  },
});
