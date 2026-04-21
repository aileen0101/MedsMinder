import { useEffect } from 'react';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import * as SplashScreen from 'expo-splash-screen';
import * as Notifications from 'expo-notifications';
import { Colors } from '@/constants/theme';

SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  useEffect(() => {
    SplashScreen.hideAsync();
    const sub = Notifications.addNotificationResponseReceivedListener(() => {
      // Navigate to medications tab when notification tapped
    });
    return () => sub.remove();
  }, []);

  return (
    <>
      <StatusBar style="dark" backgroundColor={Colors.background} />
      <Stack
        screenOptions={{
          headerShown: false,
          animation: 'slide_from_right',
          animationDuration: 180,
          contentStyle: { backgroundColor: Colors.background },
        }}
      >
        <Stack.Screen name="index" options={{ animation: 'fade' }} />
        <Stack.Screen name="onboarding" options={{ animation: 'fade' }} />
        <Stack.Screen name="(tabs)" options={{ animation: 'fade' }} />
      </Stack>
    </>
  );
}
