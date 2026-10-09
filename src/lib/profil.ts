import type { Schule } from './types';

/** Gröbere Zusammenfassung der Schularten für die Übersicht in Prozent. */
export type Profil = { id: string; label: string; kat: string };

export const PROFILE: Profil[] = [
  { id: 'vs', label: 'Volksschule', kat: 'vs' },
  { id: 'ms', label: 'Mittelschule', kat: 'ms' },
  { id: 'ahs', label: 'Gymnasium (AHS)', kat: 'ahs' },
  { id: 'ps', label: 'Polytechnische Schule', kat: 'ps' },
  { id: 'bhs', label: 'BHS (HTL, HAK, HLW u. a.)', kat: 'bmhs' },
  { id: 'bs', label: 'Berufsschule', kat: 'bs' },
  { id: 'lf', label: 'Land- und Forstwirtschaft', kat: 'lf' },
  { id: 'ss', label: 'Sonderschule', kat: 'ss' },
  { id: 'gk', label: 'Gesundheit und Pflege', kat: 'gk' },
  { id: 'ph', label: 'Pädagogische Hochschule', kat: 'ph' },
  { id: 'musik', label: 'Musikschule', kat: 'musik' },
  { id: 'sonst', label: 'Sonstige', kat: 'sonst' },
];

// Bildungskompass-Schulart-ID -> Profil
const ART: Record<string, string> = {
  '1': 'vs', '3': 'ms', '4': 'ss', '5': 'ps', '6': 'bs', '7': 'bs', '8': 'ahs', '9': 'ahs',
  '10': 'bhs', '11': 'bhs', '12': 'bhs', '13': 'bhs', '15': 'lf', '16': 'lf', '17': 'bhs',
  '18': 'ph', '20': 'gk', '21': 'musik', '22': 'sonst', '23': 'sonst',
};
// Rückfall für Schulen ohne Bildungskompass-Eintrag
const KAT: Record<string, string> = { bmhs: 'bhs' };

export const profilOf = (s: Pick<Schule, 'artId' | 'kat'>): string =>
  (s.artId && ART[s.artId]) || KAT[s.kat] || s.kat;

export const profilLabel = (id: string) => PROFILE.find((p) => p.id === id)?.label ?? id;
export const profilKat = (id: string) => PROFILE.find((p) => p.id === id)?.kat ?? 'sonst';
