import { writeFile, mkdir, readFile } from 'fs/promises';
import { join, resolve } from 'path';
import { existsSync, readFileSync } from 'fs';

// 在模块加载时立即读取 .env（绕过ESM import顺序问题）
function loadEnvKey(key: string): string {
  if (process.env[key]) return process.env[key]!;
  // 尝试从 ../.env 和 ./.env 读取
  for (const envPath of [resolve(process.cwd(), '../.env'), resolve(process.cwd(), '.env')]) {
    try {
      const content = readFileSync(envPath, 'utf-8');
      const match = content.match(new RegExp(`^${key}=(.+)$`, 'm'));
      if (match) {
        const val = match[1].trim();
        process.env[key] = val; // 同步到 process.env
        return val;
      }
    } catch { /* ignore */ }
  }
  return '';
}

// ========== TTS Provider 接口 ==========

export interface TTSProvider {
  name: string;
  synthesize(text: string, voice: string): Promise<Buffer>;
  isAvailable(): boolean;
}

// ========== 音色配置 ==========

// CosyVoice 音色映射（6个AI玩家 + 主持人）
export const TTS_VOICE_PROFILES: Record<string, { voice: string; label: string }> = {
  'openai/gpt-4.1-nano':          { voice: 'longxiaobai', label: '龙小白（男声，阳光）' },
  'anthropic/claude-sonnet-4.5':   { voice: 'longxiaochun', label: '龙小淳（女声，温柔）' },
  'google/gemini-2.5-flash-lite':  { voice: 'longjielidou', label: '龙杰力豆（男声，浑厚）' },
  'deepseek/deepseek-chat':        { voice: 'longxiaoxia', label: '龙小夏（女声，活泼）' },
  'qwen/qwen3-235b-a22b':          { voice: 'longshu', label: '龙叔（男声，成熟）' },
  'moonshotai/kimi-k2':            { voice: 'longyue', label: '龙悦（女声，知性）' },
};

export const NARRATOR_VOICE_ID = 'longxiang'; // 龙翔（男声，播报风格）

// Edge-TTS 音色映射（降级用）
const EDGE_TTS_PROFILES: Record<string, { voice: string; rate: string; pitch: string }> = {
  'openai/gpt-4.1-nano':          { voice: 'zh-CN-YunxiNeural', rate: '+0%', pitch: '+0Hz' },
  'anthropic/claude-sonnet-4.5':   { voice: 'zh-CN-XiaoyiNeural', rate: '+5%', pitch: '+2Hz' },
  'google/gemini-2.5-flash-lite':  { voice: 'zh-CN-YunjianNeural', rate: '+0%', pitch: '-2Hz' },
  'deepseek/deepseek-chat':        { voice: 'zh-CN-XiaoxiaoNeural', rate: '-5%', pitch: '+0Hz' },
  'qwen/qwen3-235b-a22b':          { voice: 'zh-CN-YunxiaNeural', rate: '+0%', pitch: '+3Hz' },
  'moonshotai/kimi-k2':            { voice: 'zh-CN-XiaochenNeural', rate: '+0%', pitch: '-1Hz' },
};

const EDGE_NARRATOR = { voice: 'zh-CN-YunyangNeural', rate: '-10%', pitch: '-3Hz' };

// 主持人台词
export const NARRATOR_LINES: Record<string, string> = {
  night_start: '天黑请闭眼。',
  guard_turn: '守卫请睁眼，请选择你要守护的人。',
  werewolf_turn: '狼人请睁眼。狼人请选择你们今晚要杀害的目标。',
  witch_turn: '女巫请睁眼。',
  seer_turn: '预言家请睁眼，请选择你要查验的人。',
  dawn: '天亮了，请大家睁眼。',
  last_words: '请留下你的遗言。',
  discussion: '请开始自由讨论。',
  voting: '讨论结束，请大家投票。',
  hunter_shoot: '猎人，你可以选择开枪带走一名玩家。',
  game_over_werewolf: '游戏结束，狼人阵营获得了胜利！',
  game_over_villager: '游戏结束，好人阵营获得了胜利！',
};

// ========== Provider 1: CosyVoice2 (阿里云百炼) ==========

class DashScopeTTS implements TTSProvider {
  name = 'CosyVoice';
  private apiKey: string;
  private wsUrl = 'wss://dashscope.aliyuncs.com/api-ws/v1/inference/';

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  isAvailable(): boolean {
    return !!this.apiKey;
  }

  async synthesize(text: string, voice: string): Promise<Buffer> {
    // CosyVoice TTS 使用 WebSocket 协议
    const { default: WebSocket } = await import('ws');

    return new Promise<Buffer>((resolve, reject) => {
      const ws = new WebSocket(this.wsUrl, {
        headers: { 'Authorization': `Bearer ${this.apiKey}` },
      });

      const taskId = 'tts-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8);
      const audioChunks: Buffer[] = [];
      const timer = setTimeout(() => {
        ws.close();
        reject(new Error('CosyVoice TTS timeout (15s)'));
      }, 15000);

      ws.on('open', () => {
        ws.send(JSON.stringify({
          header: { action: 'run-task', task_id: taskId, streaming: 'out' },
          payload: {
            model: 'cosyvoice-v1',
            task_group: 'audio',
            task: 'tts',
            function: 'SpeechSynthesizer',
            input: { text },
            parameters: { voice: voice || 'longxiaochun', format: 'mp3', sample_rate: 22050 },
          },
        }));
      });

      ws.on('message', (data: Buffer) => {
        try {
          const json = JSON.parse(data.toString());
          if (json.header?.event === 'task-failed') {
            clearTimeout(timer);
            ws.close();
            reject(new Error(`CosyVoice: ${json.header?.error_message || 'task failed'}`));
            return;
          }
          if (json.header?.event === 'task-finished') {
            clearTimeout(timer);
            ws.close();
            const audio = Buffer.concat(audioChunks);
            if (audio.length > 0) {
              resolve(audio);
            } else {
              reject(new Error('CosyVoice: no audio data'));
            }
            return;
          }
          // result-generated 事件 - 忽略JSON控制帧
        } catch {
          // 非JSON = 纯二进制音频数据
          audioChunks.push(Buffer.from(data));
        }
      });

      ws.on('error', (err) => {
        clearTimeout(timer);
        reject(new Error(`CosyVoice WS error: ${err.message}`));
      });

      ws.on('close', () => {
        clearTimeout(timer);
        if (audioChunks.length > 0) {
          resolve(Buffer.concat(audioChunks));
        }
        // 如果已经resolve/reject了，这里的调用会被忽略
      });
    });
  }
}

// ========== Provider 2: ChatTTS 本地 ==========

class ChatTTSLocal implements TTSProvider {
  name = 'ChatTTS';
  private baseUrl: string;

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl;
  }

  isAvailable(): boolean {
    return !!this.baseUrl;
  }

  async synthesize(text: string, _voice: string): Promise<Buffer> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000);

    try {
      const response = await fetch(`${this.baseUrl}/tts`, {
        method: 'POST',
        signal: controller.signal,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text,
          prompt: '',
          voice: 2222, // ChatTTS voice seed
        }),
      });

      if (!response.ok) {
        throw new Error(`ChatTTS ${response.status}`);
      }

      return Buffer.from(await response.arrayBuffer());
    } finally {
      clearTimeout(timeout);
    }
  }
}

// ========== Provider 3: Edge-TTS (降级) ==========

class EdgeTTSProvider implements TTSProvider {
  name = 'edge-tts';

  isAvailable(): boolean {
    return true; // 始终可尝试
  }

  async synthesize(text: string, voice: string): Promise<Buffer> {
    const profile = EDGE_TTS_PROFILES[voice] || EDGE_NARRATOR;
    const { tts } = await import('edge-tts');
    return tts(text, { voice: profile.voice, rate: profile.rate, pitch: profile.pitch });
  }
}

// ========== 主服务 ==========

const AUDIO_DIR = join(process.cwd(), 'audio_cache');

export class TTSService {
  private providers: TTSProvider[] = [];
  private cacheDir = AUDIO_DIR;

  constructor() {
    this.ensureCacheDir();
    this.initProviders();
  }

  private async ensureCacheDir(): Promise<void> {
    if (!existsSync(this.cacheDir)) {
      await mkdir(this.cacheDir, { recursive: true });
    }
  }

  private initProviders(): void {
    const dashscopeKey = loadEnvKey('DASHSCOPE_API_KEY');
    if (dashscopeKey) {
      this.providers.push(new DashScopeTTS(dashscopeKey));
      console.log('🎵 TTS Provider: CosyVoice (阿里云百炼 WebSocket) 已启用');
    }

    const chatTTSUrl = loadEnvKey('CHATTTS_URL');
    if (chatTTSUrl) {
      this.providers.push(new ChatTTSLocal(chatTTSUrl));
      console.log('🎵 TTS Provider: ChatTTS (本地) 已启用');
    }

    // Edge-TTS 作为最终降级
    this.providers.push(new EdgeTTSProvider());
    console.log('🎵 TTS Provider: edge-tts (降级) 已启用');
    console.log(`🎵 TTS Provider 优先级: ${this.providers.map(p => p.name).join(' → ')}`);
  }

  /** 重新初始化（API key更新后调用） */
  reinit(): void {
    this.providers = [];
    this.initProviders();
  }

  /** 合成玩家发言语音 */
  async synthesizePlayerSpeech(text: string, aiModel: string): Promise<Buffer> {
    const cosyVoice = TTS_VOICE_PROFILES[aiModel]?.voice || 'longxiaochun';
    return this.synthesizeWithFallback(text, aiModel, cosyVoice);
  }

  /** 合成主持人语音（带缓存） */
  async synthesizeNarrator(lineKey: string): Promise<Buffer> {
    const text = NARRATOR_LINES[lineKey];
    if (!text) throw new Error(`Unknown narrator line: ${lineKey}`);

    const cacheFile = join(this.cacheDir, `narrator_${lineKey}.mp3`);
    if (existsSync(cacheFile)) {
      return readFile(cacheFile);
    }

    const audio = await this.synthesizeWithFallback(text, '__narrator__', NARRATOR_VOICE_ID);

    // 缓存
    try {
      await writeFile(cacheFile, audio);
    } catch { /* 缓存失败不影响 */ }

    return audio;
  }

  /** 通用合成（含Provider降级） */
  async synthesize(text: string, voiceOrModel?: string): Promise<Buffer> {
    const cosyVoice = voiceOrModel
      ? (TTS_VOICE_PROFILES[voiceOrModel]?.voice || voiceOrModel)
      : NARRATOR_VOICE_ID;
    return this.synthesizeWithFallback(text, voiceOrModel || '__narrator__', cosyVoice);
  }

  private async synthesizeWithFallback(text: string, modelKey: string, cosyVoiceId: string): Promise<Buffer> {
    for (const provider of this.providers) {
      if (!provider.isAvailable()) continue;

      try {
        // CosyVoice用cosyVoiceId，edge-tts用modelKey
        const voiceParam = provider.name === 'edge-tts' ? modelKey : cosyVoiceId;

        const audio = await provider.synthesize(text, voiceParam);
        if (audio && audio.length > 100) {
          return audio;
        }
      } catch (err) {
        console.warn(`TTS [${provider.name}] 失败: ${err instanceof Error ? err.message : err}`);
      }
    }

    throw new Error('所有TTS Provider均失败');
  }

  /** 获取当前活跃的Provider名称 */
  getActiveProvider(): string {
    for (const p of this.providers) {
      if (p.isAvailable()) return p.name;
    }
    return 'none';
  }

  /** 获取音色列表 */
  getVoiceProfiles(): Record<string, { voice: string; label: string }> {
    return TTS_VOICE_PROFILES;
  }
}
