import React from 'react';
import { View, Text, StyleSheet, ViewStyle } from 'react-native';
import { Colors, BorderRadius, Typography } from '@/constants/theme';

type BadgeVariant = 'success' | 'warning' | 'danger' | 'primary' | 'secondary' | 'neutral' | 'dark';

interface BadgeProps {
  label: string;
  variant?: BadgeVariant;
  style?: ViewStyle;
  icon?: string;
}

const VARIANT_COLORS: Record<BadgeVariant, { bg: string; text: string }> = {
  success: { bg: Colors.successLight, text: Colors.success },
  warning: { bg: Colors.warningLight, text: '#9A6A08' },
  danger: { bg: Colors.dangerLight, text: Colors.dangerDark },
  primary: { bg: Colors.primaryLight, text: Colors.primaryDark },
  secondary: { bg: Colors.secondaryLight, text: Colors.accent },
  neutral: { bg: Colors.divider, text: Colors.inkMuted },
  dark: { bg: Colors.inkSoft, text: Colors.textOnDark },
};

export default function Badge({ label, variant = 'primary', style, icon }: BadgeProps) {
  const colors = VARIANT_COLORS[variant];
  return (
    <View style={[styles.badge, { backgroundColor: colors.bg }, style]}>
      <Text style={[styles.text, { color: colors.text }]}>
        {icon ? `${icon} ` : ''}
        {label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: BorderRadius.sm,
    alignSelf: 'flex-start',
  },
  text: {
    ...Typography.caption,
    fontWeight: '600',
  },
});
