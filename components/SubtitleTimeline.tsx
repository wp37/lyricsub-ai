import React, { useRef, useState, useEffect, useCallback } from 'react';
import { SubtitleSegment } from '../types';
import { ZoomIn, ZoomOut, Move, GripVertical } from 'lucide-react';

interface SubtitleTimelineProps {
  segments: SubtitleSegment[];
  duration: number;
  currentTime: number;
  onSeek: (time: number) => void;
  onSegmentUpdate: (index: number, newStart: number, newEnd: number) => void;
  onSegmentSelect?: (index: number) => void;
  selectedSegmentIndex?: number | null;
}

const SubtitleTimeline: React.FC<SubtitleTimelineProps> = ({
  segments,
  duration,
  currentTime,
  onSeek,
  onSegmentUpdate,
  onSegmentSelect,
  selectedSegmentIndex
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [zoom, setZoom] = useState(50); // pixels per second
  const [hoveredSegment, setHoveredSegment] = useState<number | null>(null);
  const [dragging, setDragging] = useState<{
    index: number;
    type: 'move' | 'resize-start' | 'resize-end';
    startX: number;
    originalStart: number;
    originalEnd: number;
  } | null>(null);

  // Handle Mouse Move (Global)
  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!dragging) return;

      const deltaX = e.clientX - dragging.startX;
      const deltaTime = deltaX / zoom;
      const segment = segments[dragging.index];

      let newStart = dragging.originalStart;
      let newEnd = dragging.originalEnd;

      if (dragging.type === 'move') {
        newStart += deltaTime;
        newEnd += deltaTime;
      } else if (dragging.type === 'resize-start') {
        newStart += deltaTime;
      } else if (dragging.type === 'resize-end') {
        newEnd += deltaTime;
      }

      // Constraints
      if (newStart < 0) newStart = 0;
      if (newEnd > duration) newEnd = duration;
      if (newEnd - newStart < 0.1) {
          if (dragging.type === 'resize-start') newStart = newEnd - 0.1;
          else newEnd = newStart + 0.1;
      }

      onSegmentUpdate(dragging.index, newStart, newEnd);
    };

    const handleMouseUp = () => {
      setDragging(null);
    };

    if (dragging) {
      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseup', handleMouseUp);
    }

    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [dragging, zoom, duration, onSegmentUpdate, segments]);

  const handleMouseDown = (e: React.MouseEvent, index: number, type: 'move' | 'resize-start' | 'resize-end') => {
    e.stopPropagation();
    if (onSegmentSelect) onSegmentSelect(index);
    const segment = segments[index];
    setDragging({
      index,
      type,
      startX: e.clientX,
      originalStart: segment.start,
      originalEnd: segment.end,
    });
  };

  const handleSeekClick = (e: React.MouseEvent) => {
      if (dragging) return;
      if (!containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      const x = e.clientX - rect.left + containerRef.current.scrollLeft;
      const time = x / zoom;
      onSeek(time);
  };

  return (
    <div className="flex flex-col gap-2 w-full select-none">
      {/* Controls */}
      <div className="flex items-center justify-between px-2">
          <div className="flex items-center gap-2 text-xs text-slate-500">
              <Move className="w-3 h-3" />
              <span>Drag to move, edges to resize</span>
          </div>
          <div className="flex items-center gap-2">
              <button onClick={() => setZoom(z => Math.max(10, z - 10))} className="p-1 hover:bg-slate-200 rounded"><ZoomOut className="w-3 h-3" /></button>
              <span className="text-xs w-12 text-center">{zoom}px/s</span>
              <button onClick={() => setZoom(z => Math.min(200, z + 10))} className="p-1 hover:bg-slate-200 rounded"><ZoomIn className="w-3 h-3" /></button>
          </div>
      </div>

      {/* Timeline Track */}
      <div 
        ref={containerRef}
        className="relative w-full h-32 bg-slate-100 dark:bg-slate-900 rounded-lg overflow-x-auto overflow-y-hidden border border-slate-300 dark:border-slate-700 custom-scrollbar"
        onMouseDown={handleSeekClick}
      >
        <div style={{ width: Math.max(duration * zoom, 1000), height: '100%' }} className="relative">
            
            {/* Time Ruler */}
            <div className="absolute top-0 left-0 right-0 h-6 border-b border-slate-200 dark:border-slate-700 flex items-end select-none pointer-events-none">
                {Array.from({ length: Math.ceil(duration) }).map((_, i) => (
                    <div key={i} className="absolute bottom-0 border-l border-slate-300 dark:border-slate-600 h-2 text-[9px] pl-1 text-slate-400" style={{ left: i * zoom }}>
                        {i % 5 === 0 ? i + 's' : ''}
                    </div>
                ))}
            </div>

            {/* Playhead */}
            <div 
                className="absolute top-0 bottom-0 w-0.5 bg-red-500 z-30 pointer-events-none"
                style={{ left: currentTime * zoom }}
            />

            {/* Segments */}
            {segments.map((seg, idx) => {
                const left = seg.start * zoom;
                const width = (seg.end - seg.start) * zoom;
                const isHovered = hoveredSegment === idx;
                const isDragging = dragging?.index === idx;
                const isSelected = selectedSegmentIndex === idx;

                return (
                    <div
                        key={idx}
                        className={`absolute top-8 h-16 rounded-md border text-[10px] flex items-center justify-center overflow-hidden cursor-move transition-colors group z-10
                            ${isDragging ? 'bg-indigo-500 border-indigo-600 text-white z-20 shadow-lg' : 
                              isSelected ? 'bg-indigo-200 dark:bg-indigo-900 border-indigo-500 text-indigo-900 dark:text-indigo-100 ring-2 ring-indigo-500/50' :
                              isHovered ? 'bg-indigo-100 dark:bg-indigo-900/40 border-indigo-300 dark:border-indigo-700 text-indigo-700 dark:text-indigo-300' : 
                              'bg-white dark:bg-slate-800 border-slate-300 dark:border-slate-600 text-slate-500 dark:text-slate-400'}
                        `}
                        style={{ left, width: Math.max(2, width) }}
                        onMouseEnter={() => setHoveredSegment(idx)}
                        onMouseLeave={() => setHoveredSegment(null)}
                        onMouseDown={(e) => handleMouseDown(e, idx, 'move')}
                        title={`${seg.text} (${seg.start.toFixed(2)}s - ${seg.end.toFixed(2)}s)`}
                    >
                        {/* Resize Handles */}
                        <div 
                            className="absolute left-0 top-0 bottom-0 w-2 cursor-w-resize hover:bg-indigo-400/50 z-20"
                            onMouseDown={(e) => handleMouseDown(e, idx, 'resize-start')}
                        />
                        <div 
                            className="absolute right-0 top-0 bottom-0 w-2 cursor-e-resize hover:bg-indigo-400/50 z-20"
                            onMouseDown={(e) => handleMouseDown(e, idx, 'resize-end')}
                        />
                        
                        {/* Content */}
                        <span className="truncate px-2 pointer-events-none select-none font-medium">
                            {seg.text}
                        </span>
                        
                        {/* Hover Info Popup */}
                        {isHovered && !isDragging && (
                            <div className="absolute -top-8 left-1/2 -translate-x-1/2 bg-black/80 text-white px-2 py-1 rounded text-[9px] whitespace-nowrap z-50 pointer-events-none">
                                {seg.start.toFixed(2)}s - {seg.end.toFixed(2)}s
                            </div>
                        )}
                    </div>
                );
            })}
        </div>
      </div>
    </div>
  );
};

export default SubtitleTimeline;
