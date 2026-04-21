import React, { useState, useRef, useEffect } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  KeyboardAvoidingView,
  Platform,
  Alert,
  Linking,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import MapView, { Marker, PROVIDER_GOOGLE } from 'react-native-maps';
import * as Location from 'expo-location';
import { useJournal } from '@/hooks/useJournal';
import { getChatHistory, saveChatMessage, getMedications } from '@/services/storage';
import { sendChatMessage, checkBackendHealth } from '@/services/claude';
import type { ChatMessage, JournalEntry, MoodLevel } from '@/types';
import { Privacy } from '@/constants/privacy';
import { Colors, Spacing, BorderRadius, Typography, Shadow } from '@/constants/theme';
import Card from '@/components/ui/Card';
import Badge from '@/components/ui/Badge';
import Button from '@/components/ui/Button';
import PrivacyNotice from '@/components/ui/PrivacyNotice';

type Tab = 'journal' | 'chat' | 'nearby';

export default function SupportScreen() {
  const [activeTab, setActiveTab] = useState<Tab>('journal');

  return (
    <SafeAreaView style={styles.safeArea} edges={['top']}>
      <View style={styles.header}>
        <Text style={styles.title}>Support</Text>
      </View>

      <View style={styles.tabBar}>
        {(['journal', 'chat', 'nearby'] as Tab[]).map((tab) => (
          <TouchableOpacity
            key={tab}
            style={[styles.tab, activeTab === tab && styles.tabActive]}
            onPress={() => setActiveTab(tab)}
          >
            <Text style={[styles.tabText, activeTab === tab && styles.tabTextActive]}>
              {tab === 'journal' ? 'Journal' : tab === 'chat' ? 'Ask AI' : 'Nearby'}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {activeTab === 'journal' && <JournalTab />}
      {activeTab === 'chat' && <ChatTab />}
      {activeTab === 'nearby' && <NearbyTab />}
    </SafeAreaView>
  );
}

// ─── Journal Tab ─────────────────────────────────────────────────────────────

const COMMON_SYMPTOMS = [
  'Headache', 'Nausea', 'Dizziness', 'Fatigue', 'Dry mouth',
  'Stomach pain', 'Rash', 'Insomnia', 'Appetite loss', 'Palpitations',
];

const MOOD_LABELS: Record<MoodLevel, string> = {
  1: '😞 Poor',
  2: '😕 Fair',
  3: '😐 Okay',
  4: '🙂 Good',
  5: '😄 Great',
};

function JournalTab() {
  const { entries, addEntry, removeEntry } = useJournal();
  const [showForm, setShowForm] = useState(false);
  const [symptoms, setSymptoms] = useState<string[]>([]);
  const [sideEffects, setSideEffects] = useState('');
  const [mood, setMood] = useState<MoodLevel>(3);
  const [energy, setEnergy] = useState<MoodLevel>(3);
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);

  async function handleSave() {
    setSaving(true);
    await addEntry({
      date: new Date().toISOString().split('T')[0],
      symptoms,
      sideEffects,
      mood,
      energy,
      notes,
    });
    setSymptoms([]); setSideEffects(''); setMood(3); setEnergy(3); setNotes('');
    setShowForm(false);
    setSaving(false);
  }

  return (
    <ScrollView style={styles.tabContent} contentContainerStyle={styles.tabPadding} showsVerticalScrollIndicator={false}>
      <View style={styles.journalHeader}>
        <Text style={styles.sectionTitle}>Symptom Journal</Text>
        <TouchableOpacity onPress={() => setShowForm(!showForm)} style={styles.addBtn}>
          <Ionicons name={showForm ? 'close' : 'add'} size={20} color="#fff" />
        </TouchableOpacity>
      </View>

      {showForm && (
        <Card style={styles.formCard}>
          <Text style={styles.formTitle}>New Entry — {new Date().toLocaleDateString()}</Text>

          <Text style={styles.formLabel}>Symptoms today</Text>
          <View style={styles.symptomGrid}>
            {COMMON_SYMPTOMS.map((s) => (
              <TouchableOpacity
                key={s}
                style={[styles.symptomChip, symptoms.includes(s) && styles.symptomChipActive]}
                onPress={() =>
                  setSymptoms((prev) =>
                    prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s]
                  )
                }
              >
                <Text style={[styles.symptomChipText, symptoms.includes(s) && styles.symptomChipTextActive]}>
                  {s}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          <Text style={styles.formLabel}>Side effects notes</Text>
          <TextInput
            style={styles.textArea}
            value={sideEffects}
            onChangeText={setSideEffects}
            placeholder="Describe any side effects..."
            placeholderTextColor={Colors.textLight}
            multiline
          />

          <Text style={styles.formLabel}>Overall mood</Text>
          <View style={styles.moodRow}>
            {([1, 2, 3, 4, 5] as MoodLevel[]).map((m) => (
              <TouchableOpacity
                key={m}
                style={[styles.moodBtn, mood === m && styles.moodBtnActive]}
                onPress={() => setMood(m)}
              >
                <Text style={styles.moodEmoji}>{MOOD_LABELS[m].split(' ')[0]}</Text>
              </TouchableOpacity>
            ))}
          </View>

          <Text style={styles.formLabel}>Notes</Text>
          <TextInput
            style={styles.textArea}
            value={notes}
            onChangeText={setNotes}
            placeholder="Any other notes..."
            placeholderTextColor={Colors.textLight}
            multiline
          />

          <Button label="Save Entry" onPress={handleSave} loading={saving} />
        </Card>
      )}

      {entries.length === 0 ? (
        <View style={styles.empty}>
          <Ionicons name="journal-outline" size={48} color={Colors.primaryLight} />
          <Text style={styles.emptyText}>No journal entries yet</Text>
          <Text style={styles.emptySubtext}>Tap + to log your first entry</Text>
        </View>
      ) : (
        entries.map((entry) => <JournalEntryCard key={entry.id} entry={entry} onDelete={() => removeEntry(entry.id)} />)
      )}
    </ScrollView>
  );
}

function JournalEntryCard({ entry, onDelete }: { entry: JournalEntry; onDelete: () => void }) {
  return (
    <Card style={styles.journalCard}>
      <View style={styles.journalCardHeader}>
        <Text style={styles.journalDate}>{new Date(entry.date).toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })}</Text>
        <View style={styles.journalMeta}>
          <Text style={styles.moodLabel}>{MOOD_LABELS[entry.mood]}</Text>
          <TouchableOpacity onPress={onDelete}>
            <Ionicons name="trash-outline" size={16} color={Colors.textLight} />
          </TouchableOpacity>
        </View>
      </View>
      {entry.symptoms.length > 0 && (
        <View style={styles.symptomRow}>
          {entry.symptoms.map((s) => <Badge key={s} label={s} variant="warning" />)}
        </View>
      )}
      {entry.sideEffects ? <Text style={styles.journalNotes}>{entry.sideEffects}</Text> : null}
      {entry.notes ? <Text style={styles.journalNotes}>{entry.notes}</Text> : null}
    </Card>
  );
}

// ─── Chat Tab ─────────────────────────────────────────────────────────────────

function ChatTab() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [userMeds, setUserMeds] = useState<string[]>([]);
  const [backendOk, setBackendOk] = useState<boolean | null>(null);
  const [chunkCount, setChunkCount] = useState(0);
  const scrollRef = useRef<ScrollView>(null);

  useEffect(() => {
    getChatHistory().then(setMessages);
    getMedications().then((meds) => setUserMeds(meds.map((m) => m.name.toLowerCase())));
    checkBackendHealth().then((h) => { setBackendOk(h.ok); setChunkCount(h.chunks); });
  }, []);

  async function handleSend() {
    if (!input.trim() || loading) return;
    const userMsg: ChatMessage = {
      id: `msg-${Date.now()}`,
      role: 'user',
      content: input.trim(),
      timestamp: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, userMsg]);
    setInput('');
    setLoading(true);
    await saveChatMessage(userMsg);
    setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 100);

    try {
      const { content, sources } = await sendChatMessage(userMsg.content, messages, userMeds);
      const assistantMsg: ChatMessage = {
        id: `msg-${Date.now()}-ai`,
        role: 'assistant',
        content,
        sources,
        timestamp: new Date().toISOString(),
      };
      setMessages((prev) => [...prev, assistantMsg]);
      await saveChatMessage(assistantMsg);
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : 'Unknown error';
      setMessages((prev) => [...prev, {
        id: `msg-${Date.now()}-err`,
        role: 'assistant',
        content: `Sorry, I couldn't connect to the AI service. ${errMsg}`,
        timestamp: new Date().toISOString(),
      }]);
    }
    setLoading(false);
    setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 100);
  }

  return (
    <KeyboardAvoidingView
      style={styles.chatContainer}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 120 : 0}
    >
      <PrivacyNotice message={Privacy.CHATBOT_NOTICE} />

      {backendOk === false && (
        <View style={styles.backendWarning}>
          <Ionicons name="warning-outline" size={14} color={Colors.warning} />
          <Text style={styles.backendWarningText}>Backend not running — cd backend && python main.py</Text>
        </View>
      )}
      {backendOk === true && (
        <View style={styles.backendOk}>
          <Ionicons name="server-outline" size={14} color={Colors.success} />
          <Text style={styles.backendOkText}>
            RAG ready · {chunkCount} FDA chunks · {userMeds.length} med{userMeds.length !== 1 ? 's' : ''} in context
          </Text>
        </View>
      )}

      <ScrollView
        ref={scrollRef}
        style={styles.chatScroll}
        contentContainerStyle={styles.chatContent}
        showsVerticalScrollIndicator
        keyboardShouldPersistTaps="handled"
        onContentSizeChange={() => scrollRef.current?.scrollToEnd({ animated: true })}
      >
        {messages.length === 0 && (
          <View style={styles.chatEmpty}>
            <Ionicons name="chatbubbles-outline" size={48} color={Colors.primaryLight} />
            <Text style={styles.chatEmptyTitle}>Ask about your medications</Text>
            <Text style={styles.chatEmptySubtext}>
              Answers are grounded in FDA-approved drug labels. All responses include citations.
            </Text>
          </View>
        )}
        {messages.map((msg) => <ChatBubble key={msg.id} msg={msg} />)}
        {loading && (
          <View style={styles.typingBubble}>
            <ActivityIndicator size="small" color={Colors.primary} />
            <Text style={styles.typingText}>Thinking...</Text>
          </View>
        )}
      </ScrollView>

      <View style={styles.chatInput}>
        <TextInput
          style={styles.chatInputField}
          value={input}
          onChangeText={setInput}
          placeholder="Ask about medications, side effects..."
          placeholderTextColor={Colors.textLight}
          multiline
          maxLength={500}
        />
        <TouchableOpacity
          onPress={handleSend}
          disabled={!input.trim() || loading}
          style={[styles.sendBtn, (!input.trim() || loading) && styles.sendBtnDisabled]}
        >
          <Ionicons name="send" size={20} color="#fff" />
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

async function openSourceUrl(url: string) {
  try {
    const supported = await Linking.canOpenURL(url);
    if (supported) await Linking.openURL(url);
    else Alert.alert('Cannot open link', url);
  } catch {
    Alert.alert('Cannot open link', url);
  }
}

function ChatBubble({ msg }: { msg: ChatMessage }) {
  const isUser = msg.role === 'user';
  const rawSources = !isUser && Array.isArray(msg.sources) ? msg.sources : [];

  const seenDrugs = new Set<string>();
  const drugChips: { drug: string; url: string }[] = [];
  for (const s of rawSources) {
    if (typeof s === 'string') continue;
    const key = s.drug.toLowerCase();
    if (seenDrugs.has(key)) continue;
    seenDrugs.add(key);
    drugChips.push({ drug: s.drug, url: s.url });
  }

  return (
    <View style={[styles.bubble, isUser ? styles.bubbleUser : styles.bubbleAI]}>
      <Text style={[styles.bubbleText, isUser ? styles.bubbleTextUser : styles.bubbleTextAI]}>
        {msg.content}
      </Text>
      {drugChips.length > 0 && (
        <View style={styles.sourcesFooter}>
          <Text style={styles.sourcesFooterLabel}>FDA label:</Text>
          {drugChips.map((c) => (
            <TouchableOpacity
              key={c.url}
              onPress={() => openSourceUrl(c.url)}
              activeOpacity={0.6}
              style={styles.sourceChip}
            >
              <Text style={styles.sourceChipText} numberOfLines={1}>
                {c.drug}
              </Text>
              <Ionicons name="open-outline" size={11} color={Colors.primaryDark} />
            </TouchableOpacity>
          ))}
        </View>
      )}
    </View>
  );
}

// ─── Nearby Tab ───────────────────────────────────────────────────────────────

type PlaceType = 'pharmacy' | 'doctor' | 'hospital';

const PLACE_TYPES: { key: PlaceType; label: string; icon: string }[] = [
  { key: 'pharmacy', label: 'Pharmacy', icon: '💊' },
  { key: 'doctor', label: 'Doctor', icon: '👨‍⚕️' },
  { key: 'hospital', label: 'Hospital', icon: '🏥' },
];

interface Place {
  id: string;
  name: string;
  vicinity: string;
  lat: number;
  lng: number;
}

function NearbyTab() {
  const [location, setLocation] = useState<{ lat: number; lng: number } | null>(null);
  const [places, setPlaces] = useState<Place[]>([]);
  const [placeType, setPlaceType] = useState<PlaceType>('pharmacy');
  const [loading, setLoading] = useState(false);
  const [permissionDenied, setPermissionDenied] = useState(false);

  async function getLocation() {
    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== 'granted') {
      setPermissionDenied(true);
      return null;
    }
    const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
    return { lat: loc.coords.latitude, lng: loc.coords.longitude };
  }

  async function searchNearby(type: PlaceType) {
    setLoading(true);
    setPlaceType(type);
    setPlaces([]);

    let loc = location;
    if (!loc) {
      loc = await getLocation();
      if (!loc) {
        setLoading(false);
        return;
      }
      setLocation(loc);
    }

    const key = process.env.EXPO_PUBLIC_GOOGLE_MAPS_KEY;
    if (!key || key === 'your_google_maps_key_here') {
      Alert.alert('Maps API not configured', 'Add EXPO_PUBLIC_GOOGLE_MAPS_KEY to your .env file.');
      setLoading(false);
      return;
    }

    // Google Places "doctor" type was deprecated — newer recommendation is
    // to use the text-based keyword search with a type filter.
    const keyword = type === 'doctor' ? 'doctor' : type;
    const apiType = type === 'doctor' ? 'doctor' : type;
    const url =
      `https://maps.googleapis.com/maps/api/place/nearbysearch/json` +
      `?location=${loc.lat},${loc.lng}` +
      `&radius=5000` +
      `&type=${apiType}` +
      `&keyword=${encodeURIComponent(keyword)}` +
      `&key=${key}`;

    try {
      const res = await fetch(url);
      const data = await res.json();

      // Google returns a `status` field; anything other than OK/ZERO_RESULTS is a real error.
      if (data.status && data.status !== 'OK' && data.status !== 'ZERO_RESULTS') {
        const hint =
          data.status === 'REQUEST_DENIED'
            ? 'The Places API may not be enabled for this key, or billing is not set up. Open Google Cloud Console → APIs & Services → enable "Places API" and ensure billing is on.'
            : data.status === 'OVER_QUERY_LIMIT'
            ? 'Google API quota exceeded.'
            : data.status === 'INVALID_REQUEST'
            ? 'Request was invalid — try a different location.'
            : '';
        Alert.alert(
          `Google Places: ${data.status}`,
          `${data.error_message ?? 'No detail'}\n\n${hint}`.trim()
        );
        setLoading(false);
        return;
      }

      const mapped: Place[] = (data.results ?? []).slice(0, 10).map((p: Record<string, unknown>) => ({
        id: p.place_id as string,
        name: p.name as string,
        vicinity: (p.vicinity as string) ?? (p.formatted_address as string) ?? '',
        lat: (p.geometry as { location: { lat: number; lng: number } }).location.lat,
        lng: (p.geometry as { location: { lat: number; lng: number } }).location.lng,
      }));

      if (mapped.length === 0) {
        Alert.alert('No results', `No ${type}s found within 5km. Try a different type.`);
      }

      setPlaces(mapped);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Network error';
      Alert.alert('Failed to fetch places', msg);
    }
    setLoading(false);
  }

  async function openInMaps(place: Place) {
    // iOS devices without Chrome / Google Maps installed sometimes fail to
    // open google.com/maps URLs that include `query_place_id` — especially
    // when the place name ends in punctuation like a comma. Try a series of
    // robust fallbacks so we always land in SOME map app.
    const q = encodeURIComponent(place.name.replace(/,\s*$/, ''));
    const ll = `${place.lat},${place.lng}`;
    const candidates = Platform.select({
      ios: [
        `maps://?q=${q}&ll=${ll}`, // Apple Maps app scheme (always installed)
        `https://maps.apple.com/?q=${q}&ll=${ll}`,
        `https://www.google.com/maps/search/?api=1&query=${ll}`,
      ],
      android: [
        `geo:${ll}?q=${ll}(${q})`,
        `https://www.google.com/maps/search/?api=1&query=${ll}`,
      ],
      default: [`https://www.google.com/maps/search/?api=1&query=${ll}`],
    }) as string[];

    for (const url of candidates) {
      try {
        const canOpen = await Linking.canOpenURL(url);
        if (canOpen) {
          await Linking.openURL(url);
          return;
        }
      } catch {
        // try next candidate
      }
    }
    Alert.alert('Could not open map', `${place.name}\n${place.vicinity}`);
  }

  return (
    <ScrollView style={styles.tabContent} contentContainerStyle={styles.tabPadding} showsVerticalScrollIndicator={false}>
      <PrivacyNotice message={Privacy.LOCATION_NOTICE} dismissable />

      <View style={styles.placeTypeRow}>
        {PLACE_TYPES.map((t) => (
          <TouchableOpacity
            key={t.key}
            style={[styles.placeTypeBtn, placeType === t.key && styles.placeTypeBtnActive]}
            onPress={() => searchNearby(t.key)}
          >
            <Text style={styles.placeTypeEmoji}>{t.icon}</Text>
            <Text style={[styles.placeTypeText, placeType === t.key && styles.placeTypeTextActive]}>{t.label}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {permissionDenied && (
        <Card variant="outlined" style={styles.permissionCard}>
          <Text style={styles.permissionText}>Location permission denied. Enable it in Settings to find nearby providers.</Text>
        </Card>
      )}

      {location && (
        <MapView
          style={styles.map}
          provider={PROVIDER_GOOGLE}
          initialRegion={{ latitude: location.lat, longitude: location.lng, latitudeDelta: 0.05, longitudeDelta: 0.05 }}
          showsUserLocation
        >
          {places.map((p) => (
            <Marker
              key={p.id}
              coordinate={{ latitude: p.lat, longitude: p.lng }}
              title={p.name}
              description={p.vicinity}
              pinColor={Colors.primary}
            />
          ))}
        </MapView>
      )}

      {loading ? (
        <ActivityIndicator color={Colors.primary} style={{ marginTop: Spacing.xl }} />
      ) : places.length === 0 ? (
        <View style={styles.empty}>
          <Ionicons name="map-outline" size={48} color={Colors.primaryLight} />
          <Text style={styles.emptyText}>Select a provider type to search nearby</Text>
        </View>
      ) : (
        places.map((place) => (
          <TouchableOpacity key={place.id} onPress={() => openInMaps(place)} activeOpacity={0.85}>
            <Card style={styles.placeCard}>
              <View style={styles.placeRow}>
                <View style={styles.placeIcon}>
                  <Ionicons name="location" size={20} color={Colors.primary} />
                </View>
                <View style={styles.placeInfo}>
                  <Text style={styles.placeName}>{place.name}</Text>
                  <Text style={styles.placeVicinity}>{place.vicinity}</Text>
                </View>
                <Ionicons name="open-outline" size={16} color={Colors.textLight} />
              </View>
            </Card>
          </TouchableOpacity>
        ))
      )}
    </ScrollView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: Colors.background },
  header: { padding: Spacing.lg, paddingBottom: Spacing.sm },
  title: { ...Typography.h2, color: Colors.text },
  tabBar: {
    flexDirection: 'row',
    marginHorizontal: Spacing.lg,
    marginBottom: Spacing.sm,
    backgroundColor: Colors.surface,
    borderRadius: BorderRadius.pill,
    padding: 4,
    ...Shadow.sm,
  },
  tab: {
    flex: 1,
    paddingVertical: 8,
    borderRadius: BorderRadius.pill,
    alignItems: 'center',
  },
  tabActive: { backgroundColor: Colors.primary },
  tabText: { ...Typography.bodySmall, color: Colors.textSecondary, fontWeight: '600' },
  tabTextActive: { color: Colors.textOnPrimary },
  tabContent: { flex: 1 },
  tabPadding: { padding: Spacing.lg, gap: Spacing.md, paddingBottom: 100 },

  // Journal
  journalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  sectionTitle: { ...Typography.h3, color: Colors.text },
  addBtn: {
    width: 36,
    height: 36,
    borderRadius: BorderRadius.pill,
    backgroundColor: Colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    ...Shadow.sm,
  },
  formCard: { gap: Spacing.sm },
  formTitle: { ...Typography.h4, color: Colors.primaryDark },
  formLabel: { ...Typography.label, color: Colors.text },
  symptomGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.xs },
  symptomChip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: BorderRadius.pill,
    borderWidth: 1.5,
    borderColor: Colors.border,
    backgroundColor: Colors.surface,
  },
  symptomChipActive: { backgroundColor: Colors.primaryLight, borderColor: Colors.primary },
  symptomChipText: { ...Typography.bodySmall, color: Colors.textSecondary, fontWeight: '600' },
  symptomChipTextActive: { color: Colors.primaryDark },
  textArea: {
    backgroundColor: Colors.background,
    borderRadius: BorderRadius.md,
    padding: Spacing.sm,
    minHeight: 70,
    textAlignVertical: 'top',
    ...Typography.body,
    color: Colors.text,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  moodRow: { flexDirection: 'row', gap: Spacing.sm },
  moodBtn: {
    flex: 1,
    height: 48,
    borderRadius: BorderRadius.md,
    backgroundColor: Colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: Colors.border,
  },
  moodBtnActive: { borderColor: Colors.primary, backgroundColor: Colors.primaryLight },
  moodEmoji: { fontSize: 24 },
  journalCard: { gap: Spacing.sm },
  journalCardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  journalDate: { ...Typography.label, color: Colors.text },
  journalMeta: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  moodLabel: { ...Typography.bodySmall, color: Colors.textSecondary },
  symptomRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 4 },
  journalNotes: { ...Typography.body, color: Colors.textSecondary, lineHeight: 20 },
  empty: { alignItems: 'center', gap: Spacing.sm, marginTop: 60 },
  emptyText: { ...Typography.h4, color: Colors.textSecondary },
  emptySubtext: { ...Typography.body, color: Colors.textLight },

  // Chat
  chatContainer: { flex: 1, paddingHorizontal: Spacing.lg },
  chatScroll: { flex: 1 },
  chatContent: { gap: Spacing.sm, paddingBottom: Spacing.xl, paddingTop: Spacing.xs },
  chatEmpty: { alignItems: 'center', gap: Spacing.sm, marginTop: 60, paddingHorizontal: Spacing.lg },
  chatEmptyTitle: { ...Typography.h4, color: Colors.textSecondary, textAlign: 'center' },
  chatEmptySubtext: { ...Typography.body, color: Colors.textLight, textAlign: 'center', lineHeight: 22 },
  bubble: {
    maxWidth: '85%',
    borderRadius: BorderRadius.lg,
    padding: Spacing.md,
    gap: 6,
  },
  bubbleUser: {
    backgroundColor: Colors.primary,
    alignSelf: 'flex-end',
    borderBottomRightRadius: BorderRadius.sm,
  },
  bubbleAI: {
    backgroundColor: Colors.surface,
    alignSelf: 'flex-start',
    borderBottomLeftRadius: BorderRadius.sm,
    ...Shadow.sm,
  },
  bubbleText: { ...Typography.body, lineHeight: 22 },
  bubbleTextUser: { color: Colors.textOnPrimary },
  bubbleTextAI: { color: Colors.text },
  sourcesFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: Spacing.xs,
    paddingTop: Spacing.xs,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: Colors.divider,
  },
  sourcesFooterLabel: {
    ...Typography.caption,
    color: Colors.textLight,
    fontStyle: 'italic',
    marginRight: 2,
  },
  sourceChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: Colors.primaryLight,
    borderRadius: BorderRadius.pill,
    paddingHorizontal: 10,
    paddingVertical: 3,
  },
  sourceChipText: {
    ...Typography.caption,
    color: Colors.primaryDark,
    fontWeight: '600',
    textTransform: 'capitalize',
  },
  typingBubble: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    backgroundColor: Colors.surface,
    alignSelf: 'flex-start',
    borderRadius: BorderRadius.lg,
    padding: Spacing.md,
    ...Shadow.sm,
  },
  typingText: { ...Typography.bodySmall, color: Colors.textSecondary },
  chatInput: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: Spacing.sm,
    paddingVertical: Spacing.sm,
    paddingBottom: Platform.OS === 'ios' ? Spacing.lg : Spacing.sm,
  },
  chatInputField: {
    flex: 1,
    backgroundColor: Colors.surface,
    borderRadius: BorderRadius.xl,
    paddingHorizontal: Spacing.md,
    paddingVertical: 10,
    ...Typography.body,
    color: Colors.text,
    maxHeight: 100,
    borderWidth: 1.5,
    borderColor: Colors.border,
  },
  sendBtn: {
    width: 44,
    height: 44,
    borderRadius: BorderRadius.pill,
    backgroundColor: Colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    ...Shadow.sm,
  },
  sendBtnDisabled: { opacity: 0.4, shadowOpacity: 0 },
  backendWarning: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: Colors.warningLight,
    borderRadius: BorderRadius.sm,
    paddingHorizontal: Spacing.sm,
    paddingVertical: 6,
    marginBottom: 6,
  },
  backendWarningText: { ...Typography.caption, color: Colors.warning, fontWeight: '600', flex: 1 },
  backendOk: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: Colors.successLight,
    borderRadius: BorderRadius.sm,
    paddingHorizontal: Spacing.sm,
    paddingVertical: 6,
    marginBottom: 6,
  },
  backendOkText: { ...Typography.caption, color: Colors.success, fontWeight: '600', flex: 1 },

  // Nearby
  placeTypeRow: { flexDirection: 'row', gap: Spacing.sm },
  placeTypeBtn: {
    flex: 1,
    alignItems: 'center',
    backgroundColor: Colors.surface,
    borderRadius: BorderRadius.lg,
    paddingVertical: Spacing.sm,
    gap: 4,
    borderWidth: 1.5,
    borderColor: Colors.border,
    ...Shadow.sm,
  },
  placeTypeBtnActive: { backgroundColor: Colors.primaryLight, borderColor: Colors.primary },
  placeTypeEmoji: { fontSize: 22 },
  placeTypeText: { ...Typography.caption, color: Colors.textSecondary, fontWeight: '600' },
  placeTypeTextActive: { color: Colors.primaryDark },
  map: { height: 240, borderRadius: BorderRadius.lg, overflow: 'hidden' },
  placeCard: { padding: Spacing.sm },
  placeRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  placeIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: Colors.primaryLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  placeInfo: { flex: 1 },
  placeName: { ...Typography.bodySmall, fontWeight: '600', color: Colors.text },
  placeVicinity: { ...Typography.caption, color: Colors.textSecondary },
  permissionCard: { padding: Spacing.md },
  permissionText: { ...Typography.body, color: Colors.textSecondary },
});
