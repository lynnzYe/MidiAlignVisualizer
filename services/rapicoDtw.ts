import { AlignmentTuple, MidiNote } from "../types";

const INIT_WEIGHT = 1.0;
const INS_PENALTY = 1.0;
const ONSET_TOLERANCE = 0.09;

type DpPathPoint = [scoreIndex: number, tapIndex: number, pointerIndex: number];

interface ScoreSegment {
  scoreOnset: number;
  scoreIndices: number[];
}

interface PathPair extends AlignmentTuple {
  scoreIndex: number;
  perfIndex: number;
}

const makeMatrix = (rows: number, cols: number, value = Number.POSITIVE_INFINITY) =>
  Array.from({ length: rows }, () => Array(cols).fill(value));

const cloneMatrix = (matrix: number[][]) => matrix.map((row) => [...row]);

const groupScoreNotes = (notes: MidiNote[]) => {
  if (notes.length === 0) return { segments: [], segmentStarts: [] };

  const segments: ScoreSegment[] = [];
  const segmentStarts: number[] = [];
  let referenceOnset = notes[0].start;
  let current: number[] = [0];

  for (let index = 1; index < notes.length; index += 1) {
    const onset = notes[index].start;
    if (Math.abs(onset - referenceOnset) <= ONSET_TOLERANCE) {
      current.push(index);
      referenceOnset = onset;
    } else {
      segments.push({
        scoreIndices: current,
        scoreOnset:
          current.reduce((sum, scoreIndex) => sum + notes[scoreIndex].start, 0) /
          current.length,
      });
      segmentStarts.push(Math.min(...current));
      current = [index];
      referenceOnset = onset;
    }
  }

  segments.push({
    scoreIndices: current,
    scoreOnset:
      current.reduce((sum, scoreIndex) => sum + notes[scoreIndex].start, 0) /
      current.length,
  });
  segmentStarts.push(Math.min(...current));

  return { segments, segmentStarts };
};

const bisectRight = (values: number[], target: number) => {
  let low = 0;
  let high = values.length;
  while (low < high) {
    const mid = Math.floor((low + high) / 2);
    if (target < values[mid]) high = mid;
    else low = mid + 1;
  }
  return low;
};

const getSegmentIndex = (segmentStarts: number[], noteIndex: number) =>
  Math.max(0, bisectRight(segmentStarts, noteIndex) - 1);

const buildNoteIndexMap = (notes: MidiNote[]) =>
  new Map(notes.map((note, index) => [note.id, index]));

const buildRelativeRankMap = (
  notes: MidiNote[],
  noteIndices: number[],
  nRank: number,
) => {
  const sortedByPitchDesc = [...noteIndices].sort((a, b) => {
    if (notes[b].pitch !== notes[a].pitch) return notes[b].pitch - notes[a].pitch;
    return notes[a].start - notes[b].start;
  });
  const denominator = Math.max(1, sortedByPitchDesc.length - 1);
  const scale = Math.max(0, nRank - 1);

  return new Map(
    sortedByPitchDesc.map((noteIndex, rank) => [
      notes[noteIndex].id,
      (rank / denominator) * scale,
    ]),
  );
};

const reorderBucketByRtp = (
  pairs: AlignmentTuple[],
  scoreNotes: MidiNote[],
  perfNotes: MidiNote[],
) => {
  if (pairs.length < 2) return pairs;

  const scoreNoteIndexById = buildNoteIndexMap(scoreNotes);
  const perfNoteIndexById = buildNoteIndexMap(perfNotes);
  const scoreIndices = pairs.flatMap((pair) => {
    const index = scoreNoteIndexById.get(pair.scoreId);
    return index === undefined ? [] : [index];
  });
  const perfIndices = pairs.flatMap((pair) => {
    const index = perfNoteIndexById.get(pair.perfId);
    return index === undefined ? [] : [index];
  });
  const nRank = Math.min(scoreIndices.length, perfIndices.length);
  if (nRank < 2) return pairs;

  const scoreRtp = buildRelativeRankMap(scoreNotes, scoreIndices, nRank);
  const perfRtp = buildRelativeRankMap(perfNotes, perfIndices, nRank);

  const sortedScoreIds = pairs
    .map((pair) => pair.scoreId)
    .sort((a, b) => {
      const rtpDelta = (scoreRtp.get(a) ?? 0) - (scoreRtp.get(b) ?? 0);
      if (rtpDelta !== 0) return rtpDelta;
      return a - b;
    });

  const sortedPerfIds = pairs
    .map((pair) => pair.perfId)
    .sort((a, b) => {
      const rtpDelta = (perfRtp.get(a) ?? 0) - (perfRtp.get(b) ?? 0);
      if (rtpDelta !== 0) return rtpDelta;
      return a - b;
    });

  return sortedScoreIds.map((scoreId, index) => ({
    scoreId,
    annotId: -1,
    perfId: sortedPerfIds[index],
  }));
};

const repairChordOrderingByRtp = (
  pairs: AlignmentTuple[],
  scoreNotes: MidiNote[],
  perfNotes: MidiNote[],
) => {
  // Keep the 3D DP timing path intact; only repair note order inside local chord buckets.
  const { segments: scoreSegments, segmentStarts: scoreSegmentStarts } =
    groupScoreNotes(scoreNotes);
  const { segmentStarts: perfSegmentStarts } = groupScoreNotes(perfNotes);
  const scoreNoteIndexById = buildNoteIndexMap(scoreNotes);
  const perfNoteIndexById = buildNoteIndexMap(perfNotes);
  const bucketedPairs = new Map<string, AlignmentTuple[]>();
  const repairedPairIds = new Set<string>();

  pairs.forEach((pair) => {
    const scoreIndex = scoreNoteIndexById.get(pair.scoreId);
    const perfIndex = perfNoteIndexById.get(pair.perfId);
    if (scoreIndex === undefined || perfIndex === undefined) return;

    const scoreSegmentIndex = getSegmentIndex(scoreSegmentStarts, scoreIndex);
    if ((scoreSegments[scoreSegmentIndex]?.scoreIndices.length ?? 0) < 2) return;

    const perfSegmentIndex = getSegmentIndex(perfSegmentStarts, perfIndex);
    const key = `${scoreSegmentIndex}:${perfSegmentIndex}`;
    const bucket = bucketedPairs.get(key) ?? [];
    bucket.push(pair);
    bucketedPairs.set(key, bucket);
  });

  const repairedPairs: AlignmentTuple[] = [];
  bucketedPairs.forEach((bucket) => {
    if (bucket.length < 2) return;
    bucket.forEach((pair) => repairedPairIds.add(`${pair.scoreId}:${pair.perfId}`));
    repairedPairs.push(...reorderBucketByRtp(bucket, scoreNotes, perfNotes));
  });

  return [
    ...pairs.filter((pair) => !repairedPairIds.has(`${pair.scoreId}:${pair.perfId}`)),
    ...repairedPairs,
  ];
};

const sortNotesForDtw = (notes: MidiNote[]) =>
  [...notes].sort((a, b) => {
    if (Math.abs(a.start - b.start) > 0.0001) return a.start - b.start;
    return a.pitch - b.pitch;
  });

const sortPairs = (pairs: AlignmentTuple[]) =>
  [...pairs].sort((a, b) => {
    if (a.scoreId !== b.scoreId) return a.scoreId - b.scoreId;
    return a.perfId - b.perfId;
  });

const keepOneToOnePairs = (pairs: AlignmentTuple[]) => {
  const usedScoreIds = new Set<number>();
  const usedPerfIds = new Set<number>();
  const result: AlignmentTuple[] = [];

  pairs.forEach((pair) => {
    if (usedScoreIds.has(pair.scoreId) || usedPerfIds.has(pair.perfId)) return;
    usedScoreIds.add(pair.scoreId);
    usedPerfIds.add(pair.perfId);
    result.push(pair);
  });

  return result;
};

const fillForwardScoreAlignment = (
  pathPairs: PathPair[],
  sortedScore: MidiNote[],
) => {
  const sortedPathPairs = [...pathPairs].sort((a, b) => {
    if (a.scoreIndex !== b.scoreIndex) return a.scoreIndex - b.scoreIndex;
    return a.perfIndex - b.perfIndex;
  });
  const result: AlignmentTuple[] = [];
  let pathIndex = 0;
  let currentPerfId = -1;

  sortedScore.forEach((scoreNote, scoreIndex) => {
    while (
      pathIndex < sortedPathPairs.length &&
      sortedPathPairs[pathIndex].scoreIndex <= scoreIndex
    ) {
      currentPerfId = sortedPathPairs[pathIndex].perfId;
      pathIndex += 1;
    }

    if (currentPerfId !== -1) {
      result.push({
        scoreId: scoreNote.id,
        annotId: -1,
        perfId: currentPerfId,
      });
    }
  });

  return result;
};

class DP3D1NNRapicoTs {
  private readonly nScore: number;
  private readonly scoreExpectedOnsets: number[];
  private lastCost: number[][];
  private allCost: number[][][] = [];
  private prevTap: MidiNote | null = null;

  constructor(private readonly scoreNotes: MidiNote[]) {
    this.nScore = scoreNotes.length;
    const { segments, segmentStarts } = groupScoreNotes(scoreNotes);
    this.scoreExpectedOnsets = scoreNotes.map((_, scoreIndex) => {
      const segmentIndex = getSegmentIndex(segmentStarts, scoreIndex);
      return segments[segmentIndex]?.scoreOnset ?? scoreNotes[scoreIndex].start;
    });

    this.lastCost = makeMatrix(this.nScore, this.nScore);
    for (let row = 0; row < this.nScore; row += 1) {
      this.lastCost[row][0] = 0;
    }
  }

  private dist(tap: MidiNote, pointerIndex: number) {
    if (!this.prevTap) {
      return this.scoreNotes.map((_, scoreIndex) => {
        return (scoreIndex + pointerIndex) * INIT_WEIGHT;
      });
    }

    const pointerOnset =
      pointerIndex === 0 ? 0 : this.scoreExpectedOnsets[pointerIndex - 1];
    const perfIoi = tap.start - this.prevTap.start;

    return this.scoreExpectedOnsets.map((scoreOnset) => {
      const scoreIoi = scoreOnset - pointerOnset;
      return Math.abs(perfIoi - scoreIoi);
    });
  }

  private getBacktrackChoices(coords: DpPathPoint) {
    const validAxes = coords
      .map((coord, axis) => (coord !== 0 ? axis : -1))
      .filter((axis) => axis !== -1);
    const choices: DpPathPoint[] = [];
    const comboCount = 2 ** validAxes.length;

    for (let mask = 1; mask < comboCount; mask += 1) {
      const next = [...coords] as DpPathPoint;
      validAxes.forEach((axis, axisIndex) => {
        const bit = (mask >> (validAxes.length - axisIndex - 1)) & 1;
        if (bit) next[axis] -= 1;
      });
      choices.push(next);
    }

    return choices;
  }

  private cleanPath(path: DpPathPoint[]) {
    const forwardPath = [...path].reverse();
    return forwardPath.filter((point, index) => {
      return index === 0 || point[1] !== forwardPath[index - 1][1];
    });
  }

  predict(tap: MidiNote) {
    const currentCost = makeMatrix(this.nScore, this.nScore);

    for (let pointerIndex = 0; pointerIndex < this.nScore; pointerIndex += 1) {
      const columnCost = this.dist(tap, pointerIndex);
      if (!this.prevTap) {
        for (let scoreIndex = 0; scoreIndex < this.nScore; scoreIndex += 1) {
          currentCost[scoreIndex][pointerIndex] = columnCost[scoreIndex];
        }
        continue;
      }

      for (let scoreIndex = 0; scoreIndex < columnCost.length; scoreIndex += 1) {
        const v100 = this.lastCost[scoreIndex][pointerIndex] + INS_PENALTY;
        const v101 =
          pointerIndex > 0
            ? this.lastCost[scoreIndex][pointerIndex - 1] + INS_PENALTY
            : Number.POSITIVE_INFINITY;
        const v001 =
          pointerIndex > 0
            ? currentCost[scoreIndex][pointerIndex - 1]
            : Number.POSITIVE_INFINITY;
        const v110 =
          scoreIndex > 0
            ? this.lastCost[scoreIndex - 1][pointerIndex] + INS_PENALTY
            : Number.POSITIVE_INFINITY;
        const v111 =
          scoreIndex > 0 && pointerIndex > 0
            ? this.lastCost[scoreIndex - 1][pointerIndex - 1]
            : Number.POSITIVE_INFINITY;
        const v011 =
          scoreIndex > 0 && pointerIndex > 0
            ? currentCost[scoreIndex - 1][pointerIndex - 1]
            : Number.POSITIVE_INFINITY;
        const v010 =
          scoreIndex > 0
            ? currentCost[scoreIndex - 1][pointerIndex]
            : Number.POSITIVE_INFINITY;

        columnCost[scoreIndex] += Math.min(
          v100,
          v101,
          v001,
          v110,
          v111,
          v011,
          v010,
        );
      }

      for (let scoreIndex = 0; scoreIndex < columnCost.length; scoreIndex += 1) {
        currentCost[scoreIndex][pointerIndex] = columnCost[scoreIndex];
      }
    }

    this.allCost.push(cloneMatrix(currentCost));
    this.prevTap = tap;
    this.lastCost = currentCost;
  }

  backtrack(scoreIndex: number, pointerIndex: number) {
    if (this.allCost.length === 0) return [];

    let currentScore = scoreIndex;
    let currentTap = this.allCost.length - 1;
    let currentPointer = pointerIndex;
    const path: DpPathPoint[] = [[currentScore, currentTap, currentPointer]];

    while (currentScore > 0 || currentTap > 0 || currentPointer > 0) {
      const choices = this.getBacktrackChoices([
        currentScore,
        currentTap,
        currentPointer,
      ]);
      let bestChoice = choices[0];
      let bestCost =
        this.allCost[bestChoice[1]][bestChoice[0]][bestChoice[2]];

      for (let index = 1; index < choices.length; index += 1) {
        const choice = choices[index];
        const cost = this.allCost[choice[1]][choice[0]][choice[2]];
        if (cost < bestCost) {
          bestCost = cost;
          bestChoice = choice;
        }
      }

      [currentScore, currentTap, currentPointer] = bestChoice;
      path.push([currentScore, currentTap, currentPointer]);
    }

    return this.cleanPath(path);
  }

  getAlignmentPath() {
    return this.backtrack(this.nScore - 1, this.nScore - 1);
  }
}

export const runDP3D1NNRapico = (
  scoreNotes: MidiNote[],
  perfNotes: MidiNote[],
): AlignmentTuple[] => {
  if (scoreNotes.length === 0 || perfNotes.length === 0) return [];

  const sortedScore = sortNotesForDtw(scoreNotes);
  const sortedPerf = sortNotesForDtw(perfNotes);
  const model = new DP3D1NNRapicoTs(sortedScore);
  sortedPerf.forEach((tap) => model.predict(tap));

  const pathPairs = model
    .getAlignmentPath()
    .map(([scoreIndex, perfIndex]) => ({
      scoreIndex,
      perfIndex,
      scoreId: sortedScore[scoreIndex]?.id ?? -1,
      annotId: -1,
      perfId: sortedPerf[perfIndex]?.id ?? -1,
    }))
    .filter((pair) => pair.scoreId !== -1 && pair.perfId !== -1);

  const repairedPathPairs = repairChordOrderingByRtp(
    keepOneToOnePairs(pathPairs),
    sortedScore,
    sortedPerf,
  );
  const repairedPathPairByScoreId = new Map(
    repairedPathPairs.map((pair) => [pair.scoreId, pair.perfId]),
  );

  return fillForwardScoreAlignment(
    pathPairs.map((pair) => ({
      ...pair,
      perfId: repairedPathPairByScoreId.get(pair.scoreId) ?? pair.perfId,
    })),
    sortedScore,
  );
};

export const runGuidedDP3D1NNRapico = (
  scoreNotes: MidiNote[],
  perfNotes: MidiNote[],
  guidePairs: AlignmentTuple[] = [],
): AlignmentTuple[] => {
  if (guidePairs.length === 0) {
    return runDP3D1NNRapico(scoreNotes, perfNotes);
  }

  const sortedScore = sortNotesForDtw(scoreNotes);
  const sortedPerf = sortNotesForDtw(perfNotes);
  const scoreIndexById = buildNoteIndexMap(sortedScore);
  const perfIndexById = buildNoteIndexMap(sortedPerf);
  const monotonicGuides = guidePairs
    .flatMap((pair) => {
      const scoreIndex = scoreIndexById.get(pair.scoreId);
      const perfIndex = perfIndexById.get(pair.perfId);
      return scoreIndex === undefined || perfIndex === undefined
        ? []
        : [{ pair, scoreIndex, perfIndex }];
    })
    .sort((a, b) => {
      if (a.scoreIndex !== b.scoreIndex) return a.scoreIndex - b.scoreIndex;
      return a.perfIndex - b.perfIndex;
    })
    .reduce<
      Array<{ pair: AlignmentTuple; scoreIndex: number; perfIndex: number }>
    >((guides, guide) => {
      const previous = guides[guides.length - 1];
      if (
        !previous ||
        (guide.scoreIndex > previous.scoreIndex &&
          guide.perfIndex > previous.perfIndex)
      ) {
        guides.push(guide);
      }
      return guides;
    }, []);

  if (monotonicGuides.length === 0) {
    return runDP3D1NNRapico(scoreNotes, perfNotes);
  }

  const result: AlignmentTuple[] = [];
  let previousScoreIndex = -1;
  let previousPerfIndex = -1;

  [...monotonicGuides, null].forEach((guide) => {
    const nextScoreIndex = guide?.scoreIndex ?? sortedScore.length;
    const nextPerfIndex = guide?.perfIndex ?? sortedPerf.length;
    const scoreChunk = sortedScore.slice(previousScoreIndex + 1, nextScoreIndex);
    const perfChunk = sortedPerf.slice(previousPerfIndex + 1, nextPerfIndex);

    result.push(...runDP3D1NNRapico(scoreChunk, perfChunk));

    if (guide) {
      result.push({
        scoreId: guide.pair.scoreId,
        annotId: -1,
        perfId: guide.pair.perfId,
      });
      previousScoreIndex = guide.scoreIndex;
      previousPerfIndex = guide.perfIndex;
    }
  });

  return sortPairs(result);
};
