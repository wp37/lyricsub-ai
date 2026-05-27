# 🧠 LYRICSUB AI — ANTIGRAVITY BRAINCORE & MEMORY

> [!NOTE]
> File này đóng vai trò là **"Permanent Memory" (Bộ nhớ vĩnh viễn)** của dự án LyricSub AI cho AI Agent Antigravity. Khi chuyển đổi giữa các model (Flash, Pro, Claude, GPT, v.v.), Agent sẽ đọc file này đầu tiên để nắm toàn bộ cấu trúc dự án và tiếp tục lập trình mà không cần đọc lại toàn bộ code.

---

## 📅 THÔNG TIN TRẠNG THÁI HIỆN TẠI (LATEST STATE)
*   **Dự án:** LyricSub AI (Trích xuất lời bài hát bằng AI, biên tập subtitle và xuất video overlay karaoke/script).
*   **Trạng thái:** Đã hoàn thành các tính năng cốt lõi và các nâng cấp nâng cao của các chế độ **Script** và **News Ticker**.
*   **Mô hình xuất video tối ưu (CapCut Workflow - Option B):**
    *   Hỗ trợ xuất video overlay chữ dạng nền đen (`#0b0a09`), phông xanh (`#00ff00`) hoặc **trong suốt hoàn toàn (Transparent - WebM VP9/VP8)**.
    *   Hòa trộn cực sạch vào CapCut, Premiere, DaVinci Resolve mà không tốn token Gemini.

---

## 🛠️ CẤU TRÚC PHẦN CỨNG & THƯ MỤC CỐT LÕI
Dự án được xây dựng trên nền tảng **React + TypeScript + Vite + Canvas API (Client-side)**.

```
📁 karaoke/
├── 📄 App.tsx                # 👑 ENGINE TRỌNG TÂM (~215KB) - Toàn bộ UI, logic vẽ Canvas, Export video.
├── 📄 types.ts                # Định nghĩa toàn bộ Enum & Interface (DisplayMode, VisualizerStyle...).
├── 📄 index.css               # Hệ thống Style toàn cục (chứa .transparency-checkered cho Canvas).
├── 📁 services/
│   └── 📄 geminiService.ts    # Kết nối Gemini API, trích xuất lời & timing, tự động sửa JSON lỗi.
├── 📁 utils/
│   ├── 📄 converters.ts       # Chuyển đổi định dạng SRT, ASS, LRC...
│   └── 📄 timingPostProcessor.ts # Chuẩn hóa timing từ AI.
└── 📄 package.json            # Các thư viện phụ thuộc (Vite, Tailwind, Lucide React...).
```

---

## 👑 KHẢO SÁT CHI TIẾT FILE `App.tsx` (BẢN ĐỒ CODE)
Vì `App.tsx` rất lớn, các Model mới cần đặc biệt lưu ý các khu vực quan trọng sau để tránh sửa nhầm hoặc fuzzy-match lỗi:

### 1. Hàm vẽ `draw` chính (Canvas Loop) — [Dòng 925+]
Chịu trách nhiệm render visualizer, background và văn bản theo thời gian phát thực tế (`currentTime`).
*   **Background [Dòng 943+]:** Tự động xử lý màu nền, ảnh nền slide, video cover. Đặc biệt hỗ trợ `bgColor === 'transparent'` -> gọi `ctx.clearRect()` thay vì `ctx.fillRect()` để giữ kênh alpha.
*   **Visualizer [Dòng 982+]:** Vẽ sóng nhạc chuyển động theo tần số âm thanh.

### 2. Các chế độ hiển thị nâng cao (Display Modes)
*   **SCRIPT Mode [Dòng 1290+]:** Hiển thị kịch bản chiếm 2/3 màn hình (cho bản tin/dạy học).
    *   *Độ trong suốt:* Tự động phát hiện `bgColor === 'transparent'` để vẽ panel nền gradient mờ và đường kẻ chia màn hình siêu mỏng, nhẹ nhàng (`rgba(255,255,255,0.08)`).
    *   *Highlight:* Tô màu chữ theo từng từ trùng khớp thời gian hát của ca sĩ.
*   **NEWS TICKER Mode [Dòng 1454+]:** Cuộn dọc văn bản mượt mà, tốc độ điều chỉnh theo tiến trình audio.
    *   *Độ trong suốt:* Panel gradient cuộn dọc tự động trong suốt khi chọn nền Transparent.
*   **SPLIT SCREEN / SPLIT LEFT / SPLIT RIGHT [Dòng 1563+]:** Chia màn hình karaoke chuyên nghiệp. Tự động chuyển gradient nền mờ khi nền trong suốt.
*   **KARAOKE / MARQUEE / TELEPROMPTER [Dòng 1680+]:** Các chế độ chạy chữ karaoke truyền thống.

### 3. Engine Tự Động Co Giãn Chữ (Auto-wrap & Auto-scale)
Để tránh tràn chữ khỏi Canvas khi câu quá dài (vấn đề kích thước chữ):
*   `wrapText(ctx, text, maxWidth)`: Tự động xuống dòng khi chữ vượt quá 85% Canvas width.
*   `autoScaleFont(ctx, text, maxWidth, baseSize, fontFamily, weight)`: Tự động giảm kích thước font (tối thiểu 50%) cho đến khi vừa khớp màn hình.

### 4. Logic Export Offline (Offline Video Export) — [Dòng 2162+]
*   Sử dụng `canvas.captureStream(0)` phối hợp với `MediaRecorder` và Worker chạy ẩn chống treo trình duyệt.
*   **Trong suốt hoàn toàn:** Nếu `bgColor === 'transparent'`, ép hệ thống ưu tiên lưu WebM (`video/webm;codecs=vp9`) hỗ trợ kênh Alpha để kéo thẳng vào CapCut mà không cần lọc phông.

---

## 🤖 THIẾT LẬP GEMINI MODEL & TOKEN LIMIT
*   Dự án hỗ trợ chuyển đổi giữa **Gemini Flash** và **Gemini Pro**.
*   **geminiService.ts** tự động kiểm tra loại model được chọn:
    *   **Pro models (gemini-3-pro-preview):** Tự động tăng `maxOutputTokens` lên **131.072 tokens (128K)** để xuất lời cực dài không lo bị đứt quãng.
    *   **Flash models (gemini-3-flash-preview):** Giữ giới hạn **65.536 tokens**.
*   Công cụ sửa lỗi JSON (`repairTruncatedJSON`) hoạt động cực kỳ ổn định ở đầu ra.

---

## 💡 HƯỚNG DẪN DÀNH CHO DEVELOPER MỚI (HOW TO WORK)
1.  **Chạy local test:**
    ```bash
    npm run dev
    ```
2.  **Kiểm tra Build trước khi push:**
    ```bash
    npm run build
    ```
3.  **Lưu ý khi chỉnh sửa code `App.tsx`:**
    *   Luôn sử dụng ngữ cảnh đầy đủ khi thực hiện `replace_file_content` hoặc `multi_replace_file_content`.
    *   Nhiều block vẽ (như SCRIPT gradient và SPLIT_SCREEN gradient) có các lệnh `createLinearGradient` tương tự nhau. Sử dụng các keyword độc nhất như `DisplayMode.SCRIPT`, `DisplayMode.NEWS_TICKER` để định vị chính xác vùng code.

---
*Dự án đã được tối ưu hóa tối đa về hiệu năng render 60FPS trên canvas và tiết kiệm chi phí token API Gemini!*
