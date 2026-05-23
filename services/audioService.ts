import Soundfont, { SoundfontInstrument } from "soundfont-player";
import { MidiNote } from "../types";

const INSTRUMENT_NAME = "acoustic_grand_piano";
const SOUNDFONT = "MusyngKite";

let audioContext: AudioContext | null = null;
let instrumentPromise: Promise<SoundfontInstrument> | null = null;
let scheduledNodes: Array<AudioNode & { stop?: (when?: number) => void }> = [];

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
      gain: Math.max(0.2, note.velocity || 0.7),
    });
  } catch (error) {
    console.warn("Unable to play MIDI preview note.", error);
  }
};

export const stopMidiPlayback = () => {
  const ac = audioContext;
  scheduledNodes.forEach((node) => {
    try {
      node.stop?.(ac ? ac.currentTime : undefined);
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
    const instrument = await getInstrument();
    const ac = getAudioContext();

    scheduledNodes = notes
      .filter((note) => note.start + note.duration >= startOffset)
      .map((note) => {
        const overlap = Math.max(0, startOffset - note.start);
        const when = ac.currentTime + Math.max(0, note.start - startOffset);
        const duration = Math.max(0.05, note.duration - overlap);

        return instrument.play(note.pitch, when, {
          duration,
          gain: Math.max(0.2, note.velocity || 0.7),
        });
      });
  } catch (error) {
    console.warn("Unable to start MIDI playback.", error);
  }
};
