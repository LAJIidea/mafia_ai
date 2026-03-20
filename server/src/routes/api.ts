import { Express } from 'express';
import { RoomManager } from '../engine/index.js';
import { RoleName, PlayerType, PRESET_CONFIGS, getDefaultConfig } from '../engine/index.js';
import { networkInterfaces } from 'os';
import QRCode from 'qrcode';
import { TTSService, VOICE_PROFILES, NARRATOR_LINES } from '../voice/TTSService.js';

const ttsService = new TTSService();

export function setupRoutes(app: Express, roomManager: RoomManager): void {
  // 获取房间列表
  app.get('/api/rooms', (_req, res) => {
    res.json(roomManager.listRooms());
  });

  // 创建房间
  app.post('/api/rooms', (req, res) => {
    try {
      const { name, totalPlayers, roleConfig } = req.body;
      if (!name || !totalPlayers) {
        res.status(400).json({ error: '请提供房间名称和玩家人数' });
        return;
      }

      const room = roomManager.createRoom(name, totalPlayers, roleConfig);
      res.json({
        roomId: room.id,
        name: room.name,
        config: room.engine.getState().config,
      });
    } catch (err) {
      res.status(400).json({ error: (err as Error).message });
    }
  });

  // 获取房间详情
  app.get('/api/rooms/:roomId', (req, res) => {
    const room = roomManager.getRoom(req.params.roomId);
    if (!room) {
      res.status(404).json({ error: '房间不存在' });
      return;
    }
    res.json(room.engine.getState());
  });

  // 获取预设配置
  app.get('/api/presets', (_req, res) => {
    res.json(PRESET_CONFIGS);
  });

  // 获取指定人数默认配置
  app.get('/api/presets/:count', (req, res) => {
    const count = parseInt(req.params.count, 10);
    if (count < 6 || count > 16) {
      res.status(400).json({ error: '人数范围：6-16' });
      return;
    }
    res.json(getDefaultConfig(count));
  });

  // 获取局域网二维码
  app.get('/api/qrcode', async (_req, res) => {
    try {
      const addresses = getLocalAddresses();
      const port = process.env.PORT || '3000';
      const url = addresses.length > 0
        ? `http://${addresses[0]}:${port}`
        : `http://localhost:${port}`;

      const qrDataUrl = await QRCode.toDataURL(url, {
        width: 256,
        margin: 2,
        color: { dark: '#0f0e17', light: '#ffffff' },
      });

      res.json({ url, qrCode: qrDataUrl, addresses });
    } catch (err) {
      res.status(500).json({ error: '二维码生成失败' });
    }
  });

  // AI配置相关
  app.post('/api/ai/config', (req, res) => {
    const { apiToken, models } = req.body;
    if (!apiToken) {
      res.status(400).json({ error: '请提供API Token' });
      return;
    }
    // 存储配置到内存
    (app as any).__aiConfig = { apiToken, models };
    res.json({ success: true, message: 'AI配置已保存' });
  });

  app.get('/api/ai/config', (_req, res) => {
    const config = (app as any).__aiConfig || null;
    res.json({
      configured: !!config,
      models: config?.models || [],
    });
  });

  // 支持的AI模型列表
  app.get('/api/ai/models', (_req, res) => {
    res.json([
      { id: 'openai/gpt-4o', name: 'GPT-4o', provider: 'OpenAI' },
      { id: 'anthropic/claude-3.5-sonnet', name: 'Claude 3.5 Sonnet', provider: 'Anthropic' },
      { id: 'google/gemini-2.0-flash', name: 'Gemini 2.0 Flash', provider: 'Google' },
      { id: 'deepseek/deepseek-chat', name: 'Deepseek Chat', provider: 'DeepSeek' },
      { id: 'qwen/qwen-2.5-72b-instruct', name: 'Qwen 2.5', provider: 'Alibaba' },
      { id: 'moonshot/moonshot-v1-128k', name: 'Kimi', provider: 'Moonshot' },
    ]);
  });

  // TTS 语音合成 - 主持人语音
  app.get('/api/tts/narrator/:lineKey', async (req, res) => {
    try {
      const { lineKey } = req.params;
      if (!NARRATOR_LINES[lineKey]) {
        res.status(400).json({ error: '无效的语音行' });
        return;
      }
      const audio = await ttsService.synthesizeNarrator(lineKey);
      res.set('Content-Type', 'audio/mpeg');
      res.set('Cache-Control', 'public, max-age=86400');
      res.send(audio);
    } catch (err) {
      res.status(500).json({ error: 'TTS合成失败: ' + (err as Error).message });
    }
  });

  // TTS 语音合成 - AI玩家发言
  app.post('/api/tts/speak', async (req, res) => {
    try {
      const { text, aiModel } = req.body;
      if (!text) {
        res.status(400).json({ error: '请提供文本' });
        return;
      }
      const audio = await ttsService.synthesizePlayerSpeech(text, aiModel || '');
      res.set('Content-Type', 'audio/mpeg');
      res.send(audio);
    } catch (err) {
      res.status(500).json({ error: 'TTS合成失败: ' + (err as Error).message });
    }
  });

  // 获取音色列表
  app.get('/api/tts/voices', (_req, res) => {
    res.json(ttsService.getVoiceProfiles());
  });
}

function getLocalAddresses(): string[] {
  const interfaces = networkInterfaces();
  const addresses: string[] = [];
  for (const iface of Object.values(interfaces)) {
    if (!iface) continue;
    for (const alias of iface) {
      if (alias.family === 'IPv4' && !alias.internal) {
        addresses.push(alias.address);
      }
    }
  }
  return addresses;
}
