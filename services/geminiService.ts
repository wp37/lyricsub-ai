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

    // The genai sdk list() returns an async iterable
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
    
    // Sort: prioritize Flash over Pro (since Flash has a 1,000,000 TPM free tier rate limit vs only 32,000 TPM for Pro, which is required for audio files)
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

export async function processAudioWithGemini(
  audioBase64: string,
  mimeType: string,
  mode: ProcessingMode,
  language: string,
  duration: number,
  modelName: string | GeminiModel = GeminiModel.V3_FLASH,
  referenceLyrics?: string
): Promise<string> {
  const ai = new GoogleGenAI({ apiKey: getEffectiveApiKey() });
  
  const isThinkingModel = modelName.includes('thinking');

  // System Instruction: Cân bằng giữa "Timing" và "Content"
  const systemInstruction = mode === ProcessingMode.LYRICS 
    ? "Bạn là chuyên gia biên tập lời bài hát (Lyrics Editor). Nhiệm vụ: Nghe file audio, nhận diện lời hát chính xác, trình bày chia khổ (verse/chorus) rõ ràng, đúng chính tả. Không thêm lời dẫn."
    : `Bạn là chuyên gia kỹ thuật âm thanh (Audio Timing Engineer) chuyên về Karaoke.
       
       MỤC TIÊU CỐT LÕI: TẠO TRẢI NGHIỆM KARAOKE MƯỢT MÀ.
       
       QUY TẮC VÀNG VỀ THỜI GIAN (TIMING RULES):
       1. **START (Vocal Onset):** Bắt đầu ngay khi ca sĩ nhả chữ đầu tiên. Bỏ qua nhạc dạo.
       2. **END (Vocal Offset - QUAN TRỌNG NHẤT):** Thời gian kết thúc phải là khoảnh khắc CHÍNH XÁC ca sĩ ngắt tiếng của từ cuối cùng. 
          - TUYỆT ĐỐI KHÔNG tính khoảng lặng (silence) hoặc nhạc nền sau câu hát vào 'end'.
          - Nếu 'end' bị trễ, thanh karaoke sẽ chạy chậm hơn nhạc -> Trải nghiệm tồi. Hãy cắt 'end' thật gọn (Tight Timing).
       
       3. **KHÔNG BỎ SÓT:** Phải bắt được mọi từ ngữ, kể cả rap nhanh, hát bè.

       RÀNG BUỘC KỸ THUẬT:
       - Thời gian 'start' < 'end'.
       - 'start' và 'end' phải nằm trong khoảng 0 - ${duration.toFixed(2)}.
       - Ngôn ngữ: ${language}.`;

  // Prompt: Thêm cơ chế "Anchor" để neo thời gian và đảm bảo trích xuất trọn vẹn
  const referencePrompt = referenceLyrics 
    ? `\n\nLỜI GỐC ĐỂ ĐỐI CHIẾU (BẮT BUỘC: Bạn phải căn chỉnh thời gian cho TOÀN BỘ lời gốc dưới đây từ đầu đến cuối bài, không được phép cắt xén, bỏ bớt hay dừng lại nửa chừng):\n${referenceLyrics}` 
    : "";

  const prompt = mode === ProcessingMode.LYRICS
    ? `Trích xuất lời bài hát cho file audio này. Ngôn ngữ: ${language}. Độ dài: ${Math.floor(duration)}s.${referencePrompt}`
    : `Phân tích Audio và tạo JSON phụ đề Karaoke chuẩn từng mili-giây.
       
       LƯU Ý KHI XỬ LÝ:
       1. **Chặt chẽ (Tightness):** Với câu "Tôi yêu em", ngay khi chữ "em" vừa dứt, hãy đóng timestamp 'end' ngay lập tức. Đừng đợi hết khuôn nhạc.
       2. **Mật độ:** Với đoạn Rap/Hát nhanh, hãy chia nhỏ segment (1-3s) để chữ chạy kịp nhạc.
       
       ${referencePrompt}
       
       Output JSON Schema: { "segments": [{ "index": 1, "start": 12.5, "end": 15.2, "text": "Lời bài hát..." }] }`;

  const responseSchema = mode === ProcessingMode.SUBTITLES ? {
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
  } : undefined;

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
      // Temperature 0.2: Ổn định để timing chính xác nhưng vẫn đủ linh hoạt để nghe rõ lời
      temperature: 0.2, 
      maxOutputTokens: 8192,
      thinkingConfig: isThinkingModel ? { thinkingBudget: 1024 } : undefined
    }
  });

  return result.text || "";
}

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
        temperature: 0.7 // Hơi sáng tạo để ra phong thái nhạc sành điệu
      }
    });

    if (response.text) {
      const data = JSON.parse(response.text.trim());
      // Bảo đảm styleTags không dài hơn 1000 ký tự
      if (data.styleTags && data.styleTags.length > 1000) {
        data.styleTags = data.styleTags.substring(0, 997) + "...";
      }
      return data;
    }
    throw new Error("Không nhận được dữ liệu từ Gemini");
  } catch (err) {
    console.error("Error in optimizeForSuno:", err);
    // Fallback thông minh dựa trên preferences
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