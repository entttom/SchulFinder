import type { Schule } from './types';

/** Gröbere Zusammenfassung der Schularten für die Übertritte in Prozent: Profil-ID -> Beschriftung. */
const PROFILE: Record<string, string> = {
  vs: 'Volksschule',
  ms: 'Mittelschule',
  ahs: 'Gymnasium (AHS)',
  ps: 'Polytechnische Schule',
  bhs: 'BHS (HTL, HAK, HLW u. a.)',
  bs: 'Berufsschule',
  lf: 'Land- und Forstwirtschaft',
  ss: 'Sonderschule',
  gk: 'Gesundheit und Pflege',
  ph: 'Pädagogische Hochschule',
  musik: 'Musikschule',
  sonst: 'Sonstige',
};

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

export const profilLabel = (id: string) => PROFILE[id] ?? id;
