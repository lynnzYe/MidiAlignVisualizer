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
} from "./types";
import { parseMidiFile, parseAlignmentCsv } from "./services/midiService";
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
} from "lucide-react";
// TODO: check alignment seems to be of wrong order. Id assignment
const PLAYHEAD_ANCHOR_X = 100; // Pixels from left edge where playback starts

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
  const [selectedNote, setSelectedNote] = useState<{
    id: number;
    midi: number;
    panel: "score" | "perf";
  } | null>(null);
  const [visibility, setVisibility] = useState<AlignmentVisibility>("full");
  const [syncScroll, setSyncScroll] = useState(false);

  const [playback, setPlayback] = useState<PlaybackState>({
    isPlaying: false,
    startTime: 0,
    startOffset: 0,
    activePanel: null,
  });
  const [playheadTime, setPlayheadTime] = useState(0);

  const containerRef = useRef<HTMLDivElement>(null);
  const requestRef = useRef<number>(null);

  const scoreInputRef = useRef<HTMLInputElement>(null);
  const perfInputRef = useRef<HTMLInputElement>(null);
  const alignInputRef = useRef<HTMLInputElement>(null);
  const gtInputRef = useRef<HTMLInputElement>(null);

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

  // Hotkeys
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const isInput =
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement;
      if (isInput) return;

      if (e.key.toLowerCase() === "v") {
        setSyncScroll((prev) => !prev);
      }
      if (e.key === " ") {
        e.preventDefault();
        togglePlayback(playback.activePanel || "score");
      }
      // MoveID: Keyboard navigation for selected note
      if ((e.key === "ArrowLeft" || e.key === "ArrowRight") && selectedNote) {
        e.preventDefault();
        const midiData = selectedNote.panel === "score" ? scoreMidi : perfMidi;
        if (!midiData) return;

        const currentId = selectedNote.id;
        const newId = e.key === "ArrowRight" ? currentId + 1 : currentId - 1;
        const newPitch = midiData.notes[newId].pitch;

        if (newId >= 0 && newId < midiData.notes.length) {
          setSelectedNote({ ...selectedNote, id: newId, midi: newPitch });
        }
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [
    playback.activePanel,
    playback.isPlaying,
    selectedNote,
    scoreMidi,
    perfMidi,
  ]);

  // Playback Loop
  useEffect(() => {
    const animate = (time: number) => {
      if (playback.isPlaying) {
        const elapsed = (time - playback.startTime) / 1000;
        const currentPos = playback.startOffset + elapsed;
        setPlayheadTime(currentPos);

        if (playback.activePanel === "score") {
          setScoreViewState((prev) => ({
            ...prev,
            scrollX: currentPos - PLAYHEAD_ANCHOR_X / prev.zoomX,
          }));
          if (syncScroll) {
            const sNote = scoreMidi?.notes.find(
              (n) => n.start <= currentPos && n.start + n.duration >= currentPos
            );
            if (sNote) {
              const pId = alignment.find((a) => a.scoreId === sNote.id)?.perfId;
              const pNote = perfMidi?.notes.find((n) => n.id === pId);
              if (pNote && pId !== -1)
                setPerfViewState((prev) => ({
                  ...prev,
                  scrollX: pNote.start - PLAYHEAD_ANCHOR_X / prev.zoomX,
                }));
            }
          }
        } else if (playback.activePanel === "perf") {
          setPerfViewState((prev) => ({
            ...prev,
            scrollX: currentPos - PLAYHEAD_ANCHOR_X / prev.zoomX,
          }));
          if (syncScroll) {
            const pNote = perfMidi?.notes.find(
              (n) => n.start <= currentPos && n.start + n.duration >= currentPos
            );
            if (pNote) {
              const sId = alignment.find((a) => a.perfId === pNote.id)?.scoreId;
              const sNote = scoreMidi?.notes.find((n) => n.id === sId);
              if (sNote && sId !== -1)
                setScoreViewState((prev) => ({
                  ...prev,
                  scrollX: sNote.start - PLAYHEAD_ANCHOR_X / prev.zoomX,
                }));
            }
          }
        }
      }
      requestRef.current = requestAnimationFrame(animate);
    };
    requestRef.current = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(requestRef.current!);
  }, [playback, syncScroll, scoreMidi, perfMidi, alignment]);

  const togglePlayback = (panel: "score" | "perf") => {
    if (playback.isPlaying && playback.activePanel === panel) {
      setPlayback((prev) => ({ ...prev, isPlaying: false }));
    } else {
      const currentView = panel === "score" ? scoreViewState : perfViewState;
      const startTimeAtAnchor =
        currentView.scrollX + PLAYHEAD_ANCHOR_X / currentView.zoomX;
      setPlayback({
        isPlaying: true,
        startTime: performance.now(),
        startOffset: startTimeAtAnchor,
        activePanel: panel,
      });
      setPlayheadTime(startTimeAtAnchor);
    }
  };

  const handleScroll = useCallback(
    (panel: "score" | "perf", deltaX: number, deltaY: number) => {
      const isPlaybackActive = playback.isPlaying;
      const isThisPanelPlaying =
        isPlaybackActive && playback.activePanel === panel;

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
    [syncScroll, playback]
  );

  const handleZoom = useCallback(
    (
      panel: "score" | "perf",
      type: "X" | "Y",
      factor: number,
      centerCoord: number
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
    []
  );

  const handleScoreUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const data = await parseMidiFile(file);
    if (data) setScoreMidi(data);
    else alert("Error: Invalid MIDI file.");
  };

  const handlePerfUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const data = await parseMidiFile(file);
    if (data) setPerfMidi(data);
    else alert("Error: Invalid MIDI file.");
  };

  const clearAll = () => {
    setScoreMidi(null);
    setPerfMidi(null);
    setAlignment([]);
    setGtAlignment([]);
    setSelectedNote(null);
    setPlayback((p) => ({ ...p, isPlaying: false }));
    if (scoreInputRef.current) scoreInputRef.current.value = "";
    if (perfInputRef.current) perfInputRef.current.value = "";
    if (alignInputRef.current) alignInputRef.current.value = "";
    if (gtInputRef.current) gtInputRef.current.value = "";
  };

  const renderLines = () => {
    if (
      visibility === "none" ||
      !scoreMidi ||
      !perfMidi ||
      !containerRef.current
    )
      return null;
    const panelH = containerRef.current.clientHeight / 2;
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
          (gt) => gt.scoreId === pair.scoreId && gt.perfId === pair.perfId
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
        />
      );
    });

    if (selectedNote && gtAlignment.length > 0) {
      const pair = gtAlignment.find(
        (gt) =>
          (selectedNote.panel === "score" && gt.scoreId === selectedNote.id) ||
          (selectedNote.panel === "perf" && gt.perfId === selectedNote.id)
      );

      if (pair && pair.scoreId !== -1 && pair.perfId !== -1) {
        const sNote = scoreMidi.notes.find((n) => n.id === pair.scoreId);
        const pNote = perfMidi.notes.find((n) => n.id === pair.perfId);
        const isAlreadyDrawn = alignment.some(
          (a) => a.scoreId === pair.scoreId && a.perfId === pair.perfId
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
            />
          );
        }
      }
    }
    return lines;
  };

  const handleNoteClick = (n: MidiNote, panel: "score" | "perf") => {
    setSelectedNote((prev) =>
      prev?.id === n.id && prev?.panel === panel
        ? null
        : { id: n.id, midi: n.pitch, panel }
    );
  };

  const scoreAnchorTime =
    scoreViewState.scrollX + PLAYHEAD_ANCHOR_X / scoreViewState.zoomX;
  const perfAnchorTime =
    perfViewState.scrollX + PLAYHEAD_ANCHOR_X / perfViewState.zoomX;

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
                  if (e.target.files?.[0])
                    setAlignment(await parseAlignmentCsv(e.target.files[0]));
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
                  if (e.target.files?.[0])
                    setGtAlignment(await parseAlignmentCsv(e.target.files[0]));
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
        </div>

        <div className="flex items-center gap-4">
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
            {renderLines()}
          </svg>

          <div className="flex-1 relative group border-b border-white/[0.04]">
            <PianoRoll
              label="SCORE"
              data={scoreMidi}
              unmappedNoteIds={scoreUnmappedIds}
              viewState={scoreViewState}
              playheadTime={
                playback.activePanel === "score" ? playheadTime : null
              }
              anchorX={PLAYHEAD_ANCHOR_X}
              selectedNoteId={
                selectedNote?.panel === "score" ? selectedNote.id : null
              }
              onNoteClick={(n) => handleNoteClick(n, "score")}
              onBlankClick={() => setSelectedNote(null)}
              onScroll={(dx, dy) => handleScroll("score", dx, dy)}
              onZoom={(type, factor, center) =>
                handleZoom("score", type, factor, center)
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
                      containerRef.current!.clientWidth / 2
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
                      containerRef.current!.clientWidth / 2
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

          <div className="flex-1 relative group">
            <PianoRoll
              label="PERFORMANCE"
              data={perfMidi}
              unmappedNoteIds={perfUnmappedIds}
              viewState={perfViewState}
              playheadTime={
                playback.activePanel === "perf" ? playheadTime : null
              }
              anchorX={PLAYHEAD_ANCHOR_X}
              selectedNoteId={
                selectedNote?.panel === "perf" ? selectedNote.id : null
              }
              onNoteClick={(n) => handleNoteClick(n, "perf")}
              onBlankClick={() => setSelectedNote(null)}
              onScroll={(dx, dy) => handleScroll("perf", dx, dy)}
              onZoom={(type, factor, center) =>
                handleZoom("perf", type, factor, center)
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
                      containerRef.current!.clientWidth / 2
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
                      containerRef.current!.clientWidth / 2
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
              <span className="text-zinc-100 flex items-center gap-3 tabular-nums font-mono"></span>
              {(selectedNote.panel === "score"
                ? scoreUnmappedIds.has(selectedNote.id) && <></>
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
              V: Sync, left/right: next ID
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
