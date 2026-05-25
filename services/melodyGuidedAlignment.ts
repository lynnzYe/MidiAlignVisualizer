import { AlignmentTuple, MidiNote } from "../types";

const ONSET_TOLERANCE = 0.09;
const DEFAULT_RATIO = 1.0;

interface IndexedAnchor extends AlignmentTuple {
  scoreIndex: number;
  perfIndex: number;
}

interface NoteGroup {
  notes: MidiNote[];
  onset: number;
}

interface GroupMatch {
  scoreGroup: NoteGroup;
  scoreGroupIndex: number;
  perfGroup: NoteGroup;
  perfGroupIndex: number;
}

const sortNotes = (notes: MidiNote[]) =>
  [...notes].sort((a, b) => {
    if (Math.abs(a.start - b.start) > 0.0001) return a.start - b.start;
    return a.pitch - b.pitch;
  });

const sortPairs = (pairs: AlignmentTuple[]) =>
  [...pairs].sort((a, b) => {
    if (a.scoreId !== b.scoreId) return a.scoreId - b.scoreId;
    return a.perfId - b.perfId;
  });

const buildNoteIndexMap = (notes: MidiNote[]) =>
  new Map(notes.map((note, index) => [note.id, index]));

const groupNotesByOnset = (notes: MidiNote[]) => {
  if (notes.length === 0) return [];

  const groups: NoteGroup[] = [];
  let current: MidiNote[] = [notes[0]];
  let referenceOnset = notes[0].start;

  for (let index = 1; index < notes.length; index += 1) {
    const note = notes[index];
    if (Math.abs(note.start - referenceOnset) <= ONSET_TOLERANCE) {
      current.push(note);
      referenceOnset = note.start;
    } else {
      groups.push({
        notes: current,
        onset: current.reduce((sum, item) => sum + item.start, 0) / current.length,
      });
      current = [note];
      referenceOnset = note.start;
    }
  }

  groups.push({
    notes: current,
    onset: current.reduce((sum, item) => sum + item.start, 0) / current.length,
  });
  return groups;
};

const buildMonotonicAnchors = (
  scoreNotes: MidiNote[],
  perfNotes: MidiNote[],
  guidePairs: AlignmentTuple[],
) => {
  const scoreIndexById = buildNoteIndexMap(scoreNotes);
  const perfIndexById = buildNoteIndexMap(perfNotes);
  return guidePairs
    .flatMap((pair) => {
      const scoreIndex = scoreIndexById.get(pair.scoreId);
      const perfIndex = perfIndexById.get(pair.perfId);
      return scoreIndex === undefined || perfIndex === undefined
        ? []
        : [{ ...pair, scoreIndex, perfIndex }];
    })
    .sort((a, b) => {
      if (a.scoreIndex !== b.scoreIndex) return a.scoreIndex - b.scoreIndex;
      return a.perfIndex - b.perfIndex;
    })
    .reduce<IndexedAnchor[]>((anchors, anchor) => {
      const previous = anchors[anchors.length - 1];
      if (
        !previous ||
        (anchor.scoreIndex > previous.scoreIndex &&
          anchor.perfIndex > previous.perfIndex)
      ) {
        anchors.push(anchor);
      }
      return anchors;
    }, []);
};

const estimateRatio = (
  anchors: IndexedAnchor[],
  anchorIndex: number,
  scoreNotes: MidiNote[],
  perfNotes: MidiNote[],
) => {
  const pairs: Array<[IndexedAnchor, IndexedAnchor]> = [];
  if (anchorIndex > 0 && anchorIndex < anchors.length) {
    pairs.push([anchors[anchorIndex - 1], anchors[anchorIndex]]);
  }
  if (anchorIndex + 1 < anchors.length) {
    pairs.push([anchors[anchorIndex], anchors[anchorIndex + 1]]);
  }
  if (anchorIndex > 1) {
    pairs.push([anchors[anchorIndex - 2], anchors[anchorIndex - 1]]);
  }

  for (const [left, right] of pairs) {
    const scoreDelta =
      scoreNotes[right.scoreIndex].start - scoreNotes[left.scoreIndex].start;
    const perfDelta =
      perfNotes[right.perfIndex].start - perfNotes[left.perfIndex].start;
    if (scoreDelta > 0.001 && perfDelta > 0.001) {
      return perfDelta / scoreDelta;
    }
  }

  return DEFAULT_RATIO;
};

const estimatePerfTime = (
  scoreTime: number,
  previousAnchor: IndexedAnchor | null,
  nextAnchor: IndexedAnchor | null,
  ratio: number,
  scoreNotes: MidiNote[],
  perfNotes: MidiNote[],
) => {
  const anchor = previousAnchor ?? nextAnchor;
  if (!anchor) return scoreTime * ratio;
  return (
    perfNotes[anchor.perfIndex].start +
    (scoreTime - scoreNotes[anchor.scoreIndex].start) * ratio
  );
};

const medianPositiveDelta = (groups: NoteGroup[]) => {
  const deltas: number[] = [];
  for (let index = 1; index < groups.length; index += 1) {
    const delta = groups[index].onset - groups[index - 1].onset;
    if (delta > 0.001) deltas.push(delta);
  }
  if (deltas.length === 0) return 0.25;
  deltas.sort((a, b) => a - b);
  return deltas[Math.floor(deltas.length / 2)];
};

const alignNoteGroups = (
  scoreGroups: NoteGroup[],
  perfGroups: NoteGroup[],
  expectedPerfTime: (scoreTime: number) => number,
) => {
  const nScore = scoreGroups.length;
  const nPerf = perfGroups.length;
  const scoreSkipCost = 6.0;
  const perfSkipCost = 6.0;
  const timeScale = Math.max(
    0.08,
    Math.min(0.75, medianPositiveDelta(perfGroups)),
  );
  const dp = Array.from({ length: nScore + 1 }, () =>
    Array(nPerf + 1).fill(Number.POSITIVE_INFINITY),
  );
  const back: Array<Array<"match" | "score-skip" | "perf-skip" | null>> =
    Array.from({ length: nScore + 1 }, () => Array(nPerf + 1).fill(null));
  dp[0][0] = 0;

  for (let i = 0; i <= nScore; i += 1) {
    for (let j = 0; j <= nPerf; j += 1) {
      if (!Number.isFinite(dp[i][j])) continue;

      if (i < nScore) {
        const next = dp[i][j] + scoreSkipCost;
        if (next < dp[i + 1][j]) {
          dp[i + 1][j] = next;
          back[i + 1][j] = "score-skip";
        }
      }

      if (j < nPerf) {
        const next = dp[i][j] + perfSkipCost;
        if (next < dp[i][j + 1]) {
          dp[i][j + 1] = next;
          back[i][j + 1] = "perf-skip";
        }
      }

      if (i < nScore && j < nPerf) {
        const expectedTime = expectedPerfTime(scoreGroups[i].onset);
        const timeDelta = Math.abs(perfGroups[j].onset - expectedTime);
        const matchCost = timeDelta / timeScale;
        const next = dp[i][j] + matchCost;
        if (next < dp[i + 1][j + 1]) {
          dp[i + 1][j + 1] = next;
          back[i + 1][j + 1] = "match";
        }
      }
    }
  }

  const matches: GroupMatch[] = [];
  let i = nScore;
  let j = nPerf;
  while (i > 0 || j > 0) {
    const step = back[i][j];
    if (step === "match") {
      matches.push({
        scoreGroup: scoreGroups[i - 1],
        scoreGroupIndex: i - 1,
        perfGroup: perfGroups[j - 1],
        perfGroupIndex: j - 1,
      });
      i -= 1;
      j -= 1;
    } else if (step === "score-skip") {
      i -= 1;
    } else if (step === "perf-skip") {
      j -= 1;
    } else {
      break;
    }
  }

  return matches.reverse();
};

const localPitchRank = (
  note: MidiNote,
  groupIndex: number,
  groups: NoteGroup[],
) => {
  const contextRadius = 2;
  const start = Math.max(0, groupIndex - contextRadius);
  const end = Math.min(groups.length, groupIndex + contextRadius + 1);
  const contextPitches = groups
    .slice(start, end)
    .flatMap((group) => group.notes.map((item) => item.pitch))
    .sort((a, b) => a - b);

  if (contextPitches.length <= 1) return 0.5;

  let lowerCount = 0;
  let equalCount = 0;
  contextPitches.forEach((pitch) => {
    if (pitch < note.pitch) lowerCount += 1;
    if (pitch === note.pitch) equalCount += 1;
  });

  const averageRank = lowerCount + Math.max(0, equalCount - 1) / 2;
  return averageRank / (contextPitches.length - 1);
};

const pairNotesByRelativePitch = (
  scoreGroup: NoteGroup,
  perfGroup: NoteGroup,
  scoreGroupIndex: number,
  perfGroupIndex: number,
  scoreGroups: NoteGroup[],
  perfGroups: NoteGroup[],
  fixedPairs: AlignmentTuple[] = [],
) => {
  const sortedScore = [...scoreGroup.notes].sort((a, b) => a.pitch - b.pitch);
  const sortedPerf = [...perfGroup.notes].sort((a, b) => a.pitch - b.pitch);
  const nScore = sortedScore.length;
  const nPerf = sortedPerf.length;
  const pairCount = Math.min(nScore, nPerf);
  const pairs: AlignmentTuple[] = [];

  if (pairCount === 0) return pairs;

  const usedScoreIds = new Set<number>();
  const usedPerfIds = new Set<number>();
  const addPair = (scoreNote: MidiNote, perfNote: MidiNote) => {
    if (pairs.length >= pairCount) return;
    if (usedScoreIds.has(scoreNote.id) || usedPerfIds.has(perfNote.id)) return;
    usedScoreIds.add(scoreNote.id);
    usedPerfIds.add(perfNote.id);
    pairs.push({
      scoreId: scoreNote.id,
      annotId: -1,
      perfId: perfNote.id,
    });
  };

  const scoreNoteById = new Map(sortedScore.map((note) => [note.id, note]));
  const perfNoteById = new Map(sortedPerf.map((note) => [note.id, note]));
  fixedPairs.forEach((pair) => {
    const scoreNote = scoreNoteById.get(pair.scoreId);
    const perfNote = perfNoteById.get(pair.perfId);
    if (scoreNote && perfNote) addPair(scoreNote, perfNote);
  });

  if (nPerf >= 2 && nScore >= 2) {
    addPair(sortedScore[0], sortedPerf[0]);
    addPair(sortedScore[nScore - 1], sortedPerf[nPerf - 1]);
  }

  const scoreRankById = new Map(
    sortedScore.map((note) => [
      note.id,
      localPitchRank(note, scoreGroupIndex, scoreGroups),
    ]),
  );
  const perfRankById = new Map(
    sortedPerf.map((note) => [
      note.id,
      localPitchRank(note, perfGroupIndex, perfGroups),
    ]),
  );

  const candidates = sortedScore.flatMap((scoreNote, scoreIndex) =>
    sortedPerf.map((perfNote, perfIndex) => ({
      scoreIndex,
      perfIndex,
      scoreNote,
      perfNote,
      cost: Math.abs(
        (scoreRankById.get(scoreNote.id) ?? 0.5) -
          (perfRankById.get(perfNote.id) ?? 0.5),
      ),
    })),
  );

  candidates.sort((a, b) => {
    if (Math.abs(a.cost - b.cost) > 0.000001) return a.cost - b.cost;
    const aEndpoint =
      Math.min(a.scoreIndex, nScore - 1 - a.scoreIndex) +
      Math.min(a.perfIndex, nPerf - 1 - a.perfIndex);
    const bEndpoint =
      Math.min(b.scoreIndex, nScore - 1 - b.scoreIndex) +
      Math.min(b.perfIndex, nPerf - 1 - b.perfIndex);
    if (aEndpoint !== bEndpoint) return aEndpoint - bEndpoint;
    return a.scoreIndex - b.scoreIndex;
  });

  for (const candidate of candidates) {
    if (pairs.length >= pairCount) break;
    addPair(candidate.scoreNote, candidate.perfNote);
  }

  return pairs;
};

export const runMelodyGuidedAlignment = (
  scoreNotes: MidiNote[],
  perfNotes: MidiNote[],
  guidePairs: AlignmentTuple[],
) => {
  const sortedScore = sortNotes(scoreNotes);
  const sortedPerf = sortNotes(perfNotes);
  const anchors = buildMonotonicAnchors(sortedScore, sortedPerf, guidePairs);
  if (sortedScore.length === 0 || sortedPerf.length === 0 || anchors.length === 0) {
    return [];
  }

  const result: AlignmentTuple[] = anchors.map((anchor) => ({
    scoreId: anchor.scoreId,
    annotId: -1,
    perfId: anchor.perfId,
  }));

  const usedScoreIds = new Set(result.map((pair) => pair.scoreId));
  const usedPerfIds = new Set(result.map((pair) => pair.perfId));
  const reservedScoreIds = new Set<number>();
  const reservedPerfIds = new Set<number>();

  const addPairs = (pairs: AlignmentTuple[]) => {
    pairs.forEach((pair) => {
      if (usedScoreIds.has(pair.scoreId) || usedPerfIds.has(pair.perfId)) return;
      usedScoreIds.add(pair.scoreId);
      usedPerfIds.add(pair.perfId);
      result.push(pair);
    });
  };

  const allScoreGroups = groupNotesByOnset(sortedScore);
  const allPerfGroups = groupNotesByOnset(sortedPerf);
  const scoreGroupIndexByNoteId = new Map<number, number>();
  const perfGroupIndexByNoteId = new Map<number, number>();
  allScoreGroups.forEach((group, groupIndex) => {
    group.notes.forEach((note) => scoreGroupIndexByNoteId.set(note.id, groupIndex));
  });
  allPerfGroups.forEach((group, groupIndex) => {
    group.notes.forEach((note) => perfGroupIndexByNoteId.set(note.id, groupIndex));
  });

  const anchorPairsByGroup = new Map<string, AlignmentTuple[]>();
  anchors.forEach((anchor) => {
    const scoreGroupIndex = scoreGroupIndexByNoteId.get(anchor.scoreId);
    const perfGroupIndex = perfGroupIndexByNoteId.get(anchor.perfId);
    if (scoreGroupIndex === undefined || perfGroupIndex === undefined) return;
    const key = `${scoreGroupIndex}:${perfGroupIndex}`;
    const pairs = anchorPairsByGroup.get(key) ?? [];
    pairs.push(anchor);
    anchorPairsByGroup.set(key, pairs);
  });

  anchorPairsByGroup.forEach((fixedPairs, key) => {
    const [scoreGroupIndex, perfGroupIndex] = key.split(":").map(Number);
    const scoreGroup = allScoreGroups[scoreGroupIndex];
    const perfGroup = allPerfGroups[perfGroupIndex];
    if (!scoreGroup || !perfGroup) return;

    scoreGroup.notes.forEach((note) => reservedScoreIds.add(note.id));
    perfGroup.notes.forEach((note) => reservedPerfIds.add(note.id));
    addPairs(
      pairNotesByRelativePitch(
        scoreGroup,
        perfGroup,
        scoreGroupIndex,
        perfGroupIndex,
        allScoreGroups,
        allPerfGroups,
        fixedPairs,
      ),
    );
  });

  for (let anchorIndex = 0; anchorIndex <= anchors.length; anchorIndex += 1) {
    const previousAnchor = anchors[anchorIndex - 1] ?? null;
    const nextAnchor = anchors[anchorIndex] ?? null;
    const scoreStart = previousAnchor ? previousAnchor.scoreIndex + 1 : 0;
    const scoreEnd = nextAnchor ? nextAnchor.scoreIndex : sortedScore.length;
    const perfStart = previousAnchor ? previousAnchor.perfIndex + 1 : 0;
    const perfEnd = nextAnchor ? nextAnchor.perfIndex : sortedPerf.length;

    const scoreChunk = sortedScore
      .slice(scoreStart, scoreEnd)
      .filter((note) => !usedScoreIds.has(note.id) && !reservedScoreIds.has(note.id));
    const perfChunk = sortedPerf
      .slice(perfStart, perfEnd)
      .filter((note) => !usedPerfIds.has(note.id) && !reservedPerfIds.has(note.id));
    if (scoreChunk.length === 0 || perfChunk.length === 0) continue;

    const ratio = estimateRatio(anchors, anchorIndex, sortedScore, sortedPerf);
    const expectedPerfTime = (scoreTime: number) =>
      estimatePerfTime(
        scoreTime,
        previousAnchor,
        nextAnchor,
        ratio,
        sortedScore,
        sortedPerf,
      );
    const scoreGroups = groupNotesByOnset(scoreChunk);
    const perfGroups = groupNotesByOnset(perfChunk);
    const groupMatches = alignNoteGroups(scoreGroups, perfGroups, expectedPerfTime);

    groupMatches.forEach(
      ({ scoreGroup, scoreGroupIndex, perfGroup, perfGroupIndex }) => {
        addPairs(
          pairNotesByRelativePitch(
            scoreGroup,
            perfGroup,
            scoreGroupIndex,
            perfGroupIndex,
            scoreGroups,
            perfGroups,
          ),
        );
      },
    );
  }

  return sortPairs(result);
};
