
export interface MidiNote {
  id: number;
  pitch: number;
  start: number;
  duration: number;
  ticks: number;
  durationTicks: number;
  velocity: number;
}

export interface MidiGridLine {
  time: number;
  ticks: number;
  kind: 'bar' | 'beat';
}

export interface MidiData {
  notes: MidiNote[];
  duration: number;
  durationTicks: number;
  ppq: number;
  gridLines: MidiGridLine[];
}

export interface AlignmentTuple {
  scoreId: number;
  annotId: number; // Intermediary score (subset, 1-1 mapped to perfId)
  perfId: number;
}

export interface ViewState {
  zoomX: number; // pixels per second
  zoomY: number; // pixels per semitone
  scrollX: number; // offset in seconds
  scrollY: number; // offset in semitones (0-127)
}

export type AlignmentVisibility = 'full' | 'half' | 'none';

export interface PlaybackState {
  isPlaying: boolean;
  startTime: number; // performance.now() when started
  startOffset: number; // time in seconds where started
  activePanel: 'score' | 'perf' | null;
}

export type RollPanel = 'score' | 'perf';

export type PlaybackSoundMode = 'native' | 'aligned-score';

export interface AlignmentRangeMarks {
  left: number | null;
  right: number | null;
}

export type AlignmentMarksByPanel = Record<RollPanel, AlignmentRangeMarks>;
