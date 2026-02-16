
import { Midi } from '@tonejs/midi';
import { MidiData, MidiNote, AlignmentTuple } from '../types';

/**
 * Core logic to parse MIDI data from an ArrayBuffer
 */
export function parseMidiBuffer(arrayBuffer: ArrayBuffer): MidiData | null {
  try {
    // Check for MIDI magic bytes "MThd"
    const view = new Uint8Array(arrayBuffer);
    if (view[0] !== 0x4d || view[1] !== 0x54 || view[2] !== 0x68 || view[3] !== 0x64) {
      console.warn('Data does not appear to be a valid MIDI (missing MThd header).');
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
    console.error('Error parsing MIDI buffer:', err);
    return null;
  }
}

/**
 * Core logic to parse Alignment CSV from a string
 */
export function parseCsvText(text: string): AlignmentTuple[] {
  try {
    // Remove Byte Order Mark (BOM) if present
    const cleanText = text.replace(/^\uFEFF/, '');

    // Split lines and filter out empty ones
    const lines = cleanText.split(/\r?\n/).map(l => l.trim()).filter(l => l.length > 0);
    const pairs: AlignmentTuple[] = [];

    lines.forEach(line => {
      // Handle both comma and space separators, stripping quotes
      const parts = line.split(/[,\s]+/).map(p => p.trim().replace(/^["'](.+)["']$/, '$1'));

      let sId = NaN;
      let pId = NaN;

      if (parts.length >= 3) {
        // Handle three-column format: score_id, annot_id, perf_id
        sId = parseInt(parts[0]);
        pId = parseInt(parts[2]);
      } else if (parts.length === 2) {
        // Fallback for standard two-column format: score_id, perf_id
        sId = parseInt(parts[0]);
        pId = parseInt(parts[1]);
      }

      if (!isNaN(sId) && !isNaN(pId)) {
        pairs.push({ scoreId: sId, annotId: -1, perfId: pId });
      }
    });

    return pairs;
  } catch (err) {
    console.error('Error parsing CSV text:', err);
    return [];
  }
}

/**
 * Parses a MIDI file from an upload
 */
export async function parseMidiFile(file: File): Promise<MidiData | null> {
  const buffer = await file.arrayBuffer();
  return parseMidiBuffer(buffer);
}

/**
 * Parses alignment CSV from an upload
 */
export async function parseAlignmentCsv(file: File): Promise<AlignmentTuple[]> {
  const text = await file.text();
  return parseCsvText(text);
}

/**
 * Fetches and parses a MIDI file from a URL
 */
export async function loadMidiFromUrl(url: string): Promise<MidiData | null> {
  try {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Failed to fetch ${url}`);
    const buffer = await response.arrayBuffer();
    return parseMidiBuffer(buffer);
  } catch (e) {
    console.error(e);
    return null;
  }
}

/**
 * Fetches and parses an alignment CSV from a URL
 */
export async function loadAlignmentCsvFromUrl(url: string): Promise<AlignmentTuple[]> {
  try {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Failed to fetch ${url}`);
    const text = await response.text();
    return parseCsvText(text);
  } catch (e) {
    console.error(e);
    return [];
  }
}
