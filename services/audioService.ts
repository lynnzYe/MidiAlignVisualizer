import Soundfont, { SoundfontInstrument } from "soundfont-player";
import { MidiNote } from "../types";

const INSTRUMENT_NAME = "acoustic_grand_piano";
const SOUNDFONT = "MusyngKite";
const PLAYBACK_LOOKBACK_SECONDS = 0.12;
const SCHEDULE_LOOKAHEAD_SECONDS = 1.5;
const SCHEDULER_INTERVAL_MS = 100;

let audioContext: AudioContext | null = null;
let instrumentPromise: Promise<SoundfontInstrument> | null = null;
let scheduledNodes: Array<AudioNode & { stop?: (when?: number) => void }> = [];
let schedulerId: number | null = null;
let playbackSession = 0;

const DEFAULT_GAIN = 6.2;

const getAudioContext = () => {
  if (!audioContext) {
    const AudioContextCtor =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext })
        .webkitAudioContext;
    audioContext = new AudioContextCtor();
  }
  return audioContext;
};

const getInstrument = async () => {
  const ac = getAudioContext();
  if (ac.state === "suspended") {
    await ac.resume();
  }

  if (!instrumentPromise) {
    instrumentPromise = Soundfont.instrument(ac, INSTRUMENT_NAME, {
      soundfont: SOUNDFONT,
      format: "mp3",
    });
  }

  try {
    return await instrumentPromise;
  } catch (error) {
    instrumentPromise = null;
    throw error;
  }
};

export const playMidiNotePreview = async (note: MidiNote) => {
  try {
    const instrument = await getInstrument();
    const ac = getAudioContext();
    instrument.play(note.pitch, ac.currentTime, {
      duration: Math.max(0.12, Math.min(note.duration || 0.6, 0.9)),
      gain: Math.max(DEFAULT_GAIN, note.velocity || DEFAULT_GAIN),
    });
  } catch (error) {
    console.warn("Unable to play MIDI preview note.", error);
  }
};

export const stopMidiPlayback = () => {
  playbackSession += 1;
  if (schedulerId !== null) {
    window.clearInterval(schedulerId);
    schedulerId = null;
  }
  const ac = audioContext;
  scheduledNodes.forEach((node) => {
    try {
      node.stop?.(ac ? ac.currentTime + 0.001 : undefined);
    } catch {
      // Some browser audio nodes cannot be stopped twice.
    }
  });
  scheduledNodes = [];
};

export const startMidiPlayback = async (
  notes: MidiNote[],
  startOffset: number,
) => {
  try {
    stopMidiPlayback();
    const session = playbackSession;
    const instrument = await getInstrument();
    if (session !== playbackSession) return;
    const ac = getAudioContext();
    const sortedNotes = [...notes].sort((a, b) => {
      if (Math.abs(a.start - b.start) > 0.0001) return a.start - b.start;
      return a.pitch - b.pitch;
    });
    const audioStartTime = ac.currentTime;
    let nextNoteIndex = sortedNotes.findIndex(
      (note) => note.start >= startOffset - PLAYBACK_LOOKBACK_SECONDS,
    );
    if (nextNoteIndex === -1) nextNoteIndex = sortedNotes.length;

    const scheduleWindow = () => {
      if (session !== playbackSession) return;
      const playbackTime = startOffset + (ac.currentTime - audioStartTime);
      const windowEnd = playbackTime + SCHEDULE_LOOKAHEAD_SECONDS;

      while (
        nextNoteIndex < sortedNotes.length &&
        sortedNotes[nextNoteIndex].start <= windowEnd
      ) {
        const note = sortedNotes[nextNoteIndex];
        const overlap = Math.max(0, startOffset - note.start);
        const when = audioStartTime + Math.max(0, note.start - startOffset);
        const duration = Math.max(0.05, note.duration - overlap);

        const node = instrument.play(note.pitch, when, {
          duration,
          gain: Math.max(DEFAULT_GAIN, note.velocity || DEFAULT_GAIN),
        });
        if (node) scheduledNodes.push(node);
        nextNoteIndex += 1;
      }

      if (nextNoteIndex >= sortedNotes.length && schedulerId !== null) {
        window.clearInterval(schedulerId);
        schedulerId = null;
      }
    };

    scheduleWindow();
    if (nextNoteIndex < sortedNotes.length) {
      schedulerId = window.setInterval(
        scheduleWindow,
        SCHEDULER_INTERVAL_MS,
      );
    }
  } catch (error) {
    console.warn("Unable to start MIDI playback.", error);
  }
};
