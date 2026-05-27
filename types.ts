
export enum ProcessingMode {
  LYRICS = 'LYRICS',
  SUBTITLES = 'SUBTITLES'
}

export enum ExportFormat {
  SRT = 'SRT',
  ASS = 'ASS'
}

export enum GeminiModel {
  V3_FLASH = 'gemini-3-flash-preview',
  V3_PRO = 'gemini-3-pro-preview'
}

export enum TextCase {
  NORMAL = 'NORMAL',
  UPPER = 'UPPER',
  LOWER = 'LOWER'
}

export enum VisualizerStyle {
  NONE = 'None',
  // Classic
  BARS = 'Bars',
  CIRCLE = 'Radial',
  WAVE = 'Waveform',
  PIXELS = 'Matrix',
  PARTICLES = 'Particles',
  MIRROR = 'Mirror',
  BLOCKS = 'Blocks',
  SPECTRUM = 'Spectrum',
  CIRCULAR_BARS = 'Circular Bars',
  DUAL_WAVE = 'Dual Wave',
  SYMMETRY = 'Symmetry',
  // New Creative Styles
  RINGS = 'Freq Rings',
  HEXAGON = 'Hex Grid',
  HUD = 'Tech HUD',
  SPIRAL = 'Spiral',
  HEART = 'Heartbeat',
  SHOCKWAVE = 'Shockwave',
  ECLIPSE = 'Eclipse',
  STARFIELD = 'Starfield',
  OSCILLOSCOPE = 'Oscilloscope',
  LUMI = 'Lumi Orb'
}

export enum VizColorMode {
  SINGLE = 'Single',
  GRADIENT = 'Gradient',
  RAINBOW = 'Rainbow'
}

export enum SubtitlePosition {
  TOP_LEFT = 'top-left',
  TOP_CENTER = 'top-center',
  TOP_RIGHT = 'top-right',
  MIDDLE_LEFT = 'middle-left',
  MIDDLE_CENTER = 'middle-center',
  MIDDLE_RIGHT = 'middle-right',
  BOTTOM_LEFT = 'bottom-left',
  BOTTOM_CENTER = 'bottom-center',
  BOTTOM_RIGHT = 'bottom-right'
}

export enum TextAlign {
  LEFT = 'left',
  CENTER = 'center',
  RIGHT = 'right'
}

export enum TransitionEffect {
  NONE = 'None',
  FADE = 'Fade',
  SLIDE_LEFT = 'Slide Left',
  SLIDE_UP = 'Slide Up',
  ZOOM_IN = 'Zoom In',
  FLASH = 'Flash',
  RANDOM = 'Random'
}

export enum IntroAnimation {
  NONE = 'None',
  FADE = 'Fade',
  ZOOM_IN = 'Zoom In',
  ZOOM_OUT = 'Zoom Out',
  SLIDE_UP = 'Slide Up',
  SLIDE_DOWN = 'Slide Down',
  SLIDE_LEFT = 'Slide Left',
  SLIDE_RIGHT = 'Slide Right'
}

export enum DisplayMode {
  KARAOKE = 'Karaoke',
  TEXT_OVERLAY = 'Text Overlay',
  MARQUEE = 'Marquee',
  SPLIT_SCREEN = 'Split Screen',
  TELEPROMPTER = 'Teleprompter',
  SPLIT_LEFT = 'Split Left',
  SPLIT_RIGHT = 'Split Right',
  SCRIPT = 'Script',
  NEWS_TICKER = 'News Ticker'
}

export enum CornerPosition {
  TOP_LEFT = 'Top Left',
  TOP_RIGHT = 'Top Right',
  BOTTOM_LEFT = 'Bottom Left',
  BOTTOM_RIGHT = 'Bottom Right'
}

export interface WordTiming {
  word: string;
  duration: number; // milliseconds
}

export interface SubtitleSegment {
  index: number;
  start: number;
  end: number;
  text: string;
  words?: WordTiming[];
  lineNumber?: 1 | 2;
}

export interface GeminiResponse {
  segments?: SubtitleSegment[];
  lyrics?: string;
}