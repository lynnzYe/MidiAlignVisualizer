
import React, { useRef, useEffect, useCallback } from 'react';
import { MidiData, ViewState, MidiNote } from '../types';

interface PianoRollProps {
  data: MidiData | null;
  viewState: ViewState;
  selectedNoteId: number | null;
  playheadTime: number | null;
  anchorX: number;
  onNoteClick: (note: MidiNote) => void;
  onBlankClick: () => void;
  onScroll: (deltaX: number, deltaY: number) => void;
  onZoom: (type: 'X' | 'Y', factor: number, centerCoord: number) => void;
  label: string;
}

const PianoRoll: React.FC<PianoRollProps> = ({
  data,
  viewState,
  selectedNoteId,
  playheadTime,
  anchorX,
  onNoteClick,
  onBlankClick,
  onScroll,
  onZoom,
  label
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const NOTES_IN_OCTAVE = 12;
  const BLACK_KEYS = [1, 3, 6, 8, 10]; 

  const isSharp = (pitch: number) => BLACK_KEYS.includes(pitch % NOTES_IN_OCTAVE);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const { width, height } = canvas;
    const { zoomX, zoomY, scrollX, scrollY } = viewState;

    ctx.clearRect(0, 0, width, height);

    // 1. Draw Background Grid
    const startMidi = Math.floor(scrollY);
    const endMidi = Math.ceil(scrollY + height / zoomY);

    for (let pitch = startMidi; pitch <= endMidi; pitch++) {
      const y = height - (pitch - scrollY + 1) * zoomY;
      ctx.fillStyle = isSharp(pitch) ? '#08080a' : '#0e0e11';
      ctx.fillRect(0, y, width, zoomY);

      ctx.strokeStyle = '#18181b';
      ctx.lineWidth = 0.5;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(width, y);
      ctx.stroke();

      if (pitch % 12 === 0) {
        ctx.strokeStyle = '#27272a';
        ctx.lineWidth = 1;
        ctx.strokeRect(0, y, width, 0.5);
      }
    }

    // Vertical grid (Seconds)
    ctx.strokeStyle = '#18181b';
    const startTime = Math.floor(scrollX);
    const endTime = Math.ceil(scrollX + width / zoomX);
    for (let t = startTime; t <= endTime; t++) {
      const x = (t - scrollX) * zoomX;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, height);
      ctx.stroke();
    }

    // Static Anchor Line (Apparent white line)
    ctx.setLineDash([5, 5]);
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.55)'; // More apparent, less opaque
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(anchorX, 0);
    ctx.lineTo(anchorX, height);
    ctx.stroke();
    ctx.setLineDash([]);

    // 2. Draw Notes
    if (data) {
      data.notes.forEach(note => {
        const x = (note.start - scrollX) * zoomX;
        const w = note.duration * zoomX;
        const y = height - (note.pitch - scrollY + 1) * zoomY;
        const h = zoomY - 1;

        if (x + w < 0 || x > width) return;

        const isSelected = selectedNoteId === note.id;
        
        const gradient = ctx.createLinearGradient(x, y, x, y + h);
        gradient.addColorStop(0, isSelected ? '#60a5fa' : '#34d399');
        gradient.addColorStop(1, isSelected ? '#2563eb' : '#059669');

        ctx.fillStyle = gradient;
        ctx.strokeStyle = isSelected ? '#ffffff' : '#059669';
        ctx.lineWidth = isSelected ? 2.5 : 0.5;

        ctx.beginPath();
        ctx.roundRect(x, y, Math.max(4, w), h, 3);
        ctx.fill();
        ctx.stroke();

        if (isSelected || zoomY > 20) {
            ctx.fillStyle = isSelected ? 'white' : 'rgba(255,255,255,0.7)';
            ctx.font = 'bold 10px "JetBrains Mono", monospace';
            ctx.fillText(`${note.id}`, x + 5, y + 12);
        }
      });
    }

    // 3. Moving Playhead
    if (playheadTime !== null) {
      const px = (playheadTime - scrollX) * zoomX;
      if (px >= 0 && px <= width) {
        ctx.strokeStyle = '#f87171';
        ctx.lineWidth = 2.5;
        ctx.shadowBlur = 10;
        ctx.shadowColor = 'rgba(248, 113, 113, 0.9)';
        ctx.beginPath();
        ctx.moveTo(px, 0);
        ctx.lineTo(px, height);
        ctx.stroke();
        ctx.shadowBlur = 0;
      }
    }
  }, [data, viewState, selectedNoteId, playheadTime, anchorX]);

  useEffect(() => {
    const handleResize = () => {
      if (containerRef.current && canvasRef.current) {
        canvasRef.current.width = containerRef.current.clientWidth;
        canvasRef.current.height = containerRef.current.clientHeight;
        draw();
      }
    };
    window.addEventListener('resize', handleResize);
    handleResize();
    return () => window.removeEventListener('resize', handleResize);
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
        onZoom('Y', factor, canvas.height - mouseY);
      } else {
        onZoom('X', factor, mouseX);
      }
    } else {
      // Pass deltas to parent to allow perfectly relative sync scrolling
      const dx = e.deltaX / viewState.zoomX;
      const dy = -e.deltaY / viewState.zoomY;
      onScroll(dx, dy);
    }
  };

  const handleClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!data) return;
    const rect = canvasRef.current!.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const time = x / viewState.zoomX + viewState.scrollX;
    const pitch = viewState.scrollY + (canvasRef.current!.height - y) / viewState.zoomY;

    const clickedNote = data.notes.find(note => 
      time >= note.start && time <= note.start + note.duration && Math.floor(pitch) === note.pitch
    );
    
    if (clickedNote) {
      onNoteClick(clickedNote);
    } else {
      onBlankClick();
    }
  };

  return (
    <div ref={containerRef} className="relative w-full h-full bg-[#08080a] overflow-hidden">
      <div className="absolute top-5 left-5 px-3 py-1.5 bg-zinc-950/90 rounded-lg text-[9px] text-zinc-500 font-black tracking-[0.3em] z-10 border border-white/[0.2] pointer-events-none uppercase shadow-2xl">
        {label}
      </div>
      <canvas ref={canvasRef} onWheel={handleWheel} onClick={handleClick} className="cursor-crosshair w-full h-full block" />
    </div>
  );
};

export default PianoRoll;
