import { SubtitleSegment, WordTiming } from '../types';

/**
 * Post-Processing Engine cho Karaoke Timing
 * 
 * Pipeline: Input Segments → Validate → Fix Overlaps → Fill Gaps → 
 *           Redistribute Words → Align Reference → Output
 */

// ===== 1. BOUNDARY VALIDATION =====
export function validateBoundaries(segments: SubtitleSegment[], duration: number): SubtitleSegment[] {
  return segments.map(seg => {
    let start = Math.max(0, seg.start);
    let end = Math.min(duration, seg.end);
    
    // Ensure start < end with minimum 0.1s duration
    if (start >= end) {
      end = Math.min(duration, start + 0.5);
      if (start >= end) {
        start = Math.max(0, end - 0.5);
      }
    }
    
    return { ...seg, start, end };
  });
}

// ===== 2. OVERLAP RESOLUTION =====
export function resolveOverlaps(segments: SubtitleSegment[]): SubtitleSegment[] {
  if (segments.length <= 1) return segments;
  
  // Sort by start time
  const sorted = [...segments].sort((a, b) => a.start - b.start);
  
  for (let i = 0; i < sorted.length - 1; i++) {
    const current = sorted[i];
    const next = sorted[i + 1];
    
    if (current.end > next.start) {
      // Overlap detected - split at midpoint
      const midpoint = (current.end + next.start) / 2;
      sorted[i] = { ...current, end: midpoint - 0.01 };
      sorted[i + 1] = { ...next, start: midpoint + 0.01 };
    }
  }
  
  return sorted;
}

// ===== 3. GAP FILLING =====
export function fillGaps(segments: SubtitleSegment[], maxGap: number = 0.3): SubtitleSegment[] {
  if (segments.length <= 1) return segments;
  
  const result = [...segments].sort((a, b) => a.start - b.start);
  
  for (let i = 0; i < result.length - 1; i++) {
    const current = result[i];
    const next = result[i + 1];
    const gap = next.start - current.end;
    
    if (gap > 0 && gap <= maxGap) {
      // Small gap: extend current segment's end to fill
      result[i] = { ...current, end: next.start };
    }
  }
  
  return result;
}

// ===== 4. WORD TIMING REDISTRIBUTION =====
export function redistributeWordTimings(segment: SubtitleSegment): SubtitleSegment {
  if (!segment.words || segment.words.length === 0) return segment;
  
  const segDuration = (segment.end - segment.start) * 1000; // ms
  const totalWordDuration = segment.words.reduce((sum, w) => sum + w.duration, 0);
  
  if (totalWordDuration <= 0) {
    // All words have 0 duration - distribute evenly
    const durationPerWord = segDuration / segment.words.length;
    return {
      ...segment,
      words: segment.words.map(w => ({ ...w, duration: Math.round(durationPerWord) }))
    };
  }
  
  // If total doesn't match segment duration, redistribute proportionally
  const ratio = segDuration / totalWordDuration;
  if (Math.abs(ratio - 1) > 0.05) { // More than 5% difference
    const newWords = segment.words.map(w => ({
      ...w,
      duration: Math.max(50, Math.round(w.duration * ratio))
    }));
    
    // Fix rounding errors: adjust last word
    const newTotal = newWords.reduce((sum, w) => sum + w.duration, 0);
    const diff = Math.round(segDuration) - newTotal;
    if (newWords.length > 0) {
      newWords[newWords.length - 1].duration += diff;
    }
    
    return { ...segment, words: newWords };
  }
  
  return segment;
}

// ===== 5. REFERENCE LYRICS ALIGNMENT (Fuzzy Match) =====

/**
 * Levenshtein distance for fuzzy matching
 */
function levenshteinDistance(a: string, b: string): number {
  const matrix: number[][] = [];
  const n = a.length;
  const m = b.length;
  
  for (let i = 0; i <= n; i++) matrix[i] = [i];
  for (let j = 0; j <= m; j++) matrix[0][j] = j;
  
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1,
        matrix[i][j - 1] + 1,
        matrix[i - 1][j - 1] + cost
      );
    }
  }
  
  return matrix[n][m];
}

/**
 * Tính similarity score giữa 2 string (0-1)
 */
function similarity(a: string, b: string): number {
  if (a === b) return 1;
  const maxLen = Math.max(a.length, b.length);
  if (maxLen === 0) return 1;
  return 1 - levenshteinDistance(a.toLowerCase(), b.toLowerCase()) / maxLen;
}

/**
 * Align reference lyrics text with AI-generated segments
 * Preserves timing from AI but replaces text with reference lyrics
 */
export function alignWithReferenceLyrics(
  segments: SubtitleSegment[],
  referenceLyrics: string
): SubtitleSegment[] {
  if (!referenceLyrics.trim()) return segments;
  
  // Split reference into lines
  const refLines = referenceLyrics
    .split('\n')
    .map(l => l.trim())
    .filter(l => l.length > 0);
  
  if (refLines.length === 0) return segments;
  
  // Build alignment using fuzzy matching
  const result = [...segments];
  const usedRefLines = new Set<number>();
  
  // First pass: exact or near-exact matches
  for (let i = 0; i < result.length; i++) {
    let bestMatch = -1;
    let bestScore = 0;
    
    for (let j = 0; j < refLines.length; j++) {
      if (usedRefLines.has(j)) continue;
      
      const score = similarity(result[i].text, refLines[j]);
      if (score > bestScore && score > 0.5) {
        bestScore = score;
        bestMatch = j;
      }
    }
    
    if (bestMatch >= 0) {
      result[i] = { 
        ...result[i], 
        text: refLines[bestMatch],
        // Regenerate words from new text if word timing exists
        words: result[i].words ? generateWordsFromText(refLines[bestMatch], result[i]) : undefined
      };
      usedRefLines.add(bestMatch);
    }
  }
  
  // Second pass: sequential alignment for unmatched
  let refIdx = 0;
  for (let i = 0; i < result.length; i++) {
    if (usedRefLines.has(i)) continue; // Already matched
    
    // Find next unused ref line
    while (refIdx < refLines.length && usedRefLines.has(refIdx)) refIdx++;
    
    if (refIdx < refLines.length) {
      result[i] = {
        ...result[i],
        text: refLines[refIdx],
        words: result[i].words ? generateWordsFromText(refLines[refIdx], result[i]) : undefined
      };
      usedRefLines.add(refIdx);
      refIdx++;
    }
  }
  
  return result;
}

/**
 * Generate word timings from new text based on original segment timing
 */
function generateWordsFromText(text: string, originalSegment: SubtitleSegment): WordTiming[] {
  const words = text.trim().split(/\s+/);
  const segDuration = (originalSegment.end - originalSegment.start) * 1000; // ms
  
  if (originalSegment.words && originalSegment.words.length > 0) {
    // Try to redistribute original word durations to new words
    const totalOrigDuration = originalSegment.words.reduce((sum, w) => sum + w.duration, 0);
    const durationPerChar = totalOrigDuration / originalSegment.text.replace(/\s/g, '').length;
    
    return words.map(w => ({
      word: w,
      duration: Math.max(50, Math.round(w.length * durationPerChar))
    }));
  }
  
  // Equal distribution
  const durationPerWord = segDuration / words.length;
  return words.map(w => ({
    word: w,
    duration: Math.max(50, Math.round(durationPerWord))
  }));
}

// ===== 6. AUTO WORD SPLITTING =====

/**
 * Tự động tách segment thành word-level timing nếu chưa có
 * Sử dụng character-weighted distribution (từ dài hơn = thời gian lâu hơn)
 */
export function autoSplitToWords(segment: SubtitleSegment): SubtitleSegment {
  if (segment.words && segment.words.length > 0) return segment;
  
  const words = segment.text.trim().split(/\s+/);
  if (words.length === 0) return segment;
  
  const totalChars = words.reduce((sum, w) => sum + w.length, 0);
  const segDuration = (segment.end - segment.start) * 1000; // ms
  
  const newWords: WordTiming[] = words.map(w => ({
    word: w,
    duration: Math.max(80, Math.round((w.length / totalChars) * segDuration))
  }));
  
  // Fix rounding
  const total = newWords.reduce((sum, w) => sum + w.duration, 0);
  const diff = Math.round(segDuration) - total;
  if (newWords.length > 0) {
    newWords[newWords.length - 1].duration += diff;
  }
  
  return { ...segment, words: newWords };
}

// ===== 7. SNAP TO ENERGY PEAKS =====

/**
 * Snap segment boundaries to nearest energy peaks
 * energyPeaks: array of timestamps (seconds) where energy peaks occur
 */
export function snapToEnergyPeaks(
  segments: SubtitleSegment[],
  energyPeaks: number[],
  maxSnapDistance: number = 0.15 // seconds
): SubtitleSegment[] {
  if (energyPeaks.length === 0) return segments;
  
  return segments.map(seg => {
    let newStart = seg.start;
    let newEnd = seg.end;
    
    // Find nearest peak to start
    let nearestStartPeak = -1;
    let nearestStartDist = Infinity;
    for (const peak of energyPeaks) {
      const dist = Math.abs(peak - seg.start);
      if (dist < nearestStartDist && dist <= maxSnapDistance) {
        nearestStartDist = dist;
        nearestStartPeak = peak;
      }
    }
    if (nearestStartPeak >= 0) newStart = nearestStartPeak;
    
    // Find nearest energy drop for end
    // We look for a point where energy is low near the end
    let nearestEndDrop = -1;
    let nearestEndDist = Infinity;
    for (const peak of energyPeaks) {
      const dist = Math.abs(peak - seg.end);
      if (dist < nearestEndDist && dist <= maxSnapDistance && peak > newStart) {
        nearestEndDist = dist;
        nearestEndDrop = peak;
      }
    }
    if (nearestEndDrop >= 0) newEnd = nearestEndDrop;
    
    // Ensure valid
    if (newStart >= newEnd) {
      newEnd = newStart + (seg.end - seg.start);
    }
    
    return { ...seg, start: newStart, end: newEnd };
  });
}

// ===== FULL PIPELINE =====

export interface PostProcessOptions {
  duration: number;
  referenceLyrics?: string;
  energyPeaks?: number[];
  autoSplitWords?: boolean;
  maxGap?: number;
  snapToPeaks?: boolean;
}

/**
 * Run full post-processing pipeline
 */
export function runPostProcessing(
  segments: SubtitleSegment[],
  options: PostProcessOptions
): SubtitleSegment[] {
  let result = [...segments];
  
  // Step 1: Validate boundaries
  result = validateBoundaries(result, options.duration);
  
  // Step 2: Resolve overlaps
  result = resolveOverlaps(result);
  
  // Step 3: Fill small gaps
  result = fillGaps(result, options.maxGap ?? 0.3);
  
  // Step 4: Snap to energy peaks (if available)
  if (options.snapToPeaks && options.energyPeaks && options.energyPeaks.length > 0) {
    result = snapToEnergyPeaks(result, options.energyPeaks);
  }
  
  // Step 5: Align with reference lyrics (if provided)
  if (options.referenceLyrics) {
    result = alignWithReferenceLyrics(result, options.referenceLyrics);
  }
  
  // Step 6: Auto-split to words (if enabled)
  if (options.autoSplitWords) {
    result = result.map(seg => autoSplitToWords(seg));
  }
  
  // Step 7: Redistribute word timings
  result = result.map(seg => redistributeWordTimings(seg));
  
  // Step 8: Re-index
  result = result.map((seg, idx) => ({ ...seg, index: idx + 1 }));
  
  return result;
}
