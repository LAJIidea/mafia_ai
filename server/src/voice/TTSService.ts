// TTS 语音合成服务 - 使用 Edge TTS 实现多音色
import { spawn } from 'child_process';
import { writeFile, mkdir } from 'fs/promises';
import { join } from 'path';
import { existsSync } from 'fs';

// AI玩家音色配置 - 每个模型对应不同音色
export const VOICE_PROFILES: Record<string, { voice: string; rate: string; pitch: string; label: string }> = {
  'openai/gpt-4o': {
    voice: 'zh-CN-YunxiNeural',
    rate: '+0%',
    pitch: '+0Hz',
    label: '云希（男声，成熟沉稳）',
  },
  'anthropic/claude-3.5-sonnet': {
    voice: 'zh-CN-XiaoyiNeural',
    rate: '+5%',
    pitch: '+2Hz',
    label: '晓伊（女声，温柔知性）',
  },
  'google/gemini-2.0-flash': {
    voice: 'zh-CN-YunjianNeural',
    rate: '+0%',
    pitch: '-2Hz',
    label: '云健（男声，浑厚有力）',
  },
  'deepseek/deepseek-chat': {
    voice: 'zh-CN-XiaoxiaoNeural',
    rate: '-5%',
    pitch: '+0Hz',
    label: '晓晓（女声，活泼可爱）',
  },
  'qwen/qwen-2.5-72b-instruct': {
    voice: 'zh-CN-YunxiaNeural',
    rate: '+0%',
    pitch: '+3Hz',
    label: '云夏（男声，年轻活力）',
  },
  'moonshot/moonshot-v1-128k': {
    voice: 'zh-CN-XiaochenNeural',
    rate: '+0%',
    pitch: '-1Hz',
    label: '晓辰（女声，沉稳冷静）',
  },
};

// 系统主持人音色
const NARRATOR_VOICE = {
  voice: 'zh-CN-YunyangNeural',
  rate: '-10%',
  pitch: '-3Hz',
};

// 系统主持语音文案
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

const AUDIO_DIR = join(process.cwd(), 'audio_cache');

export class TTSService {
  private cacheDir: string;

  constructor() {
    this.cacheDir = AUDIO_DIR;
    this.ensureCacheDir();
  }

  private async ensureCacheDir(): Promise<void> {
    if (!existsSync(this.cacheDir)) {
      await mkdir(this.cacheDir, { recursive: true });
    }
  }

  async synthesize(text: string, voiceProfile?: string): Promise<Buffer> {
    const profile = voiceProfile && VOICE_PROFILES[voiceProfile]
      ? VOICE_PROFILES[voiceProfile]
      : NARRATOR_VOICE;

    return this.synthesizeWithEdgeTTS(text, profile.voice, profile.rate, profile.pitch);
  }

  async synthesizeNarrator(lineKey: string): Promise<Buffer> {
    const text = NARRATOR_LINES[lineKey];
    if (!text) throw new Error(`Unknown narrator line: ${lineKey}`);

    // 检查缓存
    const cacheFile = join(this.cacheDir, `narrator_${lineKey}.mp3`);
    if (existsSync(cacheFile)) {
      const { readFile } = await import('fs/promises');
      return readFile(cacheFile);
    }

    const audio = await this.synthesizeWithEdgeTTS(
      text,
      NARRATOR_VOICE.voice,
      NARRATOR_VOICE.rate,
      NARRATOR_VOICE.pitch,
    );

    // 缓存主持人音频
    await writeFile(cacheFile, audio);
    return audio;
  }

  async synthesizePlayerSpeech(text: string, aiModel: string): Promise<Buffer> {
    return this.synthesize(text, aiModel);
  }

  private synthesizeWithEdgeTTS(
    text: string,
    voice: string,
    rate: string,
    pitch: string,
  ): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];

      // 使用 edge-tts npm 包
      const edgeTTS = import('edge-tts').then(async (mod) => {
        try {
          const tts = new mod.default();
          const readable = tts.toStream(text, {
            voice,
            rate,
            pitch,
          });

          readable.on('data', (chunk: Buffer) => {
            chunks.push(chunk);
          });

          readable.on('end', () => {
            resolve(Buffer.concat(chunks));
          });

          readable.on('error', (err: Error) => {
            reject(err);
          });
        } catch (err) {
          // Fallback: 返回空音频标记
          reject(new Error(`TTS synthesis failed: ${err}`));
        }
      }).catch(reject);
    });
  }

  getVoiceProfiles(): Record<string, { voice: string; label: string }> {
    const result: Record<string, { voice: string; label: string }> = {};
    for (const [model, profile] of Object.entries(VOICE_PROFILES)) {
      result[model] = { voice: profile.voice, label: profile.label };
    }
    return result;
  }
}
