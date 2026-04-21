import React from 'react';
import {
  Pressable,
  Text,
  StyleSheet,
  ActivityIndicator,
  ViewStyle,
  TextStyle,
  Animated,
  Easing,
  View,
} from 'react-native';
import { Colors, BorderRadius, Typography, Motion } from '@/constants/theme';

interface ButtonProps {
  label: string;
  onPress: () => void;
  /**
   * primary   — IG blue solid button (the default "Follow" style)
   * accent    — magenta solid button (destructive / attention)
   * secondary — outlined, black text on white
   * ghost     — transparent, black text, no border (text link)
   * danger    — IG red
   */
  variant?: 'primary' | 'accent' | 'secondary' | 'ghost' | 'danger';
  size?: 'sm' | 'md' | 'lg';
  loading?: boolean;
  disabled?: boolean;
  style?: ViewStyle;
  textStyle?: TextStyle;
  icon?: React.ReactNode;
}

export default function Button({
  label,
  onPress,
  variant = 'primary',
  size = 'md',
  loading = false,
  disabled = false,
  style,
  textStyle,
  icon,
}: ButtonProps) {
  const isDisabled = disabled || loading;
  const opacity = React.useRef(new Animated.Value(1)).current;

  const animateTo = (to: number) => {
    Animated.timing(opacity, {
      toValue: to,
      duration: Motion.fast,
      easing: Easing.out(Easing.quad),
      useNativeDriver: true,
    }).start();
  };

  return (
    <Animated.View style={{ opacity }}>
      <Pressable
        onPress={onPress}
        onPressIn={() => animateTo(0.7)}
        onPressOut={() => animateTo(1)}
        disabled={isDisabled}
        style={[
          styles.base,
          styles[variant],
          styles[`size_${size}` as const],
          isDisabled && styles.disabled,
          style,
        ]}
      >
        {loading ? (
          <ActivityIndicator
            color={
              variant === 'secondary' || variant === 'ghost'
                ? Colors.ink
                : Colors.textOnPrimary
            }
            size="small"
          />
        ) : (
          <View style={styles.inner}>
            {icon}
            <Text
              style={[
                styles.text,
                styles[`text_${variant}` as const],
                styles[`textSize_${size}` as const],
                textStyle,
              ]}
            >
              {label}
            </Text>
          </View>
        )}
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  base: {
    borderRadius: BorderRadius.md,
    overflow: 'hidden',
  },
  inner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  primary: {
    backgroundColor: Colors.primary,
  },
  accent: {
    backgroundColor: Colors.accent,
  },
  secondary: {
    backgroundColor: Colors.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Colors.border,
  },
  ghost: {
    backgroundColor: 'transparent',
  },
  danger: {
    backgroundColor: Colors.danger,
  },
  disabled: {
    opacity: 0.45,
  },
  size_sm: { paddingVertical: 7, paddingHorizontal: 14 },
  size_md: { paddingVertical: 10, paddingHorizontal: 18 },
  size_lg: { paddingVertical: 14, paddingHorizontal: 24 },
  text: {
    fontWeight: '600',
    letterSpacing: -0.1,
  },
  text_primary: { color: Colors.textOnPrimary },
  text_accent: { color: Colors.textOnPrimary },
  text_secondary: { color: Colors.inkSoft },
  text_ghost: { color: Colors.primary },
  text_danger: { color: Colors.textOnPrimary },
  textSize_sm: { ...Typography.bodySmall, fontWeight: '600' },
  textSize_md: { ...Typography.body, fontWeight: '600' },
  textSize_lg: { fontSize: 15, fontWeight: '600' as const },
});
