/**
 * STT Service - 语音转文字
 *
 * Provider优先级:
 * 1. 阿里云百炼 Paraformer（国内可访问，和TTS用同一个API Key）
 * 2. Groq Whisper API（国外，免费、快速）
 * 3. 返回空字符串（降级到客户端Web Speech API）
 */

import { readFileSync } from 'fs';
import { resolve } from 'path';

function loadEnvKey(key: string): string {
  if (process.env[key]) return process.env[key]!;
  for (const envPath of [resolve(process.cwd(), '../.env'), resolve(process.cwd(), '.env')]) {
    try {
      const content = readFileSync(envPath, 'utf-8');
      const match = content.match(new RegExp(`^${key}=(.+)$`, 'm'));
      if (match) {
        const val = match[1].trim();
        process.env[key] = val;
        return val;
      }
    } catch { /* ignore */ }
  }
  return '';
}

export interface TranscriptionResult {
  text: string;
  confidence: number;
  language: string;
}

export class STTService {
  private dashscopeKey: string;
  private groqApiKey: string;
  private activeProvider: string = 'none';

  constructor() {
    this.dashscopeKey = loadEnvKey('DASHSCOPE_API_KEY');
    this.groqApiKey = loadEnvKey('GROQ_API_KEY');

    if (this.dashscopeKey) {
      this.activeProvider = 'paraformer';
      console.log('🎤 STT Provider: 阿里云Paraformer 已启用（国内可用）');
    } else if (this.groqApiKey) {
      this.activeProvider = 'groq';
      console.log('🎤 STT Provider: Groq Whisper API 已启用');
    } else {
      console.log('⚠️ STT: 未配置API Key，服务端语音转文字不可用（将使用客户端Web Speech API）');
    }
  }

  isAvailable(): boolean {
    return this.activeProvider !== 'none';
  }

  getProvider(): string {
    return this.activeProvider;
  }

  /**
   * 将音频Buffer转换为文字
   * @param audioBuffer - 音频数据（webm/opus/mp3/wav格式）
   * @param language - 语言代码，默认 'zh'
   * @returns 转录的文字，失败返回空字符串
   */
  async transcribe(audioBuffer: Buffer, language: string = 'zh'): Promise<string> {
    // 按优先级尝试
    if (this.dashscopeKey) {
      const result = await this.transcribeWithParaformer(audioBuffer, language);
      if (result) return result;
    }

    if (this.groqApiKey) {
      const result = await this.transcribeWithGroq(audioBuffer, language);
      if (result) return result;
    }

    console.warn('STT: 所有Provider均不可用');
    return '';
  }

  // ========== 阿里云 Paraformer ==========
  private async transcribeWithParaformer(audioBuffer: Buffer, _language: string): Promise<string> {
    try {
      // Paraformer 使用DashScope file transcription API
      // POST https://dashscope.aliyuncs.com/api/v1/services/audio/asr/transcription
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 30000);

      try {
        // 先用multipart上传音频
        const boundary = '----FormBoundary' + Date.now().toString(36);
        const parts: Buffer[] = [];

        // JSON参数部分
        const params = JSON.stringify({
          model: 'paraformer-v2',
          input: {},
          parameters: {
            language_hints: ['zh'],
          },
        });

        parts.push(Buffer.from(
          `--${boundary}\r\n` +
          `Content-Disposition: form-data; name="request"\r\n` +
          `Content-Type: application/json\r\n\r\n` +
          params + '\r\n'
        ));

        // 音频文件部分
        parts.push(Buffer.from(
          `--${boundary}\r\n` +
          `Content-Disposition: form-data; name="file"; filename="audio.webm"\r\n` +
          `Content-Type: audio/webm\r\n\r\n`
        ));
        parts.push(audioBuffer);
        parts.push(Buffer.from('\r\n'));

        parts.push(Buffer.from(`--${boundary}--\r\n`));
        const body = Buffer.concat(parts);

        const response = await fetch(
          'https://dashscope.aliyuncs.com/api/v1/services/audio/asr/transcription',
          {
            method: 'POST',
            signal: controller.signal,
            headers: {
              'Authorization': `Bearer ${this.dashscopeKey}`,
              'Content-Type': `multipart/form-data; boundary=${boundary}`,
              'X-DashScope-Async': 'enable',
            },
            body,
          }
        );

        if (!response.ok) {
          const errText = await response.text().catch(() => '');
          throw new Error(`Paraformer API ${response.status}: ${errText.substring(0, 200)}`);
        }

        const data = await response.json() as any;

        // 异步模式：需要轮询结果
        if (data.output?.task_id) {
          return await this.pollParaformerResult(data.output.task_id);
        }

        // 同步模式直接返回
        if (data.output?.text) {
          const text = data.output.text.trim();
          if (text) console.log(`🎤 Paraformer转录: "${text.substring(0, 50)}..."`);
          return text;
        }

        return '';
      } finally {
        clearTimeout(timeout);
      }
    } catch (err) {
      console.warn('Paraformer STT失败:', err instanceof Error ? err.message : err);
      return '';
    }
  }

  private async pollParaformerResult(taskId: string, maxRetries: number = 10): Promise<string> {
    for (let i = 0; i < maxRetries; i++) {
      await new Promise(r => setTimeout(r, 1000)); // 每秒轮询

      try {
        const response = await fetch(
          `https://dashscope.aliyuncs.com/api/v1/tasks/${taskId}`,
          {
            headers: { 'Authorization': `Bearer ${this.dashscopeKey}` },
          }
        );

        if (!response.ok) continue;

        const data = await response.json() as any;
        const status = data.output?.task_status;

        if (status === 'SUCCEEDED') {
          // 获取转录结果
          const results = data.output?.results;
          if (results && results.length > 0) {
            const transcriptionUrl = results[0].transcription_url;
            if (transcriptionUrl) {
              const transRes = await fetch(transcriptionUrl);
              const transData = await transRes.json() as any;
              const text = transData?.transcripts?.[0]?.text ||
                           transData?.body?.text || '';
              if (text) console.log(`🎤 Paraformer转录: "${text.substring(0, 50)}..."`);
              return text.trim();
            }
          }
          return '';
        }

        if (status === 'FAILED') {
          console.warn('Paraformer任务失败:', data.output?.message);
          return '';
        }
        // PENDING/RUNNING → 继续轮询
      } catch {
        // 轮询失败继续
      }
    }
    console.warn('Paraformer轮询超时');
    return '';
  }

  // ========== Groq Whisper ==========
  private async transcribeWithGroq(audioBuffer: Buffer, language: string): Promise<string> {
    try {
      const boundary = '----FormBoundary' + Date.now().toString(36);
      const parts: Buffer[] = [];

      parts.push(Buffer.from(
        `--${boundary}\r\n` +
        `Content-Disposition: form-data; name="file"; filename="audio.webm"\r\n` +
        `Content-Type: audio/webm\r\n\r\n`
      ));
      parts.push(audioBuffer);
      parts.push(Buffer.from('\r\n'));

      parts.push(Buffer.from(
        `--${boundary}\r\n` +
        `Content-Disposition: form-data; name="model"\r\n\r\n` +
        `whisper-large-v3\r\n`
      ));

      parts.push(Buffer.from(
        `--${boundary}\r\n` +
        `Content-Disposition: form-data; name="language"\r\n\r\n` +
        `${language}\r\n`
      ));

      parts.push(Buffer.from(
        `--${boundary}\r\n` +
        `Content-Disposition: form-data; name="response_format"\r\n\r\n` +
        `json\r\n`
      ));

      parts.push(Buffer.from(`--${boundary}--\r\n`));
      const body = Buffer.concat(parts);

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 30000);

      try {
        const response = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
          method: 'POST',
          signal: controller.signal,
          headers: {
            'Authorization': `Bearer ${this.groqApiKey}`,
            'Content-Type': `multipart/form-data; boundary=${boundary}`,
          },
          body,
        });

        if (!response.ok) {
          const errText = await response.text().catch(() => '');
          throw new Error(`Groq Whisper ${response.status}: ${errText.substring(0, 200)}`);
        }

        const data = await response.json() as { text?: string };
        const text = data.text?.trim() || '';
        if (text) console.log(`🎤 Groq STT转录: "${text.substring(0, 50)}..."`);
        return text;
      } finally {
        clearTimeout(timeout);
      }
    } catch (err) {
      console.warn('Groq STT失败:', err instanceof Error ? err.message : err);
      return '';
    }
  }

  /** 验证客户端发送的转录文本 */
  validateTranscription(text: string): boolean {
    if (!text || text.trim().length === 0) return false;
    if (text.length > 5000) return false;
    return true;
  }
}
