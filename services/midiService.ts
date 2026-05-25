
import { Midi } from '@tonejs/midi';
import { MidiData, MidiGridLine, MidiNote, AlignmentTuple } from '../types';

const DEFAULT_TIME_SIGNATURE: [number, number] = [4, 4];

const buildGridLines = (midi: Midi): MidiGridLine[] => {
  const durationTicks = midi.durationTicks;
  const ppq = midi.header.ppq;
  if (durationTicks <= 0 || ppq <= 0) return [];

  const timeSignatures = [...midi.header.timeSignatures]
    .map((event) => ({
      ticks: Math.max(0, Math.round(event.ticks)),
      timeSignature: event.timeSignature as [number, number],
    }))
    .sort((a, b) => a.ticks - b.ticks);

  if (timeSignatures.length === 0 || timeSignatures[0].ticks > 0) {
    timeSignatures.unshift({
      ticks: 0,
      timeSignature: DEFAULT_TIME_SIGNATURE,
    });
  }

  const gridLines: MidiGridLine[] = [];
  const seenTicks = new Set<number>();

  timeSignatures.forEach((event, index) => {
    if (event.ticks > durationTicks) return;

    const nextEvent = timeSignatures[index + 1];
    const segmentEndTicks = Math.min(nextEvent?.ticks ?? durationTicks, durationTicks);
    const includeSegmentEnd = !nextEvent || segmentEndTicks >= durationTicks;
    const [numerator, denominator] = event.timeSignature;
    const ticksPerBeat = Math.max(1, Math.round(ppq * (4 / denominator)));
    const ticksPerBar = Math.max(ticksPerBeat, ticksPerBeat * numerator);

    for (
      let tick = event.ticks;
      includeSegmentEnd ? tick <= segmentEndTicks : tick < segmentEndTicks;
      tick += ticksPerBeat
    ) {
      const roundedTick = Math.round(tick);
      if (seenTicks.has(roundedTick)) continue;
      seenTicks.add(roundedTick);

      const ticksFromSegmentStart = roundedTick - event.ticks;
      gridLines.push({
        time: midi.header.ticksToSeconds(roundedTick),
        ticks: roundedTick,
        kind:
          Math.abs(ticksFromSegmentStart % ticksPerBar) < 1 ? 'bar' : 'beat',
      });
    }
  });

  return gridLines.sort((a, b) => a.time - b.time);
};

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
          ticks: note.ticks,
          durationTicks: note.durationTicks,
          velocity: note.velocity
        });
      });
    });

    // Deterministic sorting for ID assignment. Use ticks first so IDs match
    // MIDI-order alignment files even when tempo maps produce dense time values.
    allNotes.sort((a, b) => {
      if (a.ticks !== b.ticks) return a.ticks - b.ticks;
      return a.pitch - b.pitch;
    });

    // Assign IDs 0 to N-1
    const notesWithIds = allNotes.map((note, index) => ({
      ...note,
      id: index
    }));

    return {
      notes: notesWithIds,
      duration: midi.duration,
      durationTicks: midi.durationTicks,
      ppq: midi.header.ppq,
      gridLines: buildGridLines(midi)
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
