import React, { useRef, useEffect, useCallback } from "react";
import { AlignmentRangeMarks, MidiData, ViewState, MidiNote } from "../types";

interface PianoRollProps {
  data: MidiData | null;
  unmappedNoteIds?: Set<number>;
  viewState: ViewState;
  selectedNoteId: number | null;
  playheadTime: number | null;
  anchorX: number;
  rangeMarks: AlignmentRangeMarks;
  onNoteClick: (note: MidiNote) => void;
  onBlankClick: () => void;
  onScroll: (deltaX: number, deltaY: number) => void;
  onZoom: (type: "X" | "Y", factor: number, centerCoord: number) => void;
  onPanelFocus: () => void;
  onNoteDragStart: (note: MidiNote, clientX: number, clientY: number) => void;
  label: string;
}

const PianoRoll: React.FC<PianoRollProps> = ({
  data,
  unmappedNoteIds,
  viewState,
  selectedNoteId,
  playheadTime,
  anchorX,
  rangeMarks,
  onNoteClick,
  onBlankClick,
  onScroll,
  onZoom,
  onPanelFocus,
  onNoteDragStart,
  label,
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const NOTES_IN_OCTAVE = 12;
  const BLACK_KEYS = [1, 3, 6, 8, 10];
  const C_MAJOR_NOTES = [0, 2, 4, 5, 7, 9, 11];

  const isSharp = (pitch: number) =>
    BLACK_KEYS.includes(pitch % NOTES_IN_OCTAVE);
  const isCMajorNote = (pitch: number) =>
    C_MAJOR_NOTES.includes(pitch % NOTES_IN_OCTAVE);

  const getNoteAtCanvasPoint = useCallback(
    (x: number, y: number) => {
      if (!data || !canvasRef.current) return null;

      const time = x / viewState.zoomX + viewState.scrollX;
      const pitch =
        viewState.scrollY +
        (canvasRef.current.height - y) / viewState.zoomY;

      return (
        data.notes.find(
          (note) =>
            time >= note.start &&
            time <= note.start + note.duration &&
            Math.floor(pitch) === note.pitch,
        ) ?? null
      );
    },
    [data, viewState],
  );

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const { width, height } = canvas;
    const { zoomX, zoomY, scrollX, scrollY } = viewState;

    ctx.clearRect(0, 0, width, height);

    // 1. Draw Background Grid
    const startMidi = Math.floor(scrollY);
    const endMidi = Math.ceil(scrollY + height / zoomY);

    for (let pitch = startMidi; pitch <= endMidi; pitch++) {
      const y = height - (pitch - scrollY + 1) * zoomY;
      ctx.fillStyle = isCMajorNote(pitch) ? "#101014" : "#050507";
      ctx.fillRect(0, y, width, zoomY);

      ctx.strokeStyle = isCMajorNote(pitch)
        ? "rgba(255,255,255,0.075)"
        : "rgba(255,255,255,0.025)";
      ctx.lineWidth = 0.5;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(width, y);
      ctx.stroke();

      if (pitch % 12 === 0) {
        ctx.strokeStyle = "rgba(255,255,255,0.22)";
        ctx.lineWidth = 1.25;
        ctx.beginPath();
        ctx.moveTo(0, y + zoomY);
        ctx.lineTo(width, y + zoomY);
        ctx.stroke();
      }
    }

    // Vertical grid (beats and bars, assuming quarter-note beat timing).
    const beatStep = 0.25;
    const startTime = Math.floor(scrollX / beatStep) * beatStep;
    const endTime = scrollX + width / zoomX;
    for (let t = startTime; t <= endTime + beatStep; t += beatStep) {
      const x = (t - scrollX) * zoomX;
      const beatIndex = Math.round(t / beatStep);
      const isBar = beatIndex % 16 === 0;
      const isBeat = beatIndex % 4 === 0;
      ctx.strokeStyle = isBar
        ? "rgba(255,255,255,0.34)"
        : isBeat
        ? "rgba(255,255,255,0.16)"
        : "rgba(255,255,255,0.055)";
      ctx.lineWidth = isBar ? 1.35 : isBeat ? 0.9 : 0.5;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, height);
      ctx.stroke();
    }

    // Static Anchor Line (Apparent white line)
    ctx.setLineDash([5, 5]);
    ctx.strokeStyle = "rgba(255, 255, 255, 0.55)"; // More apparent, less opaque
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(anchorX, 0);
    ctx.lineTo(anchorX, height);
    ctx.stroke();
    ctx.setLineDash([]);

    // Alignment segment marks
    const sortedMarks = [rangeMarks.left, rangeMarks.right]
      .filter((mark): mark is number => mark !== null)
      .sort((a, b) => a - b);
    if (sortedMarks.length === 2) {
      const x1 = (sortedMarks[0] - scrollX) * zoomX;
      const x2 = (sortedMarks[1] - scrollX) * zoomX;
      ctx.fillStyle = "rgba(239, 68, 68, 0.08)";
      ctx.fillRect(Math.min(x1, x2), 0, Math.abs(x2 - x1), height);
    }

    sortedMarks.forEach((mark, index) => {
      const x = (mark - scrollX) * zoomX;
      if (x < -20 || x > width + 20) return;

      ctx.setLineDash([4, 5]);
      ctx.strokeStyle = "rgba(248, 113, 113, 0.95)";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, height);
      ctx.stroke();
      ctx.setLineDash([]);

      ctx.fillStyle = "rgba(127, 29, 29, 0.85)";
      ctx.fillRect(x + 5, 8, 16, 16);
      ctx.fillStyle = "#fecaca";
      ctx.font = 'bold 9px "JetBrains Mono", monospace';
      ctx.fillText(index === 0 ? "L" : "R", x + 10, 20);
    });

    // 2. Draw Notes
    if (data) {
      data.notes.forEach((note) => {
        const x = (note.start - scrollX) * zoomX;
        const w = note.duration * zoomX;
        const y = height - (note.pitch - scrollY + 1) * zoomY;
        const h = zoomY - 1;

        if (x + w < 0 || x > width) return;

        const isSelected = selectedNoteId === note.id;
        const isUnmapped = unmappedNoteIds?.has(note.id);

        const gradient = ctx.createLinearGradient(x, y, x, y + h);
        if (isUnmapped) {
          gradient.addColorStop(0, isSelected ? "#ef4444" : "#71717a");
          gradient.addColorStop(1, isSelected ? "#991b1b" : "#3f3f46");
        } else {
          gradient.addColorStop(0, isSelected ? "#60a5fa" : "#34d399");
          gradient.addColorStop(1, isSelected ? "#2563eb" : "#059669");
        }

        ctx.fillStyle = gradient;
        ctx.strokeStyle = isUnmapped
          ? "#ef4444"
          : isSelected
          ? "#ffffff"
          : "#059669";
        ctx.lineWidth = isSelected ? 2.5 : isUnmapped ? 1.5 : 0.5;

        ctx.beginPath();
        ctx.roundRect(x, y, Math.max(4, w), h, 3);
        ctx.fill();
        ctx.stroke();

        // Optional Flag/Highlight for unmapped notes
        if (isUnmapped) {
          ctx.fillStyle = "#ef4444";
          ctx.beginPath();
          ctx.arc(x + 2, y + 2, 2.5, 0, Math.PI * 2);
          ctx.fill();
        }

        if (isSelected || zoomY > 20) {
          ctx.fillStyle = isSelected ? "white" : "rgba(255,255,255,0.7)";
          ctx.font = 'bold 10px "JetBrains Mono", monospace';
          ctx.fillText(`${note.id}`, x + (isUnmapped ? 8 : 5), y + 12);
        }
      });
    }

    // 3. Moving Playhead
    if (playheadTime !== null) {
      const px = (playheadTime - scrollX) * zoomX;
      if (px >= 0 && px <= width) {
        ctx.strokeStyle = "#f87171";
        ctx.lineWidth = 2.5;
        ctx.shadowBlur = 10;
        ctx.shadowColor = "rgba(248, 113, 113, 0.9)";
        ctx.beginPath();
        ctx.moveTo(px, 0);
        ctx.lineTo(px, height);
        ctx.stroke();
        ctx.shadowBlur = 0;
      }
    }
  }, [
    data,
    unmappedNoteIds,
    viewState,
    selectedNoteId,
    playheadTime,
    anchorX,
    rangeMarks,
  ]);

  useEffect(() => {
    const handleResize = () => {
      if (containerRef.current && canvasRef.current) {
        canvasRef.current.width = containerRef.current.clientWidth;
        canvasRef.current.height = containerRef.current.clientHeight;
        draw();
      }
    };
    window.addEventListener("resize", handleResize);
    handleResize();
    return () => window.removeEventListener("resize", handleResize);
  }, [draw]);

  useEffect(() => draw(), [draw]);

  const handleWheel = (e: React.WheelEvent) => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const isZooming = e.altKey || e.metaKey || e.ctrlKey;
    const rect = canvas.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;

    if (isZooming) {
      e.preventDefault();
      const zoomFactor = 1.1;
      const factor = e.deltaY < 0 ? zoomFactor : 1 / zoomFactor;

      if (e.altKey) {
        onZoom("Y", factor, canvas.height - mouseY);
      } else {
        onZoom("X", factor, mouseX);
      }
    } else {
      // Pass deltas to parent to allow perfectly relative sync scrolling
      const dx = e.deltaX / viewState.zoomX;
      const dy = -e.deltaY / viewState.zoomY;
      onScroll(dx, dy);
    }
  };

  const handleClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    onPanelFocus();
    if (!data) return;
    const rect = canvasRef.current!.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const clickedNote = getNoteAtCanvasPoint(x, y);

    if (clickedNote) {
      onNoteClick(clickedNote);
    } else {
      onBlankClick();
    }
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    onPanelFocus();
    if (e.button !== 0 || !data) return;

    const rect = canvasRef.current!.getBoundingClientRect();
    const note = getNoteAtCanvasPoint(e.clientX - rect.left, e.clientY - rect.top);
    if (note) {
      onNoteDragStart(note, e.clientX, e.clientY);
    }
  };

  return (
    <div
      ref={containerRef}
      className="relative w-full h-full bg-[#08080a] overflow-hidden"
    >
      <div className="absolute top-5 left-5 px-3 py-1.5 bg-zinc-950/90 rounded-lg text-[9px] text-zinc-500 font-black tracking-[0.3em] z-10 border border-white/[0.2] pointer-events-none uppercase shadow-2xl">
        {label}
      </div>
      <canvas
        ref={canvasRef}
        onWheel={handleWheel}
        onClick={handleClick}
        onPointerDown={handlePointerDown}
        className="cursor-crosshair w-full h-full block"
      />
    </div>
  );
};

export default PianoRoll;
