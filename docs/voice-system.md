# 狼人杀语音系统技术文档

## 一、架构概览

语音系统采用**云端优先 + 自动降级**的架构，在4核4G小服务器上实现低延迟语音交互。

```
真人玩家                         服务器                          AI玩家
┌────────┐                   ┌──────────┐                   ┌────────┐
│ 浏览器  │                   │ Node.js  │                   │ LLM API│
│        │   voice_audio     │          │   OpenRouter      │        │
│ 录音   │ ──socket.io──→   │ 1.广播音频│ ──────────────→  │ 生成文本│
│        │                   │ 2.STT转写│                   │        │
│ 播放   │ ←──socket.io──   │ 3.TTS合成│ ←──────────────  │ 返回    │
│        │   audio_broadcast │          │                   │        │
└────────┘                   └──────────┘                   └────────┘
```

## 二、技术选型与速度分析

### 为什么选云端API而不是本地部署？

| 指标 | 云端API (CosyVoice2) | 本地ChatTTS (4C4G CPU) |
|------|----------------------|------------------------|
| **首包延迟** | **150ms** | 2-5秒 |
| **10字合成** | **<1秒** | 3-8秒 |
| **50字发言** | **1-2秒** | 10-20秒 |
| **内存占用** | **0MB** | 1.5-2GB (仅剩2GB给游戏) |
| **并发能力** | 高（云端集群） | 低（CPU单线程） |
| **音质** | 极高（神经网络） | 高 |
| **稳定性** | 高（SLA保障） | 中（OOM风险） |
| **成本** | 2元/万字符 | 免费（但需要算力） |

**结论：4核4G服务器上，云端API在速度、稳定性、内存效率上全面碾压本地部署。**

- 一局6人游戏约产生3000-5000字发言 → TTS成本约0.6-1元
- 本地ChatTTS会占用1.5-2GB内存，游戏引擎+Node.js仅剩约2GB，容易OOM
- ChatTTS在CPU上合成50字需要10-20秒，游戏体验极差

### TTS Provider 降级链

```
CosyVoice2 (阿里云百炼)    ← 主选，国内可用，150ms首包
    ↓ 失败
ChatTTS (本地HTTP服务)      ← 可选，需额外部署Python服务
    ↓ 失败
edge-tts (微软非官方)       ← 最终降级，可能403
```

### STT Provider 降级链

```
阿里云 Paraformer           ← 主选，和CosyVoice2共用API Key！
    ↓ 失败
Groq Whisper API            ← 备选，国外服务器可能不可达
    ↓ 都失败
客户端 Web Speech API       ← 浏览器本地识别（不经过服务器）
```

**关键优势：TTS和STT共用同一个阿里云百炼 DashScope API Key，只需注册一个账号。**

## 三、服务详情

### 3.1 TTS服务 (`server/src/voice/TTSService.ts`)

#### CosyVoice2 API

- **端点**: `https://dashscope.aliyuncs.com/api/v1/services/aigc/text2audio/synthesis`
- **认证**: `Authorization: Bearer <DASHSCOPE_API_KEY>`
- **模型**: `cosyvoice-v1`（自动使用最新CosyVoice2.0引擎）
- **特性**: 150ms首包延迟、自然语调、情感控制

#### 音色配置（6个AI玩家 + 主持人）

| AI模型 | CosyVoice音色ID | 音色名 | 性别 |
|--------|-----------------|--------|------|
| GPT-4.1 Nano | `longxiaobai` | 龙小白 | 男声，阳光 |
| Claude Sonnet 4.5 | `longxiaochun` | 龙小淳 | 女声，温柔 |
| Gemini 2.5 Flash | `longjielidou` | 龙杰力豆 | 男声，浑厚 |
| DeepSeek V3 | `longxiaoxia` | 龙小夏 | 女声，活泼 |
| Qwen3 235B | `longshu` | 龙叔 | 男声，成熟 |
| Kimi K2 | `longyue` | 龙悦 | 女声，知性 |
| **主持人** | `longxiang` | 龙翔 | 男声，播报风格 |

### 3.2 STT服务 (`server/src/voice/STTService.ts`)

#### 阿里云 Paraformer（主选）

- **端点**: `https://dashscope.aliyuncs.com/api/v1/services/audio/asr/transcription`
- **认证**: 同CosyVoice2，共用 `DASHSCOPE_API_KEY`
- **模型**: `paraformer-v2`
- **特点**: 中文识别准确率极高，异步任务模式

#### Groq Whisper（备选）

- **端点**: `https://api.groq.com/openai/v1/audio/transcriptions`
- **认证**: `GROQ_API_KEY`
- **模型**: `whisper-large-v3`
- **特点**: 免费、极快（4分半音频3秒转录），但国内可能无法访问

## 四、语音交互流程

### 4.1 真人语音发言

```
浏览器                              服务器                         其他玩家
  │                                  │                              │
  │ 1. 点击"语音发言"                  │                              │
  │ 2. MediaRecorder录音              │                              │
  │ 3. Web Speech API实时字幕         │                              │
  │ 4. 点击"结束发言"                  │                              │
  │                                  │                              │
  │──── voice_audio {audio} ────→   │                              │
  │                                  │ 5. 广播音频                    │
  │                                  │──── audio_broadcast ────→    │ 播放
  │                                  │                              │
  │                                  │ 6. STT转录（Paraformer）       │
  │                                  │                              │
  │                                  │ 7. AI agent.addMemory(文字)   │
  │                                  │                              │
  │ ←── chat_message {text} ────    │──── chat_message ────→       │ 显示
  │ 显示                              │                              │
```

### 4.2 AI语音发言

```
服务器                                                        所有玩家
  │                                                              │
  │ 1. AIAgent.generateSpeech() → 调用LLM生成文本                  │
  │                                                              │
  │ 2. TTSService.synthesize(文本) → CosyVoice2合成音频             │
  │                                                              │
  │──── audio_broadcast {audio, playerName} ────→                │ 播放语音
  │──── chat_message {text, aiModel} ────→                       │ 显示文字
  │                                                              │
  │ 3. 其他AI agent.addMemory(文字)                                │
```

## 五、环境变量配置

```bash
# .env 文件

# 阿里云百炼 API Key（TTS + STT 共用）
# 获取: https://bailian.console.aliyun.com/
DASHSCOPE_API_KEY=sk-xxx

# OpenRouter API Key（AI大模型）
OPENROUTER_API_KEY=sk-or-v1-xxx

# Groq API Key（备选STT，国内可能不可用）
# 获取: https://console.groq.com/
GROQ_API_KEY=

# ChatTTS 本地服务地址（可选，需要额外部署）
# CHATTTS_URL=http://localhost:9966
```

**最简配置：只需 `DASHSCOPE_API_KEY` + `OPENROUTER_API_KEY` 两个Key即可运行完整语音系统。**

## 六、修改的文件清单

### 服务端（server/）
| 文件 | 改动 |
|------|------|
| `src/voice/TTSService.ts` | 重写：多Provider架构 (CosyVoice2→ChatTTS→edge-tts) |
| `src/voice/STTService.ts` | 重写：Paraformer + Groq Whisper双Provider |
| `src/socket.ts` | 新增voice_audio事件、AI发言TTS广播、导出ttsService |
| `src/routes/api.ts` | 使用共享ttsService实例 |
| `src/e2e-test.ts` | 更新TTS测试判定逻辑 |

### 客户端（client/）
| 文件 | 改动 |
|------|------|
| `src/hooks/useAudioRecorder.ts` | 新建：MediaRecorder录音hook |
| `src/components/VoiceInput.tsx` | 重构：录音+上传+实时字幕 |
| `src/pages/Game.tsx` | 监听audio_broadcast播放语音 |

### 配置
| 文件 | 改动 |
|------|------|
| `.env` | 新增 DASHSCOPE_API_KEY、GROQ_API_KEY、CHATTTS_URL |

## 七、Socket.io 事件新增

| 事件 | 方向 | 数据 | 说明 |
|------|------|------|------|
| `voice_audio` | 客户端→服务器 | `{audio: ArrayBuffer}` | 真人语音录音上传 |
| `audio_broadcast` | 服务器→客户端 | `{playerId, playerName, audio: Buffer, type}` | 语音广播（真人/AI） |

## 八、费用预估

以6人局（1真人+5AI）为例，一局游戏约3轮：
- AI发言：5人 × 3轮 × 约80字/条 = 约1200字 → CosyVoice2成本 ≈ **0.24元**
- 主持人播报：约15条 × 20字/条 = 约300字 → 成本 ≈ **0.06元**
- STT转录：真人发言3次 × 约30秒 → Paraformer成本 ≈ **0.01元**
- **一局总费用 ≈ 0.3元**

## 九、E2E测试结果（最新）

```
✅ PASS: 19  ❌ FAIL: 0  ⚠️ WARN: 6

游戏流程：全部通过（创建房间→角色分配→夜间→讨论→投票→结束）
语音数据链路：全部通过（aiModel字段传递、音色映射、广播事件）
TTS合成：WARN（需配置DASHSCOPE_API_KEY后验证）
耗时：130.7秒
```
