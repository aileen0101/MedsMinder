import { useEffect } from 'react';
import { View, ActivityIndicator, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { getUserProfile } from '@/services/storage';
import { Colors } from '@/constants/theme';

export default function Index() {
  const router = useRouter();

  useEffect(() => {
    async function checkOnboarding() {
      const profile = await getUserProfile();
      if (profile?.consentGiven) {
        router.replace('/(tabs)/home');
      } else {
        router.replace('/onboarding');
      }
    }
    checkOnboarding();
  }, [router]);

  return (
    <View style={styles.container}>
      <ActivityIndicator size="large" color={Colors.primary} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.background,
  },
});
