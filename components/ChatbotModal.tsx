import React, { useState, useRef, useEffect } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  Keyboard,
  Platform,
  Modal,
  ActivityIndicator,
  Linking,
  Alert,
  Pressable,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { getChatHistory, saveChatMessage, getMedications } from '@/services/storage';
import { sendChatMessage, checkBackendHealth } from '@/services/claude';
import type { ChatMessage } from '@/types';
import { Privacy } from '@/constants/privacy';
import { Colors, Spacing, BorderRadius, Typography } from '@/constants/theme';
import PrivacyNotice from '@/components/ui/PrivacyNotice';

interface ChatbotModalProps {
  visible: boolean;
  onClose: () => void;
}

export default function ChatbotModal({ visible, onClose }: ChatbotModalProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [userMeds, setUserMeds] = useState<string[]>([]);
  const [backendOk, setBackendOk] = useState<boolean | null>(null);
  const [chunkCount, setChunkCount] = useState(0);
  const [kbHeight, setKbHeight] = useState(0);
  const scrollRef = useRef<ScrollView>(null);

  useEffect(() => {
    if (!visible) return;
    getChatHistory().then(setMessages);
    getMedications().then((meds) => setUserMeds(meds.map((m) => m.name.toLowerCase())));
    checkBackendHealth().then((h) => {
      setBackendOk(h.ok);
      setChunkCount(h.chunks);
    });
  }, [visible]);

  // Manually track the keyboard height so we can lift the input above it.
  // KeyboardAvoidingView is unreliable inside iOS pageSheet modals — it often
  // leaves the TextInput hidden under the keyboard. The most robust fix is
  // to read the keyboard frame directly and pad the composer container.
  useEffect(() => {
    const showEvt = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvt = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const showSub = Keyboard.addListener(showEvt, (e) => {
      setKbHeight(e.endCoordinates?.height ?? 0);
      // Ensure the latest message is in view when the keyboard opens.
      setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 50);
    });
    const hideSub = Keyboard.addListener(hideEvt, () => setKbHeight(0));
    return () => {
      showSub.remove();
      hideSub.remove();
    };
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
      setMessages((prev) => [
        ...prev,
        {
          id: `msg-${Date.now()}-err`,
          role: 'assistant',
          content: `Sorry, I couldn't connect to the AI service. ${errMsg}`,
          timestamp: new Date().toISOString(),
        },
      ]);
    }
    setLoading(false);
    setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 100);
  }

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      {/*
       * Why pageSheet + SafeAreaView with only 'bottom' edge:
       *  - pageSheet opens with a natural iOS margin at the top, so the
       *    header doesn't sit under the Dynamic Island / notch at all.
       *  - A grabber bar at the very top (standard iOS sheet affordance)
       *    adds another ~16pt of breathing room before the close/back
       *    controls, making them easy to tap with a thumb.
       */}
      <View style={styles.safeArea}>
        <View style={styles.grabberWrap}>
          <View style={styles.grabber} />
        </View>

        <View style={styles.header}>
          <Pressable
            onPress={onClose}
            style={styles.headerBtn}
            hitSlop={{ top: 20, bottom: 20, left: 20, right: 20 }}
            accessibilityRole="button"
            accessibilityLabel="Close chat"
          >
            <Text style={styles.headerBtnText}>Close</Text>
          </Pressable>

          <View style={styles.headerCenter}>
            <View style={styles.avatar}>
              <Ionicons name="sparkles" size={14} color={Colors.textOnPrimary} />
            </View>
            <View>
              <Text style={styles.title}>MedsMinder AI</Text>
              <Text style={styles.subtitle}>
                {backendOk === null
                  ? 'Connecting…'
                  : backendOk
                  ? `Active · ${chunkCount} sources`
                  : 'Offline'}
              </Text>
            </View>
          </View>

          <View style={styles.headerBtn} />
        </View>

        <View style={styles.body}>
          <ScrollView
            ref={scrollRef}
            style={styles.chatScroll}
            contentContainerStyle={styles.chatContent}
            showsVerticalScrollIndicator
            keyboardShouldPersistTaps="handled"
            onContentSizeChange={() => scrollRef.current?.scrollToEnd({ animated: true })}
          >
            <PrivacyNotice message={Privacy.CHATBOT_NOTICE} />

            {backendOk === false && (
              <View style={styles.backendWarning}>
                <Ionicons name="warning-outline" size={14} color={Colors.warning} />
                <Text style={styles.backendWarningText}>
                  Backend not running — cd backend && python3 main.py
                </Text>
              </View>
            )}

            {messages.length === 0 && (
              <View style={styles.chatEmpty}>
                <Ionicons name="chatbubbles-outline" size={40} color={Colors.inkLight} />
                <Text style={styles.chatEmptyTitle}>Ask about your medications</Text>
                <Text style={styles.chatEmptySubtext}>
                  Answers grounded in FDA-approved drug labels.
                </Text>
              </View>
            )}

            {messages.map((msg) => (
              <ChatBubble key={msg.id} msg={msg} />
            ))}

            {loading && (
              <View style={styles.typingBubble}>
                <ActivityIndicator size="small" color={Colors.inkMuted} />
                <Text style={styles.typingText}>Typing…</Text>
              </View>
            )}
          </ScrollView>

          <View style={[styles.chatInput, { paddingBottom: kbHeight > 0 ? 8 : 20, marginBottom: kbHeight }]}>
            <TextInput
              style={styles.chatInputField}
              value={input}
              onChangeText={setInput}
              placeholder="Message…"
              placeholderTextColor={Colors.inkLight}
              multiline
              maxLength={500}
              onFocus={() => setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 100)}
            />
            <TouchableOpacity
              onPress={handleSend}
              disabled={!input.trim() || loading}
              style={styles.sendBtn}
            >
              <Text
                style={[
                  styles.sendBtnText,
                  (!input.trim() || loading) && styles.sendBtnTextDisabled,
                ]}
              >
                Send
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

async function openSource(url: string) {
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
    <View style={[styles.bubbleRow, isUser ? styles.bubbleRowUser : styles.bubbleRowAI]}>
      <View style={[styles.bubble, isUser ? styles.bubbleUser : styles.bubbleAI]}>
        <Text style={[styles.bubbleText, isUser ? styles.bubbleTextUser : styles.bubbleTextAI]}>
          {msg.content}
        </Text>
        {drugChips.length > 0 && (
          <View style={styles.sourcesFooter}>
            {drugChips.map((c) => (
              <TouchableOpacity
                key={c.url}
                onPress={() => openSource(c.url)}
                activeOpacity={0.6}
                style={styles.sourceChip}
              >
                <Ionicons name="link-outline" size={11} color={Colors.primaryDark} />
                <Text style={styles.sourceChipText} numberOfLines={1}>
                  {c.drug}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: Colors.background },

  grabberWrap: {
    alignItems: 'center',
    paddingTop: 8,
    paddingBottom: 4,
  },
  grabber: {
    width: 40,
    height: 5,
    borderRadius: 3,
    backgroundColor: Colors.border,
  },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.md,
    paddingTop: Spacing.sm,
    paddingBottom: Spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Colors.border,
    gap: Spacing.sm,
  },
  headerBtn: {
    minWidth: 60,
    height: 36,
    alignItems: 'flex-start',
    justifyContent: 'center',
  },
  headerBtnText: {
    ...Typography.body,
    color: Colors.primary,
    fontWeight: '600',
  },
  headerCenter: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.sm,
  },
  avatar: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: Colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: { ...Typography.h4, color: Colors.ink },
  subtitle: { ...Typography.caption, color: Colors.inkMuted, marginTop: 1 },

  body: { flex: 1 },
  chatScroll: { flex: 1 },
  chatContent: {
    gap: Spacing.sm,
    paddingHorizontal: Spacing.md,
    paddingTop: Spacing.md,
    paddingBottom: Spacing.xl,
  },

  chatEmpty: {
    alignItems: 'center',
    gap: Spacing.sm,
    marginTop: 60,
    paddingHorizontal: Spacing.lg,
  },
  chatEmptyTitle: { ...Typography.h3, color: Colors.inkSoft, textAlign: 'center' },
  chatEmptySubtext: {
    ...Typography.body,
    color: Colors.inkMuted,
    textAlign: 'center',
    lineHeight: 20,
  },

  bubbleRow: { width: '100%' },
  bubbleRowUser: { alignItems: 'flex-end' },
  bubbleRowAI: { alignItems: 'flex-start' },
  bubble: {
    maxWidth: '80%',
    borderRadius: BorderRadius.xl,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  bubbleUser: {
    backgroundColor: Colors.primary,
    borderBottomRightRadius: 6,
  },
  bubbleAI: {
    backgroundColor: Colors.divider,
    borderBottomLeftRadius: 6,
  },
  bubbleText: { ...Typography.body, lineHeight: 20 },
  bubbleTextUser: { color: Colors.textOnPrimary },
  bubbleTextAI: { color: Colors.ink },

  sourcesFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: 8,
  },
  sourceChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: Colors.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Colors.border,
    borderRadius: BorderRadius.pill,
    paddingHorizontal: 8,
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
    backgroundColor: Colors.divider,
    alignSelf: 'flex-start',
    borderRadius: BorderRadius.xl,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  typingText: { ...Typography.bodySmall, color: Colors.inkMuted },

  chatInput: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: Colors.border,
  },
  chatInputField: {
    flex: 1,
    backgroundColor: Colors.surface,
    borderRadius: BorderRadius.pill,
    paddingHorizontal: Spacing.md,
    paddingVertical: 10,
    ...Typography.body,
    color: Colors.ink,
    maxHeight: 100,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Colors.border,
  },
  sendBtn: { paddingHorizontal: 8, paddingVertical: 8 },
  sendBtnText: {
    ...Typography.body,
    color: Colors.primary,
    fontWeight: '700',
  },
  sendBtnTextDisabled: { color: Colors.inkLight },

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
});
