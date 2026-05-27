import React, { useRef, useState, useEffect, useCallback } from 'react';
import { SubtitleSegment } from '../types';
import { ZoomIn, ZoomOut, Move, GripVertical, Activity } from 'lucide-react';

interface SubtitleTimelineProps {
  segments: SubtitleSegment[];
  duration: number;
  currentTime: number;
  onSeek: (time: number) => void;
  onSegmentUpdate: (index: number, newStart: number, newEnd: number) => void;
  onSegmentSelect?: (index: number) => void;
  selectedSegmentIndex?: number | null;
  /** Waveform amplitude data (0-1 normalized) for visualization */
  waveformData?: Float32Array | null;
  /** Samples per second in waveform data */
  waveformSampleRate?: number;
}

const SubtitleTimeline: React.FC<SubtitleTimelineProps> = ({
  segments,
  duration,
  currentTime,
  onSeek,
  onSegmentUpdate,
  onSegmentSelect,
  selectedSegmentIndex,
  waveformData,
  waveformSampleRate = 100
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const waveformCanvasRef = useRef<HTMLCanvasElement>(null);
  const [zoom, setZoom] = useState(50);
  const [hoveredSegment, setHoveredSegment] = useState<number | null>(null);
  const [dragging, setDragging] = useState<{
    index: number;
    type: 'move' | 'resize-start' | 'resize-end';
    startX: number;
    originalStart: number;
    originalEnd: number;
  } | null>(null);

  // Draw waveform on canvas
  useEffect(() => {
    const canvas = waveformCanvasRef.current;
    if (!canvas || !waveformData || waveformData.length === 0) return;
    
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    
    const totalWidth = Math.max(duration * zoom, 1000);
    canvas.width = totalWidth;
    canvas.height = 80;
    
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    
    // Draw waveform
    const centerY = canvas.height / 2;
    const maxHeight = canvas.height * 0.45;
    
    // Background gradient
    const bgGrad = ctx.createLinearGradient(0, 0, 0, canvas.height);
    bgGrad.addColorStop(0, 'rgba(99, 102, 241, 0.03)');
    bgGrad.addColorStop(0.5, 'rgba(99, 102, 241, 0.08)');
    bgGrad.addColorStop(1, 'rgba(99, 102, 241, 0.03)');
    ctx.fillStyle = bgGrad;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    
    // Center line
    ctx.strokeStyle = 'rgba(99, 102, 241, 0.15)';
    ctx.lineWidth = 0.5;
    ctx.beginPath();
    ctx.moveTo(0, centerY);
    ctx.lineTo(canvas.width, centerY);
    ctx.stroke();
    
    // Draw waveform bars
    const samplesPerPixel = (waveformData.length / duration) / zoom;
    
    for (let x = 0; x < totalWidth; x++) {
      const sampleIdx = Math.floor((x / zoom) * waveformSampleRate);
      if (sampleIdx >= waveformData.length) break;
      
      // Average a few samples for smoother display
      let amp = 0;
      let count = 0;
      const range = Math.max(1, Math.floor(samplesPerPixel));
      for (let j = 0; j < range && (sampleIdx + j) < waveformData.length; j++) {
        amp += waveformData[sampleIdx + j];
        count++;
      }
      amp = count > 0 ? amp / count : 0;
      
      const barHeight = amp * maxHeight;
      
      if (barHeight > 0.5) {
        // Color based on amplitude
        const alpha = 0.3 + amp * 0.5;
        const time = x / zoom;
        
        // Highlight active segment area
        const isInSegment = segments.some(s => time >= s.start && time <= s.end);
        
        if (isInSegment) {
          ctx.fillStyle = `rgba(99, 102, 241, ${alpha})`;
        } else {
          ctx.fillStyle = `rgba(148, 163, 184, ${alpha * 0.6})`;
        }
        
        // Draw symmetric bar
        ctx.fillRect(x, centerY - barHeight, 1, barHeight * 2);
      }
    }
    
    // Draw energy threshold line
    ctx.strokeStyle = 'rgba(239, 68, 68, 0.2)';
    ctx.lineWidth = 0.5;
    ctx.setLineDash([4, 4]);
    const thresholdY = centerY - maxHeight * 0.3;
    ctx.beginPath();
    ctx.moveTo(0, thresholdY);
    ctx.lineTo(canvas.width, thresholdY);
    ctx.stroke();
    ctx.setLineDash([]);
    
  }, [waveformData, waveformSampleRate, duration, zoom, segments]);

  // Handle Mouse Move (Global)
  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!dragging) return;

      const deltaX = e.clientX - dragging.startX;
      const deltaTime = deltaX / zoom;

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

  const totalWidth = Math.max(duration * zoom, 1000);

  return (
    <div className="flex flex-col gap-2 w-full select-none">
      {/* Controls */}
      <div className="flex items-center justify-between px-2">
          <div className="flex items-center gap-2 text-xs text-slate-500">
              <Move className="w-3 h-3" />
              <span>Kéo để di chuyển, cạnh để resize</span>
              {waveformData && (
                <span className="flex items-center gap-1 text-indigo-500 ml-2">
                  <Activity className="w-3 h-3" />
                  Waveform
                </span>
              )}
          </div>
          <div className="flex items-center gap-2">
              <button onClick={() => setZoom(z => Math.max(10, z - 10))} className="p-1 hover:bg-slate-200 dark:hover:bg-slate-700 rounded"><ZoomOut className="w-3 h-3" /></button>
              <span className="text-xs w-12 text-center">{zoom}px/s</span>
              <button onClick={() => setZoom(z => Math.min(200, z + 10))} className="p-1 hover:bg-slate-200 dark:hover:bg-slate-700 rounded"><ZoomIn className="w-3 h-3" /></button>
          </div>
      </div>

      {/* Timeline Track */}
      <div 
        ref={containerRef}
        className="relative w-full h-40 bg-slate-100 dark:bg-slate-900 rounded-lg overflow-x-auto overflow-y-hidden border border-slate-300 dark:border-slate-700 custom-scrollbar"
        onMouseDown={handleSeekClick}
      >
        <div style={{ width: totalWidth, height: '100%' }} className="relative">
            
            {/* Waveform Canvas (Background Layer) */}
            {waveformData && (
              <canvas
                ref={waveformCanvasRef}
                className="absolute top-6 left-0 w-full pointer-events-none"
                style={{ width: totalWidth, height: 80 }}
              />
            )}

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
                className="absolute top-0 bottom-0 w-0.5 bg-red-500 z-30 pointer-events-none shadow-sm shadow-red-500/50"
                style={{ left: currentTime * zoom }}
            >
              {/* Playhead triangle indicator */}
              <div className="absolute -top-0 left-1/2 -translate-x-1/2 w-0 h-0 border-l-[4px] border-r-[4px] border-t-[6px] border-l-transparent border-r-transparent border-t-red-500" />
            </div>

            {/* Segments */}
            {segments.map((seg, idx) => {
                const left = seg.start * zoom;
                const width = (seg.end - seg.start) * zoom;
                const isHovered = hoveredSegment === idx;
                const isDragging = dragging?.index === idx;
                const isSelected = selectedSegmentIndex === idx;
                const hasWords = seg.words && seg.words.length > 0;

                return (
                    <div
                        key={idx}
                        className={`absolute top-8 h-20 rounded-md border text-[10px] flex flex-col items-center justify-center overflow-hidden cursor-move transition-colors group z-10
                            ${isDragging ? 'bg-indigo-500 border-indigo-600 text-white z-20 shadow-lg' : 
                              isSelected ? 'bg-indigo-200 dark:bg-indigo-900 border-indigo-500 text-indigo-900 dark:text-indigo-100 ring-2 ring-indigo-500/50' :
                              isHovered ? 'bg-indigo-100 dark:bg-indigo-900/40 border-indigo-300 dark:border-indigo-700 text-indigo-700 dark:text-indigo-300' : 
                              'bg-white/80 dark:bg-slate-800/80 border-slate-300 dark:border-slate-600 text-slate-500 dark:text-slate-400'}
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
                        
                        {/* Word count indicator */}
                        {hasWords && (
                          <span className="text-[8px] opacity-50 pointer-events-none">
                            {seg.words!.length} words
                          </span>
                        )}
                        
                        {/* Word timing bars (mini visualization) */}
                        {hasWords && width > 30 && (
                          <div className="absolute bottom-0 left-0 right-0 h-1.5 flex pointer-events-none">
                            {seg.words!.map((w, wIdx) => {
                              const wordPct = w.duration / ((seg.end - seg.start) * 1000) * 100;
                              return (
                                <div
                                  key={wIdx}
                                  className={`h-full ${wIdx % 2 === 0 ? 'bg-indigo-400/40' : 'bg-violet-400/40'}`}
                                  style={{ width: `${wordPct}%` }}
                                  title={`${w.word}: ${w.duration}ms`}
                                />
                              );
                            })}
                          </div>
                        )}
                        
                        {/* Hover Info Popup */}
                        {isHovered && !isDragging && (
                            <div className="absolute -top-10 left-1/2 -translate-x-1/2 bg-black/90 text-white px-3 py-1.5 rounded-lg text-[9px] whitespace-nowrap z-50 pointer-events-none shadow-lg">
                                <div>{seg.start.toFixed(2)}s → {seg.end.toFixed(2)}s ({((seg.end - seg.start) * 1000).toFixed(0)}ms)</div>
                                {hasWords && <div className="text-indigo-300">{seg.words!.length} words synced</div>}
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
