// STT 语音识别服务
// 真人玩家使用浏览器的 Web Speech API 进行语音识别（客户端实现）
// 服务端负责接收转录后的文本并转发给AI

export interface TranscriptionResult {
  text: string;
  confidence: number;
  language: string;
}

export class STTService {
  // 服务端STT主要用于处理客户端发送的音频（备选方案）
  // 主要方案是使用浏览器的 Web Speech API (在客户端实现)

  async transcribeFromBuffer(_audioBuffer: Buffer): Promise<TranscriptionResult> {
    // 使用 Whisper API 作为备选方案（需要配置）
    // 这里提供接口，实际调用在配置了 Whisper 服务后启用
    throw new Error('Server-side STT not configured. Use client-side Web Speech API.');
  }

  // 验证客户端发送的转录文本
  validateTranscription(text: string): boolean {
    if (!text || text.trim().length === 0) return false;
    if (text.length > 5000) return false; // 防止过长文本
    return true;
  }
}
