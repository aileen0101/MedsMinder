import React from 'react';
import { Tabs } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { View, StyleSheet, Pressable } from 'react-native';
import type { BottomTabBarProps } from '@react-navigation/bottom-tabs';
import { StackActions } from '@react-navigation/native';
import { Colors, Spacing } from '@/constants/theme';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

type IoniconsName = React.ComponentProps<typeof Ionicons>['name'];

interface TabMeta {
  name: string;
  title: string;
  icon: IoniconsName;
  iconActive: IoniconsName;
}

const TABS: TabMeta[] = [
  { name: 'home',         title: 'Home',     icon: 'home-outline',          iconActive: 'home' },
  { name: 'medications',  title: 'Meds',     icon: 'medkit-outline',        iconActive: 'medkit' },
  { name: 'support',      title: 'Support',  icon: 'search-outline',        iconActive: 'search' },
  { name: 'emergency',    title: 'SOS',      icon: 'alert-circle-outline', iconActive: 'alert-circle' },
];

/**
 * Instagram-style bottom tab bar:
 *  - pure white background
 *  - hairline top border
 *  - outlined icons when inactive, filled (solid black) when active
 *  - no labels, no pills — just icons (IG keeps it dead simple)
 */
function IgTabBar({ state, descriptors, navigation }: BottomTabBarProps) {
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.bar, { paddingBottom: Math.max(insets.bottom, 6) }]}>
      {state.routes.map((route, index) => {
        const meta = TABS.find((t) => t.name === route.name);
        if (!meta) return null;
        const isFocused = state.index === index;
        const { options } = descriptors[route.key];

        return (
          <Pressable
            key={route.key}
            onPress={() => {
              const event = navigation.emit({
                type: 'tabPress',
                target: route.key,
                canPreventDefault: true,
              });
              if (event.defaultPrevented) return;

              // React Navigation preserves each tab's nested stack
              // state. Without intervention, tapping the Meds tab
              // after visiting a detail would land back on the detail
              // instead of the all-medications list the user asked
              // for.
              //
              // Strategy:
              //   1. If not focused, switch to the tab first.
              //   2. If the nested stack is deep (has a detail parked
              //      on top), pop it to root. popToTop must target
              //      the nested stack's own key — targeting the tab
              //      route.key raised "POP_TO_TOP was not handled"
              //      warnings in a previous iteration.
              if (!isFocused) {
                navigation.navigate(route.name as never);
              }

              const nested = route.state as { type?: string; index?: number; key?: string } | undefined;
              const stackKey = nested?.key;
              const isDeep =
                nested?.type === 'stack' && (nested.index ?? 0) > 0 && !!stackKey;
              if (isDeep) {
                navigation.dispatch({
                  ...StackActions.popToTop(),
                  target: stackKey,
                });
              }
            }}
            onLongPress={() => navigation.emit({ type: 'tabLongPress', target: route.key })}
            accessibilityRole="button"
            accessibilityState={isFocused ? { selected: true } : {}}
            accessibilityLabel={options.tabBarAccessibilityLabel ?? meta.title}
            style={styles.tab}
            hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
          >
            <Ionicons
              name={isFocused ? meta.iconActive : meta.icon}
              size={26}
              color={isFocused ? Colors.ink : Colors.inkSoft}
            />
          </Pressable>
        );
      })}
    </View>
  );
}

export default function TabLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        animation: 'shift',
      }}
      tabBar={(props) => <IgTabBar {...props} />}
    >
      {TABS.map((t) => (
        <Tabs.Screen key={t.name} name={t.name} options={{ title: t.title }} />
      ))}
    </Tabs>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    backgroundColor: Colors.surface,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: Colors.border,
    paddingTop: Spacing.sm,
  },
  tab: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 6,
  },
});
