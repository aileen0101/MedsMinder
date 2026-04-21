// MedsMinder — Core TypeScript Interfaces
// All health data is stored locally on device using AsyncStorage.

export interface UserProfile {
  name: string;
  consentGiven: boolean;
  consentDate: string; // ISO date string
}

export type MealRelation = 'with-meal' | 'empty-stomach' | 'any';
export type TimeOfDay = 'morning' | 'afternoon' | 'evening' | 'night';

export interface DoseSchedule {
  id: string;
  time: string; // "HH:MM" format
  mealRelation: MealRelation;
  timeOfDay: TimeOfDay;
}

export interface RefillInfo {
  currentCount: number;
  totalCount: number;
  refillDate?: string; // ISO date string
  pharmacy?: string;
}

export interface FoodGuidance {
  takeWithFood: boolean;
  avoidAlcohol: boolean;
  avoidGrapefruit: boolean;
  avoidDairy: boolean;
  customRestrictions: string[];
}

export interface ChatSource {
  drug: string;
  section: string;
  url: string;
}

export interface MedAIInfo {
  summary: string;
  purpose: string;
  sideEffects: string[];
  interactions: string[];
  sources: ChatSource[];
  generatedAt: string; // ISO date string
}

export interface Medication {
  id: string;
  name: string;
  dose: string;
  purpose: string;
  instructions: string;
  sideEffects: string[];
  contraindications: string[];
  foodGuidance: FoodGuidance;
  schedule: DoseSchedule[];
  refillInfo: RefillInfo;
  color: string; // hex color for card accent
  aiInfo?: MedAIInfo;
  /**
   * How many physical pills/tablets make up ONE "dose" as prescribed.
   * e.g. dose="500 mg" + pill strength 250 mg → pillsPerDose=2.
   * Used to decrement refillInfo.currentCount correctly when a dose is
   * marked as taken. Optional for backward compat with existing records;
   * treat undefined as 1 at read time.
   */
  pillsPerDose?: number;
  createdAt: string;
  updatedAt: string;
}

export interface DoseLog {
  id: string;
  medicationId: string;
  medicationName: string;
  scheduledTime: string; // ISO datetime
  takenAt?: string; // ISO datetime — undefined if skipped
  taken: boolean;
  notes?: string;
}

export type MoodLevel = 1 | 2 | 3 | 4 | 5;

export interface JournalEntry {
  id: string;
  date: string; // ISO date string
  symptoms: string[];
  sideEffects: string;
  mood: MoodLevel;
  energy: MoodLevel;
  notes: string;
  createdAt: string;
}

export interface EmergencyContact {
  id: string;
  name: string;
  relationship: string;
  phone: string;
}

export interface EmergencyProfile {
  bloodType: string;
  allergies: string[];
  conditions: string[];
  contacts: EmergencyContact[];
  additionalNotes: string;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  sources?: ChatSource[];
  timestamp: string; // ISO datetime
}

export interface LifestyleReminder {
  id: string;
  type: 'avoid' | 'limit' | 'remember';
  category: 'food' | 'drink' | 'activity' | 'general';
  text: string;
  medicationId?: string; // which med this is related to
}
