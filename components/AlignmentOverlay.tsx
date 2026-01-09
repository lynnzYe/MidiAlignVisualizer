
import React, { useMemo } from 'react';
import { MidiData, AlignmentPair, ViewState, AlignmentVisibility } from '../types';

interface AlignmentOverlayProps {
  scoreData: MidiData | null;
  perfData: MidiData | null;
  alignment: AlignmentPair[];
  scoreViewState: ViewState;
  perfViewState: ViewState;
  visibility: AlignmentVisibility;
  selectedScoreId: number | null;
  selectedPerfId: number | null;
}

const AlignmentOverlay: React.FC<AlignmentOverlayProps> = ({
  scoreData,
  perfData,
  alignment,
  scoreViewState,
  perfViewState,
  visibility,
  selectedScoreId,
  selectedPerfId
}) => {
  if (visibility === 'none' || !scoreData || !perfData) return null;

  const opacity = visibility === 'half' ? 0.3 : 1;

  // We need to calculate global Y positions because we have two panels stacked.
  // This component will be absolute positioned covering the whole vertical space.
  
  const lines = useMemo(() => {
    return alignment.map((pair, idx) => {
      const scoreNote = scoreData.notes.find(n => n.id === pair.scoreId);
      const perfNote = perfData.notes.find(n => n.id === pair.perfId);

      if (!scoreNote || !perfNote) return null;

      const isSelected = scoreNote.id === selectedScoreId || perfNote.id === selectedPerfId;

      // Map coordinates
      // Panel 1 (Score) is the top half
      // Panel 2 (Perf) is the bottom half
      // Assume parent container is 100% height, split 50/50.
      
      const x1 = (scoreNote.start - scoreViewState.scrollX) * scoreViewState.zoomX;
      // Y1 relative to top panel center. Let's assume height is 'H'.
      // The canvas drawing uses: h - (pitch - scrollY + 1) * zoomY
      // But we'll do this calculation based on the actual DOM structure in App.tsx
      
      return { pair, scoreNote, perfNote, isSelected };
    }).filter(Boolean);
  }, [alignment, scoreData, perfData, scoreViewState, perfViewState, selectedScoreId, selectedPerfId]);

  // Note: Finding exact pixel positions for SVG across components is tricky.
  // Instead of complex DOM measurements, we pass the "panel height" logic here.
  // App.tsx will wrap this in a container that defines the coordinate system.

  return (
    <svg className="absolute inset-0 pointer-events-none z-20 w-full h-full">
      <defs>
        <linearGradient id="lineGrad" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stopColor="#10b981" stopOpacity={opacity} />
          <stop offset="100%" stopColor="#3b82f6" stopOpacity={opacity} />
        </linearGradient>
      </defs>
      {lines.map((line, i) => {
        if (!line) return null;
        const { scoreNote, perfNote, isSelected } = line;

        // X coords
        const x1 = (scoreNote.start - scoreViewState.scrollX) * scoreViewState.zoomX;
        const x2 = (perfNote.start - perfViewState.scrollX) * perfViewState.zoomX;

        // Y coords relative to whole container
        // Top panel takes top 50%. Bottom panel takes bottom 50%.
        // Assuming height H. Panel height = H/2.
        // Score Y: (h/2) - (note.pitch - scrollY + 0.5) * zoomY
        // Perf Y: (h/2) + ( (h/2) - (note.pitch - scrollY + 0.5) * zoomY )
        
        // This math is handled via CSS and props by the parent.
        // For simplicity, we'll draw them if we had the actual pixel offsets.
        // SEE App.tsx for the integrated drawing strategy using refs or simpler overlays.
        return null; 
      })}
    </svg>
  );
};

export default AlignmentOverlay;
