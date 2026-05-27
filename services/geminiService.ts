import { GoogleGenAI, Type } from "@google/genai";
import { ProcessingMode, GeminiModel } from "../types";

const API_KEY_STORAGE_KEY = 'lyricsub_gemini_api_key';

export function getStoredApiKey(): string {
  try {
    return localStorage.getItem(API_KEY_STORAGE_KEY) || '';
  } catch {
    return '';
  }
}

export function setStoredApiKey(key: string): void {
  try {
    localStorage.setItem(API_KEY_STORAGE_KEY, key);
  } catch (e) {
    console.error('Failed to save API key', e);
  }
}

export function getEffectiveApiKey(): string {
  const stored = getStoredApiKey();
  if (stored) return stored;
  return (typeof process !== 'undefined' && process.env?.GEMINI_API_KEY) || '';
}

export interface ModelInfo {
  name: string;
  displayName: string;
}

export async function getAvailableModels(): Promise<ModelInfo[]> {
  try {
    const ai = new GoogleGenAI({ apiKey: getEffectiveApiKey() });
    const modelsResponse = await ai.models.list();
    const models: ModelInfo[] = [];

    const excludePatterns = [
      'vision', 'experimental', 'embedding', 'robotics', 'tts',
      'nano', 'custom-tools', 'live', 'lite', 'imagen', 'learnlm',
      'bisheng', 'aqa'
    ];

    for await (const m of modelsResponse) {
      const name = m.name.toLowerCase();
      if (
        name.includes('gemini') &&
        !excludePatterns.some(p => name.includes(p)) &&
        (name.includes('pro') || name.includes('flash'))
      ) {
         models.push({
           name: m.name.replace('models/', ''),
           displayName: m.displayName || m.name.replace('models/', '')
         });
      }
    }
    
    return models.sort((a, b) => {
      const aIsFlash = a.name.includes('flash') ? 1 : 0;
      const bIsFlash = b.name.includes('flash') ? 1 : 0;
      if (bIsFlash !== aIsFlash) return bIsFlash - aIsFlash;
      return b.name.localeCompare(a.name);
    });
  } catch (err) {
    console.error("Error fetching models, returning defaults:", err);
    return [
      { name: "gemini-2.5-pro", displayName: "Gemini 2.5 Pro" },
      { name: "gemini-2.5-flash", displayName: "Gemini 2.5 Flash" },
      { name: "gemini-3.1-pro-preview", displayName: "Gemini 3.1 Pro Preview" },
      { name: "gemini-3.1-flash-preview", displayName: "Gemini 3.1 Flash Preview" }
    ];
  }
}

// ===== WORD-LEVEL TIMING SCHEMA (Highly Compressed Inline Format) =====
const WORD_LEVEL_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    segments: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          index: { type: Type.INTEGER },
          start: { type: Type.NUMBER, description: "Start time in seconds (e.g. 15.5)" },
          end: { type: Type.NUMBER, description: "End time in seconds (e.g. 18.2)" },
          text: { type: Type.STRING, description: "Văn bản kèm thời lượng từng từ dạng 'Từ{mili_giây}', ví dụ: 'Tôi{500} yêu{350} em{450}'" }
        },
        required: ["index", "start", "end", "text"]
      }
    }
  },
  required: ["segments"]
};

// Segment-only schema (legacy fallback)
const SEGMENT_ONLY_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    segments: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          index: { type: Type.INTEGER },
          start: { type: Type.NUMBER, description: "Start time in seconds (e.g. 15.5)" },
          end: { type: Type.NUMBER, description: "End time in seconds (e.g. 18.2)" },
          text: { type: Type.STRING, description: "Subtitle text" },
        },
        required: ["index", "start", "end", "text"]
      }
    }
  },
  required: ["segments"]
};

// Helper: Determine max output tokens based on model capabilities
function getMaxOutputTokens(modelName: string): number {
  const name = modelName.toLowerCase();
  if (name.includes('pro')) return 131072; // 128K for Pro models - handles long songs with word-level timing
  return 65536; // 64K for Flash models
}

export async function processAudioWithGemini(
  audioBase64: string,
  mimeType: string,
  mode: ProcessingMode,
  language: string,
  duration: number,
  modelName: string | GeminiModel = GeminiModel.V3_FLASH,
  referenceLyrics?: string,
  enableWordLevel: boolean = true
): Promise<string> {
  const ai = new GoogleGenAI({ apiKey: getEffectiveApiKey() });
  
  const isThinkingModel = modelName.includes('thinking');

  // ===== ENHANCED SYSTEM INSTRUCTION (Module 1 - Compressed) =====
  const systemInstruction = mode === ProcessingMode.LYRICS 
    ? "Bạn là chuyên gia biên tập lời bài hát (Lyrics Editor). Nhiệm vụ: Nghe file audio, nhận diện lời hát chính xác, trình bày chia khổ (verse/chorus) rõ ràng, đúng chính tả. Không thêm lời dẫn."
    : `Bạn là chuyên gia kỹ thuật âm thanh cấp cao (Senior Audio Timing Engineer) chuyên về Karaoke Word-Level Sync.
       
       MỤC TIÊU CỐT LÕI: TẠO KARAOKE KHỚP TỪNG TỪ CHO TOÀN BỘ BÀI HÁT (FULL LENGTH SYNCHRONIZATION).
       
       QUY TẮC VÀNG VỀ THỜI GIAN (TIMING RULES):
       1. **START (Vocal Onset):** Bắt đầu ngay khoảnh khắc ca sĩ phát ra âm thanh đầu tiên của câu. Bỏ qua nhạc dạo/nhạc nền.
       2. **END (Vocal Offset):** Kết thúc đúng lúc ca sĩ dứt tiếng từ cuối cùng. Cắt gọn gàng ngay khi dứt tiếng.
       3. **INLINE WORD TIMING (SIÊU QUAN TRỌNG - TIẾT KIỆM BỘ NHỚ):**
          - Bạn PHẢI tích hợp thời lượng của mỗi từ TRỰC TIẾP vào trong câu văn bản ở trường "text" dưới dạng 'Từ{mili_giây}'.
          - Ví dụ: Thay vì viết "Tôi yêu em" → Bạn viết "Tôi{600} yêu{800} em{600}".
          - Mỗi từ trong câu phải có thời lượng (duration) bằng mili-giây thật chính xác theo tốc độ hát.
          - Tổng thời lượng của tất cả các từ trong câu phải đúng bằng (end - start) * 1000.
          - KHÔNG được bỏ sót bất kỳ từ nào, kể cả từ đệm.
       4. **MẠCH LẠC:** Segments phải theo thứ tự thời gian, không overlap.
       5. **TOÀN BỘ BÀI HÁT (BẮT BUỘC):**
          - Bạn BẮT BUỘC phải nghe, nhận diện và trích xuất timing cho TOÀN BỘ thời lượng bài hát từ giây 0:00 cho đến giây cuối cùng (giây thứ ${Math.floor(duration)}).
          - TUYỆT ĐỐI KHÔNG ĐƯỢC DỪNG LẠI ở giữa chừng. Phải trích xuất đầy đủ tất cả các câu hát cho đến khi hết audio. Kể cả bài hát dài, hãy kiên trì trích xuất hết 100%.
       
       RÀNG BUỘC KỸ THUẬT:
       - start < end cho mọi segment.
       - 0 ≤ start, end ≤ ${duration.toFixed(2)}.
       - Ngôn ngữ: ${language}.
       - Phân chia câu ngắn gọn từ 2-4 giây để hiển thị mượt mà.`;

  const referencePrompt = referenceLyrics 
    ? `\n\nLỜI GỐC ĐỂ ĐỐI CHIẾU (BẮT BUỘC TUÂN THỦ):
Bạn PHẢI căn chỉnh thời gian cho TOÀN BỘ lời gốc dưới đây, từ đầu đến cuối. 
KHÔNG được cắt xén, bỏ bớt, hay thay đổi bất kỳ từ nào.
Mỗi từ trong lời gốc phải xuất hiện trong output với timing chính xác.
Mỗi từ phải đi kèm với {duration} bằng mili-giây.

${referenceLyrics}` 
    : "";

  // ===== ENHANCED PROMPT (Module 1 - Compressed) =====
  const prompt = mode === ProcessingMode.LYRICS
    ? `Trích xuất lời bài hát cho file audio này. Ngôn ngữ: ${language}. Độ dài: ${Math.floor(duration)}s.${referencePrompt}`
    : `Phân tích Audio và tạo JSON Karaoke WORD-LEVEL TIMING chuẩn từng mili-giây dưới dạng tích hợp gọn nhẹ (Inline format) cho toàn bộ bài hát dài ${Math.floor(duration)} giây.
       
       YÊU CẦU BẮT BUỘC KHÔNG THỂ BỎ QUA:
       - Bạn phải trích xuất timing cho TOÀN BỘ thời lượng bài hát từ giây 0:00 cho đến giây cuối cùng là ${Math.floor(duration)} giây.
       - Tuyệt đối không dừng lại ở giữa chừng. Phải bao phủ toàn bộ nội dung bài hát.
       
       HƯỚNG DẪN CHI TIẾT:
       1. **Nghe kỹ từng từ**: Xác định chính xác thời điểm bắt đầu và kết thúc MỖI TỪ.
       2. **Định dạng inline**: Viết thời lượng (duration tính bằng mili-giây) trực tiếp sau mỗi từ trong trường "text" dưới dạng: word{duration_ms}
          Ví dụ: Câu "Tôi yêu em" hát trong 2 giây (start: 12.0, end: 14.0):
          "text": "Tôi{600} yêu{800} em{600}"
       3. **Tight timing**: Segment "end" phải cắt ngay khi từ cuối dứt tiếng.
       4. **Tổng words duration = (end - start) * 1000**: Bắt buộc khớp!
       
       ${referencePrompt}
       
       Output JSON bắt buộc khớp theo schema dưới đây:
       { "segments": [{ "index": 1, "start": 12.5, "end": 15.2, "text": "Tôi{500} yêu{600} em{400}" }] }`;

  const responseSchema = mode === ProcessingMode.SUBTITLES 
    ? (enableWordLevel ? WORD_LEVEL_SCHEMA : SEGMENT_ONLY_SCHEMA)
    : undefined;

  const result = await ai.models.generateContent({
    model: typeof modelName === 'string' ? modelName : modelName,
    contents: [
      {
        parts: [
          { inlineData: { data: audioBase64, mimeType } },
          { text: prompt }
        ]
      }
    ],
    config: {
      systemInstruction,
      responseMimeType: mode === ProcessingMode.SUBTITLES ? "application/json" : "text/plain",
      responseSchema: mode === ProcessingMode.SUBTITLES ? responseSchema : undefined,
      temperature: 0.1, // Lower temperature for more precise timing
      maxOutputTokens: getMaxOutputTokens(typeof modelName === 'string' ? modelName : modelName), // Pro: 128K, Flash: 64K
      thinkingConfig: isThinkingModel ? { thinkingBudget: 2048 } : undefined
    }
  });

  return result.text || "";
}

// ===== MODULE 3: MULTI-PASS REFINEMENT =====

export interface RefinementProgress {
  currentPass: number;
  totalPasses: number;
  status: string;
}

/**
 * Multi-pass refinement: re-sends segments back to AI for timing correction
 * Pass 1: Initial extraction (already done)
 * Pass 2: Refine word-level timing with segment context
 * Pass 3: Validation pass
 */
export async function refineTimingWithGemini(
  audioBase64: string,
  mimeType: string,
  currentSegments: string, // JSON string of current segments
  language: string,
  duration: number,
  modelName: string,
  onProgress?: (progress: RefinementProgress) => void
): Promise<string> {
  const ai = new GoogleGenAI({ apiKey: getEffectiveApiKey() });
  const isThinkingModel = modelName.includes('thinking');

  onProgress?.({ currentPass: 2, totalPasses: 2, status: 'Đang tinh chỉnh word-level timing...' });

  const refineSystemInstruction = `Bạn là chuyên gia Karaoke Timing Validator. 
Nhiệm vụ: Nhận kết quả timing sơ bộ và file audio gốc, rồi TINH CHỈNH cho chính xác hơn.

QUY TẮC:
1. Nghe lại audio kỹ càng và so sánh với timing hiện tại.
2. Sửa các word duration sai lệch (từ hát nhanh nhưng duration quá dài, hoặc ngược lại).
3. Đảm bảo tổng word durations = (end - start) * 1000 cho mỗi segment.
4. KHÔNG thêm/bớt segment hay thay đổi text. Chỉ sửa timing.
5. Nếu timing hiện tại đã tốt, giữ nguyên.
6. Kết quả trả về PHẢI có cùng số lượng segments và words.`;

  const refinePrompt = `Đây là kết quả timing sơ bộ. Hãy nghe lại audio và tinh chỉnh timing cho chính xác hơn.

TIMING HIỆN TẠI:
${currentSegments}

Yêu cầu:
- Nghe kỹ từng word trong audio
- Sửa duration nếu word bị lệch
- Giữ nguyên text và thứ tự
- Trả về cùng format JSON`;

  try {
    const result = await ai.models.generateContent({
      model: modelName,
      contents: [
        {
          parts: [
            { inlineData: { data: audioBase64, mimeType } },
            { text: refinePrompt }
          ]
        }
      ],
      config: {
        systemInstruction: refineSystemInstruction,
        responseMimeType: "application/json",
        responseSchema: WORD_LEVEL_SCHEMA,
        temperature: 0.05, // Very low for precision
        maxOutputTokens: getMaxOutputTokens(modelName), // Pro: 128K, Flash: 64K
        thinkingConfig: isThinkingModel ? { thinkingBudget: 2048 } : undefined
      }
    });

    onProgress?.({ currentPass: 2, totalPasses: 2, status: 'Hoàn thành tinh chỉnh!' });
    return result.text || currentSegments;
  } catch (err) {
    console.error("Refinement pass failed, using original:", err);
    return currentSegments;
  }
}


// ===== SUNO OPTIMIZER (unchanged) =====

export interface SunoOptimizationResult {
  styleTags: string;
  lyrics: string;
  vibeDescription: string;
  vietnameseGuide: string;
}

export async function optimizeForSuno(
  lyricsOrPrompt: string,
  preferences: {
    genre?: string;
    tempo?: string;
    vocals?: string;
    mood?: string;
    instruments?: string;
  },
  modelName: string = "gemini-3.5-flash"
): Promise<SunoOptimizationResult> {
  const ai = new GoogleGenAI({ apiKey: getEffectiveApiKey() });

  const systemInstruction = `Bạn là một kỹ sư âm thanh cấp cao chuyên gia sáng tạo âm nhạc trên nền tảng Suno AI.
Nhiệm vụ của bạn là nhận diện, phân tích cấu trúc lời bài hát hoặc ý tưởng bài hát và biên dịch ra:
1. "Style of Music" phù hợp với Suno AI:
   - Viết hoàn toàn bằng TIẾNG ANH để Suno hiểu đúng nhạc cụ, phong cách.
   - Định dạng: các từ khóa ngắn gọn hoặc cụm mô tả phong cách được cách nhau bởi dấu phẩy. Ví dụ: "120bpm, synthwave, retro 80s production style, deep nostalgic analog synths, gated reverb drums, emotional warm female vocals, stereo panning acoustic guitars, cinematic ambient transition, gold studio mastering".
   - GIỚI HẠN: Bạn có ngân sách lên tới 1000 KÝ TỰ (Bản nâng cấp cao cấp hiện tại của Suno AI). Hãy tận dụng ngân sách này để viết một mô tả style cực kỳ chi tiết, phong phú, phối trộn đa dạng thể loại, nhạc cụ chính/phụ, nhịp điệu chi tiết, cách phối âm (mixing & mastering), hiệu ứng giọng ca (vocal effects) và chiều sâu không gian (spatial depth) để bản nhạc đạt chất lượng phòng thu cao nhất.
   - TUYỆT ĐỐI KHÔNG dùng tên ca sĩ hoặc ban nhạc thực tế (ví dụ: Taylor Swift style, Coldplay vibe) vì Suno từ chối tạo nhạc hoặc bỏ qua.
   - Tích hợp chặt chẽ các tùy chọn yêu thích mà người dùng lựa chọn: thể loại (genre), nhịp độ (tempo), kiểu giọng (vocals), tâm trạng (mood), nhạc cụ (instruments).
2. "Cấu trúc lời bài hát" tối ưu hóa cho Suno AI:
   - Phân chia lời bài hát thành các đoạn rập khuôn mà AI Suno cực kỳ nhạy như: [Intro], [Verse 1], [Pre-Chorus], [Chorus], [Verse 2], [Melodic Interlude], [Guitar Solo], [Bridge], [Drop], [Chorus], [Outro]...
   - Tránh dồn đống quá nhiều từ vào một câu hoặc dồn khổ dài khiến AI phát âm hụt hơi. Chèn thông minh các nhãn nhạc cụ để tạo cao trào bùng nổ.
3. Cung cấp một vài mẹo (guide) bằng tiếng Việt siêu ngọc giúp người dùng tạo ra bản nhạc hay nhất.`;

  const preferenceDetails = `
TÙY CHỌN YÊU THÍCH CỦA NGƯỜI DÙNG:
- Thể loại chính (Genre): ${preferences.genre || "Tự nhận diện từ lời hát"}
- Nhịp độ (Tempo/BPM): ${preferences.tempo || "Tự nhận diện"}
- Kiểu giọng hát (Vocals): ${preferences.vocals || "Tự nhận diện"}
- Tâm trạng/Mood: ${preferences.mood || "Tự nhận diện"}
- Nhạc cụ đặc trưng: ${preferences.instruments || "Tự nhận diện"}
`;

  const prompt = `Hãy tối ưu cấu trúc bài hát dưới đây thành định dạng tối ưu nhất cho Suno AI và tạo ra chuỗi Style Tags chuẩn đét.

LỜI BÀI HÁT / Ý TƯỞNG NHẠC GỐC:
${lyricsOrPrompt}

${preferenceDetails}

Yêu cầu trả về định dạng JSON phù hợp cấu trúc sau:
{
  "styleTags": "Chuỗi style tags bằng tiếng Anh phong phú và chi tiết, tối đa 1000 ký tự",
  "lyrics": "Toàn bộ bài hát đã cấu trúc lại có các nhãn [Verse], [Chorus],... ngăn nắp",
  "vibeDescription": "Phân tích nhanh cấu trúc và vibe nhạc bằng tiếng Việt",
  "vietnameseGuide": "Mẹo sử dụng prompt này trên Suno tối ưu nhất"
}`;

  try {
    const response = await ai.models.generateContent({
      model: modelName,
      contents: prompt,
      config: {
        systemInstruction,
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            styleTags: { 
              type: Type.STRING, 
              description: "Strictly comma-separated list of style tags and production descriptors, in English, up to 1000 characters total! NEVER mention real artists names." 
            },
            lyrics: { 
              type: Type.STRING, 
              description: "Structured lyrics with bracket cues like [Intro], [Verse], [Chorus] etc." 
            },
            vibeDescription: { 
              type: Type.STRING, 
              description: "Brief analysis of the vibe in Vietnamese" 
            },
            vietnameseGuide: { 
              type: Type.STRING, 
              description: "A few pro tips on how to generate this successfully" 
            }
          },
          required: ["styleTags", "lyrics", "vibeDescription", "vietnameseGuide"]
        },
        temperature: 0.7
      }
    });

    if (response.text) {
      const data = JSON.parse(response.text.trim());
      if (data.styleTags && data.styleTags.length > 1000) {
        data.styleTags = data.styleTags.substring(0, 997) + "...";
      }
      return data;
    }
    throw new Error("Không nhận được dữ liệu từ Gemini");
  } catch (err) {
    console.error("Error in optimizeForSuno:", err);
    const defaultStyle = [
      preferences.tempo || "110bpm",
      preferences.genre || "modern pop",
      preferences.instruments || "piano, acoustic guitar",
      preferences.vocals || "melodic female vocals",
      preferences.mood || "emotional"
    ].join(", ").substring(0, 1000);

    return {
      styleTags: defaultStyle,
      lyrics: `[Intro]\n\n[Verse 1]\n${lyricsOrPrompt}\n\n[Chorus]\n(Hãy chèn thêm đoạn điệp khúc tại đây)\n\n[Outro]`,
      vibeDescription: "Không thể phân tích bằng AI hoặc token hết hạn. Đã tạo cấu trúc mẫu tự động.",
      vietnameseGuide: "Hãy thử kiểm tra lại khóa API của bạn trong tab Cài đặt."
    };
  }
}