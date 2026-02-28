import { ContestInput, Player } from '../types';

const STORAGE_KEY_CONTEST = 'dfsapp.contestInput.v1';
const STORAGE_KEY_ONBOARDING = 'dfsapp.onboarding.v1';
const STORAGE_KEY_BELIEFS = 'dfsapp.beliefs.v1';
const STORAGE_KEY_BELIEF_NAME = 'dfsapp.beliefName.v1';

export const saveContestInput = (input: ContestInput) => {
  try {
    localStorage.setItem(STORAGE_KEY_CONTEST, JSON.stringify(input));
  } catch (e) {
    console.warn("Failed to save contest to localStorage", e);
  }
};

export const loadContestInput = (): ContestInput | null => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_CONTEST);
    if (raw) return JSON.parse(raw) as ContestInput;
  } catch (e) {
    console.warn("Failed to load contest from localStorage", e);
  }
  return null;
};

export const saveBeliefs = (players: Player[], name: string) => {
  try {
    localStorage.setItem(STORAGE_KEY_BELIEFS, JSON.stringify(players));
    localStorage.setItem(STORAGE_KEY_BELIEF_NAME, name);
  } catch (e) {
    console.warn("Failed to save beliefs", e);
  }
};

export const loadBeliefs = (): { players: Player[], name: string } | null => {
  try {
    const rawP = localStorage.getItem(STORAGE_KEY_BELIEFS);
    const rawN = localStorage.getItem(STORAGE_KEY_BELIEF_NAME);
    if (rawP && rawN) {
      return { players: JSON.parse(rawP), name: rawN };
    }
  } catch (e) {
    console.warn("Failed to load beliefs", e);
  }
  return null;
};

export const hasDismissedOnboarding = (): boolean => {
  try {
    return localStorage.getItem(STORAGE_KEY_ONBOARDING) === 'true';
  } catch (e) {
    return false;
  }
};

export const dismissOnboarding = () => {
  try {
    localStorage.setItem(STORAGE_KEY_ONBOARDING, 'true');
  } catch (e) {
    console.warn("Failed to save onboarding state", e);
  }
};