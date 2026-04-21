// MedsMinder — Privacy Notice Strings
// ⚠️  IMPORTANT: This app handles sensitive health information.
// All notices below must remain visible and accurate.

export const Privacy = {
  // Full consent text shown on onboarding — user must explicitly agree
  FULL_CONSENT: `Your health information is private and important. Here's how MedsMinder handles your data:

📱 LOCAL STORAGE ONLY
All your medication data, journal entries, and emergency profile are stored exclusively on your device using AsyncStorage. We do not operate servers or databases.

🤖 AI FEATURES — DATA LEAVES YOUR DEVICE
When you use the AI chatbot or generate medication info, your questions are sent to Google's Gemini API. Google's privacy policy applies to these queries. Do not include personally identifiable medical records (e.g. your full name + diagnosis) in AI queries.

🗺️ LOCATION — NEARBY PROVIDERS ONLY
Your location is only accessed when you use the Nearby Providers feature, and is only sent to Google Maps. It is not stored by MedsMinder.

🚫 NO THIRD-PARTY TRACKING
We do not use analytics, crash reporting, or advertising SDKs.

By continuing, you consent to this data handling.`,

  // Short banner shown in chatbot screen
  CHATBOT_NOTICE: '🤖 AI queries are sent to Google\'s Gemini API. Do not include personally identifiable info.',

  // Short banner shown in medication AI info section
  MED_AI_NOTICE: '⚠️ AI-generated information is sent to Gemini API. Always verify with your pharmacist or doctor.',

  // Banner on emergency profile screen
  EMERGENCY_NOTICE: '📱 This information is stored only on your device. Share it with first responders in an emergency.',

  // Banner on nearby providers map
  LOCATION_NOTICE: '📍 Your location is sent to Google Maps only when searching for providers. It is not stored.',

  // Footer shown on AI-generated content
  AI_DISCLAIMER: 'This information was AI-generated using Gemini (Google). Always consult your healthcare provider before making medical decisions. Sources are listed above.',

  // Citation header
  SOURCES_HEADER: 'Sources cited by AI:',
};
