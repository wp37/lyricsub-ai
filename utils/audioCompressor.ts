/**
 * Utilities for compressing audio in the browser using Web Audio API.
 * Downsamples to a mono 16kHz 16-bit PCM WAV to minimize payload size and avoid API rate limits/errors.
 */

export async function compressAudioToMonoWav(file: File, targetSampleRate = 16000): Promise<{ base64: string; mimeType: string }> {
  // For files already very small (< 2MB) and not WAV, we can skip processing to be safe and fast.
  if (file.size < 2 * 1024 * 1024 && file.type !== 'audio/wav' && file.type !== 'audio/x-wav') {
    return getRawBase64(file);
  }

  try {
    console.log(`Starting audio compression/downsampling for: ${file.name} (${(file.size / 1024 / 1024).toFixed(2)} MB)`);
    const arrayBuffer = await file.arrayBuffer();
    
    // We need AudioContext
    const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
    if (!AudioContextClass) {
      console.warn("AudioContext not supported, falling back to raw upload");
      return getRawBase64(file);
    }
    
    const audioCtx = new AudioContextClass();
    let audioBuffer: AudioBuffer;
    try {
      audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);
    } catch (decodeErr) {
      console.warn("Browser AudioContext could not decode this audio format. Falling back to raw file.", decodeErr);
      audioCtx.close();
      return getRawBase64(file);
    }
    audioCtx.close();

    const duration = audioBuffer.duration;
    const sampleCount = Math.round(duration * targetSampleRate);
    
    // Use OfflineAudioContext to perform resampling and channel mixing on the GPU/hardware thread
    const OfflineAudioContextClass = window.OfflineAudioContext || (window as any).webkitOfflineAudioContext;
    const offlineCtx = new OfflineAudioContextClass(1, sampleCount, targetSampleRate);
    
    const bufferSource = offlineCtx.createBufferSource();
    bufferSource.buffer = audioBuffer;
    bufferSource.connect(offlineCtx.destination);
    bufferSource.start();
    
    const renderedBuffer = await offlineCtx.startRendering();
    const channelData = renderedBuffer.getChannelData(0); // Mixed down to mono
    
    // Encode downsampled float data into 16-bit PCM WAV format
    const wavBuffer = encodeWAV(channelData, targetSampleRate);
    const base64 = bufferToBase64(wavBuffer);
    
    console.log(`Audio successfully compressed to 16kHz mono WAV. New size: ${(wavBuffer.byteLength / 1024 / 1024).toFixed(2)} MB`);
    
    return {
      base64,
      mimeType: 'audio/wav'
    };
  } catch (err) {
    console.error("Error compressing audio, falling back to raw upload:", err);
    return getRawBase64(file);
  }
}

async function getRawBase64(file: File): Promise<{ base64: string; mimeType: string }> {
  const reader = new FileReader();
  const base64Promise = new Promise<string>((resolve) => {
    reader.onload = () => resolve((reader.result as string).split(',')[1]);
    reader.readAsDataURL(file);
  });
  const base64 = await base64Promise;
  return { base64, mimeType: file.type };
}

function encodeWAV(samples: Float32Array, sampleRate: number): ArrayBuffer {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);
  
  /* RIFF identifier */
  writeString(view, 0, 'RIFF');
  /* file length */
  view.setUint32(4, 36 + samples.length * 2, true);
  /* RIFF type */
  writeString(view, 8, 'WAVE');
  /* format chunk identifier */
  writeString(view, 12, 'fmt ');
  /* format chunk length */
  view.setUint32(16, 16, true);
  /* sample format (raw PCM) */
  view.setUint16(20, 1, true);
  /* channel count (mono) */
  view.setUint16(22, 1, true);
  /* sample rate */
  view.setUint32(24, sampleRate, true);
  /* byte rate (sample rate * block align) */
  view.setUint32(28, sampleRate * 2, true);
  /* block align (channel count * bytes per sample) */
  view.setUint16(32, 2, true);
  /* bits per sample */
  view.setUint16(34, 16, true);
  /* data chunk identifier */
  writeString(view, 36, 'data');
  /* data chunk length */
  view.setUint32(40, samples.length * 2, true);
  
  floatTo16BitPCM(view, 44, samples);
  
  return buffer;
}

function floatTo16BitPCM(output: DataView, offset: number, input: Float32Array) {
  for (let i = 0; i < input.length; i++, offset += 2) {
    let s = Math.max(-1, Math.min(1, input[i]));
    output.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
  }
}

function writeString(view: DataView, offset: number, string: string) {
  for (let i = 0; i < string.length; i++) {
    view.setUint8(offset + i, string.charCodeAt(i));
  }
}

function bufferToBase64(buffer: ArrayBuffer): string {
  let binary = '';
  const bytes = new Uint8Array(buffer);
  const len = bytes.byteLength;
  const chunkLimit = 8192;
  
  // Use chunking to avoid Call Stack Size Exceeded errors for large arrays
  for (let i = 0; i < len; i += chunkLimit) {
    const chunk = bytes.subarray(i, i + chunkLimit);
    binary += String.fromCharCode.apply(null, chunk as any);
  }
  
  return window.btoa(binary);
}
