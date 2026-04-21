import React, { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Colors, BorderRadius, Spacing, Typography } from '@/constants/theme';

interface PrivacyNoticeProps {
  message: string;
  dismissable?: boolean;
}

export default function PrivacyNotice({ message, dismissable = false }: PrivacyNoticeProps) {
  const [dismissed, setDismissed] = useState(false);
  if (dismissed) return null;

  return (
    <View style={styles.container}>
      <Ionicons name="shield-checkmark-outline" size={16} color={Colors.primaryDark} style={styles.icon} />
      <Text style={styles.text}>{message}</Text>
      {dismissable && (
        <TouchableOpacity onPress={() => setDismissed(true)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <Ionicons name="close" size={16} color={Colors.textSecondary} />
        </TouchableOpacity>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: Colors.primaryLight,
    borderRadius: BorderRadius.md,
    padding: Spacing.sm,
    gap: 8,
    marginBottom: Spacing.sm,
  },
  icon: {
    marginTop: 1,
  },
  text: {
    ...Typography.bodySmall,
    color: Colors.primaryDark,
    flex: 1,
    lineHeight: 18,
  },
});
