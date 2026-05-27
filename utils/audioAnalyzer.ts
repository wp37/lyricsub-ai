/**
 * Audio Waveform Analysis Module
 * 
 * Cung cấp:
 * 1. Onset Detection - phát hiện điểm bắt đầu có âm thanh
 * 2. Energy Peaks - tìm đỉnh năng lượng âm thanh
 * 3. Waveform Data - dữ liệu sóng âm cho hiển thị timeline
 * 4. RMS Energy - đánh giá mức năng lượng tại mỗi thời điểm
 */

export interface WaveformData {
  /** Normalized amplitude values (0-1) for each sample point */
  amplitudes: Float32Array;
  /** Duration of audio in seconds */
  duration: number;
  /** Number of samples per second in the waveform data */
  sampleRate: number;
}

export interface EnergyPeak {
  /** Time in seconds */
  time: number;
  /** Energy value (0-1) */
  energy: number;
}

export interface OnsetPoint {
  /** Time in seconds */
  time: number;
  /** Strength of onset (0-1) */
  strength: number;
}

/**
 * Extract waveform data from audio file for visualization
 * Returns downsampled amplitude data suitable for drawing
 */
export async function extractWaveform(
  audioFile: File,
  targetSamplesPerSecond: number = 100 // 100 points per second for visualization
): Promise<WaveformData> {
  const arrayBuffer = await audioFile.arrayBuffer();
  const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
  const audioCtx = new AudioContextClass();
  
  let audioBuffer: AudioBuffer;
  try {
    audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);
  } catch (e) {
    audioCtx.close();
    throw new Error('Không thể decode audio file');
  }
  
  const channelData = audioBuffer.getChannelData(0); // Use first channel
  const duration = audioBuffer.duration;
  const sourceSampleRate = audioBuffer.sampleRate;
  
  // Downsample for visualization
  const totalOutputSamples = Math.ceil(duration * targetSamplesPerSecond);
  const amplitudes = new Float32Array(totalOutputSamples);
  const samplesPerPoint = Math.floor(channelData.length / totalOutputSamples);
  
  for (let i = 0; i < totalOutputSamples; i++) {
    const start = i * samplesPerPoint;
    const end = Math.min(start + samplesPerPoint, channelData.length);
    
    // Use RMS (Root Mean Square) for more accurate amplitude
    let sumSquared = 0;
    for (let j = start; j < end; j++) {
      sumSquared += channelData[j] * channelData[j];
    }
    amplitudes[i] = Math.sqrt(sumSquared / (end - start));
  }
  
  // Normalize to 0-1
  let maxAmp = 0;
  for (let i = 0; i < amplitudes.length; i++) {
    if (amplitudes[i] > maxAmp) maxAmp = amplitudes[i];
  }
  if (maxAmp > 0) {
    for (let i = 0; i < amplitudes.length; i++) {
      amplitudes[i] /= maxAmp;
    }
  }
  
  audioCtx.close();
  
  return {
    amplitudes,
    duration,
    sampleRate: targetSamplesPerSecond
  };
}

/**
 * Detect energy peaks in audio
 * Useful for finding vocal onset/offset points
 */
export function detectEnergyPeaks(
  waveform: WaveformData,
  threshold: number = 0.3,
  minPeakDistance: number = 0.1 // seconds
): EnergyPeak[] {
  const peaks: EnergyPeak[] = [];
  const { amplitudes, sampleRate } = waveform;
  const minSampleDistance = Math.floor(minPeakDistance * sampleRate);
  
  // Smooth the waveform first (moving average)
  const smoothed = new Float32Array(amplitudes.length);
  const windowSize = Math.max(3, Math.floor(sampleRate * 0.02)); // 20ms window
  
  for (let i = 0; i < amplitudes.length; i++) {
    let sum = 0;
    let count = 0;
    for (let j = Math.max(0, i - windowSize); j <= Math.min(amplitudes.length - 1, i + windowSize); j++) {
      sum += amplitudes[j];
      count++;
    }
    smoothed[i] = sum / count;
  }
  
  // Find local maxima above threshold
  for (let i = 1; i < smoothed.length - 1; i++) {
    if (smoothed[i] > threshold &&
        smoothed[i] >= smoothed[i - 1] &&
        smoothed[i] >= smoothed[i + 1]) {
      
      const time = i / sampleRate;
      
      // Check minimum distance from last peak
      if (peaks.length === 0 || (time - peaks[peaks.length - 1].time) >= minPeakDistance) {
        peaks.push({ time, energy: smoothed[i] });
      } else if (smoothed[i] > peaks[peaks.length - 1].energy) {
        // Replace last peak if this one is stronger
        peaks[peaks.length - 1] = { time, energy: smoothed[i] };
      }
    }
  }
  
  return peaks;
}

/**
 * Detect onset points (where sound starts after silence)
 * Uses spectral flux approximation with amplitude derivative
 */
export function detectOnsets(
  waveform: WaveformData,
  sensitivity: number = 0.15, // Lower = more sensitive
  minOnsetDistance: number = 0.2 // seconds
): OnsetPoint[] {
  const onsets: OnsetPoint[] = [];
  const { amplitudes, sampleRate } = waveform;
  const minSampleDistance = Math.floor(minOnsetDistance * sampleRate);
  
  // Calculate first derivative (rate of change)
  const derivative = new Float32Array(amplitudes.length);
  for (let i = 1; i < amplitudes.length; i++) {
    derivative[i] = Math.max(0, amplitudes[i] - amplitudes[i - 1]); // Only positive changes (onset)
  }
  
  // Smooth derivative
  const smoothed = new Float32Array(derivative.length);
  const windowSize = Math.max(2, Math.floor(sampleRate * 0.01)); // 10ms
  
  for (let i = 0; i < derivative.length; i++) {
    let sum = 0;
    let count = 0;
    for (let j = Math.max(0, i - windowSize); j <= Math.min(derivative.length - 1, i + windowSize); j++) {
      sum += derivative[j];
      count++;
    }
    smoothed[i] = sum / count;
  }
  
  // Find peaks in derivative (these are onset points)
  for (let i = 1; i < smoothed.length - 1; i++) {
    if (smoothed[i] > sensitivity &&
        smoothed[i] >= smoothed[i - 1] &&
        smoothed[i] >= smoothed[i + 1]) {
      
      const time = i / sampleRate;
      
      if (onsets.length === 0 || (time - onsets[onsets.length - 1].time) >= minOnsetDistance) {
        onsets.push({ time, strength: Math.min(1, smoothed[i] / 0.5) });
      }
    }
  }
  
  return onsets;
}

/**
 * Get energy level at a specific time
 */
export function getEnergyAtTime(waveform: WaveformData, time: number): number {
  const index = Math.floor(time * waveform.sampleRate);
  if (index < 0 || index >= waveform.amplitudes.length) return 0;
  return waveform.amplitudes[index];
}

/**
 * Get average energy in a time range
 */
export function getAverageEnergy(waveform: WaveformData, startTime: number, endTime: number): number {
  const startIdx = Math.max(0, Math.floor(startTime * waveform.sampleRate));
  const endIdx = Math.min(waveform.amplitudes.length - 1, Math.floor(endTime * waveform.sampleRate));
  
  if (startIdx >= endIdx) return 0;
  
  let sum = 0;
  for (let i = startIdx; i <= endIdx; i++) {
    sum += waveform.amplitudes[i];
  }
  
  return sum / (endIdx - startIdx + 1);
}

/**
 * Validate segment timing against audio energy
 * Returns confidence score (0-1) for each segment
 */
export function validateTimingWithAudio(
  segments: { start: number; end: number; text: string }[],
  waveform: WaveformData,
  silenceThreshold: number = 0.05
): { index: number; confidence: number; issue?: string }[] {
  return segments.map((seg, idx) => {
    const avgEnergy = getAverageEnergy(waveform, seg.start, seg.end);
    const startEnergy = getEnergyAtTime(waveform, seg.start);
    const endEnergy = getEnergyAtTime(waveform, seg.end);
    
    let confidence = 1;
    let issue: string | undefined;
    
    // Check if segment is during silence
    if (avgEnergy < silenceThreshold) {
      confidence = 0.2;
      issue = 'Segment nằm trong khoảng lặng';
    }
    
    // Check if start is at low energy (might be too early)
    if (startEnergy < silenceThreshold * 0.5 && avgEnergy > silenceThreshold) {
      confidence = Math.min(confidence, 0.6);
      issue = issue || 'Start có thể sớm hơn giọng hát';
    }
    
    // Check if end extends into silence (might be too late)
    if (endEnergy < silenceThreshold * 0.3 && avgEnergy > silenceThreshold) {
      const lastThirdEnergy = getAverageEnergy(waveform, seg.end - (seg.end - seg.start) / 3, seg.end);
      if (lastThirdEnergy < silenceThreshold) {
        confidence = Math.min(confidence, 0.5);
        issue = issue || 'End có thể trễ hơn giọng hát (kéo vào khoảng lặng)';
      }
    }
    
    return { index: idx, confidence, issue };
  });
}

/**
 * Get waveform slice for timeline rendering
 * Returns amplitude values for a specific time range
 */
export function getWaveformSlice(
  waveform: WaveformData,
  startTime: number,
  endTime: number,
  outputSamples: number = 200
): number[] {
  const startIdx = Math.max(0, Math.floor(startTime * waveform.sampleRate));
  const endIdx = Math.min(waveform.amplitudes.length, Math.floor(endTime * waveform.sampleRate));
  const inputLength = endIdx - startIdx;
  
  if (inputLength <= 0) return new Array(outputSamples).fill(0);
  
  const result: number[] = [];
  const step = inputLength / outputSamples;
  
  for (let i = 0; i < outputSamples; i++) {
    const idx = startIdx + Math.floor(i * step);
    const endSample = Math.min(startIdx + Math.floor((i + 1) * step), endIdx);
    
    // Peak value in this bucket
    let peak = 0;
    for (let j = idx; j < endSample; j++) {
      if (waveform.amplitudes[j] > peak) peak = waveform.amplitudes[j];
    }
    result.push(peak);
  }
  
  return result;
}
