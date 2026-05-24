import { AlignmentTuple, MidiNote } from "../types";

const INIT_WEIGHT = 1.0;
const INS_PENALTY = 1.0;
const ONSET_TOLERANCE = 0.09;

type DpPathPoint = [scoreIndex: number, tapIndex: number, pointerIndex: number];

interface ScoreSegment {
  scoreOnset: number;
  scoreIndices: number[];
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
      const segmentIndex = Math.max(0, bisectRight(segmentStarts, scoreIndex) - 1);
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

  const sortedScore = [...scoreNotes].sort((a, b) => {
    if (Math.abs(a.start - b.start) > 0.0001) return a.start - b.start;
    return a.pitch - b.pitch;
  });
  const sortedPerf = [...perfNotes].sort((a, b) => {
    if (Math.abs(a.start - b.start) > 0.0001) return a.start - b.start;
    return a.pitch - b.pitch;
  });

  const model = new DP3D1NNRapicoTs(sortedScore);
  sortedPerf.forEach((tap) => model.predict(tap));

  return model
    .getAlignmentPath()
    .map(([scoreIndex, perfIndex]) => ({
      scoreId: sortedScore[scoreIndex]?.id ?? -1,
      annotId: -1,
      perfId: sortedPerf[perfIndex]?.id ?? -1,
    }))
    .filter((pair) => pair.scoreId !== -1 && pair.perfId !== -1);
};
