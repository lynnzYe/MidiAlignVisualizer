
import { Midi } from '@tonejs/midi';
import { MidiData, MidiNote, AlignmentTuple } from '../types';

/**
 * Parses a MIDI file and assigns deterministic IDs based on:
 * 1. First note onset (start time)
 * 2. Note pitch (ascending)
 */
export async function parseMidiFile(file: File): Promise<MidiData | null> {
  try {
    const arrayBuffer = await file.arrayBuffer();

    // Check for MIDI magic bytes "MThd"
    const view = new Uint8Array(arrayBuffer);
    if (view[0] !== 0x4d || view[1] !== 0x54 || view[2] !== 0x68 || view[3] !== 0x64) {
      console.warn('File does not appear to be a valid MIDI file (missing MThd header).');
      // If it looks like it might be the CSV (starting with "scor" or "score"), notify the caller
      return null;
    }

    const midi = new Midi(arrayBuffer);
    let allNotes: MidiNote[] = [];

    midi.tracks.forEach(track => {
      track.notes.forEach(note => {
        allNotes.push({
          id: -1, // Placeholder
          pitch: note.midi,
          start: note.time,
          duration: note.duration,
          velocity: note.velocity
        });
      });
    });

    // Deterministic sorting for ID assignment
    allNotes.sort((a, b) => {
      if (Math.abs(a.start - b.start) > 0.0001) return a.start - b.start;
      return a.pitch - b.pitch;
    });

    // Assign IDs 0 to N-1
    const notesWithIds = allNotes.map((note, index) => ({
      ...note,
      id: index
    }));

    return {
      notes: notesWithIds,
      duration: midi.duration
    };
  } catch (err) {
    console.error('Error parsing MIDI file:', err);
    return null;
  }
}

/**
 * Parses alignment CSV. Expected format: score_id,perf_id
 * Ignores header if present.
 */
export async function parseAlignmentCsv(file: File): Promise<AlignmentTuple[]> {
  try {
    if (!file) return [];
    const text = await file.text();
    const lines = text.split(/\r?\n/).filter(line => line.trim() !== '');
    const pairs: AlignmentTuple[] = [];

    lines.forEach(line => {
      const parts = line.split(/[,\s]+/).map(p => p.trim());
      if (parts.length >= 2) {
        const sId = parseInt(parts[0]);
        const aId = parseInt(parts[1])
        const pId = parseInt(parts[2]);
        if (!isNaN(sId) && !isNaN(pId)) {
          pairs.push({ scoreId: sId, annotId: aId, perfId: pId });
        }
      }
    });

    return pairs;
  } catch (err) {
    console.error('Error parsing CSV file:', err);
    return [];
  }
}
