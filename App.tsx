
import React, { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import { 
  Upload, 
  Download, 
  FileText, 
  Loader2, 
  AlertCircle,
  Music,
  Sun,
  Moon,
  CheckCircle2,
  Cpu,
  Type as FontIcon,
  Copy,
  Trash2,
  Clock,
  Activity,
  RefreshCw,
  Edit3,
  Palette,
  Image as ImageIcon,
  Sparkles,
  Maximize2,
  Minimize2,
  ChevronRight,
  ChevronLeft,
  X,
  Key,
  BookOpen,
  LayoutGrid,
  Video,
  StopCircle,
  Film,
  Square,
  Play,
  Pause,
  ArrowRightLeft,
  Layers,
  Stamp,
  Highlighter,
  Move,
  Scaling,
  MoveVertical,
  AlignLeft,
  User,
  Timer,
  Zap,
  Smartphone,
  Monitor,
  Heart,
  ArrowRightToLine,
  ArrowLeftToLine,
  Target,
  Minus,
  Plus,
  SlidersHorizontal,
  SkipBack,
  SkipForward
} from 'lucide-react';
import { ProcessingMode, ExportFormat, SubtitleSegment, GeminiModel, TextCase, VisualizerStyle, VizColorMode, SubtitlePosition, TransitionEffect, CornerPosition, IntroAnimation, TextAlign, WordTiming, DisplayMode } from './types';

import { processAudioWithGemini, getAvailableModels, ModelInfo, optimizeForSuno, getStoredApiKey, setStoredApiKey, getEffectiveApiKey, refineTimingWithGemini } from './services/geminiService';
import { parseSegmentsToSRT, parseSegmentsToASS, parseSRTToSegments, shiftSubtitleTime, parseSegmentsToKaraokeASS, parseSegmentsToLRC, parseSegmentsToPlainLyrics } from './utils/converters';
import { compressAudioToMonoWav } from './utils/audioCompressor';
import SubtitleTimeline from './components/SubtitleTimeline';
import { runPostProcessing, autoSplitToWords } from './utils/timingPostProcessor';
import { extractWaveform, detectEnergyPeaks, WaveformData } from './utils/audioAnalyzer';

const MAX_FILE_SIZE = 100 * 1024 * 1024; // 100MB Limit
const SLIDE_DURATION = 10; // 10 seconds per slide
const TRANSITION_DURATION = 1; // 1 second transition
const SETTINGS_KEY = 'lyricsub_settings_v8'; // Bumped version
const KARAOKE_PREVIEW_TIME = 0.5; // Hiển thị trước 0.5 giây

// Updated Fonts List with 5 Karaoke Favorites
const FONTS = [
  { name: 'Be Vietnam Pro', value: 'Be Vietnam Pro, sans-serif' }, // Modern, Bold
  { name: 'Anton', value: 'Anton, sans-serif' }, // Impact style
  { name: 'Lobster', value: 'Lobster, cursive' }, // Fancy/Retro
  { name: 'Patrick Hand', value: 'Patrick Hand, cursive' }, // Handwritten
  { name: 'Comfortaa', value: 'Comfortaa, cursive' }, // Rounded
  { name: 'Inter Black', value: 'Inter, sans-serif' },
  { name: 'Oswald', value: 'Oswald, sans-serif' },
  { name: 'Dancing Script', value: 'Dancing Script, cursive' },
  { name: 'Serif Bold', value: 'serif' },
  { name: 'Monospace', value: 'monospace' }
];

// ===== TEXT RENDERING UTILITIES (Word Wrap + Auto Scale) =====

/**
 * Wrap text into multiple lines that fit within maxWidth
 * Returns array of line strings
 */
function wrapText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const words = text.split(' ');
  const lines: string[] = [];
  let currentLine = '';
  
  for (const word of words) {
    const testLine = currentLine ? `${currentLine} ${word}` : word;
    if (ctx.measureText(testLine).width > maxWidth && currentLine) {
      lines.push(currentLine);
      currentLine = word;
    } else {
      currentLine = testLine;
    }
  }
  if (currentLine) lines.push(currentLine);
  return lines.length > 0 ? lines : [text];
}

/**
 * Auto-scale font size so text fits within maxWidth
 * Returns the adjusted font size (min 50% of baseSize)
 */
function autoScaleFont(
  ctx: CanvasRenderingContext2D, 
  text: string, 
  maxWidth: number, 
  baseSize: number, 
  fontFamily: string,
  fontWeight: string = '900'
): number {
  let size = baseSize;
  const minSize = Math.max(24, baseSize * 0.5);
  ctx.font = `${fontWeight} ${size}px ${fontFamily}`;
  
  while (ctx.measureText(text).width > maxWidth && size > minSize) {
    size -= 2;
    ctx.font = `${fontWeight} ${size}px ${fontFamily}`;
  }
  return size;
}


// Helper to draw a specific visualizer frame
const renderVisualizerFrame = (
    ctx: CanvasRenderingContext2D,
    style: VisualizerStyle,
    dataArray: Uint8Array,
    bufferLength: number,
    width: number,
    height: number,
    amplitude: number,
    colorMode: VizColorMode,
    color1: string,
    color2: string
) => {
    const getFill = (i: number, total: number, val: number) => {
        if (colorMode === VizColorMode.SINGLE) return color1;
        if (colorMode === VizColorMode.GRADIENT) return i < total / 2 ? color1 : color2;
        return `hsla(${(i / total) * 360}, 70%, 60%, ${0.5 + (val / 255) * 0.5})`;
    };

    const cx = width / 2;
    const cy = height / 2;

    switch (style) {
        case VisualizerStyle.NONE:
            return;
        case VisualizerStyle.BARS: {
            const barW = (width / bufferLength) * 2;
            let x = 0;
            for (let i = 0; i < bufferLength; i++) {
                const h = (dataArray[i] / 255) * height * 0.5 * amplitude;
                ctx.fillStyle = getFill(i, bufferLength, dataArray[i]);
                ctx.fillRect(x, height - h, barW, h);
                x += barW;
            }
            break;
        }
        case VisualizerStyle.CIRCLE: {
            const r = Math.min(width, height) * 0.25;
            for (let i = 0; i < bufferLength; i++) {
                const ang = (i / bufferLength) * Math.PI * 2;
                const amp = (dataArray[i] / 255) * (r * amplitude);
                ctx.beginPath();
                ctx.moveTo(cx + Math.cos(ang) * r, cy + Math.sin(ang) * r);
                ctx.lineTo(cx + Math.cos(ang) * (r + amp), cy + Math.sin(ang) * (r + amp));
                ctx.strokeStyle = getFill(i, bufferLength, dataArray[i]);
                ctx.lineWidth = 2;
                ctx.stroke();
            }
            break;
        }
        case VisualizerStyle.WAVE: {
            ctx.beginPath();
            ctx.lineWidth = 3;
            ctx.strokeStyle = color1;
            const slice = width / bufferLength;
            let x = 0;
            for (let i = 0; i < bufferLength; i++) {
                const v = dataArray[i] / 128.0;
                const y = cy + (v - 1) * height * 0.3 * amplitude;
                if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
                x += slice;
            }
            ctx.stroke();
            break;
        }
        case VisualizerStyle.PIXELS: {
            const size = width / 40; 
            const cols = 40;
            const startX = cx - (cols * size)/2;
            for(let i=0; i<bufferLength && i < cols; i++) {
                const h = Math.floor((dataArray[i*2]/255) * 15 * amplitude);
                ctx.fillStyle = getFill(i, cols, dataArray[i*2]);
                for(let j=0; j<h; j++) ctx.fillRect(startX + i*size, cy + (size*2) - j*size, size-1, size-1);
            }
            break;
        }
        case VisualizerStyle.PARTICLES: {
             for (let i = 0; i < bufferLength; i += 5) {
                const s = (dataArray[i] / 255) * 5 * amplitude;
                const ang = i;
                const dist = (i/bufferLength) * (Math.min(width,height)/2);
                ctx.beginPath();
                ctx.arc(cx + Math.cos(ang)*dist, cy + Math.sin(ang)*dist, s + 2, 0, Math.PI*2);
                ctx.fillStyle = getFill(i, bufferLength, dataArray[i]);
                ctx.fill();
             }
             break;
        }
        case VisualizerStyle.MIRROR: {
             const w = (width/bufferLength) * 4;
             let x = 0;
             for(let i=0; i<bufferLength; i++){
                 const h = (dataArray[i]/255) * height * 0.3 * amplitude;
                 ctx.fillStyle = getFill(i, bufferLength, dataArray[i]);
                 ctx.fillRect(x, cy - h, w, h*2);
                 x += w;
             }
             break;
        }
        case VisualizerStyle.BLOCKS: {
             const bW = width / 40;
             for(let i=0; i<bufferLength; i+=8) {
                 const l = Math.floor((dataArray[i]/255)*10*amplitude);
                 ctx.fillStyle = getFill(i, bufferLength, dataArray[i]);
                 for(let j=0; j<l; j++) ctx.fillRect((i/bufferLength)*width, height - j*(bW*1.2), bW, bW);
             }
             break;
        }
        case VisualizerStyle.SPECTRUM: {
             ctx.beginPath();
             for(let i=0; i<bufferLength; i++){
                 const h = (dataArray[i]/255)*height*0.8*amplitude;
                 const x = (i/bufferLength)*width;
                 if(i===0) ctx.moveTo(x, height-h); else ctx.lineTo(x, height-h);
             }
             ctx.strokeStyle = colorMode === VizColorMode.RAINBOW ? 'white' : color1;
             ctx.lineWidth = 2;
             ctx.stroke();
             break;
        }
        case VisualizerStyle.CIRCULAR_BARS: {
             const r = Math.min(width,height)*0.15;
             for(let i=0; i<bufferLength; i+=3) {
                 const ang = (i/bufferLength)*Math.PI*2;
                 const h = (dataArray[i]/255)*100*amplitude;
                 ctx.save();
                 ctx.translate(cx, cy);
                 ctx.rotate(ang);
                 ctx.fillStyle = getFill(i, bufferLength, dataArray[i]);
                 ctx.fillRect(r, -2, h, 4);
                 ctx.restore();
             }
             break;
        }
        case VisualizerStyle.DUAL_WAVE: {
             ctx.beginPath();
             ctx.strokeStyle = color1;
             ctx.lineWidth = 3;
             let x=0; const slice=width/bufferLength;
             for(let i=0; i<bufferLength; i++) {
                 const v = dataArray[i]/128.0;
                 const dev = (v-1)*height*0.2*amplitude;
                 if(i===0) ctx.moveTo(x, cy-10+dev); else ctx.lineTo(x, cy-10+dev);
                 x+=slice;
             }
             ctx.stroke();
             ctx.beginPath();
             ctx.strokeStyle = color2;
             x=0;
             for(let i=0; i<bufferLength; i++) {
                 const v = dataArray[i]/128.0;
                 const dev = (v-1)*height*0.2*amplitude;
                 if(i===0) ctx.moveTo(x, cy+10-dev); else ctx.lineTo(x, cy+10-dev);
                 x+=slice;
             }
             ctx.stroke();
             break;
        }
        case VisualizerStyle.SYMMETRY: {
             const c = width/2;
             const w = (c)/(bufferLength/2);
             for(let i=0; i<bufferLength/2; i++){
                 const h = (dataArray[i]/255)*height*0.4*amplitude;
                 ctx.fillStyle = getFill(i, bufferLength/2, dataArray[i]);
                 ctx.fillRect(c + i*w, cy-h, w, h*2);
                 ctx.fillRect(c - (i+1)*w, cy-h, w, h*2);
             }
             break;
        }
        case VisualizerStyle.RINGS: {
            for(let i=0; i<5; i++) {
                 const val = dataArray[i * 10] || 0;
                 const r = (Math.min(width,height)/10) * (i+1) + (val/255)*20*amplitude;
                 ctx.beginPath();
                 ctx.arc(cx, cy, r, 0, Math.PI*2);
                 ctx.strokeStyle = getFill(i*10, bufferLength, val);
                 ctx.lineWidth = 2 + (val/255)*5*amplitude;
                 ctx.stroke();
            }
            break;
        }
        case VisualizerStyle.HEXAGON: {
            const r = Math.min(width, height) * 0.3 * amplitude;
            const points = 6;
            ctx.beginPath();
            for(let i=0; i<=points; i++) {
                const idx = Math.floor((i/points)*bufferLength*0.5);
                const val = dataArray[idx];
                const bump = (val/255)*50*amplitude;
                const ang = i * 2 * Math.PI / points;
                const x = cx + (r+bump) * Math.cos(ang);
                const y = cy + (r+bump) * Math.sin(ang);
                if(i===0) ctx.moveTo(x,y); else ctx.lineTo(x,y);
            }
            ctx.closePath();
            ctx.strokeStyle = color1;
            ctx.lineWidth = 4;
            ctx.stroke();
            ctx.fillStyle = color2 + '44';
            ctx.fill();
            break;
        }
        case VisualizerStyle.HUD: {
             const r = Math.min(width, height) * 0.25;
             ctx.beginPath();
             ctx.arc(cx, cy, r, 0, Math.PI*2);
             ctx.strokeStyle = color1;
             ctx.lineWidth = 2;
             ctx.stroke();
             
             for(let i=0; i<bufferLength; i+=10) {
                 const ang = (i/bufferLength) * Math.PI * 2;
                 const len = (dataArray[i]/255) * 50 * amplitude;
                 ctx.save();
                 ctx.translate(cx, cy);
                 ctx.rotate(ang);
                 ctx.fillStyle = color2;
                 ctx.fillRect(r + 5, -1, len, 2);
                 ctx.restore();
             }
             break;
        }
        case VisualizerStyle.SPIRAL: {
            ctx.beginPath();
            let angle = 0;
            let radius = 0;
            ctx.moveTo(cx, cy);
            for(let i=0; i<bufferLength; i++) {
                const val = dataArray[i];
                radius += 0.5;
                angle += 0.1;
                const bump = (val/255) * 20 * amplitude;
                const x = cx + (radius + bump) * Math.cos(angle);
                const y = cy + (radius + bump) * Math.sin(angle);
                ctx.lineTo(x, y);
                ctx.strokeStyle = getFill(i, bufferLength, val);
            }
            ctx.stroke();
            break;
        }
        case VisualizerStyle.HEART: {
            ctx.beginPath();
            const scale = Math.min(width,height) / 400 * amplitude;
            for(let i=0; i<bufferLength; i+=5) {
                const t = (i/bufferLength) * Math.PI * 2;
                const val = dataArray[i]/255;
                // Heart formula
                const x = 16 * Math.pow(Math.sin(t), 3);
                const y = -(13 * Math.cos(t) - 5 * Math.cos(2*t) - 2 * Math.cos(3*t) - Math.cos(4*t));
                
                const bump = val * 5;
                const px = cx + (x * (10 + bump)) * scale;
                const py = cy + (y * (10 + bump)) * scale;
                
                if(i===0) ctx.moveTo(px,py); else ctx.lineTo(px,py);
            }
            ctx.closePath();
            ctx.fillStyle = color1;
            ctx.fill();
            break;
        }
        case VisualizerStyle.SHOCKWAVE: {
             const bass = dataArray[10] / 255;
             const r = Math.min(width,height) * 0.4 * bass * amplitude;
             
             ctx.beginPath();
             ctx.arc(cx, cy, r, 0, Math.PI*2);
             ctx.strokeStyle = color1;
             ctx.lineWidth = 10 * bass;
             ctx.stroke();
             
             ctx.beginPath();
             ctx.arc(cx, cy, r * 1.5, 0, Math.PI*2);
             ctx.strokeStyle = color2;
             ctx.lineWidth = 5 * bass;
             ctx.stroke();
             break;
        }
        case VisualizerStyle.ECLIPSE: {
             const val = dataArray[5] / 255;
             const r = Math.min(width, height) * 0.2;
             
             // Glow
             const gradient = ctx.createRadialGradient(cx, cy, r, cx, cy, r * (1 + val*amplitude));
             gradient.addColorStop(0, 'black');
             gradient.addColorStop(0.5, color1);
             gradient.addColorStop(1, 'transparent');
             
             ctx.fillStyle = gradient;
             ctx.fillRect(0,0,width,height);
             
             // Black circle
             ctx.beginPath();
             ctx.arc(cx, cy, r, 0, Math.PI*2);
             ctx.fillStyle = 'black';
             ctx.fill();
             break;
        }
        case VisualizerStyle.STARFIELD: {
             for(let i=0; i<bufferLength; i+=10) {
                 const val = dataArray[i] / 255;
                 if(val > 0.1) {
                     const rx = (Math.sin(i)*10000)%width;
                     const ry = (Math.cos(i)*10000)%height;
                     const x = (rx + width)/2 % width;
                     const y = (ry + height)/2 % height;
                     const size = val * 5 * amplitude;
                     ctx.beginPath();
                     ctx.arc(x, y, size, 0, Math.PI*2);
                     ctx.fillStyle = getFill(i, bufferLength, dataArray[i]);
                     ctx.fill();
                 }
             }
             break;
        }
        case VisualizerStyle.OSCILLOSCOPE: {
             ctx.beginPath();
             ctx.strokeStyle = '#00ff00';
             if(colorMode !== VizColorMode.SINGLE) ctx.strokeStyle = color1;
             
             ctx.lineWidth = 2;
             for(let i=0; i<bufferLength; i++) {
                 const v = dataArray[i] / 128.0;
                 const y = cy + (v - 1) * height/2 * amplitude;
                 const x = (i/bufferLength) * width;
                 if(i===0) ctx.moveTo(x,y); else ctx.lineTo(x,y);
             }
             ctx.stroke();
             break;
        }
        case VisualizerStyle.LUMI: {
            const val = dataArray[20] / 255;
            const r = Math.min(width,height) * 0.1 + (val * 100 * amplitude);
            
            ctx.shadowBlur = 50;
            ctx.shadowColor = color1;
            ctx.beginPath();
            ctx.arc(cx, cy, r, 0, Math.PI*2);
            ctx.fillStyle = color2;
            ctx.fill();
            ctx.shadowBlur = 0;
            break;
        }
    }
}

// Mini Preview Component
const VizPreviewItem: React.FC<{
  styleName: VisualizerStyle;
  isSelected: boolean;
  onSelect: () => void;
  color1: string;
  color2: string;
}> = React.memo(({ styleName, isSelected, onSelect, color1, color2 }) => {
    const canvasRef = useRef<HTMLCanvasElement>(null);

    useEffect(() => {
        const canvas = canvasRef.current;
        if(!canvas) return;
        const ctx = canvas.getContext('2d');
        if(!ctx) return;

        const bufferLength = 32;
        const data = new Uint8Array(bufferLength);
        for(let i=0; i<bufferLength; i++) {
            data[i] = 100 + Math.sin(i/5)*50 + Math.random()*50;
        }

        ctx.clearRect(0,0,canvas.width, canvas.height);
        
        renderVisualizerFrame(
            ctx, styleName, data, bufferLength, 
            canvas.width, canvas.height, 
            0.8, VizColorMode.GRADIENT, color1, color2
        );

    }, [styleName, color1, color2]);

    return (
        <button 
            onClick={onSelect}
            className={`relative flex flex-col items-center gap-2 p-2 rounded-xl border-2 transition-all hover:bg-slate-100 dark:hover:bg-slate-800 ${isSelected ? 'border-indigo-500 bg-indigo-50 dark:bg-indigo-900/20' : 'border-transparent'}`}
        >
            <div className="w-full aspect-square bg-slate-900 rounded-lg overflow-hidden relative shadow-inner">
                 <canvas ref={canvasRef} width={80} height={80} className="w-full h-full" />
                 {isSelected && (
                     <div className="absolute inset-0 bg-indigo-500/20 flex items-center justify-center">
                         <div className="w-6 h-6 bg-indigo-500 rounded-full flex items-center justify-center">
                             <CheckCircle2 className="w-4 h-4 text-white" />
                         </div>
                     </div>
                 )}
            </div>
            <span className="text-[9px] font-bold uppercase text-center w-full truncate">{styleName}</span>
        </button>
    )
});

const DEFAULT_CONFIG = {
  model: GeminiModel.V3_FLASH,
  mode: ProcessingMode.SUBTITLES, // Default Mode
  aspectRatio: '16:9', // Default Aspect Ratio
  bgType: 'color',
  bgColor: '#0b0a09', // Luxurious Onyx Velvet Black
  bgImageOpacity: 0.5,
  transitionEffect: TransitionEffect.FADE,
  iconPos: CornerPosition.TOP_RIGHT,
  iconSize: 50,
  vizStyle: VisualizerStyle.BARS,
  vizAmplitude: 1.0,
  vizColorMode: VizColorMode.GRADIENT, // Default to Gradient for prestigious looks
  vizColor1: '#df9c10', // Imperial Gold
  vizColor2: '#f6aa1c', // Royal Sunset Gold
  
  vizIsFullWidth: true,
  vizPosX: 50, 
  vizPosY: 80, 
  vizScale: 1.0,

  subFont: FONTS[0].value,
  subSize: 64,
  subPos: SubtitlePosition.BOTTOM_CENTER,
  subOffset: 0,
  subColorMode: VizColorMode.SINGLE,
  subColor1: '#ffffff',
  subColor2: '#df9c10', // Radiant gold
  isKaraoke: true, // Default Karaoke ON
  displayMode: DisplayMode.KARAOKE, // Default Display Mode
  karaokeColor: '#df9c10', // Luxurious gold fills
  karaokeBorderColor: '#ffffff',
  textCase: TextCase.NORMAL,
  
  // NEW KARAOKE SETTINGS
  preShowTime: 2.0,
  line1Align: TextAlign.CENTER,
  line2Align: TextAlign.CENTER,
  lineGap: 1.2,
  
  // INTRO SETTINGS
  introDuration: 10,
  introPos: SubtitlePosition.MIDDLE_CENTER,
  introAnimIn: IntroAnimation.FADE,
  introAnimOut: IntroAnimation.FADE,
  
  titleFont: FONTS[1].value, // Default Anton
  titleSize: 100,
  titleColorMode: VizColorMode.GRADIENT,
  titleColor1: '#ffffff',
  titleColor2: '#df9c10', // Elegant Gold
  artistFont: FONTS[0].value,
  artistSize: 60,
  artistColorMode: VizColorMode.GRADIENT,
  artistColor1: '#faf9f5',
  artistColor2: '#f6aa1c' // Luxurious warm gold
};

const App: React.FC = () => {
  const loadSettings = () => {
    try {
      const saved = localStorage.getItem(SETTINGS_KEY);
      if (saved) return { ...DEFAULT_CONFIG, ...JSON.parse(saved) };
    } catch (e) { console.error("Failed to load settings", e); }
    return DEFAULT_CONFIG;
  };

  const initialSettings = loadSettings();

  // --- State ---
  const [isDark, setIsDark] = useState(() => document.documentElement.classList.contains('dark'));
  const [showApiKeyDialog, setShowApiKeyDialog] = useState(false);
  const [autoSelectModel, setAutoSelectModel] = useState<boolean>(() => {
    try {
      const saved = localStorage.getItem('lyricsub_auto_select_model');
      return saved !== 'false';
    } catch {
      return true;
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem('lyricsub_auto_select_model', String(autoSelectModel));
    } catch (e) {
      console.error(e);
    }
  }, [autoSelectModel]);
  const [apiKeyInput, setApiKeyInput] = useState(() => getStoredApiKey());
  const [hasApiKey, setHasApiKey] = useState(() => !!getEffectiveApiKey());
  const [file, setFile] = useState<File | null>(null);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [playbackSpeed, setPlaybackSpeed] = useState<number>(1.0);
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<string>('');
  const [duration, setDuration] = useState<number>(0);
  const [currentTime, setCurrentTime] = useState<number>(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [copySuccess, setCopySuccess] = useState(false);
  const [activeTab, setActiveTab] = useState<'editor' | 'player' | 'suno'>('editor');
  const [sunoInput, setSunoInput] = useState<string>('');
  const [sunoGenre, setSunoGenre] = useState<string>('');
  const [sunoTempo, setSunoTempo] = useState<string>('');
  const [sunoVocals, setSunoVocals] = useState<string>('');
  const [sunoMood, setSunoMood] = useState<string>('');
  const [sunoInstruments, setSunoInstruments] = useState<string>('');
  const [isSunoOptimizing, setIsSunoOptimizing] = useState<boolean>(false);
  const [sunoCopyStyleSuccess, setSunoCopyStyleSuccess] = useState<boolean>(false);
  const [sunoCopyLyricsSuccess, setSunoCopyLyricsSuccess] = useState<boolean>(false);
  const [sunoResult, setSunoResult] = useState<{
    styleTags: string;
    lyrics: string;
    vibeDescription: string;
    vietnameseGuide: string;
  } | null>(null);
  const [referenceLyrics, setReferenceLyrics] = useState<string>('');
  const [showRefLyrics, setShowRefLyrics] = useState(true);
  const [showIntro, setShowIntro] = useState(false);
  const [isFullScreen, setIsFullScreen] = useState(false);
  const [timeShiftAmount, setTimeShiftAmount] = useState<string>('0');
  const [language, setLanguage] = useState<string>('Auto');

  // Metadata State (Not Persisted, resets on file change)
  const [songTitle, setSongTitle] = useState('');
  const [artistName, setArtistName] = useState('');

  // Persisted
  const [mode, setMode] = useState<ProcessingMode>(initialSettings.mode);
  const [format, setFormat] = useState<ExportFormat>(ExportFormat.SRT);
  const [model, setModel] = useState<string>(initialSettings.model);
  const [availableModels, setAvailableModels] = useState<ModelInfo[]>([]);
  
  useEffect(() => {
    getAvailableModels().then(models => {
      setAvailableModels(models);
      // Determine the best model for default (prefer flash models because pro has extremely low free limits)
      if (models.length > 0 && !models.find(m => m.name === model)) {
          const best = models.find(m => m.name.includes('flash')) || models[0];
          setModel(best.name);
      }
    });
  }, []);

  const [textCase, setTextCase] = useState<TextCase>(initialSettings.textCase);

  const [aspectRatio, setAspectRatio] = useState<'16:9' | '9:16'>(initialSettings.aspectRatio);
  const [bgType, setBgType] = useState<'color' | 'image' | 'video'>(initialSettings.bgType);
  const [bgColor, setBgColor] = useState(initialSettings.bgColor);
  const [bgImages, setBgImages] = useState<string[]>([]);
  const [bgVideos, setBgVideos] = useState<string[]>([]);
  const [bgImageOpacity, setBgImageOpacity] = useState<number>(initialSettings.bgImageOpacity);
  const [transitionEffect, setTransitionEffect] = useState<TransitionEffect>(initialSettings.transitionEffect);

  const [iconImage, setIconImage] = useState<string | null>(null);
  const [iconPos, setIconPos] = useState<CornerPosition>(initialSettings.iconPos);
  const [iconSize, setIconSize] = useState<number>(initialSettings.iconSize);

  const [vizStyle, setVizStyle] = useState<VisualizerStyle>(initialSettings.vizStyle);
  const [vizAmplitude, setVizAmplitude] = useState<number>(initialSettings.vizAmplitude);
  const [vizColorMode, setVizColorMode] = useState<VizColorMode>(initialSettings.vizColorMode);
  const [vizColor1, setVizColor1] = useState(initialSettings.vizColor1);
  const [vizColor2, setVizColor2] = useState(initialSettings.vizColor2);
  
  const [vizIsFullWidth, setVizIsFullWidth] = useState<boolean>(initialSettings.vizIsFullWidth ?? true);
  const [vizPosX, setVizPosX] = useState<number>(initialSettings.vizPosX ?? 50);
  const [vizPosY, setVizPosY] = useState<number>(initialSettings.vizPosY ?? 80);
  const [vizScale, setVizScale] = useState<number>(initialSettings.vizScale ?? 1.0);

  const [subFont, setSubFont] = useState(initialSettings.subFont);
  const [subSize, setSubSize] = useState(initialSettings.subSize);
  const [subPos, setSubPos] = useState<SubtitlePosition>(initialSettings.subPos);
  const [subOffset, setSubOffset] = useState<number>(initialSettings.subOffset ?? 0);
  const [subColorMode, setSubColorMode] = useState<VizColorMode>(initialSettings.subColorMode);
  const [subColor1, setSubColor1] = useState(initialSettings.subColor1);
  const [subColor2, setSubColor2] = useState(initialSettings.subColor2);
  const [isKaraoke, setIsKaraoke] = useState(initialSettings.isKaraoke);
  const [displayMode, setDisplayMode] = useState<DisplayMode>(() => {
    if (initialSettings.displayMode) return initialSettings.displayMode;
    return initialSettings.isKaraoke === false ? DisplayMode.TEXT_OVERLAY : DisplayMode.KARAOKE;
  });
  const [karaokeColor, setKaraokeColor] = useState(initialSettings.karaokeColor);
  const [karaokeBorderColor, setKaraokeBorderColor] = useState(initialSettings.karaokeBorderColor ?? '#ffffff');

  // NEW STATE
  const [preShowTime, setPreShowTime] = useState<number>(initialSettings.preShowTime ?? 2.0);
  const [line1Align, setLine1Align] = useState<TextAlign>(initialSettings.line1Align ?? TextAlign.CENTER);
  const [line2Align, setLine2Align] = useState<TextAlign>(initialSettings.line2Align ?? TextAlign.CENTER);
  const [lineGap, setLineGap] = useState<number>(initialSettings.lineGap ?? 1.2);
  const [selectedSegmentIndex, setSelectedSegmentIndex] = useState<number | null>(null);

  // Intro Settings
  const [introDuration, setIntroDuration] = useState<number>(initialSettings.introDuration);
  const [introPos, setIntroPos] = useState<SubtitlePosition>(initialSettings.introPos);
  const [introAnimIn, setIntroAnimIn] = useState<IntroAnimation>(initialSettings.introAnimIn);
  const [introAnimOut, setIntroAnimOut] = useState<IntroAnimation>(initialSettings.introAnimOut);
  
  const [titleFont, setTitleFont] = useState(initialSettings.titleFont);
  const [titleSize, setTitleSize] = useState(initialSettings.titleSize);
  const [titleColorMode, setTitleColorMode] = useState<VizColorMode>(initialSettings.titleColorMode);
  const [titleColor1, setTitleColor1] = useState(initialSettings.titleColor1);
  const [titleColor2, setTitleColor2] = useState(initialSettings.titleColor2);

  const [artistFont, setArtistFont] = useState(initialSettings.artistFont);
  const [artistSize, setArtistSize] = useState(initialSettings.artistSize);
  const [artistColorMode, setArtistColorMode] = useState<VizColorMode>(initialSettings.artistColorMode);
  const [artistColor1, setArtistColor1] = useState(initialSettings.artistColor1);
  const [artistColor2, setArtistColor2] = useState(initialSettings.artistColor2);


  const [isRecording, setIsRecording] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [exportProgress, setExportProgress] = useState(0);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordedChunksRef = useRef<Blob[]>([]);

  // ===== NEW: Module states =====
  const [enableMultiPass, setEnableMultiPass] = useState<boolean>(false);
  const [refinementStatus, setRefinementStatus] = useState<string>('');
  const [enablePostProcess, setEnablePostProcess] = useState<boolean>(true);
  const [enableWordLevel, setEnableWordLevel] = useState<boolean>(true);
  const [waveformData, setWaveformData] = useState<WaveformData | null>(null);
  const [isAnalyzingAudio, setIsAnalyzingAudio] = useState<boolean>(false);
  const [enableAutoSnap, setEnableAutoSnap] = useState<boolean>(true);
  const audioBase64CacheRef = useRef<{base64: string; mimeType: string} | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const bgInputRef = useRef<HTMLInputElement>(null);
  const bgVideoInputRef = useRef<HTMLInputElement>(null);
  const iconInputRef = useRef<HTMLInputElement>(null);
  const audioPlayerRef = useRef<HTMLAudioElement>(null);
  const bgVideoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const playerContainerRef = useRef<HTMLDivElement>(null);
  const analyzerRef = useRef<AnalyserNode | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const audioDestRef = useRef<MediaStreamAudioDestinationNode | null>(null);
  const animationFrameRef = useRef<number>(0);
  
  const bgImageObjsRef = useRef<HTMLImageElement[]>([]);
  const iconImageObjRef = useRef<HTMLImageElement | null>(null);
  const parsedSegmentsRef = useRef<SubtitleSegment[]>([]);
  const dataArrayRef = useRef<Uint8Array | null>(null);

  useEffect(() => {
    const settings = {
      model, mode, textCase, aspectRatio,
      bgType, bgColor, bgImageOpacity, transitionEffect,
      iconPos, iconSize,
      vizStyle, vizAmplitude, vizColorMode, vizColor1, vizColor2, 
      vizIsFullWidth, vizPosX, vizPosY, vizScale,
      subFont, subSize, subPos, subOffset, subColorMode, subColor1, subColor2,
      isKaraoke, displayMode, karaokeColor, karaokeBorderColor,
      preShowTime, line1Align, line2Align, lineGap, // Add new settings
      introDuration, introPos, introAnimIn, introAnimOut,
      titleFont, titleSize, titleColorMode, titleColor1, titleColor2,
      artistFont, artistSize, artistColorMode, artistColor1, artistColor2
    };
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  }, [model, mode, textCase, aspectRatio, bgType, bgColor, bgImageOpacity, transitionEffect, iconPos, iconSize, vizStyle, vizAmplitude, vizColorMode, vizColor1, vizColor2, vizIsFullWidth, vizPosX, vizPosY, vizScale, subFont, subSize, subPos, subOffset, subColorMode, subColor1, subColor2, isKaraoke, displayMode, karaokeColor, karaokeBorderColor, preShowTime, line1Align, line2Align, lineGap, introDuration, introPos, introAnimIn, introAnimOut, titleFont, titleSize, titleColorMode, titleColor1, titleColor2, artistFont, artistSize, artistColorMode, artistColor1, artistColor2]);

  // Load Images
  useEffect(() => {
    if (bgType === 'image' && bgImages.length > 0) {
      bgImageObjsRef.current = [];
      bgImages.forEach(src => {
        const img = new Image();
        img.src = src;
        bgImageObjsRef.current.push(img);
      });
    } else {
      bgImageObjsRef.current = [];
    }
  }, [bgType, bgImages]);

  useEffect(() => {
    if (iconImage) {
      const img = new Image();
      img.src = iconImage;
      img.onload = () => { iconImageObjRef.current = img; };
    } else {
      iconImageObjRef.current = null;
    }
  }, [iconImage]);

  const parsedSegments = useMemo(() => {
    if (!result || mode === ProcessingMode.LYRICS) return [];
    return parseSRTToSegments(result);
  }, [result, mode]);

  // Sync ref with parsed segments and Force Draw if paused (for immediate visual feedback when editing)
  useEffect(() => {
    parsedSegmentsRef.current = parsedSegments;
    // Force draw one frame if paused to show updates
    if (!isPlaying && !isRecording) {
        requestAnimationFrame(draw);
    }
  }, [parsedSegments, isPlaying, isRecording]);

  // Auto-scroll lyrics panel to active segment
  useEffect(() => {
    if (!isPlaying || parsedSegments.length === 0) return;
    const activeIdx = parsedSegments.findIndex(s => currentTime >= s.start && currentTime <= s.end);
    if (activeIdx >= 0) {
      const el = document.getElementById(`lyric-line-${activeIdx}`);
      const container = document.getElementById('lyrics-panel-scroll');
      if (el && container) {
        const elTop = el.offsetTop - container.offsetTop;
        const targetScroll = elTop - container.clientHeight / 2 + el.clientHeight / 2;
        container.scrollTo({ top: targetScroll, behavior: 'smooth' });
      }
    }
  }, [Math.floor(currentTime), isPlaying, parsedSegments]);

  useEffect(() => {
    if (isDark) {
      document.documentElement.classList.add('dark');
      localStorage.setItem('theme', 'dark');
    } else {
      document.documentElement.classList.remove('dark');
      localStorage.setItem('theme', 'light');
    }
  }, [isDark]);

  useEffect(() => {
    const handleFsChange = () => setIsFullScreen(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', handleFsChange);
    return () => document.removeEventListener('fullscreenchange', handleFsChange);
  }, []);

  // Audio Loop
  useEffect(() => {
    const player = audioPlayerRef.current;
    if (!player) return;

    const onTimeUpdate = () => setCurrentTime(player.currentTime);
    const onPlay = () => {
        setIsPlaying(true);
        // Sync Background Video
        if (bgType === 'video' && bgVideoRef.current) {
            bgVideoRef.current.play().catch(e => console.log("Bg video play error", e));
        }
    };
    const onPause = () => {
        setIsPlaying(false);
        // Sync Background Video
        if (bgVideoRef.current) bgVideoRef.current.pause();
    };
    
    const onEnded = () => {
      setIsPlaying(false);
      if (bgVideoRef.current) bgVideoRef.current.pause();
      if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
        mediaRecorderRef.current.stop();
        setIsRecording(false);
      }
    };

    player.addEventListener('timeupdate', onTimeUpdate);
    player.addEventListener('play', onPlay);
    player.addEventListener('pause', onPause);
    player.addEventListener('ended', onEnded);
    player.playbackRate = playbackSpeed;

    if (!audioContextRef.current && (isPlaying || isRecording)) {
      audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
      analyzerRef.current = audioContextRef.current.createAnalyser();
      audioDestRef.current = audioContextRef.current.createMediaStreamDestination();
      
      const source = audioContextRef.current.createMediaElementSource(player);
      source.connect(analyzerRef.current);
      source.connect(audioContextRef.current.destination);
      source.connect(audioDestRef.current);
      analyzerRef.current.fftSize = 512;
    }

    if (isPlaying || isRecording) draw();
    else cancelAnimationFrame(animationFrameRef.current);

    return () => {
      player.removeEventListener('timeupdate', onTimeUpdate);
      player.removeEventListener('play', onPlay);
      player.removeEventListener('pause', onPause);
      player.removeEventListener('ended', onEnded);
      cancelAnimationFrame(animationFrameRef.current);
    };
  }, [playbackSpeed, audioUrl, isPlaying, isRecording, vizStyle, vizAmplitude, vizColorMode, vizColor1, vizColor2, vizIsFullWidth, vizPosX, vizPosY, vizScale, subFont, subSize, subPos, subOffset, subColorMode, subColor1, subColor2, bgType, bgColor, bgImageOpacity, transitionEffect, iconPos, iconSize, isKaraoke, displayMode, karaokeColor, karaokeBorderColor, introDuration, introPos, introAnimIn, introAnimOut, songTitle, artistName, titleFont, titleSize, titleColorMode, titleColor1, titleColor2, artistFont, artistSize, artistColorMode, artistColor1, artistColor2, aspectRatio]);

  // Main Draw Function
  const draw = useCallback((overrideTime?: number, overrideAnalyser?: AnalyserNode) => {
    if (!canvasRef.current) return;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const t = (typeof overrideTime === 'number') ? overrideTime : (audioPlayerRef.current?.currentTime || 0);
    const analyzer = overrideAnalyser || analyzerRef.current;
    if (!analyzer) return;

    const bufferLength = analyzer.frequencyBinCount;
    
    if (!dataArrayRef.current || dataArrayRef.current.length !== bufferLength) {
      dataArrayRef.current = new Uint8Array(bufferLength);
    }
    const dataArray = dataArrayRef.current;
    analyzer.getByteFrequencyData(dataArray);

    // 1. Background
    ctx.fillStyle = bgColor;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    if (bgType === 'image' && bgImageObjsRef.current.length > 0) {
      const imgs = bgImageObjsRef.current;
      const numImages = imgs.length;
      const currentSlideIndex = Math.floor((t / SLIDE_DURATION)) % numImages;
      const nextSlideIndex = (currentSlideIndex + 1) % numImages;
      const timeInSlide = t % SLIDE_DURATION;
      const currentImg = imgs[currentSlideIndex];
      const nextImg = imgs[nextSlideIndex];
      
      ctx.save();
      ctx.globalAlpha = bgImageOpacity;
      const isTransitioning = timeInSlide > (SLIDE_DURATION - TRANSITION_DURATION) && numImages > 1;

      if (!isTransitioning) {
         if (currentImg && currentImg.complete) ctx.drawImage(currentImg, 0, 0, canvas.width, canvas.height);
      } else {
        const progress = (timeInSlide - (SLIDE_DURATION - TRANSITION_DURATION)) / TRANSITION_DURATION;
        if (currentImg && currentImg.complete) ctx.drawImage(currentImg, 0, 0, canvas.width, canvas.height);
        if (nextImg && nextImg.complete) {
            ctx.globalAlpha = bgImageOpacity * progress;
            ctx.drawImage(nextImg, 0, 0, canvas.width, canvas.height);
        }
      }
      ctx.restore();
    } else if (bgType === 'video' && bgVideoRef.current) {
        // Draw Background Video (Cover Fit)
        const vid = bgVideoRef.current;
        if (vid.readyState >= 2) {
             const scale = Math.max(canvas.width / vid.videoWidth, canvas.height / vid.videoHeight);
             const x = (canvas.width / 2) - (vid.videoWidth / 2) * scale;
             const y = (canvas.height / 2) - (vid.videoHeight / 2) * scale;
             ctx.drawImage(vid, x, y, vid.videoWidth * scale, vid.videoHeight * scale);
        }
    }

    // 2. Draw Visualizer (Using standardized helper)
    ctx.save();
    let renderW = canvas.width;
    let renderH = canvas.height;
    if (!vizIsFullWidth) {
        const cx = (vizPosX / 100) * canvas.width;
        const cy = (vizPosY / 100) * canvas.height;
        ctx.translate(cx, cy);
        ctx.scale(vizScale, vizScale);
        ctx.translate(-canvas.width/2, -canvas.height/2);
    } 
    renderVisualizerFrame(
        ctx, vizStyle, dataArray, bufferLength, 
        canvas.width, canvas.height, 
        vizAmplitude, vizColorMode, vizColor1, vizColor2
    );
    ctx.restore();

    // 3. INTRO / TITLE & ARTIST DISPLAY
    if (songTitle && t < introDuration) {
        ctx.save();
        
        // Animation Logic
        const animDuration = 1.5; // Duration for entrance/exit animations
        let alpha = 1;
        
        let inProgress = Math.min(1, t / animDuration);
        let outProgress = Math.min(1, (introDuration - t) / animDuration);
        
        // Helper to apply transformations
        const applyAnim = (animType: IntroAnimation, progress: number, isOut: boolean) => {
            if (animType === IntroAnimation.NONE) return;
            
            const p = isOut ? progress : (1 - progress); // Invert for Entrance (starts from offset -> 0)
            const dir = isOut ? 1 : -1;
            
            if (animType === IntroAnimation.FADE) {
                alpha *= progress;
            } else if (animType === IntroAnimation.ZOOM_IN) {
                // In: Scale 0 -> 1. Out: Scale 1 -> 2
                const s = isOut ? 1 + (1-progress) : progress;
                ctx.translate(canvas.width/2, canvas.height/2);
                ctx.scale(s, s);
                ctx.translate(-canvas.width/2, -canvas.height/2);
                alpha *= progress; // Fade implicitly with zoom looks better
            } else if (animType === IntroAnimation.ZOOM_OUT) {
                const s = isOut ? progress : 1.5 - (0.5 * progress);
                ctx.translate(canvas.width/2, canvas.height/2);
                ctx.scale(s, s);
                ctx.translate(-canvas.width/2, -canvas.height/2);
                alpha *= progress;
            } else if (animType === IntroAnimation.SLIDE_UP) {
                ctx.translate(0, 100 * p * dir);
                alpha *= progress;
            } else if (animType === IntroAnimation.SLIDE_DOWN) {
                ctx.translate(0, -100 * p * dir);
                alpha *= progress;
            } else if (animType === IntroAnimation.SLIDE_LEFT) {
                ctx.translate(100 * p * dir, 0);
                alpha *= progress;
            } else if (animType === IntroAnimation.SLIDE_RIGHT) {
                ctx.translate(-100 * p * dir, 0);
                alpha *= progress;
            }
        };

        if (t < animDuration) {
            applyAnim(introAnimIn, inProgress, false);
        } else if (t > introDuration - animDuration) {
            applyAnim(introAnimOut, outProgress, true);
        }

        ctx.globalAlpha = alpha;

        // Determine Position
        let iX = canvas.width / 2;
        let iY = canvas.height / 2;
        const padding = 120;

        if (introPos.includes('left')) iX = canvas.width * 0.15;
        else if (introPos.includes('right')) iX = canvas.width * 0.85;

        if (introPos.includes('top')) iY = canvas.height * 0.2 + padding;
        else if (introPos.includes('bottom')) iY = canvas.height * 0.8 - padding;
        
        if (introPos === SubtitlePosition.MIDDLE_CENTER) { iX = canvas.width/2; iY = canvas.height/2; }

        let textAlign: CanvasTextAlign = 'center';
        if (introPos.includes('left')) textAlign = 'left';
        else if (introPos.includes('right')) textAlign = 'right';
        ctx.textAlign = textAlign;
        ctx.textBaseline = 'middle';

        // --- DRAW TITLE ---
        ctx.font = `bold ${titleSize}px ${titleFont.split(',')[0]}`;
        const titleMetrics = ctx.measureText(songTitle);
        
        let titleFill: string | CanvasGradient;
        if (titleColorMode === VizColorMode.SINGLE) {
            titleFill = titleColor1;
        } else {
            const grad = ctx.createLinearGradient(iX - titleMetrics.width/2, 0, iX + titleMetrics.width/2, 0);
            if (titleColorMode === VizColorMode.GRADIENT) {
                grad.addColorStop(0, titleColor1);
                grad.addColorStop(1, titleColor2);
            } else {
                // Rainbow
                grad.addColorStop(0, '#ff0000'); grad.addColorStop(0.2, '#ffff00'); grad.addColorStop(0.4, '#00ff00'); 
                grad.addColorStop(0.6, '#00ffff'); grad.addColorStop(0.8, '#0000ff'); grad.addColorStop(1, '#ff00ff');
            }
            titleFill = grad;
        }

        ctx.shadowColor = 'rgba(0,0,0,0.5)';
        ctx.shadowBlur = 10;
        ctx.fillStyle = titleFill;
        ctx.fillText(songTitle, iX, iY);
        
        // --- DRAW ARTIST (Below Title) ---
        if (artistName) {
            const artistY = iY + titleSize + 10; // Offset relative to Title
            ctx.font = `bold ${artistSize}px ${artistFont.split(',')[0]}`;
            const artistMetrics = ctx.measureText(artistName);
            
            let artistFill: string | CanvasGradient;
             if (artistColorMode === VizColorMode.SINGLE) {
                artistFill = artistColor1;
            } else {
                const grad = ctx.createLinearGradient(iX - artistMetrics.width/2, 0, iX + artistMetrics.width/2, 0);
                if (artistColorMode === VizColorMode.GRADIENT) {
                    grad.addColorStop(0, artistColor1);
                    grad.addColorStop(1, artistColor2);
                } else {
                    grad.addColorStop(0, '#ff0000'); grad.addColorStop(1, '#0000ff');
                }
                artistFill = grad;
            }
            
            ctx.fillStyle = artistFill;
            ctx.fillText(artistName, iX, artistY);
        }

        ctx.restore();
    }

    // 4. Subtitles
    if (audioPlayerRef.current && parsedSegmentsRef.current.length > 0) {
      if (displayMode === DisplayMode.TELEPROMPTER) {
         // --- TELEPROMPTER MODE (Smooth Spotify-style Vertical Scrolling) ---
         const allSegments = parsedSegmentsRef.current;
         let activeIdx = allSegments.findIndex(s => t >= s.start && t <= s.end);
         if (activeIdx === -1) {
             activeIdx = allSegments.findIndex(s => t < s.start);
             if (activeIdx === -1) {
                 activeIdx = allSegments.length - 1;
             }
         }

         const centerY = canvas.height / 2 + subOffset;
         const lineSpacing = subSize * lineGap;

         let scrollProgress = 0;
         if (activeIdx < allSegments.length - 1) {
             const nextSeg = allSegments[activeIdx + 1];
             const transitionWindow = 0.6; // 600ms transition window
             const transitionStart = nextSeg.start - transitionWindow;
             if (t >= transitionStart && t <= nextSeg.start) {
                 scrollProgress = (t - transitionStart) / transitionWindow;
             } else if (t > nextSeg.start) {
                 scrollProgress = 1;
             }
         }
         const currentScrollIndex = activeIdx + scrollProgress;

         const startIdx = Math.max(0, activeIdx - 6);
         const endIdx = Math.min(allSegments.length - 1, activeIdx + 6);

         const maxTextWidth = canvas.width * 0.85; // Max 85% of canvas width

         for (let i = startIdx; i <= endIdx; i++) {
             const segment = allSegments[i];
             const y = centerY + (i - currentScrollIndex) * lineSpacing;

             const distFromCenter = Math.abs(i - currentScrollIndex);
             const opacity = Math.max(0, 1 - distFromCenter * 0.22);

             const scale = Math.max(0.7, 1 - distFromCenter * 0.1);
             const currentSize = subSize * scale;

             ctx.save();
             // Auto-scale font if text is too wide
             const fontFamily = subFont.split(',')[0];
             const actualSize = autoScaleFont(ctx, segment.text, maxTextWidth, currentSize, fontFamily, '900');
             ctx.font = `900 ${actualSize}px ${fontFamily}`;
             ctx.textAlign = 'center';
             ctx.textBaseline = 'middle';
             ctx.globalAlpha = opacity;

             // Wrap text if still too wide after scaling
             const wrappedLines = wrapText(ctx, segment.text, maxTextWidth);
             const lineH = actualSize * 1.2;

             const totalWidth = ctx.measureText(segment.text).width;
             const baseX = canvas.width / 2;
             const startX = baseX - totalWidth / 2;

             let fillStyle: string | CanvasGradient;
             const isActive = (i === activeIdx);

             if (isActive) {
                 ctx.shadowColor = karaokeColor;
                 ctx.shadowBlur = 15;
                 fillStyle = karaokeColor;
             } else {
                 ctx.shadowBlur = 0;
                 fillStyle = 'rgba(255, 255, 255, 0.7)';
             }

             // Draw each wrapped line
             const linesStartY = y - ((wrappedLines.length - 1) * lineH) / 2;
             wrappedLines.forEach((line, lineIdx) => {
                 const ly = linesStartY + lineIdx * lineH;
                 
                 // Base Text Stroke
                 ctx.lineJoin = 'round';
                 ctx.lineWidth = actualSize * 0.1;
                 ctx.strokeStyle = 'rgba(0, 0, 0, 0.8)';
                 ctx.strokeText(line, baseX, ly);

                 // Fill Text
                 ctx.fillStyle = fillStyle;
                 ctx.fillText(line, baseX, ly);
             });

             // Karaoke word-level highlight overlay for active segment
             if (isActive) {
                 ctx.save();
                 ctx.beginPath();

                 const easeInOutCubic = (x: number): number => {
                   return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
                 };

                 let totalFillPx = 0;
                 if (segment.words && segment.words.length > 0) {
                     let charIndex = 0;
                     let accumulatedTime = 0;
                     segment.words.forEach((w, wIdx) => {
                         const wordText = w.word;
                         const wordStartPx = ctx.measureText(segment.text.substring(0, charIndex)).width;
                         const nextCharIndex = wIdx === segment.words!.length - 1 ? segment.text.length : charIndex + wordText.length + 1;
                         const nextStartPx = ctx.measureText(segment.text.substring(0, nextCharIndex)).width;
                         const wDuration = w.duration / 1000;
                         const wStart = segment.start + (accumulatedTime / 1000);
                         const wEnd = wStart + wDuration;

                         if (t >= wEnd) {
                             totalFillPx = Math.max(totalFillPx, nextStartPx);
                         } else if (t > wStart) {
                             const rawRatio = (t - wStart) / wDuration;
                             const easedRatio = easeInOutCubic(Math.max(0, Math.min(1, rawRatio)));
                             totalFillPx = Math.max(totalFillPx, wordStartPx + easedRatio * (nextStartPx - wordStartPx));
                         }
                         charIndex = nextCharIndex;
                         accumulatedTime += w.duration;
                     });
                     if (totalFillPx > 0) {
                         // Clip covers all wrapped lines
                         const clipY = linesStartY - actualSize;
                         const clipH = wrappedLines.length * lineH + actualSize;
                         ctx.rect(startX, clipY, totalFillPx, clipH);
                     }
                 } else {
                     const segDuration = segment.end - segment.start;
                     const rawProgress = Math.max(0, Math.min(1, (t - segment.start) / segDuration));
                     const easedProgress = easeInOutCubic(rawProgress);
                     const clipY = linesStartY - actualSize;
                     const clipH = wrappedLines.length * lineH + actualSize;
                     ctx.rect(startX, clipY, totalWidth * easedProgress, clipH);
                 }
                 ctx.clip();

                 // Redraw with karaoke color over clip
                 wrappedLines.forEach((line, lineIdx) => {
                     const ly = linesStartY + lineIdx * lineH;
                     ctx.shadowColor = karaokeColor;
                     ctx.shadowBlur = 20;
                     ctx.fillStyle = karaokeColor;
                     ctx.fillText(line, baseX, ly);

                     ctx.strokeStyle = karaokeBorderColor;
                     ctx.lineWidth = Math.max(1, actualSize * 0.05);
                     ctx.shadowBlur = 0;
                     ctx.strokeText(line, baseX, ly);
                 });
                 ctx.restore();
             }

             ctx.restore();
         }
      } else if (displayMode === DisplayMode.SCRIPT) {
         // --- SCRIPT MODE (Large Text 2/3 Screen - for News/Education) ---
         const allSegments = parsedSegmentsRef.current;
         let activeIdx = allSegments.findIndex(s => t >= s.start && t <= s.end);
         if (activeIdx === -1) {
             activeIdx = allSegments.findIndex(s => t < s.start);
             if (activeIdx === -1) activeIdx = allSegments.length - 1;
             else if (activeIdx > 0) activeIdx -= 1;
         }

         const segment = allSegments[activeIdx];
         if (segment) {
             const panelH = canvas.height * 0.67; // 2/3 screen
             const panelY = canvas.height - panelH;
             const padding = canvas.width * 0.06;
             const maxTextWidth = canvas.width - padding * 2;

             // Draw dark panel background
             ctx.save();
             const panelGrad = ctx.createLinearGradient(0, panelY, 0, canvas.height);
             panelGrad.addColorStop(0, 'rgba(8, 8, 8, 0.92)');
             panelGrad.addColorStop(1, 'rgba(3, 3, 3, 0.98)');
             ctx.fillStyle = panelGrad;
             ctx.fillRect(0, panelY, canvas.width, panelH);
             // Top divider line
             ctx.strokeStyle = karaokeColor + '60';
             ctx.lineWidth = 2;
             ctx.beginPath();
             ctx.moveTo(padding, panelY + 4);
             ctx.lineTo(canvas.width - padding, panelY + 4);
             ctx.stroke();
             ctx.restore();

             // Auto-size font to fill the panel area
             const fontFamily = subFont.split(',')[0];
             const targetLineCount = 4; // Aim for ~4 lines
             let scriptFontSize = Math.min(subSize * 1.5, (panelH - padding * 2) / (targetLineCount * 1.4));
             scriptFontSize = autoScaleFont(ctx, segment.text, maxTextWidth, scriptFontSize, fontFamily, '900');
             ctx.font = `900 ${scriptFontSize}px ${fontFamily}`;

             const wrappedLines = wrapText(ctx, segment.text, maxTextWidth);
             const lineH = scriptFontSize * 1.4;
             const totalTextH = wrappedLines.length * lineH;
             const textStartY = panelY + (panelH - totalTextH) / 2 + scriptFontSize / 2;

             // Karaoke progress for the segment
             const segDuration = segment.end - segment.start;
             const segProgress = Math.max(0, Math.min(1, (t - segment.start) / segDuration));

             // Draw text lines
             ctx.save();
             ctx.textAlign = 'left';
             ctx.textBaseline = 'middle';

             wrappedLines.forEach((line, i) => {
                 const ly = textStartY + i * lineH;
                 
                 // Stroke
                 ctx.lineJoin = 'round';
                 ctx.lineWidth = scriptFontSize * 0.08;
                 ctx.strokeStyle = 'rgba(0,0,0,0.9)';
                 ctx.strokeText(line, padding, ly);
                 
                 // Fill base (dimmed white)
                 ctx.fillStyle = 'rgba(255, 255, 255, 0.5)';
                 ctx.fillText(line, padding, ly);
             });

             // Karaoke highlight overlay - progressive reveal
             if (segment.words && segment.words.length > 0) {
                 // Word-level: calculate total fill pixels across all wrapped lines
                 let charIndex = 0;
                 let accumulatedTime = 0;
                 let totalFillPx = 0;
                 const fullTextWidth = ctx.measureText(segment.text).width;

                 segment.words.forEach((w, wIdx) => {
                     const wordStartPx = ctx.measureText(segment.text.substring(0, charIndex)).width;
                     const nextCharIndex = wIdx === segment.words!.length - 1 ? segment.text.length : charIndex + w.word.length + 1;
                     const nextStartPx = ctx.measureText(segment.text.substring(0, nextCharIndex)).width;
                     const wDuration = w.duration / 1000;
                     const wStart = segment.start + (accumulatedTime / 1000);
                     const wEnd = wStart + wDuration;

                     if (t >= wEnd) {
                         totalFillPx = Math.max(totalFillPx, nextStartPx);
                     } else if (t > wStart) {
                         const ratio = (t - wStart) / wDuration;
                         totalFillPx = Math.max(totalFillPx, wordStartPx + ratio * (nextStartPx - wordStartPx));
                     }
                     charIndex = nextCharIndex;
                     accumulatedTime += w.duration;
                 });

                 if (totalFillPx > 0) {
                     ctx.save();
                     ctx.beginPath();
                     ctx.rect(0, panelY, padding + totalFillPx, panelH);
                     ctx.clip();
                     wrappedLines.forEach((line, i) => {
                         const ly = textStartY + i * lineH;
                         ctx.shadowColor = karaokeColor;
                         ctx.shadowBlur = 12;
                         ctx.fillStyle = karaokeColor;
                         ctx.fillText(line, padding, ly);
                         ctx.shadowBlur = 0;
                     });
                     ctx.restore();
                 }
             } else {
                 // Segment-level fallback
                 const fillW = wrappedLines.reduce((max, line) => Math.max(max, ctx.measureText(line).width), 0);
                 ctx.save();
                 ctx.beginPath();
                 ctx.rect(0, panelY, padding + fillW * segProgress, panelH);
                 ctx.clip();
                 wrappedLines.forEach((line, i) => {
                     const ly = textStartY + i * lineH;
                     ctx.shadowColor = karaokeColor;
                     ctx.shadowBlur = 12;
                     ctx.fillStyle = karaokeColor;
                     ctx.fillText(line, padding, ly);
                     ctx.shadowBlur = 0;
                 });
                 ctx.restore();
             }

             ctx.restore();

             // Show next segment preview (dimmed, below current)
             if (activeIdx < allSegments.length - 1) {
                 const nextSeg = allSegments[activeIdx + 1];
                 const previewY = canvas.height - scriptFontSize * 0.8;
                 ctx.save();
                 ctx.font = `700 ${scriptFontSize * 0.4}px ${fontFamily}`;
                 ctx.textAlign = 'right';
                 ctx.textBaseline = 'middle';
                 ctx.globalAlpha = 0.3;
                 ctx.fillStyle = 'white';
                 const nextPreview = nextSeg.text.length > 50 ? nextSeg.text.substring(0, 50) + '...' : nextSeg.text;
                 ctx.fillText('▸ ' + nextPreview, canvas.width - padding, previewY);
                 ctx.restore();
             }
         }
      } else if (displayMode === DisplayMode.NEWS_TICKER) {
         // --- NEWS TICKER MODE (Slow vertical scroll of wrapped text blocks) ---
         const allSegments = parsedSegmentsRef.current;
         const fontFamily = subFont.split(',')[0];
         const tickerFontSize = Math.min(subSize, 56);
         const maxW = canvas.width * 0.85;
         const padding = canvas.width * 0.075;

         // Draw ticker background bar (bottom 30%)
         const barH = canvas.height * 0.30;
         const barY = canvas.height - barH;
         ctx.save();
         const barGrad = ctx.createLinearGradient(0, barY, 0, canvas.height);
         barGrad.addColorStop(0, 'rgba(6, 6, 6, 0.90)');
         barGrad.addColorStop(1, 'rgba(2, 2, 2, 0.98)');
         ctx.fillStyle = barGrad;
         ctx.fillRect(0, barY, canvas.width, barH);
         // Top accent line
         ctx.strokeStyle = karaokeColor;
         ctx.lineWidth = 3;
         ctx.beginPath();
         ctx.moveTo(0, barY);
         ctx.lineTo(canvas.width, barY);
         ctx.stroke();
         ctx.restore();

         // Find relevant segments (current + a few around)
         let activeIdx = allSegments.findIndex(s => t >= s.start && t <= s.end);
         if (activeIdx === -1) {
             activeIdx = allSegments.findIndex(s => t < s.start);
             if (activeIdx === -1) activeIdx = allSegments.length - 1;
             else if (activeIdx > 0) activeIdx -= 1;
         }

         // Calculate scroll - smooth vertical crawl (reading speed ~150 WPM)
         const readingSpeedPxPerSec = tickerFontSize * 0.8; // Pixels per second
         const lineH = tickerFontSize * 1.5;

         // Accumulate line heights for all segments up to current
         let totalScrollOffset = 0;
         for (let i = 0; i < activeIdx; i++) {
             ctx.font = `900 ${tickerFontSize}px ${fontFamily}`;
             const lines = wrapText(ctx, allSegments[i].text, maxW);
             totalScrollOffset += lines.length * lineH + lineH * 0.5; // gap between segments
         }

         // Add progress within current segment
         if (allSegments[activeIdx]) {
             const seg = allSegments[activeIdx];
             const segProgress = Math.max(0, Math.min(1, (t - seg.start) / (seg.end - seg.start)));
             ctx.font = `900 ${tickerFontSize}px ${fontFamily}`;
             const currentLines = wrapText(ctx, seg.text, maxW);
             totalScrollOffset += segProgress * (currentLines.length * lineH);
         }

         // Draw scrolling text within clipped bar area
         ctx.save();
         ctx.beginPath();
         ctx.rect(0, barY + 8, canvas.width, barH - 8);
         ctx.clip();

         const anchorY = barY + barH * 0.5; // Center of bar
         let drawY = anchorY - totalScrollOffset;

         ctx.font = `900 ${tickerFontSize}px ${fontFamily}`;
         ctx.textAlign = 'left';
         ctx.textBaseline = 'middle';

         for (let i = 0; i < allSegments.length; i++) {
             const seg = allSegments[i];
             const lines = wrapText(ctx, seg.text, maxW);
             const isActive = (i === activeIdx);
             const isPast = (t > seg.end);

             lines.forEach((line, li) => {
                 const ly = drawY + li * lineH;
                 if (ly > barY - lineH && ly < canvas.height + lineH) {
                     // Stroke
                     ctx.lineJoin = 'round';
                     ctx.lineWidth = tickerFontSize * 0.08;
                     ctx.strokeStyle = 'rgba(0,0,0,0.8)';
                     ctx.strokeText(line, padding, ly);

                     // Fill
                     if (isActive) {
                         ctx.shadowColor = karaokeColor;
                         ctx.shadowBlur = 10;
                         ctx.fillStyle = karaokeColor;
                     } else if (isPast) {
                         ctx.shadowBlur = 0;
                         ctx.fillStyle = 'rgba(255,255,255,0.35)';
                     } else {
                         ctx.shadowBlur = 0;
                         ctx.fillStyle = 'rgba(255,255,255,0.65)';
                     }
                     ctx.fillText(line, padding, ly);
                     ctx.shadowBlur = 0;
                 }
             });
             drawY += lines.length * lineH + lineH * 0.5;
         }
         ctx.restore();

      } else {
         // --- STANDARD SEGMENT-BASED DRAWING (KARAOKE, TEXT OVERLAY, MARQUEE, SPLIT SCREEN) ---
         const visibleSegments = parsedSegmentsRef.current.filter(s => 
             t >= (s.start - preShowTime) && t <= (s.end + 0.5)
         );

         // Render Split Screen, Left or Right background once if active
         if ((displayMode === DisplayMode.SPLIT_SCREEN || displayMode === DisplayMode.SPLIT_LEFT || displayMode === DisplayMode.SPLIT_RIGHT) && visibleSegments.length > 0) {
              ctx.save();
              if (displayMode === DisplayMode.SPLIT_SCREEN) {
                  const panelH = canvas.height * 0.35;
                  const panelY = canvas.height - panelH;
                  const panelGrad = ctx.createLinearGradient(0, panelY, 0, canvas.height);
                  panelGrad.addColorStop(0, 'rgba(10, 10, 10, 0.85)');
                  panelGrad.addColorStop(1, 'rgba(3, 3, 3, 0.98)');
                  ctx.fillStyle = panelGrad;
                  ctx.fillRect(0, panelY, canvas.width, panelH);
                  ctx.strokeStyle = 'rgba(255, 255, 255, 0.12)';
                  ctx.lineWidth = 1.5;
                  ctx.beginPath();
                  ctx.moveTo(0, panelY);
                  ctx.lineTo(canvas.width, panelY);
                  ctx.stroke();
              } else {
                  const panelW = canvas.width * 0.5;
                  const panelX = displayMode === DisplayMode.SPLIT_LEFT ? 0 : canvas.width * 0.5;
                  const panelGrad = ctx.createLinearGradient(panelX, 0, panelX + panelW, 0);
                  panelGrad.addColorStop(0, 'rgba(12, 12, 12, 0.85)');
                  panelGrad.addColorStop(1, 'rgba(6, 6, 6, 0.96)');
                  ctx.fillStyle = panelGrad;
                  ctx.fillRect(panelX, 0, panelW, canvas.height);
                  ctx.strokeStyle = 'rgba(255, 255, 255, 0.15)';
                  ctx.lineWidth = 1.5;
                  ctx.beginPath();
                  const dividerX = displayMode === DisplayMode.SPLIT_LEFT ? panelW : panelX;
                  ctx.moveTo(dividerX, 0);
                  ctx.lineTo(dividerX, canvas.height);
                  ctx.stroke();
              }
              ctx.restore();
         }

         visibleSegments.forEach((segment) => {
              let lineNum = segment.lineNumber;
              if (!lineNum) {
                  const segIndex = parsedSegmentsRef.current.indexOf(segment);
                  lineNum = (segIndex % 2) === 0 ? 1 : 2; 
              }

              let baseX = canvas.width / 2;
              let baseY = canvas.height / 2;
              let align: CanvasTextAlign = 'center';

              const currentAlign = lineNum === 1 ? line1Align : line2Align;
              if (currentAlign === TextAlign.LEFT) {
                  baseX = canvas.width * 0.1;
                  align = 'left';
              } else if (currentAlign === TextAlign.RIGHT) {
                  baseX = canvas.width * 0.9;
                  align = 'right';
              }

              // Override coordinates for MARQUEE, SPLIT SCREEN, SPLIT LEFT/RIGHT
              if (displayMode === DisplayMode.MARQUEE) {
                  baseY = canvas.height - 70 + subOffset;
                  align = 'left';
              } else if (displayMode === DisplayMode.SPLIT_SCREEN) {
                  const panelH = canvas.height * 0.35;
                  const panelY = canvas.height - panelH;
                  baseY = panelY + (panelH / 2) + subOffset;
                  if (lineNum === 2) {
                      baseY += (subSize * 0.9);
                  } else {
                      const hasLine2 = visibleSegments.some(s => {
                          const idx = parsedSegmentsRef.current.indexOf(s);
                          const l = s.lineNumber || ((idx % 2) === 0 ? 1 : 2);
                          return l === 2;
                      });
                      if (hasLine2) baseY -= (subSize * 0.4);
                  }
              } else if (displayMode === DisplayMode.SPLIT_LEFT || displayMode === DisplayMode.SPLIT_RIGHT) {
                  baseX = displayMode === DisplayMode.SPLIT_LEFT ? canvas.width * 0.25 : canvas.width * 0.75;
                  align = 'center';
                  baseY = canvas.height / 2 + subOffset;
                  if (lineNum === 2) {
                      baseY += (subSize * 0.75);
                  } else {
                      const hasLine2 = visibleSegments.some(s => {
                          const idx = parsedSegmentsRef.current.indexOf(s);
                          const l = s.lineNumber || ((idx % 2) === 0 ? 1 : 2);
                          return l === 2;
                      });
                      if (hasLine2) baseY -= (subSize * 0.5);
                  }
              } else {
                  if (subPos.includes('top')) baseY = canvas.height * 0.1 + subOffset;
                  else if (subPos.includes('bottom')) baseY = canvas.height * 0.9 - subOffset;
                  else baseY = canvas.height / 2 + subOffset;

                  if (lineNum === 2) {
                      baseY += (subSize * lineGap);
                  }
              }

              ctx.save();
              const fontFamily = subFont.split(',')[0];
              // Determine max text width based on display mode
              let maxTextWidth = canvas.width * 0.85;
              if (displayMode === DisplayMode.SPLIT_LEFT || displayMode === DisplayMode.SPLIT_RIGHT) {
                  maxTextWidth = canvas.width * 0.42; // Half screen minus margin
              } else if (displayMode === DisplayMode.SPLIT_SCREEN) {
                  maxTextWidth = canvas.width * 0.85;
              }

              // Auto-scale font for non-marquee modes
              let actualSubSize = subSize;
              if (displayMode !== DisplayMode.MARQUEE) {
                  actualSubSize = autoScaleFont(ctx, segment.text, maxTextWidth, subSize, fontFamily, '900');
              }
              ctx.font = `900 ${actualSubSize}px ${fontFamily}`;
              ctx.textAlign = align;
              ctx.textBaseline = 'middle';

              // Wrap text if still too wide (non-marquee only)
              const wrappedLines = displayMode === DisplayMode.MARQUEE 
                  ? [segment.text] 
                  : wrapText(ctx, segment.text, maxTextWidth);
              const wrapLineH = actualSubSize * 1.2;

              const totalWidth = ctx.measureText(segment.text).width;
              
              let startX = baseX;
              if (align === 'center') startX = baseX - totalWidth / 2;
              else if (align === 'right') startX = baseX - totalWidth;

              // If Marquee mode, calculate scrolling startX (reading-speed pacing)
              if (displayMode === DisplayMode.MARQUEE) {
                  const segDuration = segment.end - segment.start;
                  // Reading-speed: ~200 WPM → ~3.3 words/sec → scroll speed proportional to text length
                  const wordCount = segment.text.split(' ').length;
                  const readingTime = Math.max(3, wordCount / 3.3); // Min 3 seconds
                  // Use the LONGER of segment duration or reading time
                  const scrollDuration = Math.max(segDuration, readingTime);
                  const elapsed = t - segment.start;
                  const progress = Math.max(0, Math.min(1, elapsed / scrollDuration));
                  startX = canvas.width - progress * (canvas.width + totalWidth);
                  baseX = startX; // We draw text at startX since align is left
                  
                  // Sleek horizontal background bar for ticker
                  ctx.restore();
                  ctx.save();
                  ctx.fillStyle = 'rgba(10, 10, 10, 0.65)';
                  ctx.fillRect(0, baseY - actualSubSize - 10, canvas.width, (actualSubSize + 10) * 2);
                  ctx.strokeStyle = 'rgba(255, 255, 255, 0.1)';
                  ctx.lineWidth = 1;
                  ctx.strokeRect(-1, baseY - actualSubSize - 10, canvas.width + 2, (actualSubSize + 10) * 2);
                  ctx.restore();
                  
                  ctx.save();
                  ctx.font = `900 ${actualSubSize}px ${fontFamily}`;
                  ctx.textAlign = 'left';
                  ctx.textBaseline = 'middle';
              }

              let fillStyle: string | CanvasGradient;
              if (subColorMode === VizColorMode.SINGLE) {
                  fillStyle = subColor1;
              } else {
                  const grad = ctx.createLinearGradient(startX, 0, startX + totalWidth, 0);
                  if (subColorMode === VizColorMode.GRADIENT) {
                      grad.addColorStop(0, subColor1);
                      grad.addColorStop(1, subColor2);
                  } else {
                      grad.addColorStop(0, '#ff0000'); grad.addColorStop(0.2, '#ffff00'); grad.addColorStop(0.4, '#00ff00'); 
                      grad.addColorStop(0.6, '#00ffff'); grad.addColorStop(0.8, '#0000ff'); grad.addColorStop(1, '#ff00ff');
                  }
                  fillStyle = grad;
              }

              // Draw wrapped lines (base text)
              const linesStartY = baseY - ((wrappedLines.length - 1) * wrapLineH) / 2;
              wrappedLines.forEach((line, lineIdx) => {
                  const ly = linesStartY + lineIdx * wrapLineH;
                  const lx = displayMode === DisplayMode.MARQUEE ? baseX : baseX; // Keep baseX for all
                  
                  // Base Text Stroke
                  ctx.lineJoin = 'round';
                  ctx.lineWidth = actualSubSize * 0.1;
                  ctx.strokeStyle = 'black';
                  ctx.shadowColor = 'rgba(0,0,0,0.5)';
                  ctx.shadowBlur = 4;
                  ctx.strokeText(line, lx, ly);
                  
                  ctx.fillStyle = fillStyle;
                  ctx.fillText(line, lx, ly);
              });

              // Draw Highlighted Overlay
              const showHighlight = (displayMode === DisplayMode.KARAOKE) || 
                                    (displayMode === DisplayMode.SPLIT_SCREEN) ||
                                    (displayMode === DisplayMode.MARQUEE) ||
                                    (displayMode === DisplayMode.SPLIT_LEFT) ||
                                    (displayMode === DisplayMode.SPLIT_RIGHT);

              if (showHighlight) {
                  ctx.save();
                  ctx.beginPath();
                  
                  const easeInOutCubic = (x: number): number => {
                    return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
                  };
                  
                  let totalFillPx = 0;
                  let isActivelyFilling = false;
                  
                  // Clip region height covers all wrapped lines
                  const clipY = linesStartY - actualSubSize;
                  const clipH = wrappedLines.length * wrapLineH + actualSubSize;
                  
                  if (segment.words && segment.words.length > 0) {
                      let charIndex = 0;
                      let accumulatedTime = 0;

                      segment.words.forEach((w, wIdx) => {
                          const wordText = w.word;
                          const wordStartPx = ctx.measureText(segment.text.substring(0, charIndex)).width;
                          const nextCharIndex = wIdx === segment.words!.length - 1 ? segment.text.length : charIndex + wordText.length + 1;
                          const nextStartPx = ctx.measureText(segment.text.substring(0, nextCharIndex)).width;

                          const wDuration = w.duration / 1000;
                          const wStart = segment.start + (accumulatedTime / 1000);
                          const wEnd = wStart + wDuration;
                          
                          if (t >= wEnd) {
                              totalFillPx = Math.max(totalFillPx, nextStartPx);
                          } else if (t > wStart) {
                              isActivelyFilling = true;
                              const rawRatio = (t - wStart) / wDuration;
                              const easedRatio = easeInOutCubic(Math.max(0, Math.min(1, rawRatio)));
                              
                              const wordPixelWidth = nextStartPx - wordStartPx;
                              totalFillPx = Math.max(totalFillPx, wordStartPx + easedRatio * wordPixelWidth);
                          }

                          charIndex = nextCharIndex;
                          accumulatedTime += w.duration;
                      });
                      
                      if (totalFillPx > 0) {
                          ctx.rect(startX, clipY, totalFillPx, clipH);
                      }
                  } else {
                      const segDuration = segment.end - segment.start;
                      const rawProgress = Math.max(0, Math.min(1, (t - segment.start) / segDuration));
                      const easedProgress = easeInOutCubic(rawProgress);
                      const fillW = totalWidth * easedProgress;
                      isActivelyFilling = rawProgress > 0 && rawProgress < 1;
                      ctx.rect(startX, clipY, fillW, clipH);
                  }
                  
                  ctx.clip();
                  
                  const glowIntensity = isActivelyFilling ? 20 : 10;
                  
                  // Redraw karaoke highlight over all wrapped lines
                  wrappedLines.forEach((line, lineIdx) => {
                      const ly = linesStartY + lineIdx * wrapLineH;
                      ctx.shadowColor = karaokeColor;
                      ctx.shadowBlur = glowIntensity;
                      ctx.fillStyle = karaokeColor;
                      ctx.fillText(line, baseX, ly);
                  });
                  
                  if (isActivelyFilling) {
                    wrappedLines.forEach((line, lineIdx) => {
                        const ly = linesStartY + lineIdx * wrapLineH;
                        ctx.shadowBlur = glowIntensity * 2;
                        ctx.globalAlpha = 0.3;
                        ctx.fillText(line, baseX, ly);
                        ctx.globalAlpha = 1;
                    });
                  }
                  
                  wrappedLines.forEach((line, lineIdx) => {
                      const ly = linesStartY + lineIdx * wrapLineH;
                      ctx.strokeStyle = karaokeBorderColor;
                      ctx.lineWidth = Math.max(1, actualSubSize * 0.05);
                      ctx.shadowBlur = 0;
                      ctx.strokeText(line, baseX, ly);
                  });

                  ctx.restore();
              }
              ctx.restore();
         });
      }
    }

    // 5. Icon
    if (iconImageObjRef.current) {
      ctx.save();
      const padding = 20;
      let iconX = padding;
      let iconY = padding;
      switch(iconPos) {
        case CornerPosition.TOP_LEFT: iconX = padding; iconY = padding; break;
        case CornerPosition.TOP_RIGHT: iconX = canvas.width - iconSize - padding; iconY = padding; break;
        case CornerPosition.BOTTOM_LEFT: iconX = padding; iconY = canvas.height - iconSize - padding; break;
        case CornerPosition.BOTTOM_RIGHT: iconX = canvas.width - iconSize - padding; iconY = canvas.height - iconSize - padding; break;
      }
      ctx.drawImage(iconImageObjRef.current, iconX, iconY, iconSize, iconSize);
      ctx.restore();
    }
    if ((isPlaying || isRecording) && typeof overrideTime !== 'number') {
        animationFrameRef.current = requestAnimationFrame(() => draw());
    }
  }, [vizStyle, vizAmplitude, vizColorMode, vizColor1, vizColor2, vizIsFullWidth, vizPosX, vizPosY, vizScale, subFont, subSize, subPos, subOffset, subColorMode, subColor1, subColor2, bgType, bgColor, bgImageOpacity, transitionEffect, iconPos, iconSize, isKaraoke, displayMode, karaokeColor, karaokeBorderColor, preShowTime, line1Align, line2Align, lineGap, introDuration, introPos, introAnimIn, introAnimOut, songTitle, artistName, titleFont, titleSize, titleColorMode, titleColor1, titleColor2, artistFont, artistSize, artistColorMode, artistColor1, artistColor2, aspectRatio, isPlaying, isRecording]);

  // Handlers
  const toggleTheme = () => setIsDark(!isDark);
  const togglePlayback = () => {
    if (!audioPlayerRef.current) return;
    if (isPlaying) {
         audioPlayerRef.current.pause();
         // Pause BG Video is handled in onPause listener
    } else {
        audioPlayerRef.current.play();
        // Play BG Video is handled in onPlay listener
    }
  };
  const stopPlayback = () => {
    if (audioPlayerRef.current) {
      audioPlayerRef.current.pause();
      audioPlayerRef.current.currentTime = 0;
      setIsPlaying(false);
      setCurrentTime(0);
      if (bgVideoRef.current) {
          bgVideoRef.current.pause();
          bgVideoRef.current.currentTime = 0;
      }
    }
  };
  
  // --- NEW: Skip Time Function ---
  const skipTime = (seconds: number) => {
    if (audioPlayerRef.current) {
        const newTime = Math.max(0, Math.min(duration, audioPlayerRef.current.currentTime + seconds));
        audioPlayerRef.current.currentTime = newTime;
        setCurrentTime(newTime);
    }
  };

  const handleSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
    const time = parseFloat(e.target.value);
    if (audioPlayerRef.current) {
        audioPlayerRef.current.currentTime = time;
        setCurrentTime(time);
        // Sync BG Video roughly? No, let it loop independently as texture
    }
  };
  
  // --- NEW: Force Draw when seeking while paused ---
  useEffect(() => {
      if (!isPlaying && !isRecording) {
          requestAnimationFrame(draw);
      }
  }, [currentTime, draw, isPlaying, isRecording]);

  // --- NEW: Keyboard Shortcuts (Space to Play/Pause) ---
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
        if (e.code === 'Space') {
            const target = e.target as HTMLElement;
            // Ignore if typing in input/textarea
            if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') return;
            e.preventDefault(); // Prevent scroll
            
            // Toggle Logic using Ref to avoid stale closure if we relied on state inside effect
            if (audioPlayerRef.current) {
                if (audioPlayerRef.current.paused) {
                    audioPlayerRef.current.play();
                } else {
                    audioPlayerRef.current.pause();
                }
            }
        }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  const toggleFullScreen = () => {
    if (!document.fullscreenElement) playerContainerRef.current?.requestFullscreen();
    else document.exitFullscreen();
  };
  const applyTimeShift = () => {
    const shift = parseFloat(timeShiftAmount);
    if (isNaN(shift) || shift === 0 || !result) return;
    const newResult = shiftSubtitleTime(result, shift);
    setResult(newResult);
    setCopySuccess(true);
    setTimeout(() => setCopySuccess(false), 2000);
  };

  // --- NEW: QUICK SYNC FUNCTION ---
  const handleQuickSync = (type: 'start' | 'end') => {
    if (!parsedSegmentsRef.current || parsedSegmentsRef.current.length === 0) return;
    
    const t = currentTime;
    let targetIndex = -1;

    // 1. Find exact current segment
    targetIndex = parsedSegmentsRef.current.findIndex(s => t >= s.start && t <= s.end);

    // 2. If no exact segment (in gap), find the next closest one (for start sync) or previous (for end sync)
    if (targetIndex === -1) {
        if (type === 'start') {
            // Find next segment
            targetIndex = parsedSegmentsRef.current.findIndex(s => s.start > t);
            // If no next segment, maybe we are at the end, use the last one
            if (targetIndex === -1) targetIndex = parsedSegmentsRef.current.length - 1;
        } else {
            // Find prev segment (where end < t)
            // findLastIndex not always available in all envs, use reverse find
            for (let i = parsedSegmentsRef.current.length - 1; i >= 0; i--) {
                if (parsedSegmentsRef.current[i].end < t) {
                    targetIndex = i;
                    break;
                }
            }
             // If no prev segment, maybe we are at start, use the first one
             if (targetIndex === -1) targetIndex = 0;
        }
    }

    if (targetIndex !== -1) {
        const segments = [...parsedSegmentsRef.current];
        const seg = { ...segments[targetIndex] };
        
        if (type === 'start') {
            seg.start = t;
            // Prevent start > end
            if (seg.start >= seg.end) seg.end = seg.start + 0.5; 
        } else {
            seg.end = t;
            // Prevent end < start
            if (seg.end <= seg.start) seg.start = seg.end - 0.5;
        }
        
        segments[targetIndex] = seg;
        
        // Update Result String based on Format
        let newString = "";
        if (format === ExportFormat.SRT) {
            newString = parseSegmentsToSRT(segments);
        } else {
            newString = parseSegmentsToASS(segments, file?.name);
        }
        
        setResult(newString);
    }
  };

  // --- NEW: FINE TUNE FUNCTION (For adjusting red line accurately) ---
  const handleFineTune = (type: 'start' | 'end', amount: number) => {
      if (!parsedSegmentsRef.current || parsedSegmentsRef.current.length === 0) return;
      
      const t = currentTime;
      // Identify segment near current time (active or close)
      let targetIndex = parsedSegmentsRef.current.findIndex(s => t >= s.start - KARAOKE_PREVIEW_TIME && t <= s.end + 1); // Expanded range for easier catching
      
      if (targetIndex === -1) {
          // If in gap, find next closest for Start tuning, previous for End tuning
           const closestNext = parsedSegmentsRef.current.findIndex(s => s.start > t);
           if (closestNext !== -1 && (parsedSegmentsRef.current[closestNext].start - t) < 3) {
               targetIndex = closestNext;
           } else {
               // Try prev
               for (let i = parsedSegmentsRef.current.length - 1; i >= 0; i--) {
                    if (t - parsedSegmentsRef.current[i].end < 3) {
                        targetIndex = i;
                        break;
                    }
               }
           }
      }

      if (targetIndex !== -1) {
          const segments = [...parsedSegmentsRef.current];
          const seg = { ...segments[targetIndex] };
          
          if (type === 'start') {
              seg.start = Math.max(0, seg.start + amount);
              // Basic validation
              if (seg.start >= seg.end) seg.end = seg.start + 0.5;
          } else {
              seg.end = Math.max(seg.start + 0.1, seg.end + amount);
          }
          
          segments[targetIndex] = seg;
          
          // Update Result String
          let newString = "";
          if (format === ExportFormat.SRT) {
              newString = parseSegmentsToSRT(segments);
          } else {
              newString = parseSegmentsToASS(segments, file?.name);
          }
          setResult(newString);
      }
  };

  const handleWordUpdate = (segIndex: number, wordIndex: number, delta: number) => {
      const segment = parsedSegmentsRef.current[segIndex];
      if (!segment || !segment.words) return;

      const newWords = [...segment.words];
      const targetWord = { ...newWords[wordIndex] };
      
      // Apply delta
      targetWord.duration += delta;
      if (targetWord.duration < 100) targetWord.duration = 100; // Min 100ms

      const actualDelta = targetWord.duration - newWords[wordIndex].duration;
      newWords[wordIndex] = targetWord;

      // Adjust adjacent word
      if (wordIndex < newWords.length - 1) {
          const nextWord = { ...newWords[wordIndex + 1] };
          nextWord.duration -= actualDelta;
          if (nextWord.duration < 100) nextWord.duration = 100; // Min 100ms
          newWords[wordIndex + 1] = nextWord;
      } else if (wordIndex > 0) {
          const prevWord = { ...newWords[wordIndex - 1] };
          prevWord.duration -= actualDelta;
          if (prevWord.duration < 100) prevWord.duration = 100; // Min 100ms
          newWords[wordIndex - 1] = prevWord;
      }

      // Update Segment
      const newSegments = [...parsedSegmentsRef.current];
      newSegments[segIndex] = { ...segment, words: newWords };
      parsedSegmentsRef.current = newSegments;
      
      // Re-generate result string (SRT/ASS) to persist changes
      let newString = "";
      if (format === ExportFormat.SRT) {
          newString = parseSegmentsToSRT(newSegments);
      } else {
          newString = parseSegmentsToASS(newSegments, file?.name);
      }
      setResult(newString);
  };

  const handleLineToggle = (segIndex: number) => {
      const segment = parsedSegmentsRef.current[segIndex];
      if (!segment) return;
      
      const newLineNum = segment.lineNumber === 1 ? 2 : 1;
      
      const newSegments = [...parsedSegmentsRef.current];
      newSegments[segIndex] = { ...segment, lineNumber: newLineNum };
      parsedSegmentsRef.current = newSegments;

      let newString = "";
      if (format === ExportFormat.SRT) {
          newString = parseSegmentsToSRT(newSegments);
      } else {
          newString = parseSegmentsToASS(newSegments, file?.name);
      }
      setResult(newString);
  };

  const handleSplitWords = (segIndex: number) => {
      const segment = parsedSegmentsRef.current[segIndex];
      if (!segment) return;

      const words = segment.text.trim().split(/\s+/);
      const totalDuration = (segment.end - segment.start) * 1000; // ms
      const durationPerWord = Math.floor(totalDuration / words.length);
      
      const newWords: WordTiming[] = words.map(w => ({
          word: w,
          duration: durationPerWord
      }));

      const newSegments = [...parsedSegmentsRef.current];
      newSegments[segIndex] = { ...segment, words: newWords };
      parsedSegmentsRef.current = newSegments;

      let newString = "";
      if (format === ExportFormat.SRT) {
          newString = parseSegmentsToSRT(newSegments);
      } else {
          newString = parseSegmentsToASS(newSegments, file?.name);
      }
      setResult(newString);
  };

  // --- NEW: Handle Timeline Updates ---
  const handleSegmentUpdate = useCallback((index: number, newStart: number, newEnd: number) => {
    if (!parsedSegmentsRef.current) return;
    
    const segments = [...parsedSegmentsRef.current];
    const seg = { ...segments[index] };
    seg.start = newStart;
    seg.end = newEnd;
    segments[index] = seg;
    
    // Update Result String
    let newString = "";
    if (format === ExportFormat.SRT) {
        newString = parseSegmentsToSRT(segments);
    } else {
        newString = parseSegmentsToASS(segments, file?.name);
    }
    setResult(newString);
  }, [format, file]);

  const getActiveSegmentText = () => {
      if (!parsedSegmentsRef.current) return "";
      const t = currentTime;
      // Look ahead slightly for UI feedback
      const seg = parsedSegmentsRef.current.find(s => t >= s.start - 2 && t <= s.end + 2);
      return seg ? seg.text : "Chưa chọn câu hát...";
  };

  const handleOfflineExport = async (quality: '720p' | '1080p') => {
    if (!canvasRef.current || !audioUrl) return;
    setIsExporting(true);
    setExportProgress(0);
    setIsPlaying(false); // Stop playback if running

    try {
        // 1. Setup Audio Context & Destination (Silent)
        const exportAudioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
        const dest = exportAudioCtx.createMediaStreamDestination();
        const exportAnalyser = exportAudioCtx.createAnalyser();
        exportAnalyser.fftSize = 2048;

        // 2. Load Audio Data
        const response = await fetch(audioUrl);
        const arrayBuffer = await response.arrayBuffer();
        const audioBuffer = await exportAudioCtx.decodeAudioData(arrayBuffer);

        // 3. Setup Source
        const source = exportAudioCtx.createBufferSource();
        source.buffer = audioBuffer;
        source.connect(exportAnalyser);
        exportAnalyser.connect(dest);
        // Note: NOT connecting to exportAudioCtx.destination (speakers)

        // 4. Setup Recorder
        const canvasStream = canvasRef.current.captureStream(0); // 0 FPS = Manual capture mode, vital for background export
        const combinedStream = new MediaStream([...canvasStream.getVideoTracks(), ...dest.stream.getAudioTracks()]);
        
        const mimeTypes = [
          'video/mp4;codecs=h264',
          'video/mp4',
          'video/webm;codecs=h264',
          'video/webm;codecs=vp8',
          'video/webm'
        ];
        const selectedMime = mimeTypes.find(type => MediaRecorder.isTypeSupported(type)) || 'video/webm';
        const isMp4 = selectedMime.includes('mp4');
        const ext = isMp4 ? '.mp4' : '.webm';
        const bitrate = quality === '1080p' ? 8000000 : 4000000; // Higher bitrate for offline
        
        const recorder = new MediaRecorder(combinedStream, { mimeType: selectedMime, videoBitsPerSecond: bitrate });
        const chunks: Blob[] = [];
        recorder.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data); };
        recorder.onstop = () => {
            const blob = new Blob(chunks, { type: isMp4 ? 'video/mp4' : 'video/webm' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `${file?.name.split('.')[0] || 'karaoke'}_${quality}${ext}`;
            a.click();
            URL.revokeObjectURL(url);
            setIsExporting(false);
            setExportProgress(0);
            exportAudioCtx.close();
        };

        recorder.start();
        source.start(0);
        
        if (bgType === 'video' && bgVideoRef.current) {
             bgVideoRef.current.currentTime = 0;
             bgVideoRef.current.play().catch(console.error);
        }

        // 5. Start Rendering Loop (using Worker to avoid throttling)
        const fps = 30;
        const interval = 1000 / fps;
        const duration = audioBuffer.duration;
        const startTime = exportAudioCtx.currentTime;

        // Create a simple worker blob
        const workerBlob = new Blob([`
            let intervalId;
            self.onmessage = function(e) {
                if (e.data.type === 'start') {
                    intervalId = setInterval(() => postMessage('tick'), ${interval});
                } else if (e.data.type === 'stop') {
                    clearInterval(intervalId);
                }
            };
        `], { type: 'application/javascript' });
        const worker = new Worker(URL.createObjectURL(workerBlob));

        worker.onmessage = () => {
            const currentTime = exportAudioCtx.currentTime - startTime;
            
            if (currentTime >= duration) {
                worker.postMessage({ type: 'stop' });
                worker.terminate();
                recorder.stop();
                source.stop();
                if (bgType === 'video' && bgVideoRef.current) {
                    bgVideoRef.current.pause();
                }
                return;
            }

            // Draw Frame
            draw(currentTime, exportAnalyser);
            
            // Manually request frame for the recorder (fixes background tab rendering)
            const track = canvasStream.getVideoTracks()[0] as any;
            if (track.requestFrame) {
                track.requestFrame();
            }
            
            // Update Progress
            setExportProgress(Math.min(100, Math.round((currentTime / duration) * 100)));
        };

        worker.postMessage({ type: 'start' });

    } catch (err) {
        console.error("Export failed:", err);
        setIsExporting(false);
        alert("Có lỗi xảy ra khi xuất video.");
    }
  };

  const startRecording = (quality: '720p' | '1080p') => {
    if (!canvasRef.current || !audioDestRef.current) return;
    if (audioContextRef.current && audioContextRef.current.state === 'suspended') audioContextRef.current.resume();
    
    recordedChunksRef.current = [];
    const canvasStream = canvasRef.current.captureStream(30);
    const audioStream = audioDestRef.current.stream;
    const combinedStream = new MediaStream([...canvasStream.getVideoTracks(), ...audioStream.getAudioTracks()]);
    const mimeTypes = [
      'video/mp4;codecs=h264',
      'video/mp4',
      'video/webm;codecs=h264',
      'video/webm;codecs=vp8',
      'video/webm'
    ];
    const selectedMime = mimeTypes.find(type => MediaRecorder.isTypeSupported(type)) || 'video/webm';
    const isMp4 = selectedMime.includes('mp4');
    const ext = isMp4 ? '.mp4' : '.webm';
    const bitrate = quality === '1080p' ? 6000000 : 2500000;

    const recorder = new MediaRecorder(combinedStream, { mimeType: selectedMime, videoBitsPerSecond: bitrate });
    recorder.ondataavailable = (e) => { if (e.data.size > 0) recordedChunksRef.current.push(e.data); };
    recorder.onstop = () => {
      const blob = new Blob(recordedChunksRef.current, { type: isMp4 ? 'video/mp4' : 'video/webm' });
      const url = URL.createObjectURL(blob as Blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${file ? file.name.split('.')[0] : 'karaoke'}_recorded${ext}`;
      a.click();
      URL.revokeObjectURL(url);
      setIsRecording(false);
    };
    recorder.start(1000);
    mediaRecorderRef.current = recorder;
    setIsRecording(true);
    if (!isPlaying) togglePlayback();
  };
  const stopRecording = () => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
    }
  };
  const processFile = (selectedFile: File) => {
    if (selectedFile.size > MAX_FILE_SIZE) { setError('File quá lớn (tối đa 100MB).'); return; }
    setError(null); setFile(selectedFile); setResult(''); setIsPlaying(false);
    
    // Auto set Song Title from filename
    setSongTitle(selectedFile.name.replace(/\.[^/.]+$/, ""));
    setArtistName(""); // Reset artist
    setWaveformData(null); // Reset waveform
    audioBase64CacheRef.current = null;

    if (audioUrl) URL.revokeObjectURL(audioUrl);
    const objectUrl = URL.createObjectURL(selectedFile);
    setAudioUrl(objectUrl);
    const audio = new Audio(objectUrl);
    audio.addEventListener('loadedmetadata', () => setDuration(audio.duration));
    
    // Extract waveform in background (Module 6)
    setIsAnalyzingAudio(true);
    extractWaveform(selectedFile, 100).then(wf => {
      setWaveformData(wf);
      setIsAnalyzingAudio(false);
    }).catch(err => {
      console.warn('Waveform extraction failed:', err);
      setIsAnalyzingAudio(false);
    });
  };
  const clearFile = (e: React.MouseEvent) => {
    e.stopPropagation(); setFile(null); setAudioUrl(null); setResult(''); setError(null); setIsPlaying(false);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };
  const handleBgImagesChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files && files.length > 0) {
      const newImages: string[] = [];
      Array.from(files).forEach(file => newImages.push(URL.createObjectURL(file as Blob)));
      setBgImages(prev => [...prev, ...newImages]);
      setBgType('image');
    }
  };
  const handleBgVideosChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files && files.length > 0) {
      const newVideos: string[] = [];
      Array.from(files).forEach(file => newVideos.push(URL.createObjectURL(file as Blob)));
      setBgVideos(prev => [...prev, ...newVideos]);
      setBgType('video');
    }
  };
  
  // Media Reordering Handlers
  const moveMediaItem = (index: number, direction: number, type: 'image' | 'video') => {
      const arr = type === 'image' ? [...bgImages] : [...bgVideos];
      const newIndex = index + direction;
      if (newIndex < 0 || newIndex >= arr.length) return;
      [arr[index], arr[newIndex]] = [arr[newIndex], arr[index]];
      if (type === 'image') setBgImages(arr); else setBgVideos(arr);
  };
  const removeMediaItem = (index: number, type: 'image' | 'video') => {
      const arr = type === 'image' ? [...bgImages] : [...bgVideos];
      arr.splice(index, 1);
      if (type === 'image') setBgImages(arr); else setBgVideos(arr);
  };

  const handleIconChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) setIconImage(URL.createObjectURL(file));
  };
  const handleSaveApiKey = () => {
    const trimmed = apiKeyInput.trim();
    setStoredApiKey(trimmed);
    setHasApiKey(!!getEffectiveApiKey());
    setShowApiKeyDialog(false);
    // Reload models with new key
    getAvailableModels().then(models => {
      setAvailableModels(models);
      if (models.length > 0 && !models.find(m => m.name === model)) {
        const best = models.find(m => m.name.includes('pro')) || models[0];
        setModel(best.name);
      }
    });
  };

  const handleProcess = async () => {
    if (!file) return;
    if (!getEffectiveApiKey()) {
      setError('Chưa có API Key! Vui lòng nhập Gemini API Key trước khi sử dụng.');
      setShowApiKeyDialog(true);
      return;
    }
    setIsProcessing(true); setError(null); setResult(''); setRefinementStatus('Đang nén audio...');
    try {
      // Step 1: Compress audio
      const { base64, mimeType } = await compressAudioToMonoWav(file);
      audioBase64CacheRef.current = { base64, mimeType };
      
      let activeModel = model;
      if (autoSelectModel) {
        if (availableModels.length > 0) {
          activeModel = availableModels[0].name;
        } else {
          activeModel = 'gemini-2.5-flash';
        }
      }
      
      // Step 2: Pass 1 - Initial extraction with word-level timing
      setRefinementStatus('Pass 1: Trích xuất timing từ AI...');
      const rawResponse = await processAudioWithGemini(base64, mimeType, mode, language, duration, activeModel, referenceLyrics, enableWordLevel);
      
      if (mode === ProcessingMode.LYRICS) {
        setResult(rawResponse);
      } else {
        try {
          // Robust JSON extraction
          let cleanedResponse = rawResponse.trim();
          const firstBrace = cleanedResponse.indexOf('{');
          const lastBrace = cleanedResponse.lastIndexOf('}');
          if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
            cleanedResponse = cleanedResponse.substring(firstBrace, lastBrace + 1);
          }
          // JSON repair for truncated responses
          const repairTruncatedJSON = (jsonStr: string): string => {
            let s = jsonStr.trim();
            // Count unclosed brackets
            let braces = 0, brackets = 0, inString = false, escaped = false;
            for (let i = 0; i < s.length; i++) {
              const c = s[i];
              if (escaped) { escaped = false; continue; }
              if (c === '\\') { escaped = true; continue; }
              if (c === '"') { inString = !inString; continue; }
              if (inString) continue;
              if (c === '{') braces++;
              if (c === '}') braces--;
              if (c === '[') brackets++;
              if (c === ']') brackets--;
            }
            // Close unclosed strings
            if (inString) s += '"';
            // Remove trailing incomplete object/value (after last comma or opening bracket)
            const lastComplete = Math.max(s.lastIndexOf('},'), s.lastIndexOf('}]'));
            if (lastComplete > 0 && (braces > 0 || brackets > 0)) {
              s = s.substring(0, lastComplete + 1);
              // Recount
              braces = 0; brackets = 0; inString = false; escaped = false;
              for (let i = 0; i < s.length; i++) {
                const c = s[i];
                if (escaped) { escaped = false; continue; }
                if (c === '\\') { escaped = true; continue; }
                if (c === '"') { inString = !inString; continue; }
                if (inString) continue;
                if (c === '{') braces++;
                if (c === '}') braces--;
                if (c === '[') brackets++;
                if (c === ']') brackets--;
              }
            }
            // Close remaining brackets
            while (brackets > 0) { s += ']'; brackets--; }
            while (braces > 0) { s += '}'; braces--; }
            return s;
          };

          let parsed;
          try {
            parsed = JSON.parse(cleanedResponse);
          } catch (jsonErr) {
            console.warn('JSON parse failed, attempting repair...', jsonErr);
            const repaired = repairTruncatedJSON(cleanedResponse);
            parsed = JSON.parse(repaired); // If this also fails, outer catch handles it
          }
          const parseSegmentData = (s: any, idx: number): SubtitleSegment => {
            const rawText = String(s.text || '');
            let text = rawText;
            let words: { word: string, duration: number }[] | undefined = undefined;

            // Check if text has inline timing like: word{500}
            if (/\{(\d+)\}/.test(rawText)) {
              words = [];
              const parts = rawText.split(/(\{[\d]+\})/);
              let currentWord = "";
              for (let i = 0; i < parts.length; i++) {
                const part = parts[i];
                if (/^\{(\d+)\}$/.test(part)) {
                  const duration = parseInt(part.slice(1, -1), 10);
                  if (currentWord.trim()) {
                    words.push({ word: currentWord.trim(), duration });
                    currentWord = "";
                  }
                } else {
                  currentWord = part;
                }
              }
              // Clean the text by removing all {duration} tags and duplicate spaces
              text = rawText.replace(/\{[\d]+\}/g, '').replace(/\s+/g, ' ').trim();
            } else if (Array.isArray(s.words) && s.words.length > 0) {
              words = s.words.map((w: any) => ({ 
                word: String(w.word || ''), 
                duration: Number(w.duration) || 0 
              }));
            }

            return {
              index: idx + 1, 
              start: Number(s.start), 
              end: Number(s.end),
              text: textCase === TextCase.UPPER ? text.toUpperCase() : textCase === TextCase.LOWER ? text.toLowerCase() : text,
              words,
              lineNumber: s.lineNumber
            };
          };

          let segments: SubtitleSegment[] = (parsed.segments || []).map((s: any, idx: number) => parseSegmentData(s, idx));
          
          // Step 3: Pass 2 - Multi-pass refinement (Module 3)
          if (enableMultiPass && segments.length > 0) {
            setRefinementStatus('Pass 2: Tinh chỉnh word-level timing...');
            try {
              const currentJson = JSON.stringify({ segments });
              const refinedResponse = await refineTimingWithGemini(
                base64, mimeType, currentJson, language, duration, activeModel,
                (prog) => setRefinementStatus(prog.status)
              );
              let refinedCleaned = refinedResponse.trim();
              const fb = refinedCleaned.indexOf('{');
              const lb = refinedCleaned.lastIndexOf('}');
              if (fb !== -1 && lb !== -1 && lb > fb) {
                refinedCleaned = refinedCleaned.substring(fb, lb + 1);
              }
              const refinedParsed = JSON.parse(refinedCleaned);
              if (refinedParsed.segments && refinedParsed.segments.length > 0) {
                segments = refinedParsed.segments.map((s: any, idx: number) => parseSegmentData(s, idx));
              }
            } catch (refineErr) {
              console.warn('Multi-pass refinement failed, using Pass 1 result:', refineErr);
            }
          }
          
          // Step 4: Post-processing pipeline (Module 2) - wrapped in try-catch for safety
          if (enablePostProcess) {
            setRefinementStatus('Hậu xử lý: Sửa overlap, gap, redistribute...');
            try {
              // Get energy peaks for snapping (Module 6)
              let energyPeaks: number[] = [];
              if (enableAutoSnap && waveformData) {
                try {
                  const peaks = detectEnergyPeaks(waveformData, 0.25, 0.1);
                  energyPeaks = peaks.map(p => p.time);
                } catch (peakErr) {
                  console.warn('Energy peak detection failed:', peakErr);
                }
              }
              
              segments = runPostProcessing(segments, {
                duration,
                referenceLyrics: referenceLyrics || undefined,
                energyPeaks,
                autoSplitWords: enableWordLevel,
                maxGap: 0.3,
                snapToPeaks: enableAutoSnap && energyPeaks.length > 0
              });
            } catch (postErr) {
              console.error('Post-processing failed, using raw AI segments:', postErr);
              // Continue with unprocessed segments - don't throw
            }
          }
          
          setRefinementStatus('');
          
          const finalResult = format === ExportFormat.SRT ? parseSegmentsToSRT(segments) : parseSegmentsToASS(segments, file.name);
          setResult(finalResult);
          if (segments.length > 0) setActiveTab('player');
          
          // Auto download subtitle
          setTimeout(() => {
              const ext = format === ExportFormat.SRT ? '.srt' : '.ass';
              const name = file ? file.name.split('.')[0] + ext : `subtitle${ext}`;
              const blob = new Blob([finalResult], { type: 'text/plain;charset=utf-8' });
              const url = URL.createObjectURL(blob);
              const link = document.createElement('a');
              link.href = url; link.download = name; link.click();
              URL.revokeObjectURL(url);
          }, 500);

        } catch (e: any) { console.error('Subtitle parsing error:', e); setResult(rawResponse); setError(`AI trả về định dạng thô. Lỗi: ${e?.message || e}`); }
      }
    } catch (err: any) { setError(`Lỗi: ${err.message}`); } finally { setIsProcessing(false); setRefinementStatus(''); }
  };
  const copyToClipboard = () => {
    navigator.clipboard.writeText(result); setCopySuccess(true); setTimeout(() => setCopySuccess(false), 2000);
  };
  const downloadFile = () => {
    const ext = mode === ProcessingMode.LYRICS ? '.txt' : (format === ExportFormat.SRT ? '.srt' : '.ass');
    const name = file ? file.name.split('.')[0] + ext : `subtitle${ext}`;
    const blob = new Blob([result], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url; link.download = name; link.click();
  };
  
  // ===== NEW: Enhanced Export Functions (Module 5) =====
  const downloadKaraokeASS = () => {
    if (!parsedSegmentsRef.current || parsedSegmentsRef.current.length === 0) return;
    const assContent = parseSegmentsToKaraokeASS(parsedSegmentsRef.current, file?.name || 'karaoke', true);
    const name = file ? file.name.split('.')[0] + '_karaoke.ass' : 'karaoke.ass';
    const blob = new Blob([assContent], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url; link.download = name; link.click();
    URL.revokeObjectURL(url);
  };
  
  const downloadLRC = () => {
    if (!parsedSegmentsRef.current || parsedSegmentsRef.current.length === 0) return;
    const lrcContent = parseSegmentsToLRC(parsedSegmentsRef.current, {
      title: songTitle || undefined,
      artist: artistName || undefined
    });
    const name = file ? file.name.split('.')[0] + '.lrc' : 'lyrics.lrc';
    const blob = new Blob([lrcContent], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url; link.download = name; link.click();
    URL.revokeObjectURL(url);
  };
  
  const downloadPlainLyrics = () => {
    if (!parsedSegmentsRef.current || parsedSegmentsRef.current.length === 0) return;
    const lyrics = parseSegmentsToPlainLyrics(parsedSegmentsRef.current);
    const name = file ? file.name.split('.')[0] + '_lyrics.txt' : 'lyrics.txt';
    const blob = new Blob([lyrics], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url; link.download = name; link.click();
    URL.revokeObjectURL(url);
  };

  const handleSunoOptimize = async () => {
    if (!sunoInput.trim()) {
      setError("Vui lòng nhập lời bài hát hoặc dán mô tả ý tưởng trước!");
      return;
    }
    if (!getEffectiveApiKey()) {
      setError('Chưa có API Key! Vui lòng nhập Gemini API Key trước khi sử dụng.');
      setShowApiKeyDialog(true);
      return;
    }
    setIsSunoOptimizing(true);
    setError(null);
    try {
      const resp = await optimizeForSuno(sunoInput, {
        genre: sunoGenre,
        tempo: sunoTempo,
        vocals: sunoVocals,
        mood: sunoMood,
        instruments: sunoInstruments
      }, model);
      setSunoResult(resp);
    } catch (err: any) {
      setError(`Lỗi tối ưu Suno: ${err.message}`);
    } finally {
      setIsSunoOptimizing(false);
    }
  };

  const copySunoStyle = () => {
    if (sunoResult?.styleTags) {
      navigator.clipboard.writeText(sunoResult.styleTags);
      setSunoCopyStyleSuccess(true);
      setTimeout(() => setSunoCopyStyleSuccess(false), 2000);
    }
  };

  const copySunoLyrics = () => {
    if (sunoResult?.lyrics) {
      navigator.clipboard.writeText(sunoResult.lyrics);
      setSunoCopyLyricsSuccess(true);
      setTimeout(() => setSunoCopyLyricsSuccess(false), 2000);
    }
  };

  const downloadSunoLyrics = () => {
    if (sunoResult?.lyrics) {
      const blob = new Blob([sunoResult.lyrics], { type: 'text/plain;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = 'suno_lyrics.txt';
      link.click();
      URL.revokeObjectURL(url);
    }
  };

  const pullLyricsFromExtractor = () => {
    if (!result) {
      if (referenceLyrics) {
        setSunoInput(referenceLyrics);
        return;
      }
      setError("Chưa có kết quả trích xuất hoặc lời bài hát thô! Hãy chạy trích xuất trước hoặc tự nhập vào ô bên phải.");
      return;
    }
    let cleaned = result;
    if (result.includes('-->') || result.includes('[Events]') || result.includes('[Script Info]')) {
      cleaned = result
        .replace(/\d+\r?\n\d\d:\d\d:\d\d[,\.]\d\d\d\s-->\s\d\d:\d\d:\d\d[,\.]\d\d\d\r?\n/g, '')
        .replace(/Dialogue: [^,]+,\d\d?:\d\d:\d\d\.\d\d,\d\d?:\d\d:\d\d\.\d\d,[^,]+,[^,]+,\d+,\d+,\d+,[^,]*,/g, '')
        .replace(/\{\\[^\}]+\}/g, '')
        .replace(/^\s*\d+\s*$/gm, '')
        .split('\n')
        .map(line => line.trim())
        .filter(line => line && !line.startsWith('[Format]') && !line.startsWith('Title:') && !line.startsWith('[Script Info]') && !line.startsWith('Dialogue:') && !line.startsWith('ScriptType:'))
        .join('\n');
    }
    setSunoInput(cleaned);
  };

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 transition-colors duration-300 flex flex-col font-sans text-slate-900 dark:text-slate-100">
      <nav className="sticky top-0 z-50 backdrop-blur-md bg-white/70 dark:bg-slate-900/80 border-b border-slate-200 dark:border-slate-800 px-6 py-3 flex items-center justify-between shadow-sm">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-gradient-to-br from-indigo-600 to-violet-600 rounded-lg shadow-lg">
            <Activity className="w-4 h-4 text-white" />
          </div>
          <h1 className="text-lg font-bold bg-clip-text text-transparent bg-gradient-to-r from-indigo-600 to-violet-500 dark:from-indigo-400 dark:to-violet-400">
            LyricSub AI
          </h1>
        </div>
        <div className="flex items-center gap-2">
           <button onClick={() => setShowApiKeyDialog(true)} title="Gemini API Key" className={`p-2 rounded-xl transition-colors flex items-center gap-1.5 ${hasApiKey ? 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400' : 'bg-red-100 dark:bg-red-900/30 text-red-500 dark:text-red-400 animate-pulse'}`}>
            <Key className="w-4 h-4" />
            <span className="text-[10px] font-bold uppercase tracking-wider hidden sm:inline">{hasApiKey ? 'API Key ✓' : 'Nhập Key'}</span>
          </button>
           <button onClick={toggleTheme} className="p-2 rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400 transition-colors">
            {isDark ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
          </button>
        </div>
      </nav>

      <main className="flex-1 w-full max-w-7xl mx-auto p-4 md:p-6 grid grid-cols-1 xl:grid-cols-12 gap-6">
        
        {/* Left: Upload & Config */}
        <div className="xl:col-span-4 space-y-6">
          {error && (
            <div className="bg-red-500/10 border border-red-500/30 rounded-2xl p-4 flex gap-3 text-red-500 relative overflow-hidden">
              <div className="absolute top-0 left-0 w-1 h-full bg-red-500"></div>
              <AlertCircle className="w-5 h-5 flex-shrink-0 mt-0.5" />
              <div className="flex-1 space-y-0.5">
                <p className="text-xs font-black uppercase tracking-wider">Có lỗi xảy ra</p>
                <p className="text-xs opacity-95 leading-relaxed font-bold">{error}</p>
              </div>
              <button onClick={() => setError(null)} className="p-1 hover:bg-red-500/20 rounded-lg self-start transition-colors">
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          )}
          <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-sm border border-slate-200 dark:border-slate-800 p-4">
            <div onClick={() => !file && fileInputRef.current?.click()} className={`group relative rounded-xl p-4 transition-all border-2 border-dashed flex items-center gap-4 cursor-pointer ${file ? 'border-emerald-500/50 bg-emerald-50/10' : 'border-slate-200 dark:border-slate-800 hover:border-indigo-400'}`}>
              <input ref={fileInputRef} type="file" className="hidden" accept="audio/*" onChange={(e) => e.target.files?.[0] && processFile(e.target.files[0])} />
              <div className={`p-3 rounded-lg ${file ? 'bg-emerald-500' : 'bg-indigo-500'}`}>
                {file ? <CheckCircle2 className="w-5 h-5 text-white" /> : <Upload className="w-5 h-5 text-white" />}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-bold truncate">{file ? file.name : 'Nhấn để tải nhạc'}</p>
                <p className="text-[10px] text-slate-400 font-bold uppercase">{file ? `${(file.size/1024/1024).toFixed(1)}MB` : 'MP3, WAV, M4A'}</p>
              </div>
              {file && (
                <button onClick={clearFile} className="p-2 text-slate-400 hover:text-red-500 transition-colors">
                  <Trash2 className="w-4 h-4" />
                </button>
              )}
            </div>
          </div>

          <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-5 space-y-4">
             <button onClick={() => setShowRefLyrics(!showRefLyrics)} className="w-full flex items-center justify-between text-[10px] font-black uppercase tracking-widest text-slate-400">
                <span className="flex items-center gap-2"><BookOpen className="w-3 h-3" /> Lời bài hát gốc</span>
                <ChevronRight className={`w-3 h-3 transition-transform ${showRefLyrics ? 'rotate-90' : ''}`} />
             </button>
             {showRefLyrics && (
               <textarea value={referenceLyrics} onChange={(e) => setReferenceLyrics(e.target.value)}
                 className="w-full h-24 p-3 text-xs bg-slate-50 dark:bg-slate-950 rounded-xl border border-slate-200 dark:border-slate-800 outline-none transition-all focus:ring-2 focus:ring-indigo-500/20"
                 placeholder="Dán lời bài hát gốc vào đây, AI sẽ căn chỉnh chính xác 100% thay vì tự nghe."
               />
             )}
          </div>

          <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-5 space-y-4">
            <label className="flex items-center gap-2.5 cursor-pointer select-none">
              <input 
                type="checkbox" 
                checked={autoSelectModel} 
                onChange={(e) => setAutoSelectModel(e.target.checked)} 
                className="w-4 h-4 rounded text-indigo-600 focus:ring-indigo-500 accent-indigo-500 cursor-pointer"
              />
              <div className="flex-1">
                <p className="text-xs font-black uppercase tracking-wider text-slate-700 dark:text-slate-300">Tự động chọn mô hình tối ưu</p>
                <p className="text-[10px] text-slate-400 font-bold uppercase">Khuyên dùng cho Key Free (Tránh lỗi 429)</p>
              </div>
            </label>

            {!autoSelectModel && (
              <div className="pt-3 border-t border-slate-100 dark:border-slate-800 space-y-1.5 animate-fadeIn">
                <p className="text-[9px] font-black uppercase tracking-wider text-slate-400">Chọn mô hình thủ công:</p>
                <select value={model} onChange={(e) => setModel(e.target.value)} className="w-full bg-slate-50 dark:bg-slate-950 p-2.5 rounded-lg text-xs font-bold outline-none cursor-pointer border border-slate-200 dark:border-slate-800">
                  {availableModels.length > 0 ? (
                    availableModels.map(m => (
                      <option key={m.name} value={m.name}>
                        {m.name.includes('flash') 
                          ? `${m.displayName} (Nhanh, Tránh 429)` 
                          : `${m.displayName} (Dễ lỗi 429 trên Key Free)`}
                      </option>
                    ))
                  ) : (
                    <>
                      <option value={GeminiModel.V3_FLASH}>Gemini 3 Flash (Nhanh, Tránh 429)</option>
                      <option value={GeminiModel.V3_PRO}>Gemini 3 Pro (Dễ lỗi 429 trên Key Free)</option>
                    </>
                  )}
                </select>
              </div>
            )}
            
            {/* ===== NEW: Karaoke Sync Settings ===== */}
            <div className="pt-3 border-t border-slate-100 dark:border-slate-800 space-y-3">
              <p className="text-[9px] font-black uppercase tracking-widest text-indigo-500 flex items-center gap-1.5"><Zap className="w-3 h-3" /> Cơ chế khớp lời Karaoke</p>
              
              <label className="flex items-center gap-2.5 cursor-pointer select-none">
                <input type="checkbox" checked={enableWordLevel} onChange={(e) => setEnableWordLevel(e.target.checked)} 
                  className="w-3.5 h-3.5 rounded accent-indigo-500 cursor-pointer" />
                <div className="flex-1">
                  <p className="text-[10px] font-bold text-slate-700 dark:text-slate-300">Word-Level Timing</p>
                  <p className="text-[9px] text-slate-400">AI trả timing từng từ thay vì cả câu</p>
                </div>
              </label>
              
              <label className="flex items-center gap-2.5 cursor-pointer select-none">
                <input type="checkbox" checked={enablePostProcess} onChange={(e) => setEnablePostProcess(e.target.checked)} 
                  className="w-3.5 h-3.5 rounded accent-indigo-500 cursor-pointer" />
                <div className="flex-1">
                  <p className="text-[10px] font-bold text-slate-700 dark:text-slate-300">Hậu xử lý tự động</p>
                  <p className="text-[9px] text-slate-400">Sửa overlap, gap, redistribute timing</p>
                </div>
              </label>
              
              <label className="flex items-center gap-2.5 cursor-pointer select-none">
                <input type="checkbox" checked={enableAutoSnap} onChange={(e) => setEnableAutoSnap(e.target.checked)} 
                  className="w-3.5 h-3.5 rounded accent-indigo-500 cursor-pointer" />
                <div className="flex-1">
                  <p className="text-[10px] font-bold text-slate-700 dark:text-slate-300">Auto-Snap Waveform</p>
                  <p className="text-[9px] text-slate-400">Neo timing vào đỉnh năng lượng âm thanh</p>
                </div>
              </label>
              
              <label className="flex items-center gap-2.5 cursor-pointer select-none">
                <input type="checkbox" checked={enableMultiPass} onChange={(e) => setEnableMultiPass(e.target.checked)} 
                  className="w-3.5 h-3.5 rounded accent-emerald-500 cursor-pointer" />
                <div className="flex-1">
                  <p className="text-[10px] font-bold text-slate-700 dark:text-slate-300">Multi-Pass Refinement</p>
                  <p className="text-[9px] text-slate-400">2 lần gọi AI để tinh chỉnh (tốn gấp đôi token)</p>
                </div>
              </label>
              
              {/* Waveform status */}
              {file && (
                <div className="flex items-center gap-2 text-[9px]">
                  <Activity className="w-3 h-3 text-indigo-500" />
                  <span className={`font-bold ${waveformData ? 'text-emerald-500' : isAnalyzingAudio ? 'text-amber-500' : 'text-slate-400'}`}>
                    {waveformData ? `Waveform ✓ (${Math.round(waveformData.duration)}s)` : isAnalyzingAudio ? 'Đang phân tích...' : 'Chưa phân tích'}
                  </span>
                </div>
              )}
            </div>
            
            <button onClick={handleProcess} disabled={isProcessing || !file}
              className="w-full py-3 rounded-xl font-black text-xs uppercase tracking-widest bg-indigo-600 text-white flex items-center justify-center gap-2 disabled:opacity-50 hover:bg-indigo-700 transition-all shadow-lg shadow-indigo-600/20"
            >
              {isProcessing ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
              {isProcessing ? (refinementStatus || 'Đang xử lý...') : 'Bắt đầu trích xuất'}
            </button>
            
            {/* Export Format Buttons */}
            {parsedSegments.length > 0 && (
              <div className="pt-3 border-t border-slate-100 dark:border-slate-800 space-y-2">
                <p className="text-[9px] font-black uppercase tracking-widest text-slate-400 flex items-center gap-1.5"><Download className="w-3 h-3" /> Xuất thêm định dạng</p>
                <div className="grid grid-cols-3 gap-2">
                  <button onClick={downloadKaraokeASS} className="px-2 py-2 bg-violet-100 dark:bg-violet-900/30 text-violet-600 dark:text-violet-400 text-[9px] font-bold uppercase rounded-lg hover:bg-violet-200 dark:hover:bg-violet-900/50 transition-colors text-center">
                    ASS Karaoke<br/><span className="text-[8px] opacity-60">{"\\kf tags"}</span>
                  </button>
                  <button onClick={downloadLRC} className="px-2 py-2 bg-emerald-100 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400 text-[9px] font-bold uppercase rounded-lg hover:bg-emerald-200 dark:hover:bg-emerald-900/50 transition-colors text-center">
                    LRC<br/><span className="text-[8px] opacity-60">Word-level</span>
                  </button>
                  <button onClick={downloadPlainLyrics} className="px-2 py-2 bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 text-[9px] font-bold uppercase rounded-lg hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors text-center">
                    TXT<br/><span className="text-[8px] opacity-60">Lời thuần</span>
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* INTRO & DONATE SECTION */}
          <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-5 space-y-4">
             <button onClick={() => setShowIntro(!showIntro)} className="w-full flex items-center justify-between text-[10px] font-black uppercase tracking-widest text-slate-400">
                <span className="flex items-center gap-2"><Heart className="w-3 h-3 text-pink-500" /> Giới thiệu & Ủng hộ</span>
                <ChevronRight className={`w-3 h-3 transition-transform ${showIntro ? 'rotate-90' : ''}`} />
             </button>
             {showIntro && (
               <div className="space-y-3 text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
                  <p>Ứng dụng tạo video karaoke miễn phí cho người mới. Nếu bạn thấy hữu ích hãy ủng hộ mình nhé.</p>
                  
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                        <span className="font-bold text-red-500">Youtube:</span>
                        <a href="https://www.youtube.com/@nguyennkAIMusic" target="_blank" rel="noreferrer" className="hover:underline hover:text-indigo-500 truncate">@nguyennkAIMusic</a>
                    </div>
                    <div className="flex items-center gap-2">
                        <span className="font-bold text-blue-500">Facebook:</span>
                        <a href="https://www.facebook.com/NguyennkAIMusic" target="_blank" rel="noreferrer" className="hover:underline hover:text-indigo-500 truncate">NguyennkAIMusic</a>
                    </div>
                  </div>

                  <p className="text-[10px] text-slate-400 italic">
                    Sản phẩm được sự hỗ trợ ban đầu từ bạn <a href="https://www.facebook.com/hoangtuan.hp" target="_blank" rel="noreferrer" className="hover:text-indigo-500">hoangtuan.hp</a>
                  </p>

                  <div className="bg-slate-100 dark:bg-slate-800 p-3 rounded-lg border border-slate-200 dark:border-slate-700">
                    <p className="font-bold mb-1 text-indigo-500 uppercase text-[10px]">Donate:</p>
                    <p className="font-mono text-[10px]">Momo: 0909667810 (Nguyen Khoi Nguyen)</p>
                    <p className="font-mono text-[10px]">Vietinbank: 0909667810 (Nguyen Khoi Nguyen)</p>
                  </div>
               </div>
             )}
          </div>
        </div>

        {/* Right: Tabbed View */}
        <div className="xl:col-span-8 flex flex-col gap-6">
          <div className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-800 flex flex-col min-h-[550px] shadow-sm overflow-hidden">
            <div className="flex px-6 border-b border-slate-100 dark:border-slate-800 flex-wrap">
              <button onClick={() => setActiveTab('editor')} className={`px-4 py-4 text-xs font-black uppercase tracking-widest border-b-2 transition-all ${activeTab === 'editor' ? 'border-indigo-600 text-indigo-600' : 'border-transparent text-slate-400'}`}>Biên tập</button>
              <button onClick={() => setActiveTab('player')} className={`px-4 py-4 text-xs font-black uppercase tracking-widest border-b-2 transition-all ${activeTab === 'player' ? 'border-indigo-600 text-indigo-600' : 'border-transparent text-slate-400'}`}>Xem thử (Player)</button>
              <button onClick={() => setActiveTab('suno')} className={`px-4 py-4 text-xs font-black uppercase tracking-widest border-b-2 transition-all ${activeTab === 'suno' ? 'border-indigo-600 text-indigo-600 animate-pulse' : 'border-transparent text-slate-400'}`}>Tối ưu Suno AI 🎵</button>
            </div>

            <div className="flex-1 flex flex-col relative">
              {activeTab === 'editor' ? (
                <div className="flex-1 flex flex-col p-6">
                   <div className="flex flex-wrap items-center gap-2 mb-4 p-3 bg-slate-100 dark:bg-slate-800/50 rounded-xl border border-slate-200 dark:border-slate-800">
                     <ArrowRightLeft className="w-4 h-4 text-indigo-500"/>
                     <span className="text-xs font-bold uppercase text-slate-600 dark:text-slate-400">Dịch chuyển thời gian (giây):</span>
                     <div className="flex items-center gap-2 ml-auto">
                        <input type="number" step="0.1" value={timeShiftAmount} onChange={(e) => setTimeShiftAmount(e.target.value)} className="w-20 px-2 py-1 text-xs font-bold bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-lg outline-none focus:border-indigo-500" placeholder="0.0" />
                        <button onClick={applyTimeShift} disabled={!result} className="px-3 py-1 bg-indigo-100 dark:bg-indigo-900/30 text-indigo-600 dark:text-indigo-400 text-xs font-bold uppercase rounded-lg hover:bg-indigo-200 dark:hover:bg-indigo-900/50 transition-colors">Áp dụng</button>
                     </div>
                   </div>

                   <textarea value={result} onChange={(e) => setResult(e.target.value)} className="flex-1 p-6 bg-slate-50 dark:bg-slate-950 rounded-2xl border border-slate-200 dark:border-slate-800 outline-none font-mono text-sm leading-relaxed resize-none focus:ring-2 focus:ring-indigo-500/20" placeholder="Kết quả phụ đề/lời bài hát sẽ hiển thị tại đây..." />
                   <div className="flex justify-end gap-3 mt-4">
                      <button onClick={copyToClipboard} disabled={!result} className="px-4 py-2 bg-white dark:bg-slate-800 text-xs font-black rounded-xl border flex items-center gap-2 uppercase hover:bg-slate-50 dark:hover:bg-slate-700 transition-all">{copySuccess ? <CheckCircle2 className="w-3 h-3 text-emerald-500" /> : <Copy className="w-3 h-3" />} {copySuccess ? 'Đã chép' : 'Sao chép'}</button>
                      <button onClick={downloadFile} disabled={!result} className="px-5 py-2 bg-indigo-600 text-white text-xs font-black rounded-xl flex items-center gap-2 uppercase hover:bg-indigo-700 transition-all shadow-md"><Download className="w-4 h-4" /> Tải file</button>
                   </div>
                </div>
              ) : activeTab === 'player' ? (
                // REMOVED: max-h-[750px] constraint to allow full expansion
                <div className="flex-1 flex flex-col p-4 md:p-6 overflow-y-auto">
                  {/* Settings Panel */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6 text-[9px] font-black uppercase text-slate-400">
                    
                     {/* --- INTRO / METADATA SETTINGS --- */}
                     <div className="col-span-1 md:col-span-2 space-y-3 bg-slate-50 dark:bg-slate-950/50 p-4 rounded-2xl border border-slate-200 dark:border-slate-800">
                         <div className="flex items-center gap-2 mb-2 border-b border-indigo-500/10 pb-1">
                             <User className="w-3 h-3 text-emerald-500" />
                             <p className="text-emerald-500">Thông tin bài hát (Intro)</p>
                         </div>
                         
                         <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            {/* Title Config */}
                            <div className="space-y-2">
                                <div className="flex items-center gap-2">
                                    <span className="w-16">Tiêu đề:</span>
                                    <input type="text" value={songTitle} onChange={(e) => setSongTitle(e.target.value)} className="flex-1 bg-white dark:bg-slate-800 rounded px-2 py-1 outline-none border border-transparent focus:border-emerald-500 transition-colors" placeholder="Tên bài hát..." />
                                </div>
                                <div className="grid grid-cols-2 gap-2">
                                    <select value={titleFont} onChange={(e) => setTitleFont(e.target.value)} className="bg-white dark:bg-slate-800 rounded p-1 outline-none">
                                        {FONTS.map(f => <option key={f.value} value={f.value}>{f.name}</option>)}
                                    </select>
                                    <div className="flex items-center gap-2">
                                        <span>Size:</span>
                                        <input type="number" value={titleSize} onChange={(e) => setTitleSize(parseInt(e.target.value))} className="w-12 bg-white dark:bg-slate-800 rounded px-1 text-center" />
                                    </div>
                                </div>
                                <div className="flex items-center gap-2">
                                    <span>Màu:</span>
                                    <select value={titleColorMode} onChange={(e) => setTitleColorMode(e.target.value as VizColorMode)} className="bg-transparent outline-none cursor-pointer w-16">
                                        {Object.values(VizColorMode).map(m => <option key={m} value={m}>{m}</option>)}
                                    </select>
                                    {titleColorMode !== VizColorMode.RAINBOW && (
                                        <div className="flex gap-1">
                                            <input type="color" value={titleColor1} onChange={(e) => setTitleColor1(e.target.value)} className="w-4 h-4 p-0 border-none cursor-pointer" />
                                            {titleColorMode === VizColorMode.GRADIENT && <input type="color" value={titleColor2} onChange={(e) => setTitleColor2(e.target.value)} className="w-4 h-4 p-0 border-none cursor-pointer" />}
                                        </div>
                                    )}
                                </div>
                            </div>

                            {/* Artist Config */}
                            <div className="space-y-2">
                                <div className="flex items-center gap-2">
                                    <span className="w-16">Nghệ sĩ:</span>
                                    <input type="text" value={artistName} onChange={(e) => setArtistName(e.target.value)} className="flex-1 bg-white dark:bg-slate-800 rounded px-2 py-1 outline-none border border-transparent focus:border-emerald-500 transition-colors" placeholder="Tên ca sĩ..." />
                                </div>
                                <div className="grid grid-cols-2 gap-2">
                                    <select value={artistFont} onChange={(e) => setArtistFont(e.target.value)} className="bg-white dark:bg-slate-800 rounded p-1 outline-none">
                                        {FONTS.map(f => <option key={f.value} value={f.value}>{f.name}</option>)}
                                    </select>
                                    <div className="flex items-center gap-2">
                                        <span>Size:</span>
                                        <input type="number" value={artistSize} onChange={(e) => setArtistSize(parseInt(e.target.value))} className="w-12 bg-white dark:bg-slate-800 rounded px-1 text-center" />
                                    </div>
                                </div>
                                <div className="flex items-center gap-2">
                                    <span>Màu:</span>
                                    <select value={artistColorMode} onChange={(e) => setArtistColorMode(e.target.value as VizColorMode)} className="bg-transparent outline-none cursor-pointer w-16">
                                        {Object.values(VizColorMode).map(m => <option key={m} value={m}>{m}</option>)}
                                    </select>
                                    {artistColorMode !== VizColorMode.RAINBOW && (
                                        <div className="flex gap-1">
                                            <input type="color" value={artistColor1} onChange={(e) => setArtistColor1(e.target.value)} className="w-4 h-4 p-0 border-none cursor-pointer" />
                                            {artistColorMode === VizColorMode.GRADIENT && <input type="color" value={artistColor2} onChange={(e) => setArtistColor2(e.target.value)} className="w-4 h-4 p-0 border-none cursor-pointer" />}
                                        </div>
                                    )}
                                </div>
                            </div>
                         </div>

                         {/* Common Intro Settings */}
                         <div className="flex flex-wrap items-center justify-between pt-2 border-t border-slate-200 dark:border-slate-800 gap-2">
                             <div className="flex items-center gap-2">
                                 <Timer className="w-3 h-3" />
                                 <span>Thời lượng (s):</span>
                                 <input type="number" min="1" max="60" value={introDuration} onChange={(e) => setIntroDuration(parseInt(e.target.value))} className="w-12 bg-white dark:bg-slate-800 rounded px-1 text-center" />
                             </div>
                             
                             <div className="flex items-center gap-2">
                                 <Zap className="w-3 h-3" />
                                 <span>Vào:</span>
                                 <select value={introAnimIn} onChange={(e) => setIntroAnimIn(e.target.value as IntroAnimation)} className="bg-white dark:bg-slate-800 rounded outline-none w-20">
                                     {Object.values(IntroAnimation).map(a => <option key={a} value={a}>{a}</option>)}
                                 </select>
                             </div>
                             
                             <div className="flex items-center gap-2">
                                 <Zap className="w-3 h-3 rotate-180" />
                                 <span>Ra:</span>
                                 <select value={introAnimOut} onChange={(e) => setIntroAnimOut(e.target.value as IntroAnimation)} className="bg-white dark:bg-slate-800 rounded outline-none w-20">
                                     {Object.values(IntroAnimation).map(a => <option key={a} value={a}>{a}</option>)}
                                 </select>
                             </div>

                             <div className="flex items-center gap-2">
                                 <AlignLeft className="w-3 h-3" />
                                 <span>Vị trí:</span>
                                 <div className="grid grid-cols-3 gap-0.5 w-12">
                                    {Object.values(SubtitlePosition).map(pos => (
                                        <button key={pos} onClick={() => setIntroPos(pos)} className={`w-3 h-2 rounded-sm transition-all ${introPos === pos ? 'bg-emerald-500' : 'bg-slate-300 dark:bg-slate-600'}`} />
                                    ))}
                                 </div>
                             </div>
                         </div>
                     </div>

                    {/* Visualizer Config */}
                    <div className="space-y-3 bg-slate-50 dark:bg-slate-950/50 p-4 rounded-2xl border border-slate-200 dark:border-slate-800">
                      <p className="text-indigo-500 mb-2 border-b border-indigo-500/10 pb-1">Cấu hình Visualizer</p>
                      
                      {/* Background & Colors */}
                      <div className="flex flex-wrap items-center gap-2 bg-white dark:bg-slate-800 p-1.5 rounded-lg border border-slate-200 dark:border-slate-700">
                        <Palette className="w-3 h-3" />
                        <button onClick={() => setBgType('color')} className={`text-[9px] px-2 py-1 rounded transition-colors ${bgType === 'color' ? 'bg-indigo-500 text-white' : 'hover:bg-slate-100 dark:hover:bg-slate-700'}`}>Màu</button>
                        <button onClick={() => setBgType('image')} className={`text-[9px] px-2 py-1 rounded transition-colors ${bgType === 'image' ? 'bg-indigo-500 text-white' : 'hover:bg-slate-100 dark:hover:bg-slate-700'}`}>Ảnh ({bgImages.length})</button>
                        <button onClick={() => setBgType('video')} className={`text-[9px] px-2 py-1 rounded transition-colors ${bgType === 'video' ? 'bg-indigo-500 text-white' : 'hover:bg-slate-100 dark:hover:bg-slate-700'}`}>Video ({bgVideos.length})</button>
                        
                        {bgType === 'color' && 
                           <input type="color" value={bgColor} onChange={(e) => setBgColor(e.target.value)} className="w-4 h-4 bg-transparent border-none p-0 cursor-pointer" /> 
                        }
                        {bgType === 'image' && (
                           <div className="flex items-center gap-1">
                             <button onClick={() => bgInputRef.current?.click()} className="hover:text-indigo-500 text-[8px] bg-slate-200 dark:bg-slate-700 px-1 rounded flex items-center gap-1"><ImageIcon className="w-2 h-2" /> Thêm</button>
                             {bgImages.length > 0 && <button onClick={() => setBgImages([])} className="hover:text-red-500 text-[8px] bg-slate-200 dark:bg-slate-700 px-1 rounded">Xóa Tất Cả</button>}
                           </div>
                        )}
                        {bgType === 'video' && (
                            <div className="flex items-center gap-1">
                                <button onClick={() => bgVideoInputRef.current?.click()} className="hover:text-indigo-500 text-[8px] bg-slate-200 dark:bg-slate-700 px-1 rounded flex items-center gap-1"><Film className="w-2 h-2" /> Chọn</button>
                                {bgVideos.length > 0 && <button onClick={() => setBgVideos([])} className="hover:text-red-500 text-[8px] bg-slate-200 dark:bg-slate-700 px-1 rounded">Xóa Tất Cả</button>}
                            </div>
                        )}
                        
                        <input ref={bgInputRef} type="file" multiple className="hidden" accept="image/*" onChange={handleBgImagesChange} />
                        <input ref={bgVideoInputRef} type="file" className="hidden" accept="video/*" onChange={handleBgVideosChange} />
                      </div>

                      {/* MEDIA REORDERING UI */}
                      {bgType === 'image' && bgImages.length > 0 && (
                          <div className="flex gap-2 overflow-x-auto py-2 px-1 custom-scrollbar">
                              {bgImages.map((img, idx) => (
                                  <div key={idx} className="relative group min-w-[60px] w-[60px] h-[60px] rounded-lg overflow-hidden border border-slate-300 dark:border-slate-600 bg-black">
                                      <img src={img} className="w-full h-full object-cover" alt="bg" />
                                      <div className="absolute inset-0 bg-black/60 hidden group-hover:flex flex-col items-center justify-center gap-1 p-1">
                                           <div className="flex gap-1 w-full justify-between">
                                              <button onClick={() => moveMediaItem(idx, -1, 'image')} className="p-0.5 bg-white/20 rounded hover:bg-white/40"><ChevronLeft className="w-3 h-3 text-white" /></button>
                                              <button onClick={() => moveMediaItem(idx, 1, 'image')} className="p-0.5 bg-white/20 rounded hover:bg-white/40"><ChevronRight className="w-3 h-3 text-white" /></button>
                                           </div>
                                           <button onClick={() => removeMediaItem(idx, 'image')} className="p-0.5 w-full flex justify-center bg-red-500/80 rounded hover:bg-red-500 mt-1"><X className="w-3 h-3 text-white" /></button>
                                      </div>
                                  </div>
                              ))}
                          </div>
                      )}

                      {bgType === 'video' && bgVideos.length > 0 && (
                          <div className="flex gap-2 overflow-x-auto py-2 px-1 custom-scrollbar">
                              {bgVideos.map((vid, idx) => (
                                  <div key={idx} className="relative group min-w-[60px] w-[60px] h-[60px] rounded-lg overflow-hidden border border-slate-300 dark:border-slate-600 bg-black">
                                      <video src={vid} className="w-full h-full object-cover" muted />
                                      <div className="absolute inset-0 bg-black/60 hidden group-hover:flex flex-col items-center justify-center gap-1 p-1">
                                           <div className="flex gap-1 w-full justify-between">
                                              <button onClick={() => moveMediaItem(idx, -1, 'video')} className="p-0.5 bg-white/20 rounded hover:bg-white/40"><ChevronLeft className="w-3 h-3 text-white" /></button>
                                              <button onClick={() => moveMediaItem(idx, 1, 'video')} className="p-0.5 bg-white/20 rounded hover:bg-white/40"><ChevronRight className="w-3 h-3 text-white" /></button>
                                           </div>
                                           <button onClick={() => removeMediaItem(idx, 'video')} className="p-0.5 w-full flex justify-center bg-red-500/80 rounded hover:bg-red-500 mt-1"><X className="w-3 h-3 text-white" /></button>
                                      </div>
                                  </div>
                              ))}
                          </div>
                      )}
                      
                      {/* Clarity: Explicit Image Opacity Control */}
                      {bgType !== 'color' && (
                         <div className="bg-white dark:bg-slate-800 p-2 rounded-lg border border-slate-200 dark:border-slate-700">
                             <div className="flex items-center gap-2 mb-1">
                                <Layers className="w-3 h-3 text-indigo-500" />
                                <span className="font-bold">Độ mờ & Hiệu ứng:</span>
                             </div>
                             <div className="grid grid-cols-2 gap-2">
                                 <div>
                                    <span className="text-[8px] opacity-70">Opacity ({Math.round(bgImageOpacity * 100)}%):</span>
                                    <input type="range" min="0" max="1" step="0.1" value={bgImageOpacity} onChange={(e) => setBgImageOpacity(parseFloat(e.target.value))} className="w-full h-1 accent-indigo-500 cursor-pointer" />
                                 </div>
                                 {bgType === 'image' && (
                                     <div>
                                        <span className="text-[8px] opacity-70">Hiệu ứng chuyển:</span>
                                        <select value={transitionEffect} onChange={(e) => setTransitionEffect(e.target.value as TransitionEffect)} className="w-full bg-slate-100 dark:bg-slate-700 rounded p-0.5 text-[8px] outline-none">
                                            {Object.values(TransitionEffect).map(ef => <option key={ef} value={ef}>{ef}</option>)}
                                        </select>
                                     </div>
                                 )}
                             </div>
                         </div>
                      )}

                      {/* Visualizer Style Grid with Live Previews */}
                      <div className="bg-white dark:bg-slate-800 p-2 rounded-lg border border-slate-200 dark:border-slate-700 h-40 overflow-y-auto custom-scrollbar">
                         <div className="grid grid-cols-4 gap-2">
                            {Object.values(VisualizerStyle).map((style) => (
                                <VizPreviewItem 
                                    key={style}
                                    styleName={style}
                                    isSelected={vizStyle === style}
                                    onSelect={() => setVizStyle(style)}
                                    color1={vizColor1}
                                    color2={vizColor2}
                                />
                            ))}
                         </div>
                      </div>

                      {/* Viz Positioning & Sizing Controls */}
                      <div className="space-y-2 bg-white dark:bg-slate-800 p-2 rounded-lg border border-slate-200 dark:border-slate-700">
                         <div className="flex items-center justify-between">
                             <div className="flex items-center gap-2">
                                 <Scaling className="w-3 h-3" />
                                 <span>Kích thước & Vị trí:</span>
                             </div>
                             <button 
                                 onClick={() => setVizIsFullWidth(!vizIsFullWidth)}
                                 className={`px-2 py-0.5 rounded text-[8px] transition-colors ${vizIsFullWidth ? 'bg-indigo-500 text-white' : 'bg-slate-200 dark:bg-slate-700'}`}
                             >
                                 {vizIsFullWidth ? 'Full Screen' : 'Tùy chỉnh'}
                             </button>
                         </div>
                         
                         {!vizIsFullWidth && (
                             <div className="grid grid-cols-3 gap-2 mt-2">
                                 <div className="space-y-1">
                                     <span className="text-[8px] flex items-center gap-1"><Move className="w-2 h-2 rotate-90"/> X (Ngang)</span>
                                     <input type="range" min="0" max="100" value={vizPosX} onChange={(e) => setVizPosX(parseInt(e.target.value))} className="w-full h-1 accent-indigo-500"/>
                                 </div>
                                 <div className="space-y-1">
                                     <span className="text-[8px] flex items-center gap-1"><Move className="w-2 h-2"/> Y (Dọc)</span>
                                     <input type="range" min="0" max="100" value={vizPosY} onChange={(e) => setVizPosY(parseInt(e.target.value))} className="w-full h-1 accent-indigo-500"/>
                                 </div>
                                 <div className="space-y-1">
                                     <span className="text-[8px] flex items-center gap-1"><Scaling className="w-2 h-2"/> Scale</span>
                                     <input type="range" min="0.1" max="2" step="0.1" value={vizScale} onChange={(e) => setVizScale(parseFloat(e.target.value))} className="w-full h-1 accent-indigo-500"/>
                                 </div>
                             </div>
                         )}
                      </div>

                      {/* General Viz Settings */}
                      <div className="grid grid-cols-2 gap-2">
                          <div className="space-y-1">
                             <span>Biên độ sóng</span>
                             <input type="range" min="0.2" max="3" step="0.1" value={vizAmplitude} onChange={(e) => setVizAmplitude(parseFloat(e.target.value))} className="w-full h-1 accent-indigo-500" />
                          </div>
                          <div className="space-y-1">
                             <div className="flex justify-between">
                                 <span>Màu sắc</span>
                                 <div className="flex gap-1">
                                    <input type="color" value={vizColor1} onChange={(e) => setVizColor1(e.target.value)} className="w-3 h-3 p-0 bg-transparent border-none cursor-pointer" />
                                    {vizColorMode !== VizColorMode.SINGLE && <input type="color" value={vizColor2} onChange={(e) => setVizColor2(e.target.value)} className="w-3 h-3 p-0 bg-transparent border-none cursor-pointer" />}
                                 </div>
                             </div>
                             <select value={vizColorMode} onChange={(e) => setVizColorMode(e.target.value as VizColorMode)} className="w-full bg-slate-100 dark:bg-slate-700 rounded p-0.5 text-[8px] outline-none">
                                {Object.values(VizColorMode).map(m => <option key={m} value={m}>{m}</option>)}
                             </select>
                          </div>
                      </div>
                    </div>

                    {/* Subtitle & Icon Styling Row */}
                    <div className="space-y-3 bg-slate-50 dark:bg-slate-950/50 p-4 rounded-2xl border border-slate-200 dark:border-slate-800">
                      <p className="text-violet-500 mb-2 border-b border-violet-500/10 pb-1">Phụ đề & Icon</p>
                      
                       <div className="flex items-center gap-2 bg-white dark:bg-slate-800 p-1.5 rounded-lg border border-slate-200 dark:border-slate-700">
                        <Stamp className="w-3 h-3 text-pink-500" />
                        <span className="text-pink-500 font-bold">Icon:</span>
                        <button onClick={() => iconInputRef.current?.click()} className="text-[9px] bg-slate-100 dark:bg-slate-700 px-2 py-0.5 rounded hover:text-pink-500 border border-slate-200 dark:border-slate-600 truncate max-w-[80px]">
                           {iconImage ? 'Đổi ảnh' : 'Chọn ảnh'}
                        </button>
                        <input ref={iconInputRef} type="file" className="hidden" accept="image/*" onChange={handleIconChange} />
                        
                        {iconImage && (
                           <>
                           <button onClick={() => setIconImage(null)} className="text-red-500 hover:bg-red-50 p-0.5 rounded"><Trash2 className="w-3 h-3"/></button>
                           <select value={iconPos} onChange={(e) => setIconPos(e.target.value as CornerPosition)} className="bg-transparent outline-none text-[9px] w-20 cursor-pointer">
                                {Object.values(CornerPosition).map(pos => <option key={pos} value={pos}>{pos}</option>)}
                           </select>
                           </>
                        )}
                      </div>

                      {/* Icon Size Slider */}
                      {iconImage && (
                         <div className="flex items-center gap-2 bg-white dark:bg-slate-800 p-1.5 rounded-lg border border-slate-200 dark:border-slate-700">
                           <span className="text-[9px] font-bold">Size:</span>
                           <input type="range" min="20" max="150" value={iconSize} onChange={(e) => setIconSize(parseInt(e.target.value))} className="w-full accent-pink-500 cursor-pointer h-1" />
                         </div>
                      )}

                      <div className="flex flex-col gap-2 bg-white dark:bg-slate-800 p-2 rounded-lg border border-slate-200 dark:border-slate-700">
                        <div className="flex items-center gap-2">
                           <FontIcon className="w-3 h-3" />
                           <span className="text-xs font-bold">Font:</span>
                        </div>
                        {/* Font Grid Selection */}
                        <div className="grid grid-cols-2 gap-2 max-h-32 overflow-y-auto custom-scrollbar p-1">
                          {FONTS.map(f => (
                             <button 
                                key={f.value} 
                                onClick={() => setSubFont(f.value)} 
                                className={`text-[10px] p-2 rounded border text-center transition-all ${subFont === f.value ? 'border-violet-500 bg-violet-50 dark:bg-violet-900/30' : 'border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800'}`}
                                style={{ fontFamily: f.value.split(',')[0] }}
                                title={f.name}
                             >
                                {f.name}
                             </button>
                          ))}
                        </div>
                      </div>

                      <div className="flex items-center gap-2 bg-white dark:bg-slate-800 p-1.5 rounded-lg border border-slate-200 dark:border-slate-700">
                        <span>Cỡ chữ:</span>
                        <input type="range" min="24" max="150" value={subSize} onChange={(e) => setSubSize(parseInt(e.target.value))} className="w-full accent-violet-500 cursor-pointer" />
                        <span className="ml-2 font-bold text-slate-600 dark:text-slate-300 min-w-[3.5rem] text-center inline-block bg-slate-100 dark:bg-slate-800 px-2 py-1 rounded border border-slate-200 dark:border-slate-700">
                          {subSize}px
                        </span>
                      </div>

                      <div className="flex gap-2 bg-white dark:bg-slate-800 p-2 rounded-lg border border-slate-200 dark:border-slate-700">
                        <div className="flex-1">
                             <div className="flex items-center gap-1 mb-1">
                                <LayoutGrid className="w-3 h-3" />
                                <span>Vị trí (Lưới):</span>
                             </div>
                             <div className="grid grid-cols-3 gap-0.5 w-16 mx-auto">
                               {Object.values(SubtitlePosition).map(pos => (
                                 <button 
                                    key={pos} 
                                    onClick={() => setSubPos(pos)}
                                    className={`w-4 h-3 rounded-sm transition-all ${subPos === pos ? 'bg-violet-500 scale-110 shadow-sm' : 'bg-slate-300 dark:bg-slate-600'}`}
                                 />
                               ))}
                            </div>
                        </div>
                        <div className="w-px bg-slate-200 dark:bg-slate-700 mx-1"></div>
                        <div className="flex-1">
                             <div className="flex items-center gap-1 mb-1">
                                <MoveVertical className="w-3 h-3" />
                                <span>Nâng/Hạ:</span>
                             </div>
                             <div className="flex flex-col items-center justify-center h-full">
                                <input 
                                    type="range" 
                                    min="-50" 
                                    max="50" 
                                    value={subOffset} 
                                    onChange={(e) => setSubOffset(parseInt(e.target.value))} 
                                    className="w-full h-1 accent-violet-500 cursor-pointer"
                                    title="Điều chỉnh vị trí dọc"
                                />
                                <span className="text-[8px] mt-1 opacity-50">{subOffset}%</span>
                             </div>
                        </div>
                      </div>

                      <div className="flex items-center gap-2 bg-white dark:bg-slate-800 p-1.5 rounded-lg border border-slate-200 dark:border-slate-700">
                        <span>Màu chữ:</span>
                        <select value={subColorMode} onChange={(e) => setSubColorMode(e.target.value as VizColorMode)} className="bg-transparent outline-none cursor-pointer">
                          {Object.values(VizColorMode).map(m => <option key={m} value={m}>{m}</option>)}
                        </select>
                        {subColorMode !== VizColorMode.RAINBOW && (
                          <div className="flex gap-1 ml-auto">
                            <input type="color" value={subColor1} onChange={(e) => setSubColor1(e.target.value)} className="w-4 h-4 p-0 bg-transparent border-none cursor-pointer" />
                            {subColorMode === VizColorMode.GRADIENT && <input type="color" value={subColor2} onChange={(e) => setSubColor2(e.target.value)} className="w-4 h-4 p-0 bg-transparent border-none cursor-pointer" />}
                          </div>
                        )}
                      </div>

                      {/* Chế độ Hiển thị chữ */}
                      <div className="flex flex-col gap-2 bg-white dark:bg-slate-800 p-2 rounded-lg border border-slate-200 dark:border-slate-700">
                        <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                                <SlidersHorizontal className="w-3.5 h-3.5 text-indigo-500" />
                                <span className="font-bold text-xs">Chế độ hiển thị chữ</span>
                            </div>
                            <select 
                                value={displayMode} 
                                onChange={(e) => {
                                    const mode = e.target.value as DisplayMode;
                                    setDisplayMode(mode);
                                    setIsKaraoke(mode !== DisplayMode.TEXT_OVERLAY);
                                }} 
                                className="text-[10px] bg-slate-50 dark:bg-slate-900 rounded border border-slate-200 dark:border-slate-700 p-1 outline-none font-medium cursor-pointer"
                            >
                                <option value={DisplayMode.KARAOKE}>🎤 Karaoke (Cơ bản)</option>
                                <option value={DisplayMode.TEXT_OVERLAY}>📝 Text Overlay (CapCut)</option>
                                <option value={DisplayMode.MARQUEE}>📺 Marquee (Chạy ngang)</option>
                                <option value={DisplayMode.SPLIT_SCREEN}>🥞 Split Screen (Nửa dưới)</option>
                                <option value={DisplayMode.TELEPROMPTER}>📜 Teleprompter (Chạy dọc)</option>
                                <option value={DisplayMode.SPLIT_LEFT}>🚪 Split Left (1/2 bên trái)</option>
                                <option value={DisplayMode.SPLIT_RIGHT}>🚪 Split Right (1/2 bên phải)</option>
                                <option value={DisplayMode.SCRIPT}>📰 Script (2/3 màn hình - Bản tin/Dạy học)</option>
                                <option value={DisplayMode.NEWS_TICKER}>📺 News Ticker (Chạy dọc chậm)</option>
                            </select>
                        </div>
                        
                        {displayMode !== DisplayMode.TEXT_OVERLAY && (
                            <div className="mt-1 pt-2 border-t border-slate-100 dark:border-slate-700 space-y-3 animate-in fade-in slide-in-from-top-1">
                                {/* Color */}
                                <div className="flex items-center justify-between">
                                    <span className="text-[10px] text-slate-600 dark:text-slate-400">Màu phát sáng/Màu viền:</span>
                                    <div className="flex items-center gap-3">
                                        <div className="relative group" title="Màu phát sáng (Highlight)">
                                            <div className="w-4 h-4 rounded-full border border-slate-200 shadow-sm flex items-center justify-center text-[7px] font-bold text-white/50 mix-blend-difference" style={{ backgroundColor: karaokeColor }}>H</div>
                                            <input type="color" value={karaokeColor} onChange={(e) => setKaraokeColor(e.target.value)} className="w-6 h-6 p-0 bg-transparent border-none cursor-pointer opacity-0 absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2" />
                                        </div>
                                        <div className="relative group" title="Màu viền (Border)">
                                            <div className="w-4 h-4 rounded-full border border-slate-200 shadow-sm flex items-center justify-center text-[7px] font-bold text-white/50 mix-blend-difference" style={{ backgroundColor: karaokeBorderColor }}>V</div>
                                            <input type="color" value={karaokeBorderColor} onChange={(e) => setKaraokeBorderColor(e.target.value)} className="w-6 h-6 p-0 bg-transparent border-none cursor-pointer opacity-0 absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2" />
                                        </div>
                                    </div>
                                </div>
                                
                                {/* Pre-show Time */}
                                <div className="space-y-1">
                                    <div className="flex items-center justify-between">
                                        <div className="flex items-center gap-1">
                                            <Clock className="w-3 h-3 text-slate-400" />
                                            <span className="text-[10px] text-slate-600 dark:text-slate-400">Xuất hiện sớm:</span>
                                        </div>
                                        <span className="text-[9px] font-mono font-bold bg-slate-100 dark:bg-slate-900 px-1.5 py-0.5 rounded text-slate-600 dark:text-slate-300">{preShowTime}s</span>
                                    </div>
                                    <input 
                                        type="range" 
                                        min="0" 
                                        max="5" 
                                        step="0.1" 
                                        value={preShowTime} 
                                        onChange={(e) => setPreShowTime(parseFloat(e.target.value))} 
                                        className="w-full h-1 accent-red-500 cursor-pointer bg-slate-200 dark:bg-slate-700 rounded-full appearance-none" 
                                    />
                                </div>

                                {/* Line Alignment */}
                                <div className="grid grid-cols-2 gap-2">
                                    <div className="flex flex-col gap-1">
                                        <span className="text-[9px] text-slate-500">Dòng 1:</span>
                                        <select value={line1Align} onChange={(e) => setLine1Align(e.target.value as TextAlign)} className="text-[9px] bg-slate-50 dark:bg-slate-900 rounded border border-slate-200 dark:border-slate-700 p-1 outline-none focus:border-indigo-500">
                                            <option value={TextAlign.LEFT}>Trái</option>
                                            <option value={TextAlign.CENTER}>Giữa</option>
                                            <option value={TextAlign.RIGHT}>Phải</option>
                                        </select>
                                    </div>
                                    <div className="flex flex-col gap-1">
                                        <span className="text-[9px] text-slate-500">Dòng 2:</span>
                                        <select value={line2Align} onChange={(e) => setLine2Align(e.target.value as TextAlign)} className="text-[9px] bg-slate-50 dark:bg-slate-900 rounded border border-slate-200 dark:border-slate-700 p-1 outline-none focus:border-indigo-500">
                                            <option value={TextAlign.LEFT}>Trái</option>
                                            <option value={TextAlign.CENTER}>Giữa</option>
                                            <option value={TextAlign.RIGHT}>Phải</option>
                                        </select>
                                    </div>
                                </div>

                                {/* Line Gap */}
                                <div className="space-y-1">
                                    <div className="flex items-center justify-between">
                                        <span className="text-[10px] text-slate-600 dark:text-slate-400">Khoảng cách dòng:</span>
                                        <span className="text-[9px] font-mono font-bold bg-slate-100 dark:bg-slate-900 px-1.5 py-0.5 rounded text-slate-600 dark:text-slate-300">{lineGap}x</span>
                                    </div>
                                    <input 
                                        type="range" 
                                        min="1" 
                                        max="3" 
                                        step="0.1" 
                                        value={lineGap} 
                                        onChange={(e) => setLineGap(parseFloat(e.target.value))} 
                                        className="w-full h-1 accent-indigo-500 cursor-pointer bg-slate-200 dark:bg-slate-700 rounded-full appearance-none" 
                                    />
                                </div>
                            </div>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Player Controls Bar */}
                  <div className="flex flex-col gap-2 mb-4 px-2">
                    
                    {/* NEW: QUICK SYNC CONTROLS (Only Visible when Paused & Not Recording & Has Result) */}
                    {!isPlaying && !isRecording && result && (
                         <div className="flex flex-col gap-2 animate-in fade-in slide-in-from-top-2 duration-300">
                             {/* Row 1: Quick Sync Buttons */}
                             <div className="flex items-center justify-center gap-3 p-2 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800/50 rounded-xl">
                                 <div className="flex items-center gap-2 text-[10px] font-bold text-amber-600 dark:text-amber-400 uppercase mr-2">
                                     <Target className="w-3 h-3" />
                                     <span>Đồng bộ nhanh:</span>
                                 </div>
                                 <button onClick={() => handleQuickSync('start')} className="px-3 py-1.5 bg-amber-100 hover:bg-amber-200 dark:bg-amber-900/50 dark:hover:bg-amber-800 rounded-lg text-amber-700 dark:text-amber-300 text-[10px] font-bold uppercase flex items-center gap-2 transition-colors border border-amber-300/50">
                                     <ArrowRightToLine className="w-3 h-3" /> Chốt Bắt đầu
                                 </button>
                                 <button onClick={() => handleQuickSync('end')} className="px-3 py-1.5 bg-amber-100 hover:bg-amber-200 dark:bg-amber-900/50 dark:hover:bg-amber-800 rounded-lg text-amber-700 dark:text-amber-300 text-[10px] font-bold uppercase flex items-center gap-2 transition-colors border border-amber-300/50">
                                     <ArrowLeftToLine className="w-3 h-3" /> Chốt Kết thúc
                                 </button>
                             </div>

                             {/* Row 2: Fine Tune Karaoke (New Feature) */}
                             <div className="p-3 bg-indigo-50 dark:bg-indigo-900/10 border border-indigo-200 dark:border-indigo-800/30 rounded-xl space-y-2">
                                 <div className="flex items-center gap-2 mb-1">
                                     <SlidersHorizontal className="w-3 h-3 text-indigo-500" />
                                     <span className="text-[10px] font-bold text-indigo-600 dark:text-indigo-400 uppercase">Tinh chỉnh Karaoke (±0.1s):</span>
                                     <span className="ml-auto text-[10px] italic text-slate-500 truncate max-w-[150px]">{getActiveSegmentText()}</span>
                                 </div>
                                 <div className="flex gap-4">
                                     {/* Start Tuning */}
                                     <div className="flex-1 flex items-center justify-between bg-white dark:bg-slate-800 p-1.5 rounded-lg border border-indigo-100 dark:border-indigo-900/50">
                                         <span className="text-[9px] font-bold text-slate-500 ml-1">Bắt đầu:</span>
                                         <div className="flex items-center gap-1">
                                             <button onClick={() => handleFineTune('start', -0.1)} className="p-1 hover:bg-slate-100 dark:hover:bg-slate-700 rounded text-indigo-600"><Minus className="w-3 h-3" /></button>
                                             <button onClick={() => handleFineTune('start', 0.1)} className="p-1 hover:bg-slate-100 dark:hover:bg-slate-700 rounded text-indigo-600"><Plus className="w-3 h-3" /></button>
                                         </div>
                                     </div>
                                     {/* End Tuning */}
                                     <div className="flex-1 flex items-center justify-between bg-white dark:bg-slate-800 p-1.5 rounded-lg border border-indigo-100 dark:border-indigo-900/50">
                                         <span className="text-[9px] font-bold text-slate-500 ml-1">Kết thúc:</span>
                                         <div className="flex items-center gap-1">
                                             <button onClick={() => handleFineTune('end', -0.1)} className="p-1 hover:bg-slate-100 dark:hover:bg-slate-700 rounded text-red-500"><Minus className="w-3 h-3" /></button>
                                             <button onClick={() => handleFineTune('end', 0.1)} className="p-1 hover:bg-slate-100 dark:hover:bg-slate-700 rounded text-red-500"><Plus className="w-3 h-3" /></button>
                                         </div>
                                     </div>
                                 </div>
                             </div>

                             {/* Row 3: Selected Segment Editor */}
                             {selectedSegmentIndex !== null && parsedSegmentsRef.current && parsedSegmentsRef.current[selectedSegmentIndex] && (
                                 <div className="p-3 bg-violet-50 dark:bg-violet-900/10 border border-violet-200 dark:border-violet-800/30 rounded-xl space-y-2 mt-2">
                                     <div className="flex items-center justify-between mb-1">
                                         <div className="flex items-center gap-2">
                                             <Edit3 className="w-3 h-3 text-violet-500" />
                                             <span className="text-[10px] font-bold text-violet-600 dark:text-violet-400 uppercase">Chỉnh sửa chi tiết:</span>
                                         </div>
                                         <div className="flex gap-2">
                                             <button onClick={() => handleLineToggle(selectedSegmentIndex)} className="px-2 py-1 bg-white dark:bg-slate-800 border border-violet-200 rounded text-[9px] font-bold text-violet-600 hover:bg-violet-50 transition-colors">
                                                 Đổi dòng ({parsedSegmentsRef.current[selectedSegmentIndex].lineNumber || 'Auto'})
                                             </button>
                                             <button onClick={() => handleSplitWords(selectedSegmentIndex)} className="px-2 py-1 bg-white dark:bg-slate-800 border border-violet-200 rounded text-[9px] font-bold text-violet-600 hover:bg-violet-50 transition-colors">
                                                 Tách từ
                                             </button>
                                         </div>
                                     </div>
                                     
                                     {/* Word Timing Editor */}
                                     <div className="flex flex-wrap gap-1 max-h-32 overflow-y-auto custom-scrollbar p-1">
                                         {parsedSegmentsRef.current[selectedSegmentIndex].words?.map((w, wIdx) => (
                                             <div key={wIdx} className="flex flex-col items-center bg-white dark:bg-slate-800 p-1 rounded border border-slate-200 dark:border-slate-700 shadow-sm">
                                                 <span className="text-[9px] font-medium text-slate-700 dark:text-slate-300">{w.word}</span>
                                                 <div className="flex items-center gap-0.5 mt-1">
                                                     <button onClick={() => handleWordUpdate(selectedSegmentIndex, wIdx, -50)} className="p-0.5 hover:bg-red-50 rounded text-red-500 transition-colors"><Minus className="w-2 h-2" /></button>
                                                     <span className="text-[8px] text-slate-400 w-8 text-center font-mono">{w.duration}ms</span>
                                                     <button onClick={() => handleWordUpdate(selectedSegmentIndex, wIdx, 50)} className="p-0.5 hover:bg-green-50 rounded text-green-500 transition-colors"><Plus className="w-2 h-2" /></button>
                                                 </div>
                                             </div>
                                         ))}
                                         {(!parsedSegmentsRef.current[selectedSegmentIndex].words || parsedSegmentsRef.current[selectedSegmentIndex].words.length === 0) && (
                                             <span className="text-[9px] italic text-slate-400 w-full text-center py-2">Chưa có dữ liệu từ. Nhấn "Tách từ" để bắt đầu.</span>
                                         )}
                                     </div>
                                 </div>
                             )}
                         </div>
                    )}

                    <div className="flex items-center justify-between mt-2">
                        <div className="flex items-center gap-3">
                        <button onClick={toggleFullScreen} className="p-2 bg-slate-100 dark:bg-slate-800 rounded-lg hover:text-indigo-500 transition-all active:scale-95 shadow-sm" title="Toàn màn hình">
                            {isFullScreen ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
                        </button>
                        
                        {/* Aspect Ratio Toggle */}
                        <div className="flex bg-slate-100 dark:bg-slate-800 rounded-lg p-0.5 border border-slate-200 dark:border-slate-700">
                            <button onClick={() => setAspectRatio('16:9')} className={`p-1.5 rounded-md transition-all ${aspectRatio === '16:9' ? 'bg-white dark:bg-slate-600 shadow-sm' : 'opacity-50'}`} title="16:9 (Ngang)">
                                <Monitor className="w-4 h-4" />
                            </button>
                            <button onClick={() => setAspectRatio('9:16')} className={`p-1.5 rounded-md transition-all ${aspectRatio === '9:16' ? 'bg-white dark:bg-slate-600 shadow-sm' : 'opacity-50'}`} title="9:16 (Dọc)">
                                <Smartphone className="w-4 h-4" />
                            </button>
                        </div>

                        {/* Recording/Export Buttons */}
                        <div className="flex items-center gap-2">
                            {isRecording ? (
                                <button onClick={stopRecording} className="px-4 py-2 rounded-xl text-[10px] font-black uppercase flex items-center gap-2 transition-all shadow-md active:scale-95 bg-red-500 text-white animate-pulse">
                                    <StopCircle className="w-4 h-4" /> Dừng ghi
                                </button>
                            ) : isExporting ? (
                                <div className="flex items-center gap-2 px-4 py-2 bg-slate-100 dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700">
                                    <Loader2 className="w-4 h-4 animate-spin text-indigo-500" />
                                    <div className="flex flex-col">
                                        <span className="text-[9px] font-bold text-slate-500">Đang xuất video...</span>
                                        <div className="w-20 h-1 bg-slate-200 rounded-full mt-1 overflow-hidden">
                                            <div className="h-full bg-indigo-500 transition-all duration-300" style={{ width: `${exportProgress}%` }}></div>
                                        </div>
                                    </div>
                                </div>
                            ) : (
                                <>
                                    <button onClick={() => handleOfflineExport('720p')} className="px-4 py-2 rounded-xl text-[10px] font-black uppercase flex items-center gap-2 transition-all shadow-md active:scale-95 bg-slate-800 text-white hover:bg-slate-700" title="Xuất video chất lượng HD dạng MP4/WebM">
                                        <Video className="w-4 h-4" /> Xuất MP4 (720p)
                                    </button>
                                    <button onClick={() => handleOfflineExport('1080p')} className="px-4 py-2 rounded-xl text-[10px] font-black uppercase flex items-center gap-2 transition-all shadow-md active:scale-95 bg-indigo-600 text-white hover:bg-indigo-700" title="Xuất video chất lượng Full HD dạng MP4/WebM">
                                        <Highlighter className="w-4 h-4" /> Xuất MP4 (1080p)
                                    </button>
                                </>
                            )}
                        </div>
                        </div>

                        {/* Central Transport Controls */}
                        <div className="flex items-center gap-3">
                        <button onClick={stopPlayback} className="p-2.5 bg-slate-200 dark:bg-slate-800 text-slate-600 dark:text-slate-400 rounded-full hover:bg-red-500 hover:text-white transition-all shadow-md active:scale-90" title="Dừng (Reset)">
                            <Square className="w-4 h-4 fill-current" />
                        </button>
                        
                        {/* Skip Back 1s */}
                        <button onClick={() => skipTime(-1)} className="p-2 text-slate-500 hover:text-indigo-500 transition-colors" title="Lùi 1s">
                            <SkipBack className="w-5 h-5 fill-current" />
                        </button>

                        <button onClick={togglePlayback} className="p-4 bg-indigo-600 text-white rounded-full hover:scale-110 active:scale-90 transition-all shadow-xl shadow-indigo-600/30" title={isPlaying ? "Tạm dừng" : "Phát"}>
                            {isPlaying ? <Pause className="w-6 h-6 fill-current" /> : <Play className="w-6 h-6 fill-current" />}
                        </button>

                        {/* Skip Forward 1s */}
                        <button onClick={() => skipTime(1)} className="p-2 text-slate-500 hover:text-indigo-500 transition-colors" title="Tới 1s">
                            <SkipForward className="w-5 h-5 fill-current" />
                        </button>
                        </div>
                    </div>
                  </div>

                  {/* CapCut MP4 Guide */}
                  <div className="bg-emerald-500/10 border border-emerald-500/20 text-emerald-600 dark:text-emerald-400 p-4 rounded-2xl mb-4 flex items-start gap-2.5 text-[11px] leading-relaxed">
                      <Sparkles className="w-4 h-4 text-emerald-500 shrink-0 mt-0.5" />
                      <div>
                          <p className="font-bold">💡 Định dạng MP4/WebM tối ưu cho CapCut:</p>
                          <p className="opacity-90">Video xuất ra có màu nền hoặc trong suốt. Bạn có thể kéo thả trực tiếp file tải về vào CapCut trên PC/Mac/Điện thoại để lồng ghép nền và chỉnh sửa cực kỳ dễ dàng!</p>
                      </div>
                  </div>

                  {/* PLAYER CONTAINER: Aspect Ratio enforced via JS/Tailwind */}
                  <div className="flex justify-center bg-black/5 dark:bg-black/40 rounded-[32px] p-4">
                      <div ref={playerContainerRef} className={`relative overflow-hidden shadow-2xl flex flex-col items-center justify-center transition-all duration-500 border border-white/10 group bg-black ${aspectRatio === '16:9' ? 'aspect-video w-full' : 'aspect-[9/16] h-[600px]'}`}>
                        {/* Width/Height dynamic based on ratio */}
                        <canvas ref={canvasRef} width={aspectRatio === '16:9' ? 1920 : 1080} height={aspectRatio === '16:9' ? 1080 : 1920} className="w-full h-full object-contain cursor-none" />
                        {isRecording && (
                          <div className="absolute top-6 right-6 flex items-center gap-2 px-3 py-1 bg-red-600 text-white text-[9px] font-black uppercase rounded-full animate-pulse shadow-lg z-30">
                            <div className="w-2 h-2 bg-white rounded-full" /> Đang ghi hình...
                          </div>
                        )}
                      </div>
                  </div>
                  
                  <div className="mt-4 px-2 flex items-center gap-3">
                     <span className="text-[10px] font-mono text-slate-500">{Math.floor(currentTime/60)}:{String(Math.floor(currentTime%60)).padStart(2,'0')}</span>
                     <div className="flex-1 relative group">
                        <input type="range" min="0" max={duration || 100} step="0.1" value={currentTime} onChange={handleSeek} className="w-full h-1.5 bg-slate-200 dark:bg-slate-800 rounded-lg appearance-none cursor-pointer accent-indigo-600" />
                     </div>
                     <span className="text-[10px] font-mono text-slate-500">{Math.floor(duration/60)}:{String(Math.floor(duration%60)).padStart(2,'0')}</span>
                  </div>

                  {/* NEW: Subtitle Timeline Editor */}
                  {result && parsedSegments.length > 0 && (
                      <div className="mt-6 pt-6 border-t border-slate-200 dark:border-slate-800">
                          <div className="flex items-center gap-2 mb-4">
                              <Activity className="w-4 h-4 text-indigo-500" />
                              <span className="text-xs font-bold uppercase text-slate-600 dark:text-slate-400">Timeline Editor</span>
                          </div>
                          <SubtitleTimeline 
                              segments={parsedSegments}
                              duration={duration}
                              currentTime={currentTime}
                              onSeek={(t) => {
                                  if (audioPlayerRef.current) {
                                      audioPlayerRef.current.currentTime = t;
                                      setCurrentTime(t);
                                  }
                              }}
                              onSegmentUpdate={handleSegmentUpdate}
                              waveformData={waveformData?.amplitudes || null}
                              waveformSampleRate={waveformData?.sampleRate || 100}
                          />
                      </div>
                  )}
                  
                  {/* ===== FULL LYRICS PANEL ===== */}
                  {result && parsedSegments.length > 0 && (
                      <div className="mt-6 pt-6 border-t border-slate-200 dark:border-slate-800">
                          <div className="flex items-center justify-between mb-4">
                              <div className="flex items-center gap-2">
                                  <BookOpen className="w-4 h-4 text-indigo-500" />
                                  <span className="text-xs font-bold uppercase text-slate-600 dark:text-slate-400">Lời Toàn Bài</span>
                                  <span className="text-[9px] px-2 py-0.5 rounded-full bg-indigo-100 dark:bg-indigo-900/40 text-indigo-600 dark:text-indigo-400 font-bold">{parsedSegments.length} câu</span>
                              </div>
                          </div>
                          <div 
                              id="lyrics-panel-scroll"
                              className="max-h-[320px] overflow-y-auto rounded-2xl bg-gradient-to-b from-slate-50 to-white dark:from-slate-900 dark:to-slate-950 border border-slate-200 dark:border-slate-800 p-4 space-y-1 custom-scrollbar scroll-smooth"
                          >
                              {parsedSegments.map((seg, idx) => {
                                  const isActive = currentTime >= seg.start && currentTime <= seg.end;
                                  const isPast = currentTime > seg.end;
                                  const isNext = !isActive && !isPast && idx === parsedSegments.findIndex(s => currentTime < s.start);
                                  return (
                                      <div
                                          key={`lyric-${idx}`}
                                          id={`lyric-line-${idx}`}
                                          onClick={() => {
                                              if (audioPlayerRef.current) {
                                                  audioPlayerRef.current.currentTime = seg.start;
                                                  setCurrentTime(seg.start);
                                              }
                                          }}
                                          className={`px-4 py-2 rounded-xl cursor-pointer transition-all duration-300 text-sm leading-relaxed font-semibold select-none ${
                                              isActive
                                                  ? 'bg-indigo-500/15 dark:bg-indigo-500/20 text-indigo-700 dark:text-indigo-300 scale-[1.02] shadow-sm border border-indigo-500/30'
                                                  : isPast
                                                      ? 'text-slate-400 dark:text-slate-600 hover:bg-slate-100 dark:hover:bg-slate-800/50'
                                                      : isNext
                                                          ? 'text-slate-700 dark:text-slate-300 bg-slate-100/50 dark:bg-slate-800/30 hover:bg-slate-100 dark:hover:bg-slate-800/50'
                                                          : 'text-slate-500 dark:text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800/50'
                                          }`}
                                      >
                                          <span className="text-[9px] font-mono text-slate-400 dark:text-slate-600 mr-2">
                                              {Math.floor(seg.start / 60)}:{String(Math.floor(seg.start % 60)).padStart(2, '0')}
                                          </span>
                                          {seg.text}
                                      </div>
                                  );
                              })}
                          </div>
                      </div>
                  )}
                  {!result && (
                     <div className="mt-6 p-4 bg-amber-50 dark:bg-amber-900/10 rounded-2xl border border-amber-200 dark:border-amber-800/50 flex items-center gap-3">
                        <AlertCircle className="w-4 h-4 text-amber-500" />
                        <p className="text-[10px] font-bold text-amber-800 dark:text-amber-400 uppercase tracking-wider">Lưu ý: Bạn cần chạy trích xuất dữ liệu để xem và ghi video phụ đề.</p>
                     </div>
                  )}
                </div>
              ) : (
                <div className="flex-1 flex flex-col p-6 overflow-y-auto space-y-6">
                  {/* Title & Info */}
                  <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-slate-100 dark:border-slate-800 pb-4">
                    <div>
                      <h2 className="text-lg font-black bg-clip-text text-transparent bg-gradient-to-r from-violet-600 to-indigo-500 dark:from-violet-400 dark:to-indigo-400 uppercase tracking-wide flex items-center gap-2">
                        <Music className="w-5 h-5 text-indigo-500" /> Tối Ưu Lời & Phong Cách Nhạc Suno AI 🚀
                      </h2>
                      <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                        Phân tích cấu trúc bài hát, dán nhãn thông minh (Verse, Chorus, Solo...) và tìm style tags chuẩn xác lên tới 1000 ký tự.
                      </p>
                    </div>
                    
                    {/* Pull Lyrics Action */}
                    <button 
                      onClick={pullLyricsFromExtractor}
                      className="px-4 py-2 bg-gradient-to-r from-indigo-500 to-violet-500 hover:from-indigo-600 hover:to-violet-600 text-white text-xs font-black uppercase rounded-xl shadow-md flex items-center gap-2 self-start transition-all duration-300"
                    >
                      <FileText className="w-4 h-4" /> Lấy từ kết quả trích xuất
                    </button>
                  </div>

                  {/* Dual Pane Layout */}
                  <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
                    
                    {/* Left Panel: Input & Settings (Grid-span-5) */}
                    <div className="lg:col-span-5 space-y-4">
                      {/* Lyrics/Idea input */}
                      <div className="space-y-2">
                        <label className="text-xs font-black uppercase text-slate-400 tracking-wider block">1. Nhập lời bài hát hoặc ý tưởng</label>
                        <textarea
                          value={sunoInput}
                          onChange={(e) => setSunoInput(e.target.value)}
                          rows={6}
                          className="w-full p-4 border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 rounded-2xl outline-none font-sans text-xs leading-relaxed focus:ring-2 focus:ring-indigo-500/20 resize-y transition-all text-slate-900 dark:text-slate-100 placeholder-slate-400"
                          placeholder="Ví dụ: Dán lời bài hát thô tại đây, hoặc viết ý tưởng, vd: 'Một bài hát hip hop kể về nỗi cô đơn lúc 2h sáng giữa thành thị lấp lánh đèn...'"
                        />
                      </div>

                      {/* Preferences grid */}
                      <div className="bg-slate-50 dark:bg-slate-950/40 p-5 rounded-2xl border border-slate-150 dark:border-slate-800/60 space-y-4">
                        <h3 className="text-xs font-black uppercase tracking-wider text-indigo-500 border-b border-indigo-500/10 pb-2 flex items-center gap-2">
                          <SlidersHorizontal className="w-3.5 h-3.5" /> 2. Tinh chỉnh tùy chọn (Không bắt buộc)
                        </h3>

                        <div className="space-y-4 text-xs font-black uppercase text-slate-500 dark:text-slate-400">
                          {/* Main Genre Select / Input */}
                          <div className="space-y-1">
                            <span className="text-[10px]">Thể loại chính (Genre):</span>
                            <div className="flex gap-2">
                              <select 
                                value={sunoGenre} 
                                onChange={(e) => setSunoGenre(e.target.value)}
                                className="w-full bg-white dark:bg-slate-800 border cursor-pointer outline-none rounded-xl p-2 text-xs text-slate-800 dark:text-slate-200 border-slate-200 dark:border-slate-700"
                              >
                                <option value="">--- Tự động nhận diện ---</option>
                                <option value="pop">Pop</option>
                                <option value="synthwave">Synthwave (80s Retro)</option>
                                <option value="heavy metal">Heavy Metal / Rock</option>
                                <option value="indie acoustic">Indie Acoustic / Folk</option>
                                <option value="deep house">Deep House / EDM</option>
                                <option value="hip hop rap">Hip Hop / Rap</option>
                                <option value="lofi beats">Lofi Beats</option>
                                <option value="ballad">Ballad / R&B</option>
                                <option value="bolero folk">Bolero / Trữ tình</option>
                              </select>
                            </div>
                          </div>

                          {/* Tempo Select / Input */}
                          <div className="space-y-1">
                            <span className="text-[10px]">Nhịp độ (Tempo):</span>
                            <select 
                              value={sunoTempo} 
                              onChange={(e) => setSunoTempo(e.target.value)}
                              className="w-full bg-white dark:bg-slate-800 border cursor-pointer outline-none rounded-xl p-2 text-xs text-slate-800 dark:text-slate-200 border-slate-200 dark:border-slate-700"
                            >
                              <option value="">--- Tự động nhận diện ---</option>
                              <option value="slow-paced, melancholic tempo">Chậm (Slow)</option>
                              <option value="midtempo, 100 bpm">Vừa (Midtempo 100 BPM)</option>
                              <option value="upbeat, energetic 125 bpm">Nhanh (Upbeat 125 BPM)</option>
                              <option value="fast-paced, high energy 145 bpm">Rất nhanh (Fast 145 BPM)</option>
                            </select>
                          </div>

                          {/* Vocal style */}
                          <div className="space-y-1">
                            <span className="text-[10px]">Kiểu giọng ca sĩ (Vocals):</span>
                            <select 
                              value={sunoVocals} 
                              onChange={(e) => setSunoVocals(e.target.value)}
                              className="w-full bg-white dark:bg-slate-800 border cursor-pointer outline-none rounded-xl p-2 text-xs text-slate-800 dark:text-slate-200 border-slate-200 dark:border-slate-700"
                            >
                              <option value="">--- Tự động nhận diện ---</option>
                              <option value="female vocals">Giọng Nữ (Female)</option>
                              <option value="male vocals">Giọng Nam (Male)</option>
                              <option value="airy ethereal female vocals">Nữ bay bổng (Ethereal Female)</option>
                              <option value="gritty rasp male vocals">Nam khàn, rock (Gritty Male)</option>
                              <option value="duet male and female vocals">Song ca Nam Nữ (Duet)</option>
                              <option value="vietnamese vocals">Giọng hát Tiếng Việt</option>
                            </select>
                          </div>

                          {/* Mood & Atmosphere */}
                          <div className="space-y-1">
                            <span className="text-[10px]">Tâm trạng / Mood:</span>
                            <select 
                              value={sunoMood} 
                              onChange={(e) => setSunoMood(e.target.value)}
                              className="w-full bg-white dark:bg-slate-800 border cursor-pointer outline-none rounded-xl p-2 text-xs text-slate-800 dark:text-slate-200 border-slate-200 dark:border-slate-700"
                            >
                              <option value="">--- Tự động nhận diện ---</option>
                              <option value="emotional, melancholic">Buồn bã, Da diết</option>
                              <option value="uplifting, energetic, driving">Hưng phấn, Đầy năng lượng</option>
                              <option value="dark, atmospheric, cinematic">Tối tăm, Điện ảnh, Huyền bí</option>
                              <option value="chill, relaxing, dreamlike">Thư giãn, Mơ màng</option>
                              <option value="epic, heroic, symphonic">Sử thi, Hoành tráng</option>
                            </select>
                          </div>

                          {/* Featured Instruments */}
                          <div className="space-y-1">
                            <span className="text-[10px]">Nhạc cụ chính (Instruments):</span>
                            <select 
                              value={sunoInstruments} 
                              onChange={(e) => setSunoInstruments(e.target.value)}
                              className="w-full bg-white dark:bg-slate-800 border cursor-pointer outline-none rounded-xl p-2 text-xs text-slate-800 dark:text-slate-200 border-slate-200 dark:border-slate-700"
                            >
                              <option value="">--- Tự động nhận diện ---</option>
                              <option value="acoustic guitar">Acoustic Guitar mộc mạc</option>
                              <option value="soft acoustic piano">Piano êm dịu</option>
                              <option value="distorted electric guitar, heavy drums">Guitar điện & Trống rock dồn dập</option>
                              <option value="vintage synthesizers, analog drum machine">Sóng điện tử Synthesizer cổ điển</option>
                              <option value="orchestral strings, brass">Dàn dây Violin & Kèn đồng hoành tráng</option>
                              <option value="ambient saxophone, light piano">Kèn Saxophone lãng mạn</option>
                            </select>
                          </div>
                        </div>
                      </div>

                      {/* Main Optimizing Button */}
                      <button 
                        onClick={handleSunoOptimize} 
                        disabled={isSunoOptimizing || !sunoInput.trim()}
                        className="w-full py-4 text-xs font-black uppercase tracking-widest bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white rounded-2xl flex items-center justify-center gap-2 transition-all duration-300 shadow-lg shadow-indigo-600/20 active:scale-[0.98]"
                      >
                        {isSunoOptimizing ? (
                          <>
                            <Loader2 className="w-4 h-4 animate-spin" />
                            <span>Đang phân tích & tối ưu...</span>
                          </>
                        ) : (
                          <>
                            <Zap className="w-4 h-4 text-amber-400" />
                            <span>Tối Ưu Cho Suno AI Ngay</span>
                          </>
                        )}
                      </button>
                    </div>

                    {/* Right Panel: Output & Results (Grid-span-7) */}
                    <div className="lg:col-span-7 space-y-6">
                      
                      {!sunoResult ? (
                        /* Empty/Welcome State */
                        <div className="bg-slate-50 dark:bg-slate-950/30 p-8 rounded-3xl border border-slate-100 dark:border-slate-800 text-center space-y-6">
                          <div className="w-16 h-16 bg-indigo-100 dark:bg-indigo-950/50 rounded-2xl flex items-center justify-center mx-auto text-indigo-500 shadow-inner">
                            <SlidersHorizontal className="w-8 h-8" />
                          </div>
                          <div className="max-w-md mx-auto space-y-2">
                            <h3 className="font-bold text-sm">Trình Tối Ưu Hóa Bài Hát Suno Chuyên Nghiệp</h3>
                            <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
                              Khi bạn đưa lời bài hát, các mô hình AI của chúng tôi sẽ biên dịch chúng sang quy tắc cú pháp rập khuôn tối ưu nhất của Suno, giúp bài hát bùng nổ, đúng giai điệu và lôi cuốn nhất.
                            </p>
                          </div>
                          
                          {/* Cheat-Sheet Highlights */}
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-left max-w-xl mx-auto">
                            <div className="bg-white dark:bg-slate-900 p-4 rounded-xl border border-slate-100 dark:border-slate-800/80 space-y-1">
                              <p className="text-[10px] font-black uppercase text-indigo-500 flex items-center gap-1.5"><Sparkles className="w-3.5 h-3.5" /> Giới Hạn 1000 Ký Tự</p>
                              <p className="text-[11px] text-slate-500">Hệ thống Suno mới cho bản Pro/Custom hỗ trợ đến 1000 ký tự style. AI sẽ viết mô tả âm thanh chi tiết cho bạn.</p>
                            </div>
                            <div className="bg-white dark:bg-slate-900 p-4 rounded-xl border border-slate-100 dark:border-slate-800/80 space-y-1">
                              <p className="text-[10px] font-black uppercase text-indigo-500 flex items-center gap-1.5"><Layers className="w-3.5 h-3.5" /> Thẻ Cấu Trúc Đóng Ngoặc</p>
                              <p className="text-[11px] text-slate-500">Sử dụng các nhãn như <code className="bg-slate-100 dark:bg-slate-800 px-1 py-0.5 rounded text-[10px] font-mono">[Verse]</code>, <code className="bg-slate-100 dark:bg-slate-800 px-1 py-0.5 rounded text-[10px] font-mono">[Chorus]</code> giúp cấu tạo bài hát rành mạch.</p>
                            </div>
                            <div className="bg-white dark:bg-slate-900 p-4 rounded-xl border border-slate-100 dark:border-slate-800/80 space-y-1">
                              <p className="text-[10px] font-black uppercase text-indigo-500 flex items-center gap-1.5"><AlignLeft className="w-3.5 h-3.5" /> Cấm Sử Dụng Tên Ca Sĩ</p>
                              <p className="text-[11px] text-slate-500">Suno sẽ chặn hoặc bỏ qua nếu bạn ghi "nhạc Sơn Tùng" hay "giọng Adele". Thay bằng tính chất giọng hát.</p>
                            </div>
                            <div className="bg-white dark:bg-slate-900 p-4 rounded-xl border border-slate-100 dark:border-slate-800/80 space-y-1">
                              <p className="text-[10px] font-black uppercase text-indigo-500 flex items-center gap-1.5"><Clock className="w-3.5 h-3.5" /> Nhịp Độ & Nhạc Cụ</p>
                              <p className="text-[11px] text-slate-500">Sự kết hợp giữa bpm nhạc số và loại nhạc cụ truyền thống tạo ra những bản phối độc bản tuyệt vời.</p>
                            </div>
                          </div>
                        </div>
                      ) : (
                        /* Results Panel */
                        <div className="space-y-6">
                          
                          {/* 1. Subtitle Style Tags Box */}
                          <div className="bg-gradient-to-br from-indigo-500/10 to-violet-500/10 p-5 rounded-2xl border border-indigo-500/20 space-y-3 relative overflow-hidden">
                            <div className="absolute top-0 right-0 w-32 h-32 bg-indigo-500/10 rounded-full blur-2xl pointer-events-none" />
                            
                            <div className="flex items-center justify-between">
                              <span className="text-[10px] font-black uppercase text-indigo-600 dark:text-indigo-400 tracking-wider flex items-center gap-1.5">
                                <Sparkles className="w-4 h-4 animate-spin text-indigo-500" /> Style of music (Nhập ô Phong Cách Suno)
                              </span>
                              <div className="flex items-center gap-2">
                                <span className={`text-[10px] font-mono px-2 py-0.5 rounded-full font-bold ${sunoResult.styleTags.length <= 1000 ? 'bg-indigo-100 dark:bg-indigo-950/60 text-indigo-600' : 'bg-red-100 text-red-600'}`}>
                                  {sunoResult.styleTags.length} / 1000 ký tự
                                </span>
                              </div>
                            </div>

                            {/* Prompter style display */}
                            <div className="p-4 bg-white dark:bg-slate-950 border border-slate-150 dark:border-slate-800 rounded-xl font-mono text-xs text-indigo-600 dark:text-indigo-400 flex items-center gap-3 shadow-inner">
                              <span className="flex-1 select-all break-all">{sunoResult.styleTags}</span>
                              <button 
                                onClick={copySunoStyle}
                                className="p-2 bg-indigo-50 dark:bg-indigo-950/60 hover:bg-indigo-100 rounded-lg text-indigo-500 active:scale-95 transition-all flex items-center justify-center gap-1 shrink-0"
                                title="Chép Style Tags"
                              >
                                {sunoCopyStyleSuccess ? <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" /> : <Copy className="w-3.5 h-3.5" />}
                                <span className="text-[9px] font-black uppercase px-0.5">{sunoCopyStyleSuccess ? 'Xong' : 'Chép'}</span>
                              </button>
                            </div>
                          </div>

                          {/* 2. Structured Lyrics with metadata tags */}
                          <div className="space-y-2">
                            <div className="flex items-center justify-between">
                              <span className="text-[10px] font-black uppercase text-slate-400 tracking-wider flex items-center gap-1.5">
                                <Layers className="w-4 h-4 text-violet-500" /> Lời bài hát tối ưu cấu trúc của bạn
                              </span>
                              <div className="flex items-center gap-2">
                                <button 
                                  onClick={copySunoLyrics}
                                  className="px-2.5 py-1 text-[10px] font-black uppercase border rounded-lg hover:bg-slate-50 dark:hover:bg-slate-800 flex items-center gap-1 transition-all text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900"
                                >
                                  {sunoCopyLyricsSuccess ? <CheckCircle2 className="w-3 h-3 text-emerald-500" /> : <Copy className="w-3 h-3" />}
                                  <span>{sunoCopyLyricsSuccess ? 'Đã chép' : 'Sao chép lời'}</span>
                                </button>
                                <button 
                                  onClick={downloadSunoLyrics}
                                  className="px-2.5 py-1 text-[10px] font-black uppercase bg-indigo-500 text-white rounded-lg hover:bg-indigo-600 flex items-center gap-1 transition-all"
                                >
                                  <Download className="w-3 h-3" />
                                  <span>Tải .txt</span>
                                </button>
                              </div>
                            </div>

                            <textarea
                              value={sunoResult.lyrics}
                              readOnly
                              rows={12}
                              className="w-full p-4 border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 rounded-2xl outline-none font-mono text-xs leading-relaxed focus:ring-2 focus:ring-indigo-500/20 resize-y shadow-inner text-slate-900 dark:text-slate-100"
                            />
                          </div>

                          {/* 3. Vibe Analysis & Tips */}
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <div className="p-4 bg-slate-50 dark:bg-slate-950/20 border border-slate-150 dark:border-slate-800/80 rounded-2xl space-y-1.5">
                              <p className="text-[10px] font-black uppercase text-violet-500 flex items-center gap-1"><BookOpen className="w-3.5 h-3.5" /> Phân tích Vibe Nhạc</p>
                              <p className="text-[11px] text-slate-600 dark:text-slate-300 leading-relaxed">{sunoResult.vibeDescription}</p>
                            </div>
                            <div className="p-4 bg-emerald-50/40 dark:bg-emerald-950/10 border border-emerald-100 dark:border-emerald-900/40 rounded-2xl space-y-1.5">
                              <p className="text-[10px] font-black uppercase text-emerald-500 flex items-center gap-1"><CheckCircle2 className="w-3.5 h-3.5" /> Hướng Dẫn Kỹ Thuật Suno</p>
                              <p className="text-[11px] text-slate-600 dark:text-slate-300 leading-relaxed">{sunoResult.vietnameseGuide}</p>
                            </div>
                          </div>

                        </div>
                      )}

                    </div>
                  </div>

                  {/* Cheat sheet of Suno's internal meta tags */}
                  <div className="bg-slate-100/50 dark:bg-slate-900/50 p-5 rounded-2xl border border-slate-200/60 dark:border-slate-800/80 space-y-3">
                    <h3 className="text-xs font-black uppercase text-slate-500 tracking-wider flex items-center gap-2">
                      <Cpu className="w-4 h-4 text-indigo-500" /> Bảng tra cứu thẻ cấu trúc (Suno Meta Tags Cheat Sheet)
                    </h3>
                    <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-5 gap-3.5 text-[10px] font-sans">
                      <div className="space-y-1">
                        <span className="font-mono font-bold text-indigo-500 bg-white dark:bg-slate-950 px-1 py-0.5 rounded border border-slate-200 dark:border-slate-800 inline-block">[Intro]</span>
                        <p className="text-slate-400">Khởi đầu bản phối, dạo nhạc nhẹ nhàng.</p>
                      </div>
                      <div className="space-y-1">
                        <span className="font-mono font-bold text-indigo-500 bg-white dark:bg-slate-950 px-1 py-0.5 rounded border border-slate-200 dark:border-slate-800 inline-block">[Verse] Hook chính</span>
                        <p className="text-slate-400">Đoạn tự sự kể câu chuyện, hạ giọng dập dịch.</p>
                      </div>
                      <div className="space-y-1">
                        <span className="font-mono font-bold text-indigo-500 bg-white dark:bg-slate-950 px-1 py-0.5 rounded border border-slate-200 dark:border-slate-800 inline-block">[Chorus] Điệp khúc</span>
                        <p className="text-slate-400">Điệp khúc cao trào, lặp lại nhịp độ mạnh.</p>
                      </div>
                      <div className="space-y-1">
                        <span className="font-mono font-bold text-indigo-500 bg-white dark:bg-slate-950 px-1 py-0.5 rounded border border-slate-200 dark:border-slate-800 inline-block">[Guitar Solo]</span>
                        <p className="text-slate-400">Kích hoạt đoạn độc tấu Guitar điện xuất sắc.</p>
                      </div>
                      <div className="space-y-1">
                        <span className="font-mono font-bold text-indigo-500 bg-white dark:bg-slate-950 px-1 py-0.5 rounded border border-slate-200 dark:border-slate-800 inline-block">[Drop]</span>
                        <p className="text-slate-400">Beat dập tắt âm thanh tạm thời và bùng nổ trở lại.</p>
                      </div>
                      <div className="space-y-1">
                        <span className="font-mono font-bold text-indigo-500 bg-white dark:bg-slate-950 px-1 py-0.5 rounded border border-slate-200 dark:border-slate-800 inline-block">[Pre-Chorus]</span>
                        <p className="text-slate-400">Chuẩn bị đẩy cao trào, tăng nhịp điệu dồn dập.</p>
                      </div>
                      <div className="space-y-1">
                        <span className="font-mono font-bold text-indigo-500 bg-white dark:bg-slate-950 px-1 py-0.5 rounded border border-slate-200 dark:border-slate-800 inline-block">[Melodic Interlude]</span>
                        <p className="text-slate-400">Đoạn gián tấu giai đoạn êm dịu giữa bài.</p>
                      </div>
                      <div className="space-y-1">
                        <span className="font-mono font-bold text-indigo-500 bg-white dark:bg-slate-950 px-1 py-0.5 rounded border border-slate-200 dark:border-slate-800 inline-block">[Whisper]</span>
                        <p className="text-slate-400">Ca sĩ thì thầm vào micro tạo không khí tự sự.</p>
                      </div>
                      <div className="space-y-1">
                        <span className="font-mono font-bold text-indigo-500 bg-white dark:bg-slate-950 px-1 py-0.5 rounded border border-slate-200 dark:border-slate-800 inline-block">[Bridge] Cầu nối</span>
                        <p className="text-slate-400">Đoạn nối bộc lộ cảm xúc mới mẻ, đổi hướng nhịp.</p>
                      </div>
                      <div className="space-y-1">
                        <span className="font-mono font-bold text-indigo-500 bg-white dark:bg-slate-950 px-1 py-0.5 rounded border border-slate-200 dark:border-slate-800 inline-block">[Outro]</span>
                        <p className="text-slate-400">Nhạc nhỏ dần và tắt dứt khoát kết thúc bài.</p>
                      </div>
                    </div>
                  </div>

                  {/* Suno/YT Copyright Accordion */}
                  <div className="bg-slate-100/50 dark:bg-slate-900/50 p-5 rounded-2xl border border-slate-200/60 dark:border-slate-800/80 space-y-4 mt-6">
                    <h3 className="text-xs font-black uppercase text-emerald-600 dark:text-emerald-400 tracking-wider flex items-center gap-2">
                      <Sparkles className="w-4 h-4 text-emerald-500 animate-pulse" /> Cẩm nang sáng tạo & lách bản quyền Suno AI / YouTube 🛡️
                    </h3>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs">
                      <div className="bg-white dark:bg-slate-950 p-4 rounded-xl border border-slate-200 dark:border-slate-850 space-y-2">
                        <p className="font-bold text-indigo-500 flex items-center gap-1.5">1. Cách viết Style không dính gậy</p>
                        <p className="text-[11px] text-slate-500 leading-relaxed">
                          Suno cấm nhập tên ca sĩ hoặc ban nhạc thật. Để tạo nhạc cực chất, bạn hãy mô tả phong cách bằng các từ khóa nhạc lý: nhạc cụ chính, nhịp độ bpm, chất giọng (ví dụ: <code className="bg-slate-100 dark:bg-slate-800 px-1 py-0.5 rounded font-mono text-[9px]">90bpm, synthwave pop, melodic warm female vocals, stereo panning acoustic guitars</code>).
                        </p>
                      </div>
                      <div className="bg-white dark:bg-slate-950 p-4 rounded-xl border border-slate-200 dark:border-slate-850 space-y-2">
                        <p className="font-bold text-indigo-500 flex items-center gap-1.5">2. Kỹ thuật Chế lời (Parody Lyrics)</p>
                        <p className="text-[11px] text-slate-500 leading-relaxed">
                          Muốn biến bài hát quen thuộc thành bản cover chế của riêng bạn? Hãy giữ nguyên nhịp điệu (số từ trên mỗi câu) của bài gốc, nhưng thay đổi từ khóa chính, đổi bối cảnh câu chuyện. AI sẽ tự động phân tách cấu trúc <code className="bg-slate-100 dark:bg-slate-800 px-1 py-0.5 rounded font-mono text-[9px]">[Verse]</code>, <code className="bg-slate-100 dark:bg-slate-800 px-1 py-0.5 rounded font-mono text-[9px]">[Chorus]</code> để Suno bắt beat hoàn hảo.
                        </p>
                      </div>
                      <div className="bg-white dark:bg-slate-950 p-4 rounded-xl border border-slate-200 dark:border-slate-850 space-y-2">
                        <p className="font-bold text-indigo-500 flex items-center gap-1.5">3. Cover dòng nhạc khác để lách YT</p>
                        <p className="text-[11px] text-slate-500 leading-relaxed">
                          Để tránh bị Content ID của YouTube quét bản quyền bài gốc, bạn hãy phối khí lại bài hát đó sang một thể loại hoàn toàn khác lạ (ví dụ: Chuyển một bản Pop ballad buồn sang phong cách Retro 80s Synthwave sôi động, Lofi Jazz êm dịu, hay Rock bùng nổ). Điều này tạo ra bản phối độc nhất!
                        </p>
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </main>

      <footer className="py-6 text-center opacity-30 text-[10px] font-black uppercase tracking-[0.3em] flex items-center justify-center gap-4">
        <Cpu className="w-3 h-3 text-indigo-500" />
        <span>LyricSub AI Engine • 2025 Next-Gen Precision Sync</span>
      </footer>
      <audio ref={audioPlayerRef} src={audioUrl || undefined} className="hidden" crossOrigin="anonymous" />
      {/* Hidden BG Video Element */}
      {bgVideos.length > 0 && <video ref={bgVideoRef} src={bgVideos[0]} className="hidden" muted loop playsInline crossOrigin="anonymous" />}

      {/* Gemini API Key Dialog */}
      {showApiKeyDialog && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={() => setShowApiKeyDialog(false)}>
          <div onClick={(e) => e.stopPropagation()} className="relative w-full max-w-md mx-4 bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-700 shadow-2xl overflow-hidden">
            {/* Header gradient */}
            <div className="bg-gradient-to-r from-indigo-600 via-violet-600 to-purple-600 p-6 pb-8">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="p-2.5 bg-white/20 rounded-xl backdrop-blur-sm">
                    <Key className="w-5 h-5 text-white" />
                  </div>
                  <div>
                    <h2 className="text-lg font-black text-white">Gemini API Key</h2>
                    <p className="text-[10px] text-white/70 font-bold uppercase tracking-widest">Cấu hình kết nối AI</p>
                  </div>
                </div>
                <button onClick={() => setShowApiKeyDialog(false)} className="p-1.5 rounded-lg bg-white/10 hover:bg-white/20 text-white transition-colors">
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* Body */}
            <div className="p-6 -mt-4">
              <div className="bg-slate-50 dark:bg-slate-800/50 rounded-2xl p-5 border border-slate-200 dark:border-slate-700 space-y-4">
                <div>
                  <label className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-2 block">API Key</label>
                  <div className="relative">
                    <input
                      type="password"
                      value={apiKeyInput}
                      onChange={(e) => setApiKeyInput(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && handleSaveApiKey()}
                      placeholder="AIzaSy..."
                      className="w-full px-4 py-3 pr-10 bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-700 text-sm font-mono outline-none transition-all focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-500"
                      autoFocus
                    />
                    <Key className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-300" />
                  </div>
                </div>

                {hasApiKey && (
                  <div className="flex items-center gap-2 text-emerald-600 dark:text-emerald-400">
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    <span className="text-[11px] font-bold">API Key đã được lưu</span>
                  </div>
                )}

                <div className="bg-indigo-50 dark:bg-indigo-900/20 rounded-xl p-3 border border-indigo-100 dark:border-indigo-800/40">
                  <p className="text-[10px] text-indigo-600 dark:text-indigo-300 leading-relaxed">
                    <span className="font-black">Hướng dẫn:</span> Truy cập{' '}
                    <a href="https://aistudio.google.com/app/apikey" target="_blank" rel="noreferrer" className="underline font-bold hover:text-indigo-800 dark:hover:text-indigo-200">Google AI Studio</a>
                    {' '}để tạo API Key miễn phí. Key được lưu trên trình duyệt của bạn, không gửi đi đâu khác.
                  </p>
                </div>
              </div>

              {/* Actions */}
              <div className="flex gap-3 mt-5">
                <button onClick={() => setShowApiKeyDialog(false)} className="flex-1 py-3 rounded-xl font-bold text-xs uppercase tracking-widest bg-slate-100 dark:bg-slate-800 text-slate-500 hover:bg-slate-200 dark:hover:bg-slate-700 transition-all">
                  Hủy
                </button>
                <button onClick={handleSaveApiKey} className="flex-1 py-3 rounded-xl font-black text-xs uppercase tracking-widest bg-gradient-to-r from-indigo-600 to-violet-600 text-white hover:from-indigo-700 hover:to-violet-700 transition-all shadow-lg shadow-indigo-600/20 flex items-center justify-center gap-2">
                  <CheckCircle2 className="w-4 h-4" />
                  Lưu Key
                </button>
              </div>

              {/* Delete Key option */}
              {hasApiKey && (
                <button onClick={() => { setApiKeyInput(''); setStoredApiKey(''); setHasApiKey(false); }} className="w-full mt-3 py-2 text-[10px] font-bold uppercase tracking-widest text-red-400 hover:text-red-500 transition-colors flex items-center justify-center gap-1.5">
                  <Trash2 className="w-3 h-3" />
                  Xóa API Key đã lưu
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default App;
