import React, {
  useState,
  useCallback,
  useRef,
  useEffect,
  useMemo,
} from "react";
import {
  MidiData,
  ViewState,
  AlignmentTuple,
  AlignmentVisibility,
  MidiNote,
  PlaybackState,
  AlignmentMarksByPanel,
  RollPanel,
  PlaybackSoundMode,
} from "./types";
import {
  parseMidiFile,
  parseAlignmentCsv,
  loadMidiFromUrl,
  loadAlignmentCsvFromUrl,
} from "./services/midiService";
import PianoRoll from "./components/PianoRoll";
import {
  Upload,
  Trash2,
  Eye,
  EyeOff,
  MousePointer2,
  Settings2,
  Info,
  Play,
  Pause,
  ZoomIn,
  ZoomOut,
  Target,
  CheckCircle2,
  Clock,
  ChevronRight,
  ChevronLeft,
  AlertCircle,
  Download,
  Wand2,
  GitCompareArrows,
} from "lucide-react";
import {
  playMidiNotePreview,
  startMidiPlayback,
  stopMidiPlayback,
} from "./services/audioService";
import { runDP3D1NNRapico } from "./services/rapicoDtw";
// TODO: check alignment seems to be of wrong order. Id assignment
const PLAYHEAD_ANCHOR_RATIO = 1 / 5;

const emptyMarks = (): AlignmentMarksByPanel => ({
  score: { left: null, right: null },
  perf: { left: null, right: null },
});

const App: React.FC = () => {
  const [scoreMidi, setScoreMidi] = useState<MidiData | null>(null);
  const [perfMidi, setPerfMidi] = useState<MidiData | null>(null);
  const [alignment, setAlignment] = useState<AlignmentTuple[]>([]);
  const [gtAlignment, setGtAlignment] = useState<AlignmentTuple[]>([]);

  const [scoreViewState, setScoreViewState] = useState<ViewState>({
    zoomX: 100,
    zoomY: 15,
    scrollX: 0,
    scrollY: 60,
  });
  const [perfViewState, setPerfViewState] = useState<ViewState>({
    zoomX: 100,
    zoomY: 15,
    scrollX: 0,
    scrollY: 60,
  });
  const [playback, setPlayback] = useState<PlaybackState>({
    isPlaying: false,
    startTime: 0,
    startOffset: 0,
    activePanel: null,
  });
  const scoreViewStateRef = useRef(scoreViewState);
  const perfViewStateRef = useRef(perfViewState);
  const playbackRef = useRef(playback);
  useEffect(() => {
    scoreViewStateRef.current = scoreViewState;
  }, [scoreViewState]);
  useEffect(() => {
    perfViewStateRef.current = perfViewState;
  }, [perfViewState]);
  useEffect(() => {
    playbackRef.current = playback;
  }, [playback]);

  const [selectedNote, setSelectedNote] = useState<{
    id: number;
    midi: number;
    panel: "score" | "perf";
  } | null>(null);
  const [visibility, setVisibility] = useState<AlignmentVisibility>("full");
  const [syncScroll, setSyncScroll] = useState(false);
  const [playbackSoundMode, setPlaybackSoundMode] =
    useState<PlaybackSoundMode>("native");

  const [playheadTime, setPlayheadTime] = useState(0);

  const containerRef = useRef<HTMLDivElement>(null);
  const scorePanelRef = useRef<HTMLDivElement>(null);
  const perfPanelRef = useRef<HTMLDivElement>(null);
  const requestRef = useRef<number>(null);
  const [containerSize, setContainerSize] = useState({ width: 0, height: 0 });

  const scoreInputRef = useRef<HTMLInputElement>(null);
  const perfInputRef = useRef<HTMLInputElement>(null);
  const alignInputRef = useRef<HTMLInputElement>(null);
  const gtInputRef = useRef<HTMLInputElement>(null);

  const [alignmentMarks, setAlignmentMarks] =
    useState<AlignmentMarksByPanel>(emptyMarks);
  const [activeEditPanel, setActiveEditPanel] = useState<RollPanel>("score");
  const [manualUndoStack, setManualUndoStack] = useState<AlignmentTuple[][]>([]);
  const [manualRedoStack, setManualRedoStack] = useState<AlignmentTuple[][]>([]);
  const [dragLink, setDragLink] = useState<{
    fromPanel: RollPanel;
    note: MidiNote;
    pointerX: number;
    pointerY: number;
  } | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    const resizeObserver = new ResizeObserver(([entry]) => {
      setContainerSize({
        width: entry.contentRect.width,
        height: entry.contentRect.height,
      });
    });

    resizeObserver.observe(containerRef.current);
    return () => resizeObserver.disconnect();
  }, []);

  // Load defaults on mount
  useEffect(() => {
    const loadDefaults = async () => {
      // Assuming these files exist in the public folder
      const sMidi = await loadMidiFromUrl("/MidiAlignVisualizer/score.mid");
      const pMidi = await loadMidiFromUrl("/MidiAlignVisualizer/perf.mid");
      const align = await loadAlignmentCsvFromUrl(
        "/MidiAlignVisualizer/alignment.csv",
      );
      const gtalign = await loadAlignmentCsvFromUrl(
        "/MidiAlignVisualizer/gt_alignment.csv",
      );

      if (sMidi) setScoreMidi(sMidi);
      if (pMidi) setPerfMidi(pMidi);
      if (align.length > 0) setAlignment(align);
      if (gtalign.length > 0) setGtAlignment(gtalign);
    };
    loadDefaults();
  }, []);

  // Unmapped detection logic
  const scoreUnmappedIds = useMemo(() => {
    if (!scoreMidi || alignment.length === 0) return new Set<number>();
    const mapped = new Set<number>();
    const explicitlyUnmapped = new Set<number>();
    alignment.forEach((p) => {
      if (p.scoreId !== -1 && p.perfId !== -1) mapped.add(p.scoreId);
      if (p.scoreId !== -1 && p.perfId === -1)
        explicitlyUnmapped.add(p.scoreId);
    });
    const result = new Set<number>(explicitlyUnmapped);
    scoreMidi.notes.forEach((n) => {
      if (!mapped.has(n.id)) result.add(n.id);
    });
    return result;
  }, [scoreMidi, alignment]);

  const perfUnmappedIds = useMemo(() => {
    if (!perfMidi || alignment.length === 0) return new Set<number>();
    const mapped = new Set<number>();
    const explicitlyUnmapped = new Set<number>();
    alignment.forEach((p) => {
      if (p.perfId !== -1 && p.scoreId !== -1) mapped.add(p.perfId);
      if (p.perfId !== -1 && p.scoreId === -1) explicitlyUnmapped.add(p.perfId);
    });
    const result = new Set<number>(explicitlyUnmapped);
    perfMidi.notes.forEach((n) => {
      if (!mapped.has(n.id)) result.add(n.id);
    });
    return result;
  }, [perfMidi, alignment]);

  const anchorX = Math.max(1, containerSize.width * PLAYHEAD_ANCHOR_RATIO);

  const scoreNoteById = useMemo(() => {
    return new Map(scoreMidi?.notes.map((note) => [note.id, note]) ?? []);
  }, [scoreMidi]);

  const alignedScoreByPerfId = useMemo(() => {
    const map = new Map<number, MidiNote>();
    alignment.forEach((pair) => {
      if (pair.scoreId === -1 || pair.perfId === -1) return;
      const scoreNote = scoreNoteById.get(pair.scoreId);
      if (scoreNote) map.set(pair.perfId, scoreNote);
    });
    return map;
  }, [alignment, scoreNoteById]);

  const getPlaybackNotes = useCallback(
    (panel: RollPanel) => {
      if (panel === "score") return scoreMidi?.notes ?? [];
      if (!perfMidi) return [];
      if (playbackSoundMode === "native") return perfMidi.notes;

      return perfMidi.notes.flatMap((perfNote) => {
        const scoreNote = alignedScoreByPerfId.get(perfNote.id);
        if (!scoreNote) return [];
        return [{ ...perfNote, pitch: scoreNote.pitch }];
      });
    },
    [alignedScoreByPerfId, perfMidi, playbackSoundMode, scoreMidi],
  );

  const getPreviewNote = useCallback(
    (note: MidiNote, panel: RollPanel) => {
      if (panel !== "perf" || playbackSoundMode === "native") return note;
      const scoreNote = alignedScoreByPerfId.get(note.id);
      return scoreNote ? { ...note, pitch: scoreNote.pitch } : null;
    },
    [alignedScoreByPerfId, playbackSoundMode],
  );

  const focusPanel = useCallback((panel: RollPanel) => {
    setActiveEditPanel(panel);
    setPlayback((prev) =>
      prev.isPlaying ? prev : { ...prev, activePanel: panel },
    );
  }, []);

  const togglePlayback = useCallback(
    (panel: RollPanel) => {
      const currentPlayback = playbackRef.current;
      if (currentPlayback.isPlaying && currentPlayback.activePanel === panel) {
        setPlayback((prev) => ({ ...prev, isPlaying: false }));
        stopMidiPlayback();
      } else {
        const view =
          panel === "score"
            ? scoreViewStateRef.current
            : perfViewStateRef.current;
        // When pressing play, red line jumps to where the dotted white line is at
        const startTimeAtAnchor = view.scrollX + anchorX / view.zoomX;
        setPlayback({
          isPlaying: true,
          startTime: performance.now(),
          startOffset: startTimeAtAnchor,
          activePanel: panel,
        });
        setPlayheadTime(startTimeAtAnchor);
        const notes = getPlaybackNotes(panel);
        if (notes.length > 0) {
          void startMidiPlayback(notes, startTimeAtAnchor);
        }
      }
    },
    [anchorX, getPlaybackNotes],
  );

  const markAlignmentBoundary = useCallback(
    (panel: RollPanel) => {
      const view =
        panel === "score"
          ? scoreViewStateRef.current
          : perfViewStateRef.current;
      const markTime = view.scrollX + anchorX / view.zoomX;

      setAlignmentMarks((prev) => {
        const current = prev[panel];
        const nextPanelMarks =
          current.left === null || current.right !== null
            ? { left: markTime, right: null }
            : {
                left: Math.min(current.left, markTime),
                right: Math.max(current.left, markTime),
              };

        return { ...prev, [panel]: nextPanelMarks };
      });
    },
    [anchorX],
  );

  const undoManualAlignment = useCallback(() => {
    if (manualUndoStack.length === 0) return;
    const previousAlignment = manualUndoStack[manualUndoStack.length - 1];
    setManualUndoStack((undoStack) => undoStack.slice(0, -1));
    setManualRedoStack((redoStack) => [...redoStack, alignment]);
    setAlignment(previousAlignment);
  }, [alignment, manualUndoStack]);

  const redoManualAlignment = useCallback(() => {
    if (manualRedoStack.length === 0) return;
    const nextAlignment = manualRedoStack[manualRedoStack.length - 1];
    setManualRedoStack((redoStack) => redoStack.slice(0, -1));
    setManualUndoStack((undoStack) => [...undoStack, alignment]);
    setAlignment(nextAlignment);
  }, [alignment, manualRedoStack]);

  // Hotkeys
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const isInput =
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement;
      if (isInput) return;

      const isUndoKey =
        (e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z";
      if (isUndoKey) {
        e.preventDefault();
        if (e.shiftKey) {
          redoManualAlignment();
        } else {
          undoManualAlignment();
        }
        return;
      }

      if (e.key.toLowerCase() === "v") {
        setSyncScroll((prev) => !prev);
      }
      if (e.key === " ") {
        e.preventDefault();
        togglePlayback(playbackRef.current.activePanel || activeEditPanel);
      }
      if (e.key.toLowerCase() === "m") {
        e.preventDefault();
        markAlignmentBoundary(activeEditPanel);
      }
      if (e.key === "Delete" || e.key === "Backspace") {
        e.preventDefault();
        setAlignmentMarks((prev) => ({
          ...prev,
          [activeEditPanel]: { left: null, right: null },
        }));
      }

      // MoveID: Keyboard navigation for selected note
      if ((e.key === "ArrowLeft" || e.key === "ArrowRight") && selectedNote) {
        e.preventDefault();
        const midiData = selectedNote.panel === "score" ? scoreMidi : perfMidi;
        if (!midiData) return;

        const currentId = selectedNote.id;
        const newId = e.key === "ArrowRight" ? currentId + 1 : currentId - 1;

        if (newId >= 0 && newId < midiData.notes.length) {
          const nextNote = midiData.notes[newId];
          setSelectedNote({ ...selectedNote, id: newId });

          // MoveID: Auto-scroll to newly selected note
          const viewState =
            selectedNote.panel === "score"
              ? scoreViewStateRef.current
              : perfViewStateRef.current;
          const setViewState =
            selectedNote.panel === "score"
              ? setScoreViewState
              : setPerfViewState;
        }
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [
    togglePlayback,
    markAlignmentBoundary,
    undoManualAlignment,
    redoManualAlignment,
    activeEditPanel,
    selectedNote,
    scoreMidi,
    perfMidi,
  ]);

  // Playback Loop
  useEffect(() => {
    const animate = (time: number) => {
      const currentPlayback = playbackRef.current;
      if (currentPlayback.isPlaying) {
        const elapsed = (time - currentPlayback.startTime) / 1000;
        const currentPos = currentPlayback.startOffset + elapsed;
        setPlayheadTime(currentPos);
        const activeMidi =
          currentPlayback.activePanel === "score" ? scoreMidi : perfMidi;
        if (activeMidi && currentPos > activeMidi.duration + 0.1) {
          setPlayback((prev) => ({ ...prev, isPlaying: false }));
          stopMidiPlayback();
          requestRef.current = requestAnimationFrame(animate);
          return;
        }

        if (currentPlayback.activePanel === "score") {
          setScoreViewState((prev) => ({
            ...prev,
            scrollX: currentPos - anchorX / prev.zoomX,
          }));
          if (syncScroll) {
            const sNote = scoreMidi?.notes.find(
              (n) =>
                n.start <= currentPos && n.start + n.duration >= currentPos,
            );
            if (sNote) {
              const pId = alignment.find((a) => a.scoreId === sNote.id)?.perfId;
              const pNote = perfMidi?.notes.find((n) => n.id === pId);
              if (pNote && pId !== -1)
                setPerfViewState((prev) => ({
                  ...prev,
                  scrollX: pNote.start - anchorX / prev.zoomX,
                }));
            }
          }
        } else if (currentPlayback.activePanel === "perf") {
          setPerfViewState((prev) => ({
            ...prev,
            scrollX: currentPos - anchorX / prev.zoomX,
          }));
          if (syncScroll) {
            const pNote = perfMidi?.notes.find(
              (n) =>
                n.start <= currentPos && n.start + n.duration >= currentPos,
            );
            if (pNote) {
              const sId = alignment.find((a) => a.perfId === pNote.id)?.scoreId;
              const sNote = scoreMidi?.notes.find((n) => n.id === sId);
              if (sNote && sId !== -1)
                setScoreViewState((prev) => ({
                  ...prev,
                  scrollX: sNote.start - anchorX / prev.zoomX,
                }));
            }
          }
        }
      }
      requestRef.current = requestAnimationFrame(animate);
    };
    requestRef.current = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(requestRef.current!);
  }, [syncScroll, scoreMidi, perfMidi, alignment, anchorX]);

  useEffect(() => () => stopMidiPlayback(), []);

  const handleScroll = useCallback(
    (panel: "score" | "perf", deltaX: number, deltaY: number) => {
      const currentPlayback = playbackRef.current;
      const isPlaybackActive = currentPlayback.isPlaying;
      const isThisPanelPlaying =
        isPlaybackActive && currentPlayback.activePanel === panel;

      if (panel === "score") {
        // Allow independent X-scroll on a panel if it's not the playhead driver
        // If sync is on, we allow scrolling if not currently playing
        const dx = isThisPanelPlaying ? 0 : deltaX;
        setScoreViewState((prev) => ({
          ...prev,
          scrollX: prev.scrollX + dx,
          scrollY: prev.scrollY + deltaY,
        }));

        // Only propagate sync scroll if playback is not active
        if (syncScroll && !isPlaybackActive) {
          setPerfViewState((prev) => ({ ...prev, scrollX: prev.scrollX + dx }));
        }
      } else {
        const dx = isThisPanelPlaying ? 0 : deltaX;
        setPerfViewState((prev) => ({
          ...prev,
          scrollX: prev.scrollX + dx,
          scrollY: prev.scrollY + deltaY,
        }));

        if (syncScroll && !isPlaybackActive) {
          setScoreViewState((prev) => ({
            ...prev,
            scrollX: prev.scrollX + dx,
          }));
        }
      }
    },
    [syncScroll],
  );

  const handleZoom = useCallback(
    (
      panel: "score" | "perf",
      type: "X" | "Y",
      factor: number,
      centerCoord: number,
    ) => {
      const updateFn = panel === "score" ? setScoreViewState : setPerfViewState;
      updateFn((prev) => {
        if (type === "X") {
          const newZoomX = Math.max(10, Math.min(5000, prev.zoomX * factor));
          const centerTime = prev.scrollX + centerCoord / prev.zoomX;
          const newScrollX = centerTime - centerCoord / newZoomX;
          return { ...prev, zoomX: newZoomX, scrollX: newScrollX };
        } else {
          const newZoomY = Math.max(2, Math.min(100, prev.zoomY * factor));
          const centerPitch = prev.scrollY + centerCoord / prev.zoomY;
          const newScrollY = centerPitch - centerCoord / newZoomY;
          return { ...prev, zoomY: newZoomY, scrollY: newScrollY };
        }
      });
    },
    [],
  );

  const handleScoreUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const data = await parseMidiFile(file);
    if (data) {
      setScoreMidi(data);
      setAlignment([]); // Clear alignment as IDs will be completely different
      setGtAlignment([]); // Clear alignment as IDs will be completely different
      setSelectedNote(null);
      setAlignmentMarks(emptyMarks());
      setManualUndoStack([]);
      setManualRedoStack([]);
    } else alert("Error: Invalid MIDI file.");
    e.target.value = "";
  };

  const handlePerfUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const data = await parseMidiFile(file);
    if (data) {
      setPerfMidi(data);
      setAlignment([]); // Clear alignment as IDs will be completely different
      setGtAlignment([]); // Clear alignment as IDs will be completely different
      setSelectedNote(null);
      setAlignmentMarks(emptyMarks());
      setManualUndoStack([]);
      setManualRedoStack([]);
    } else alert("Error: Invalid MIDI file.");
    e.target.value = "";
  };

  const clearAll = () => {
    setScoreMidi(null);
    setPerfMidi(null);
    setAlignment([]);
    setGtAlignment([]);
    setSelectedNote(null);
    setAlignmentMarks(emptyMarks());
    setManualUndoStack([]);
    setManualRedoStack([]);
    setDragLink(null);
    setPlayback((p) => ({ ...p, isPlaying: false }));
    stopMidiPlayback();
    if (scoreInputRef.current) scoreInputRef.current.value = "";
    if (perfInputRef.current) perfInputRef.current.value = "";
    if (alignInputRef.current) alignInputRef.current.value = "";
    if (gtInputRef.current) gtInputRef.current.value = "";
  };

  const renderedLines = useMemo(() => {
    if (
      visibility === "none" ||
      !scoreMidi ||
      !perfMidi ||
      !containerRef.current
    )
      return null;
    const panelH = containerSize.height / 2;
    const opacity = visibility === "half" ? 0.3 : 1;
    const lines: React.ReactElement[] = [];

    alignment.forEach((pair, idx) => {
      if (pair.scoreId === -1 || pair.perfId === -1) return;

      const sNote = scoreMidi.notes.find((n) => n.id === pair.scoreId);
      const pNote = perfMidi.notes.find((n) => n.id === pair.perfId);
      if (!sNote || !pNote) return;

      const isSelected =
        selectedNote &&
        ((selectedNote.panel === "score" && selectedNote.id === sNote.id) ||
          (selectedNote.panel === "perf" && selectedNote.id === pNote.id));

      const hasGt = gtAlignment.length > 0;
      const isCorrect =
        hasGt &&
        gtAlignment.some(
          (gt) => gt.scoreId === pair.scoreId && gt.perfId === pair.perfId,
        );

      let color = isCorrect ? "#10b981" : hasGt ? "#facc15" : "#4ade80";
      let strokeWidth = isSelected ? 3 : 1;
      let lineOpacity = isSelected ? 1 : opacity * 0.45;

      const onsetOffset = 0.05;
      const x1 =
        (sNote.start + onsetOffset - scoreViewState.scrollX) *
        scoreViewState.zoomX;
      const y1 =
        panelH -
        (sNote.pitch - scoreViewState.scrollY + 0.5) * scoreViewState.zoomY;
      const x2 =
        (pNote.start + onsetOffset - perfViewState.scrollX) *
        perfViewState.zoomX;
      const y2 =
        panelH +
        (panelH -
          (pNote.pitch - perfViewState.scrollY + 0.5) * perfViewState.zoomY);

      if (x1 < -1000 || x1 > 5000 || x2 < -1000 || x2 > 5000) return;

      lines.push(
        <line
          key={`curr-${idx}`}
          x1={x1}
          y1={y1}
          x2={x2}
          y2={y2}
          stroke={color}
          strokeWidth={strokeWidth}
          strokeOpacity={lineOpacity}
          className="transition-all duration-300 ease-out"
        />,
      );
    });

    if (selectedNote && gtAlignment.length > 0) {
      const pair = gtAlignment.find(
        (gt) =>
          (selectedNote.panel === "score" && gt.scoreId === selectedNote.id) ||
          (selectedNote.panel === "perf" && gt.perfId === selectedNote.id),
      );

      if (pair && pair.scoreId !== -1 && pair.perfId !== -1) {
        const sNote = scoreMidi.notes.find((n) => n.id === pair.scoreId);
        const pNote = perfMidi.notes.find((n) => n.id === pair.perfId);
        const isAlreadyDrawn = alignment.some(
          (a) => a.scoreId === pair.scoreId && a.perfId === pair.perfId,
        );

        if (sNote && pNote && !isAlreadyDrawn) {
          const x1 =
            (sNote.start + 0.05 - scoreViewState.scrollX) *
            scoreViewState.zoomX;
          const y1 =
            panelH -
            (sNote.pitch - scoreViewState.scrollY + 0.5) * scoreViewState.zoomY;
          const x2 =
            (pNote.start + 0.05 - perfViewState.scrollX) * perfViewState.zoomX;
          const y2 =
            panelH +
            (panelH -
              (pNote.pitch - perfViewState.scrollY + 0.5) *
                perfViewState.zoomY);
          lines.push(
            <line
              key={`gt-selected`}
              x1={x1}
              y1={y1}
              x2={x2}
              y2={y2}
              stroke="#ef4444"
              strokeWidth={3}
              strokeOpacity={1}
              strokeDasharray="6,4"
            />,
          );
        }
      }
    }
    return lines;
  }, [
    alignment,
    gtAlignment,
    scoreMidi,
    perfMidi,
    scoreViewState,
    perfViewState,
    containerSize,
    visibility,
    selectedNote,
  ]);

  const handleNoteClick = (n: MidiNote, panel: RollPanel) => {
    focusPanel(panel);
    const previewNote = getPreviewNote(n, panel);
    if (previewNote) {
      void playMidiNotePreview(previewNote);
    }
    setSelectedNote((prev) =>
      prev?.id === n.id && prev?.panel === panel
        ? null
        : { id: n.id, midi: n.pitch, panel },
    );
  };

  const sortedAlignment = (pairs: AlignmentTuple[]) =>
    [...pairs].sort((a, b) => {
      const scoreA = a.scoreId === -1 ? Number.MAX_SAFE_INTEGER : a.scoreId;
      const scoreB = b.scoreId === -1 ? Number.MAX_SAFE_INTEGER : b.scoreId;
      if (scoreA !== scoreB) return scoreA - scoreB;
      return a.perfId - b.perfId;
    });

  const getCompletedMarks = (panel: RollPanel) => {
    const marks = alignmentMarks[panel];
    if (marks.left === null || marks.right === null) return null;
    return {
      left: Math.min(marks.left, marks.right),
      right: Math.max(marks.left, marks.right),
    };
  };

  const getNotesInMarkedRange = (midi: MidiData | null, panel: RollPanel) => {
    const marks = getCompletedMarks(panel);
    if (!midi || !marks) return [];

    return midi.notes
      .filter(
        (note) =>
          note.start + note.duration >= marks.left && note.start <= marks.right,
      )
      .sort((a, b) => {
        if (Math.abs(a.start - b.start) > 0.0001) return a.start - b.start;
        return a.pitch - b.pitch;
      });
  };

  const canRunSegmentAlignment =
    getCompletedMarks("score") !== null &&
    getCompletedMarks("perf") !== null &&
    !!scoreMidi &&
    !!perfMidi;

  const runSegmentAlignment = () => {
    if (!scoreMidi || !perfMidi) return;

    const scoreNotes = getNotesInMarkedRange(scoreMidi, "score");
    const perfNotes = getNotesInMarkedRange(perfMidi, "perf");
    if (scoreNotes.length === 0 && perfNotes.length === 0) return;

    const scoreIds = new Set(scoreNotes.map((note) => note.id));
    const perfIds = new Set(perfNotes.map((note) => note.id));
    const nextPairs = runDP3D1NNRapico(scoreNotes, perfNotes);

    setAlignment((prev) =>
      sortedAlignment([
        ...prev.filter(
          (pair) =>
            (pair.scoreId === -1 || !scoreIds.has(pair.scoreId)) &&
            (pair.perfId === -1 || !perfIds.has(pair.perfId)),
        ),
        ...nextPairs,
      ]),
    );
    setManualUndoStack([]);
    setManualRedoStack([]);
  };

  const commitManualAlignment = (
    fromPanel: RollPanel,
    fromNote: MidiNote,
    targetNote: MidiNote,
  ) => {
    const pair =
      fromPanel === "score"
        ? { scoreId: fromNote.id, annotId: -1, perfId: targetNote.id }
        : { scoreId: targetNote.id, annotId: -1, perfId: fromNote.id };

    setAlignment((prev) => {
      setManualUndoStack((undoStack) => [...undoStack, prev]);
      setManualRedoStack([]);
      return sortedAlignment([
        ...prev.filter(
          (existing) =>
            existing.scoreId !== pair.scoreId &&
            existing.perfId !== pair.perfId,
        ),
        pair,
      ]);
    });
  };

  const findNearestNoteAtPoint = (
    panel: RollPanel,
    clientX: number,
    clientY: number,
  ) => {
    const panelEl =
      panel === "score" ? scorePanelRef.current : perfPanelRef.current;
    const midi = panel === "score" ? scoreMidi : perfMidi;
    const viewState =
      panel === "score" ? scoreViewStateRef.current : perfViewStateRef.current;
    if (!panelEl || !midi || midi.notes.length === 0) return null;

    const rect = panelEl.getBoundingClientRect();
    if (
      clientX < rect.left ||
      clientX > rect.right ||
      clientY < rect.top ||
      clientY > rect.bottom
    ) {
      return null;
    }

    const localX = clientX - rect.left;
    const localY = clientY - rect.top;

    return midi.notes.reduce<MidiNote | null>((closest, note) => {
      const x = (note.start - viewState.scrollX) * viewState.zoomX;
      const y =
        rect.height - (note.pitch - viewState.scrollY + 1) * viewState.zoomY;
      const w = Math.max(4, note.duration * viewState.zoomX);
      const h = Math.max(2, viewState.zoomY - 1);

      const dx =
        localX < x ? x - localX : localX > x + w ? localX - (x + w) : 0;
      const dy =
        localY < y ? y - localY : localY > y + h ? localY - (y + h) : 0;
      const distance = Math.hypot(dx, dy);

      if (!closest) return note;

      const closestX = (closest.start - viewState.scrollX) * viewState.zoomX;
      const closestY =
        rect.height - (closest.pitch - viewState.scrollY + 1) * viewState.zoomY;
      const closestW = Math.max(4, closest.duration * viewState.zoomX);
      const closestH = Math.max(2, viewState.zoomY - 1);
      const closestDx =
        localX < closestX
          ? closestX - localX
          : localX > closestX + closestW
            ? localX - (closestX + closestW)
            : 0;
      const closestDy =
        localY < closestY
          ? closestY - localY
          : localY > closestY + closestH
            ? localY - (closestY + closestH)
            : 0;

      return distance < Math.hypot(closestDx, closestDy) ? note : closest;
    }, null);
  };

  const getOverlayNotePoint = (panel: RollPanel, note: MidiNote) => {
    if (!containerSize.height) return null;
    const panelH = containerSize.height / 2;
    const viewState = panel === "score" ? scoreViewState : perfViewState;
    const x = (note.start + 0.05 - viewState.scrollX) * viewState.zoomX;
    const yWithinPanel =
      panelH - (note.pitch - viewState.scrollY + 0.5) * viewState.zoomY;
    return { x, y: panel === "score" ? yWithinPanel : panelH + yWithinPanel };
  };

  const dragPreviewLine = useMemo(() => {
    if (!dragLink || !containerRef.current) return null;
    const start = getOverlayNotePoint(dragLink.fromPanel, dragLink.note);
    if (!start) return null;
    const rect = containerRef.current.getBoundingClientRect();

    return (
      <line
        x1={start.x}
        y1={start.y}
        x2={dragLink.pointerX - rect.left}
        y2={dragLink.pointerY - rect.top}
        stroke="#38bdf8"
        strokeWidth={2}
        strokeOpacity={0.95}
        strokeDasharray="6,5"
      />
    );
  }, [dragLink, scoreViewState, perfViewState, containerSize]);

  useEffect(() => {
    if (!dragLink) return;

    const handlePointerMove = (event: PointerEvent) => {
      setDragLink((prev) =>
        prev
          ? { ...prev, pointerX: event.clientX, pointerY: event.clientY }
          : null,
      );
    };

    const handlePointerUp = (event: PointerEvent) => {
      setDragLink((prev) => {
        if (!prev) return null;
        const targetPanel: RollPanel =
          prev.fromPanel === "score" ? "perf" : "score";
        const targetNote = findNearestNoteAtPoint(
          targetPanel,
          event.clientX,
          event.clientY,
        );
        if (targetNote) {
          commitManualAlignment(prev.fromPanel, prev.note, targetNote);
          setSelectedNote({
            id: prev.note.id,
            midi: prev.note.pitch,
            panel: prev.fromPanel,
          });
        }
        return null;
      });
    };

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
    };
  }, [dragLink, scoreMidi, perfMidi]);

  const exportAlignment = () => {
    const csv = sortedAlignment(alignment)
      .map((pair) => `${pair.scoreId},${pair.annotId},${pair.perfId}`)
      .join("\n");
    const blob = new Blob([`${csv}\n`], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "edited_alignment.csv";
    link.click();
    URL.revokeObjectURL(url);
  };

  const scoreAnchorTime =
    scoreViewState.scrollX + anchorX / scoreViewState.zoomX;
  const perfAnchorTime = perfViewState.scrollX + anchorX / perfViewState.zoomX;

  return (
    <div className="flex flex-col h-screen w-screen bg-[#09090b] text-zinc-100 overflow-hidden font-sans antialiased select-none">
      <header className="flex items-center justify-between px-6 py-3 bg-[#121214] border-b border-white/[0.04] shrink-0 z-50 shadow-[0_4px_30px_rgba(0,0,0,0.5)]">
        <div className="flex items-center gap-10">
          <div className="flex flex-col">
            <h1 className="text-[14px] font-black tracking-[0.25em] flex items-center gap-2.5 text-emerald-400">
              <Settings2 className="w-4 h-4 text-emerald-500" /> MIDI ALIGN{" "}
              <span className="text-zinc-500 font-bold opacity-60"></span>
            </h1>
            <span className="text-[9px] text-zinc-600 font-bold uppercase tracking-[0.4em] leading-none mt-1">
              Interactive Visualizer
            </span>
          </div>

          <div className="flex items-center gap-3 bg-[#1c1c1f] p-1.5 rounded-xl border border-white/[0.04] shadow-inner">
            <div className="flex gap-2 px-2.5 border-r border-white/5">
              <input
                ref={scoreInputRef}
                id="s-up"
                type="file"
                onChange={handleScoreUpload}
                className="hidden"
              />
              <label htmlFor="s-up" className="btn-modern group">
                <Upload className="w-4 h-4 text-emerald-500/60 group-hover:text-emerald-400 transition-colors" />
                <span>Score</span>
              </label>

              <input
                ref={perfInputRef}
                id="p-up"
                type="file"
                onChange={handlePerfUpload}
                className="hidden"
              />
              <label htmlFor="p-up" className="btn-modern group">
                <Upload className="w-4 h-4 text-emerald-500/60 group-hover:text-emerald-400 transition-colors" />
                <span>Perf</span>
              </label>
            </div>

            <div className="flex gap-2 px-1.5">
              <input
                ref={alignInputRef}
                id="a-up"
                type="file"
                onChange={async (e) => {
                  if (e.target.files?.[0]) {
                    const data = await parseAlignmentCsv(e.target.files[0]);
                    setAlignment(data);
                    setManualUndoStack([]);
                    setManualRedoStack([]);
                  }
                  e.target.value = "";
                }}
                className="hidden"
              />
              <label
                htmlFor="a-up"
                className="btn-modern group !border-blue-500/20 hover:!border-blue-500/40 hover:bg-blue-500/5"
              >
                <Target className="w-4 h-4 text-blue-400/70 group-hover:text-blue-400 transition-colors" />
                <span className="text-blue-100/60">Align Map</span>
              </label>

              <input
                ref={gtInputRef}
                id="gt-up"
                type="file"
                onChange={async (e) => {
                  if (e.target.files?.[0]) {
                    const data = await parseAlignmentCsv(e.target.files[0]);
                    setGtAlignment(data);
                  }
                  e.target.value = "";
                }}
                className="hidden"
              />
              <label
                htmlFor="gt-up"
                className="btn-modern group !border-purple-500/20 hover:!border-purple-500/40 hover:bg-purple-500/5"
              >
                <CheckCircle2 className="w-4 h-4 text-purple-400/70 group-hover:text-purple-400 transition-colors" />
                <span className="text-purple-100/60">GT Reference</span>
              </label>
            </div>
          </div>

          <div className="flex items-center gap-2 bg-[#1c1c1f] p-1.5 rounded-xl border border-white/[0.04] shadow-inner">
            <button
              onClick={runSegmentAlignment}
              disabled={!canRunSegmentAlignment}
              className={`btn-modern group ${
                canRunSegmentAlignment
                  ? "!border-red-500/25 hover:!border-red-500/50 hover:bg-red-500/5"
                  : "opacity-40 cursor-not-allowed"
              }`}
            >
              <Wand2 className="w-4 h-4 text-red-400/70 group-hover:text-red-300 transition-colors" />
              <span>DTW Segment</span>
            </button>
            <button
              onClick={exportAlignment}
              disabled={alignment.length === 0}
              className={`btn-modern group ${
                alignment.length > 0
                  ? "!border-emerald-500/20 hover:!border-emerald-500/40 hover:bg-emerald-500/5"
                  : "opacity-40 cursor-not-allowed"
              }`}
            >
              <Download className="w-4 h-4 text-emerald-400/70 group-hover:text-emerald-300 transition-colors" />
              <span>Export</span>
            </button>
          </div>
        </div>

        <div className="flex items-center gap-4">
          <button
            onClick={() =>
              setPlaybackSoundMode((prev) =>
                prev === "native" ? "aligned-score" : "native",
              )
            }
            className={`flex items-center gap-2 h-10 px-3 rounded-xl font-black text-[10px] tracking-wider border transition-all active:scale-[0.98] shadow-2xl whitespace-nowrap ${
              playbackSoundMode === "aligned-score"
                ? "bg-cyan-500/10 border-cyan-500/40 text-cyan-300 ring-1 ring-cyan-500/20"
                : "bg-[#1c1c1f] border-white/5 text-zinc-500 hover:border-white/10"
            }`}
          >
            <GitCompareArrows className="w-4 h-4" />
            <span>PERF SOUND</span>
            <span
              className={`relative block h-5 w-10 shrink-0 overflow-hidden rounded-full border transition-colors ${
                playbackSoundMode === "aligned-score"
                  ? "bg-cyan-400/20 border-cyan-400/40"
                  : "bg-black/30 border-white/10"
              }`}
            >
              <span
                className={`absolute left-0 top-0.5 block h-3.5 w-3.5 rounded-full transition-transform ${
                  playbackSoundMode === "aligned-score"
                    ? "translate-x-[21px] bg-cyan-300"
                    : "translate-x-0.5 bg-zinc-500"
                }`}
              />
            </span>
            <span className="text-[8px] opacity-60">
              {playbackSoundMode === "aligned-score" ? "ALIGNED" : "NATIVE"}
            </span>
          </button>

          <div className="flex bg-[#1c1c1f] rounded-xl p-1 border border-white/[0.04] shadow-inner">
            <button
              onClick={() => setVisibility("full")}
              className={`p-2 rounded-lg transition-all ${
                visibility === "full"
                  ? "bg-zinc-700 text-white shadow-xl ring-1 ring-white/10"
                  : "text-zinc-500 hover:text-zinc-300"
              }`}
            >
              <Eye className="w-4 h-4" />
            </button>
            <button
              onClick={() => setVisibility("half")}
              className={`px-2.5 rounded-lg transition-all flex items-center justify-center ${
                visibility === "half"
                  ? "bg-zinc-700 text-white shadow-xl ring-1 ring-white/10"
                  : "text-zinc-500 hover:text-zinc-300"
              }`}
            >
              <span className="text-[10px] font-black leading-none">50%</span>
            </button>
            <button
              onClick={() => setVisibility("none")}
              className={`p-2 rounded-lg transition-all ${
                visibility === "none"
                  ? "bg-zinc-700 text-white shadow-xl ring-1 ring-white/10"
                  : "text-zinc-500 hover:text-zinc-300"
              }`}
            >
              <EyeOff className="w-4 h-4" />
            </button>
          </div>

          <button
            onClick={() => setSyncScroll(!syncScroll)}
            className={`flex items-center gap-3 h-10 px-5 rounded-xl font-black text-[11px] tracking-wider border transition-all active:scale-[0.98] shadow-2xl ${
              syncScroll
                ? "bg-blue-500/10 border-blue-500/40 text-blue-400 ring-1 ring-blue-500/20"
                : "bg-[#1c1c1f] border-white/5 text-zinc-500 hover:border-white/10"
            }`}
          >
            <MousePointer2
              className={`w-4 h-4 ${syncScroll ? "animate-pulse" : ""}`}
            />
            SYNC{" "}
            <span className="text-[9px] opacity-40 font-mono ml-1">[V]</span>
          </button>

          <button
            onClick={clearAll}
            className="flex items-center justify-center w-10 h-10 bg-red-500/5 border border-red-500/10 text-red-400/50 hover:text-red-400 hover:bg-red-500/10 hover:border-red-500/40 rounded-xl transition-all active:scale-90"
          >
            <Trash2 className="w-4 h-4" />
          </button>
        </div>
      </header>

      <main className="flex-1 flex flex-col min-h-0 relative bg-black">
        <div
          ref={containerRef}
          className="flex-1 flex flex-col min-h-0 relative"
        >
          <svg className="absolute inset-0 w-full h-full pointer-events-none z-30 drop-shadow-[0_0_10px_rgba(0,0,0,0.8)]">
            {renderedLines}
            {dragPreviewLine}
          </svg>

          <div
            ref={scorePanelRef}
            className="flex-1 relative group border-b border-white/[0.04]"
          >
            <PianoRoll
              label="SCORE"
              data={scoreMidi}
              unmappedNoteIds={scoreUnmappedIds}
              viewState={scoreViewState}
              playheadTime={
                playback.activePanel === "score" ? playheadTime : null
              }
              anchorX={anchorX}
              rangeMarks={alignmentMarks.score}
              selectedNoteId={
                selectedNote?.panel === "score" ? selectedNote.id : null
              }
              onNoteClick={(n) => handleNoteClick(n, "score")}
              onBlankClick={() => {
                focusPanel("score");
                setSelectedNote(null);
              }}
              onScroll={(dx, dy) => handleScroll("score", dx, dy)}
              onZoom={(type, factor, center) =>
                handleZoom("score", type, factor, center)
              }
              onPanelFocus={() => focusPanel("score")}
              onNoteDragStart={(note, clientX, clientY) =>
                setDragLink({
                  fromPanel: "score",
                  note,
                  pointerX: clientX,
                  pointerY: clientY,
                })
              }
            />
            <div className="absolute right-8 top-8 flex items-center gap-2.5 z-40 opacity-0 group-hover:opacity-100 transition-all translate-y-2 group-hover:translate-y-0">
              <div className="flex bg-[#121214]/98 border border-white/10 rounded-2xl p-1.5 backdrop-blur-3xl shadow-[0_20px_50px_rgba(0,0,0,0.7)] ring-1 ring-white/10">
                <button
                  onClick={() => togglePlayback("score")}
                  className={`p-2.5 rounded-xl transition-all ${
                    playback.isPlaying && playback.activePanel === "score"
                      ? "text-red-400 bg-red-400/10"
                      : "hover:text-emerald-400 bg-white/5"
                  }`}
                >
                  {playback.isPlaying && playback.activePanel === "score" ? (
                    <Pause className="w-5 h-5" />
                  ) : (
                    <Play className="w-5 h-5 fill-current" />
                  )}
                </button>
                <div className="w-px bg-white/10 mx-2" />
                <button
                  onClick={() =>
                    handleZoom(
                      "score",
                      "X",
                      1.2,
                      containerRef.current!.clientWidth / 2,
                    )
                  }
                  className="p-2 hover:bg-white/10 rounded-xl"
                >
                  <ZoomIn className="w-4 h-4" />
                </button>
                <button
                  onClick={() =>
                    handleZoom(
                      "score",
                      "X",
                      1 / 1.2,
                      containerRef.current!.clientWidth / 2,
                    )
                  }
                  className="p-2 hover:bg-white/10 rounded-xl"
                >
                  <ZoomOut className="w-4 h-4" />
                </button>
              </div>
            </div>
          </div>

          <div className="h-0 relative z-40 flex items-center justify-center">
            <div className="absolute inset-x-0 top-1/2 h-px bg-white opacity-40" />
            <div className="absolute -top-4 bg-[#121214] px-6 py-2 rounded-full border border-white/10 text-[9px] font-black text-zinc-500 tracking-[0.5em] shadow-[0_0_30px_rgba(0,0,0,1)] uppercase select-none">
              Cross Comparison
            </div>
          </div>

          <div ref={perfPanelRef} className="flex-1 relative group">
            <PianoRoll
              label="PERFORMANCE"
              data={perfMidi}
              unmappedNoteIds={perfUnmappedIds}
              viewState={perfViewState}
              playheadTime={
                playback.activePanel === "perf" ? playheadTime : null
              }
              anchorX={anchorX}
              rangeMarks={alignmentMarks.perf}
              selectedNoteId={
                selectedNote?.panel === "perf" ? selectedNote.id : null
              }
              onNoteClick={(n) => handleNoteClick(n, "perf")}
              onBlankClick={() => {
                focusPanel("perf");
                setSelectedNote(null);
              }}
              onScroll={(dx, dy) => handleScroll("perf", dx, dy)}
              onZoom={(type, factor, center) =>
                handleZoom("perf", type, factor, center)
              }
              onPanelFocus={() => focusPanel("perf")}
              onNoteDragStart={(note, clientX, clientY) =>
                setDragLink({
                  fromPanel: "perf",
                  note,
                  pointerX: clientX,
                  pointerY: clientY,
                })
              }
            />
            <div className="absolute right-8 bottom-8 flex items-center gap-2.5 z-40 opacity-0 group-hover:opacity-100 transition-all -translate-y-2 group-hover:translate-y-0">
              <div className="flex bg-[#121214]/98 border border-white/10 rounded-2xl p-1.5 backdrop-blur-3xl shadow-[0_20px_50px_rgba(0,0,0,0.7)] ring-1 ring-white/10">
                <button
                  onClick={() => togglePlayback("perf")}
                  className={`p-2.5 rounded-xl transition-all ${
                    playback.isPlaying && playback.activePanel === "perf"
                      ? "text-red-400 bg-red-400/10"
                      : "hover:text-emerald-400 bg-white/5"
                  }`}
                >
                  {playback.isPlaying && playback.activePanel === "perf" ? (
                    <Pause className="w-5 h-5" />
                  ) : (
                    <Play className="w-5 h-5 fill-current" />
                  )}
                </button>
                <div className="w-px bg-white/10 mx-2" />
                <button
                  onClick={() =>
                    handleZoom(
                      "perf",
                      "X",
                      1.2,
                      containerRef.current!.clientWidth / 2,
                    )
                  }
                  className="p-2 hover:bg-white/10 rounded-xl"
                >
                  <ZoomIn className="w-4 h-4" />
                </button>
                <button
                  onClick={() =>
                    handleZoom(
                      "perf",
                      "X",
                      1 / 1.2,
                      containerRef.current!.clientWidth / 2,
                    )
                  }
                  className="p-2 hover:bg-white/10 rounded-xl"
                >
                  <ZoomOut className="w-4 h-4" />
                </button>
              </div>
            </div>
          </div>
        </div>
      </main>

      <footer className="h-12 bg-[#0c0c0e] border-t border-white/[0.05] flex items-center justify-between px-8 text-[10px] text-zinc-500 uppercase font-black tracking-widest shrink-0 shadow-[0_-10px_30px_rgba(0,0,0,0.5)] z-50">
        <div className="flex gap-8 items-center">
          <div className="flex items-center gap-3 bg-white/[0.04] px-4 py-2 rounded-lg border border-white/5 font-mono shadow-inner group">
            <Clock className="w-3.5 h-3.5 text-emerald-500/80" />
            <div className="flex gap-6 items-center border-l border-white/10 pl-4">
              <span className="flex items-center gap-2">
                <span className="text-[8px] text-zinc-600 opacity-80 tracking-normal">
                  SCORE:
                </span>
                <span className="text-emerald-400 tracking-normal tabular-nums">
                  {scoreAnchorTime.toFixed(4)}s
                </span>
              </span>
              <span className="flex items-center gap-2">
                <span className="text-[8px] text-zinc-600 opacity-80 tracking-normal">
                  PERF:
                </span>
                <span className="text-blue-400 tracking-normal tabular-nums">
                  {perfAnchorTime.toFixed(4)}s
                </span>
              </span>
            </div>
          </div>
          {selectedNote && (
            <div className="flex items-center gap-3 bg-emerald-500/10 px-4 py-2 rounded-lg border border-emerald-500/30 shadow-lg text-[10px] text-emerald-400">
              <span className="flex items-center gap-2 border-r border-emerald-500/20 pr-3">
                <div className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                {selectedNote.panel === "score" ? "SCORE" : "PERF"} Note
              </span>
              <span className="text-zinc-100 flex items-center gap-3 tabular-nums font-mono">
                <ChevronLeft className="w-3 h-3 text-emerald-500/40" />
                ID-{selectedNote.id}, MIDI-{selectedNote.midi}
                <ChevronRight className="w-3 h-3 text-emerald-500/40" />
              </span>
              {(selectedNote.panel === "score"
                ? scoreUnmappedIds.has(selectedNote.id)
                : perfUnmappedIds.has(selectedNote.id)) && (
                <span className="ml-2 flex items-center gap-1.5 px-2 py-0.5 bg-red-500/20 text-red-400 rounded-md border border-red-500/30 text-[8px] font-black uppercase">
                  <AlertCircle className="w-3 h-3" /> UNMAPPED
                </span>
              )}
            </div>
          )}
        </div>
        <div className="flex gap-10 items-center">
          <span className="flex items-center gap-3 text-zinc-600 opacity-80">
            <Info className="w-4 h-4 text-emerald-500/50" />{" "}
            <span className="text-zinc-500">
              scroll + ALT: Pitch Zoom, scroll + CMD: Time Zoom,
              <br></br>
              M: Mark {activeEditPanel.toUpperCase()}, DEL: Clear Mark, V: Sync
            </span>
          </span>
          <div className="h-5 w-px bg-white/10" />
          <span
            className={`transition-all px-4 py-1.5 rounded-lg text-[9px] border ${
              gtAlignment.length > 0
                ? "text-purple-300 bg-purple-500/10 border-purple-500/30 shadow-[0_0_20px_rgba(168,85,247,0.1)]"
                : "text-zinc-700 border-white/5 bg-white/2 opacity-50"
            }`}
          >
            GT REF: {gtAlignment.length > 0 ? "ACTIVE" : "IDLE"}
          </span>
        </div>
      </footer>

      <style>{`
        .btn-modern { 
          @apply flex items-center gap-3 px-4 py-2 bg-[#121214] hover:bg-zinc-800 rounded-xl text-[10px] font-black tracking-widest cursor-pointer border border-white/[0.05] transition-all active:scale-[0.95] shadow-lg text-zinc-400 hover:text-zinc-100;
        }
      `}</style>
    </div>
  );
};

export default App;
