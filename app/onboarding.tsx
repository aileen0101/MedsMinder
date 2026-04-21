import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  KeyboardAvoidingView,
  Platform,
  Alert,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { saveUserProfile } from '@/services/storage';
import { requestNotificationPermissions } from '@/services/notifications';
import { Privacy } from '@/constants/privacy';
import { Colors, Spacing, BorderRadius, Typography, Shadow } from '@/constants/theme';
import Button from '@/components/ui/Button';

export default function Onboarding() {
  const router = useRouter();
  const [name, setName] = useState('');
  const [consentChecked, setConsentChecked] = useState(false);
  const [showPrivacyFull, setShowPrivacyFull] = useState(false);
  const [loading, setLoading] = useState(false);

  async function handleGetStarted() {
    if (!name.trim()) {
      Alert.alert('Name required', 'Please enter your name to continue.');
      return;
    }
    if (!consentChecked) {
      Alert.alert('Privacy consent required', 'Please read and accept the privacy notice to continue.');
      return;
    }

    setLoading(true);
    await saveUserProfile({
      name: name.trim(),
      consentGiven: true,
      consentDate: new Date().toISOString(),
    });
    await requestNotificationPermissions();
    router.replace('/(tabs)/home');
  }

  return (
    <KeyboardAvoidingView
      style={styles.keyboardView}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.container}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {/* Logo area */}
        <View style={styles.logoArea}>
          <View style={styles.logoCircle}>
            <Text style={styles.logoEmoji}>💊</Text>
          </View>
          <Text style={styles.appName}>MedsMinder</Text>
          <Text style={styles.tagline}>Your personal medication companion</Text>
        </View>

        {/* Name input */}
        <View style={styles.section}>
          <Text style={styles.label}>What's your name?</Text>
          <TextInput
            style={styles.input}
            value={name}
            onChangeText={setName}
            placeholder="Enter your name"
            placeholderTextColor={Colors.textLight}
            autoCapitalize="words"
            returnKeyType="done"
          />
        </View>

        {/* Privacy consent — REQUIRED */}
        <View style={styles.privacyCard}>
          <View style={styles.privacyHeader}>
            <Ionicons name="shield-checkmark" size={22} color={Colors.primaryDark} />
            <Text style={styles.privacyTitle}>Privacy & Data Consent</Text>
          </View>

          <Text style={styles.privacySummary}>
            MedsMinder stores your health data <Text style={styles.bold}>locally on your device only</Text>.
            When you use AI features, your questions are sent to Google's Gemini API.
          </Text>

          <TouchableOpacity onPress={() => setShowPrivacyFull(!showPrivacyFull)} style={styles.readMore}>
            <Text style={styles.readMoreText}>
              {showPrivacyFull ? 'Hide full details ▲' : 'Read full privacy details ▼'}
            </Text>
          </TouchableOpacity>

          {showPrivacyFull && (
            <Text style={styles.privacyFull}>{Privacy.FULL_CONSENT}</Text>
          )}

          {/* Checkbox row */}
          <TouchableOpacity
            style={styles.checkboxRow}
            onPress={() => setConsentChecked(!consentChecked)}
            activeOpacity={0.7}
          >
            <View style={[styles.checkbox, consentChecked && styles.checkboxChecked]}>
              {consentChecked && <Ionicons name="checkmark" size={14} color="#fff" />}
            </View>
            <Text style={styles.checkboxLabel}>
              I have read and agree to the privacy notice above
            </Text>
          </TouchableOpacity>
        </View>

        <Button
          label="Get Started"
          onPress={handleGetStarted}
          size="lg"
          loading={loading}
          disabled={!consentChecked || !name.trim()}
          style={styles.ctaButton}
        />

        <Text style={styles.disclaimer}>
          MedsMinder is not a substitute for professional medical advice.
          Always consult your healthcare provider.
        </Text>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  keyboardView: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  scroll: {
    flex: 1,
  },
  container: {
    padding: Spacing.lg,
    paddingTop: 80,
    paddingBottom: 40,
    gap: Spacing.lg,
  },
  logoArea: {
    alignItems: 'center',
    gap: Spacing.sm,
    marginBottom: Spacing.md,
  },
  logoCircle: {
    width: 100,
    height: 100,
    borderRadius: 50,
    backgroundColor: Colors.primaryLight,
    alignItems: 'center',
    justifyContent: 'center',
    ...Shadow.md,
  },
  logoEmoji: {
    fontSize: 48,
  },
  appName: {
    ...Typography.h1,
    color: Colors.primaryDark,
  },
  tagline: {
    ...Typography.body,
    color: Colors.textSecondary,
  },
  section: {
    gap: Spacing.xs,
  },
  label: {
    ...Typography.label,
    color: Colors.text,
    marginLeft: 4,
  },
  input: {
    backgroundColor: Colors.surface,
    borderRadius: BorderRadius.md,
    padding: Spacing.md,
    ...Typography.body,
    color: Colors.text,
    borderWidth: 1.5,
    borderColor: Colors.border,
    ...Shadow.sm,
  },
  privacyCard: {
    backgroundColor: Colors.surface,
    borderRadius: BorderRadius.lg,
    padding: Spacing.md,
    borderWidth: 1.5,
    borderColor: Colors.primaryLight,
    gap: Spacing.sm,
    ...Shadow.sm,
  },
  privacyHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
  },
  privacyTitle: {
    ...Typography.h4,
    color: Colors.primaryDark,
  },
  privacySummary: {
    ...Typography.body,
    color: Colors.text,
    lineHeight: 22,
  },
  bold: {
    fontWeight: '700',
  },
  readMore: {
    alignSelf: 'flex-start',
  },
  readMoreText: {
    ...Typography.bodySmall,
    color: Colors.primary,
    fontWeight: '600',
  },
  privacyFull: {
    ...Typography.bodySmall,
    color: Colors.textSecondary,
    lineHeight: 20,
    backgroundColor: Colors.primaryPale,
    borderRadius: BorderRadius.sm,
    padding: Spacing.sm,
  },
  checkboxRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.sm,
    marginTop: Spacing.xs,
  },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: Colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 1,
  },
  checkboxChecked: {
    backgroundColor: Colors.primary,
    borderColor: Colors.primary,
  },
  checkboxLabel: {
    ...Typography.body,
    color: Colors.text,
    flex: 1,
    lineHeight: 22,
  },
  ctaButton: {
    marginTop: Spacing.sm,
  },
  disclaimer: {
    ...Typography.bodySmall,
    color: Colors.textLight,
    textAlign: 'center',
    lineHeight: 18,
  },
});
