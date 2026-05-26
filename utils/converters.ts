import { SubtitleSegment } from '../types';

/**
 * Định dạng số giây thành HH:MM:SS,mmm (cho SRT)
 */
function formatTimeSRT(seconds: number): string {
  const date = new Date(0);
  date.setSeconds(seconds);
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
      // ASS doesn't support our custom word timing format directly in standard players, 
      // but we can strip it or convert to karaoke tags {\k10} later if needed.
      // For now, just strip the custom tags for ASS to keep it clean, or keep text as is.
      // Let's keep text as is but strip [L1] tags for display if we want, 
      // but for now let's just use the text property.
      // Actually, if we have words, we should probably construct the text from words 
      // but maybe without the {500} tags for ASS unless we convert to {\k}.
      // Let's just use the raw text for now.
      return `Dialogue: 0,${formatTimeASS(seg.start)},${formatTimeASS(seg.end)},Default,,0,0,0,,${seg.text}`;
    })
    .join('\n');

  return header + events;
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
      // Regex flexible: supports comma (,) or dot (.) for milliseconds
      // Supports loose spacing around '-->'
      const timeMatch = lines[1].match(/(\d+):(\d+):(\d+)[,.](\d+)\s*-->\s*(\d+):(\d+):(\d+)[,.](\d+)/);
      
      if (timeMatch) {
        const start = parseInt(timeMatch[1]) * 3600 + parseInt(timeMatch[2]) * 60 + parseInt(timeMatch[3]) + parseInt(timeMatch[4]) / 1000;
        const end = parseInt(timeMatch[5]) * 3600 + parseInt(timeMatch[6]) * 60 + parseInt(timeMatch[7]) + parseInt(timeMatch[8]) / 1000;
        
        // Handle multi-line text block
        let text = lines.slice(2).join('\n');
        
        // Parse Line Number [L1] or [L2]
        let lineNumber: 1 | 2 | undefined;
        const lineMatch = text.match(/^\[L([12])\]\s*/);
        if (lineMatch) {
            lineNumber = parseInt(lineMatch[1]) as 1 | 2;
            text = text.replace(/^\[L([12])\]\s*/, '');
        }

        // Parse Word Timings {500}
        // Example: Hello{500} world{300}
        const words: { word: string, duration: number }[] = [];
        // Check if text contains {number} pattern
        if (/\{(\d+)\}/.test(text)) {
            const parts = text.split(/(\{[^}]+\})/);
            for (let i = 0; i < parts.length; i++) {
                const part = parts[i];
                if (part.match(/^\{(\d+)\}$/)) {
                    // It's a duration, assign to previous word
                    const duration = parseInt(part.match(/^\{(\d+)\}$/)![1]);
                    if (words.length > 0) {
                        words[words.length - 1].duration = duration;
                    }
                } else if (part.trim() !== '') {
                    // It's a word (or multiple words if no duration between them)
                    // We might need to split by space if no duration is attached?
                    // But the format implies Word{dur}.
                    // Let's assume the user/system puts {dur} after every word if they use this feature.
                    // If there are spaces, we treat them as part of the word or separate?
                    // "Hello{500} " -> word: "Hello", dur: 500.
                    // "Hello {500}" -> word: "Hello ", dur: 500.
                    words.push({ word: part, duration: 0 });
                }
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
  // 1. Try to shift SRT timestamps
  // Flexible regex for replace as well
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

  // 2. Try to shift ASS timestamps (if mixed or purely ASS)
  // Pattern: 0:00:00.00 (H:MM:SS.cc)
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