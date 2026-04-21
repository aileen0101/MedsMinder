import React from 'react';
import { View, StyleSheet, ViewStyle } from 'react-native';
import { Colors, BorderRadius } from '@/constants/theme';

interface CardProps {
  children?: React.ReactNode;
  style?: ViewStyle;
  /**
   * default — white surface with a hairline border (IG feed card)
   * flat    — transparent (used when parent already styles)
   * tinted  — very pale IG-blue tint, used for "info" notes
   * outlined — explicit outlined variant (same as default)
   */
  variant?: 'default' | 'tinted' | 'outlined' | 'flat' | 'dark';
  padding?: number;
}

export default function Card({
  children,
  style,
  variant = 'default',
  padding = 14,
}: CardProps) {
  return (
    <View style={[styles.base, styles[variant], { padding }, style]}>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  base: {
    borderRadius: BorderRadius.md,
  },
  default: {
    backgroundColor: Colors.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Colors.border,
  },
  tinted: {
    backgroundColor: Colors.primaryLight,
  },
  outlined: {
    backgroundColor: Colors.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Colors.border,
  },
  flat: {
    backgroundColor: 'transparent',
  },
  dark: {
    backgroundColor: Colors.inkSoft,
  },
});
