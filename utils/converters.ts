import { SubtitleSegment } from '../types';

/**
 * Định dạng số giây thành HH:MM:SS,mmm (cho SRT)
 */
function formatTimeSRT(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  const ms = Math.floor((seconds % 1) * 1000);
  return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')},${ms.toString().padStart(3, '0')}`;
}

/**
 * Định dạng số giây thành H:MM:SS.cc (cho ASS)
 */
function formatTimeASS(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  const cs = Math.floor((seconds % 1) * 100);
  return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}.${cs.toString().padStart(2, '0')}`;
}

/**
 * Định dạng số giây thành mm:ss.xx (cho LRC)
 */
function formatTimeLRC(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m.toString().padStart(2, '0')}:${s.toFixed(2).padStart(5, '0')}`;
}

export function parseSegmentsToSRT(segments: SubtitleSegment[]): string {
  return segments
    .map((seg) => {
      let text = seg.text;
      if (seg.words && seg.words.length > 0) {
        text = seg.words.map(w => `${w.word}{${Math.round(w.duration)}}`).join('');
      }
      if (seg.lineNumber) {
        text = `[L${seg.lineNumber}] ${text}`;
      }
      return `${seg.index}\n${formatTimeSRT(seg.start)} --> ${formatTimeSRT(seg.end)}\n${text}\n`;
    })
    .join('\n');
}

export function parseSegmentsToASS(segments: SubtitleSegment[], filename: string = "Untitled"): string {
  const header = `[Script Info]
Title: ${filename}
ScriptType: v4.00+
Collisions: Normal
PlayResX: 640
PlayResY: 360

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,Arial,20,&H00FFFFFF,&H000000FF,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,2,2,2,10,10,10,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`;

  const events = segments
    .map((seg) => {
      return `Dialogue: 0,${formatTimeASS(seg.start)},${formatTimeASS(seg.end)},Default,,0,0,0,,${seg.text}`;
    })
    .join('\n');

  return header + events;
}

// ===== MODULE 5: ASS KARAOKE TAGS EXPORT =====

/**
 * Export ASS với {\k} karaoke tags chuẩn
 * {\k<centiseconds>} = duration of each syllable in centiseconds (1/100 s)
 * {\kf<centiseconds>} = smooth fill effect (karaoke fill)
 */
export function parseSegmentsToKaraokeASS(
  segments: SubtitleSegment[], 
  filename: string = "Untitled",
  useSmooth: boolean = true // \kf for smooth fill
): string {
  const kTag = useSmooth ? '\\kf' : '\\k';
  
  const header = `[Script Info]
Title: ${filename} - Karaoke
ScriptType: v4.00+
Collisions: Normal
PlayResX: 1920
PlayResY: 1080

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Karaoke,Be Vietnam Pro,72,&H00FFFFFF,&H0010CFDF,&H00000000,&H80000000,-1,0,0,0,100,100,0,0,1,3,0,2,30,30,50,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`;

  const events = segments.map((seg) => {
    let karaokeText: string;
    
    if (seg.words && seg.words.length > 0) {
      // Convert word durations (ms) to centiseconds for ASS \k tags
      karaokeText = seg.words.map((w, idx) => {
        const cs = Math.round(w.duration / 10); // ms → centiseconds
        const space = idx < seg.words!.length - 1 ? ' ' : '';
        return `{${kTag}${cs}}${w.word}${space}`;
      }).join('');
    } else {
      // Fallback: single \k tag for entire segment
      const totalCs = Math.round((seg.end - seg.start) * 100);
      karaokeText = `{${kTag}${totalCs}}${seg.text}`;
    }
    
    return `Dialogue: 0,${formatTimeASS(seg.start)},${formatTimeASS(seg.end)},Karaoke,,0,0,0,,${karaokeText}`;
  }).join('\n');

  return header + events;
}

// ===== MODULE 5: ENHANCED LRC EXPORT =====

/**
 * Export Enhanced LRC format (lyrics file format cho karaoke players)
 * Supports word-level timing with <word:timestamp> format
 */
export function parseSegmentsToLRC(
  segments: SubtitleSegment[],
  metadata?: { title?: string; artist?: string; album?: string }
): string {
  const lines: string[] = [];
  
  // LRC Metadata
  if (metadata?.title) lines.push(`[ti:${metadata.title}]`);
  if (metadata?.artist) lines.push(`[ar:${metadata.artist}]`);
  if (metadata?.album) lines.push(`[al:${metadata.album}]`);
  lines.push(`[by:LyricSub AI]`);
  lines.push(`[re:LyricSub AI Karaoke Generator]`);
  lines.push('');
  
  for (const seg of segments) {
    const timestamp = `[${formatTimeLRC(seg.start)}]`;
    
    if (seg.words && seg.words.length > 0) {
      // Enhanced LRC with word-level timing
      let wordTimings = '';
      let currentTime = seg.start;
      
      for (const w of seg.words) {
        const wordTimestamp = `<${formatTimeLRC(currentTime)}>`;
        wordTimings += `${wordTimestamp}${w.word} `;
        currentTime += w.duration / 1000;
      }
      
      lines.push(`${timestamp}${wordTimings.trim()}`);
    } else {
      // Simple LRC line
      lines.push(`${timestamp}${seg.text}`);
    }
  }
  
  return lines.join('\n');
}

// ===== MODULE 5: PLAIN TEXT LYRICS EXPORT =====

/**
 * Export clean lyrics without timing (for copy/paste)
 */
export function parseSegmentsToPlainLyrics(segments: SubtitleSegment[]): string {
  return segments.map(seg => seg.text).join('\n');
}

/**
 * Hàm phân tích SRT text thành mảng segments để hiển thị player
 */
export function parseSRTToSegments(srt: string): SubtitleSegment[] {
  const segments: SubtitleSegment[] = [];
  // Normalize line endings
  const normalizedSrt = srt.replace(/\r\n/g, '\n');
  const blocks = normalizedSrt.trim().split(/\n\s*\n/);

  for (const block of blocks) {
    const lines = block.split('\n');
    if (lines.length >= 3) {
      const index = parseInt(lines[0]);
      const timeMatch = lines[1].match(/(\d+):(\d+):(\d+)[,.](\d+)\s*-->\s*(\d+):(\d+):(\d+)[,.](\d+)/);
      
      if (timeMatch) {
        const start = parseInt(timeMatch[1]) * 3600 + parseInt(timeMatch[2]) * 60 + parseInt(timeMatch[3]) + parseInt(timeMatch[4]) / 1000;
        const end = parseInt(timeMatch[5]) * 3600 + parseInt(timeMatch[6]) * 60 + parseInt(timeMatch[7]) + parseInt(timeMatch[8]) / 1000;
        
        let text = lines.slice(2).join('\n');
        
        // Parse Line Number [L1] or [L2]
        let lineNumber: 1 | 2 | undefined;
        const lineMatch = text.match(/^\[L([12])\]\s*/);
        if (lineMatch) {
            lineNumber = parseInt(lineMatch[1]) as 1 | 2;
            text = text.replace(/^\[L([12])\]\s*/, '');
        }

        // Parse Word Timings {500}
        const words: { word: string, duration: number }[] = [];
        if (/\{\d+\}/.test(text)) {
            const parts = text.split(/(\{[^}]+\})/);
            for (let i = 0; i < parts.length; i++) {
                const part = parts[i];
                if (part.match(/^\{(\d+)\}$/)) {
                    const duration = parseInt(part.match(/^\{(\d+)\}$/)![1]);
                    if (words.length > 0) {
                        words[words.length - 1].duration = duration;
                    }
                } else if (part.trim() !== '') {
                    words.push({ word: part.trim(), duration: 0 });
                }
            }
            // Clean text: remove {duration} markers for display
            if (words.length > 0) {
                text = words.map(w => w.word).join(' ');
            }
        }

        if (!isNaN(start) && !isNaN(end)) {
            segments.push({ index, start, end, text, lineNumber, words: words.length > 0 ? words : undefined });
        }
      }
    }
  }
  return segments;
}

/**
 * Hàm dịch chuyển thời gian cho cả SRT và ASS
 */
export function shiftSubtitleTime(content: string, shiftSeconds: number): string {
  let newContent = content.replace(
    /(\d{2}):(\d{2}):(\d{2})[,.](\d{3})\s*-->\s*(\d{2}):(\d{2}):(\d{2})[,.](\d{3})/g,
    (match, h1, m1, s1, ms1, h2, m2, s2, ms2) => {
      const t1 = parseInt(h1) * 3600 + parseInt(m1) * 60 + parseInt(s1) + parseInt(ms1) / 1000;
      const t2 = parseInt(h2) * 3600 + parseInt(m2) * 60 + parseInt(s2) + parseInt(ms2) / 1000;
      
      const newT1 = Math.max(0, t1 + shiftSeconds);
      const newT2 = Math.max(0, t2 + shiftSeconds);
      
      return `${formatTimeSRT(newT1)} --> ${formatTimeSRT(newT2)}`;
    }
  );

  newContent = newContent.replace(
    /(\d+):(\d{2}):(\d{2})\.(\d{2})/g,
    (match, h, m, s, cs) => {
      const t = parseInt(h) * 3600 + parseInt(m) * 60 + parseInt(s) + parseInt(cs) / 100;
      const newT = Math.max(0, t + shiftSeconds);
      return formatTimeASS(newT);
    }
  );

  return newContent;
}