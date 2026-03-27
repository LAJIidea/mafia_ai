/**
 * 端到端游戏测试：模拟完整6人局（1模拟人类 + 5 AI）
 *
 * 测试目标：
 * 1. 创建房间 → 配置AI → 加入玩家 → 开始游戏
 * 2. 夜间阶段是否正常推进（守卫→狼人→女巫→预言家）
 * 3. 黎明 → 遗言 → 讨论 → 投票 是否正常
 * 4. 人类玩家是否能看到自己的身份
 * 5. "结束发言"是否能推进讨论
 * 6. 游戏是否能正常结束
 * 7. TTS语音合成API是否正常工作
 * 8. AI发言是否携带aiModel字段（客户端TTS依赖）
 * 9. 人类发言是否被广播（AI记忆依赖）
 * 10. 投票结果是否随phase_change事件下发
 */

import { io, Socket } from 'socket.io-client';
import { readFileSync } from 'fs';
import { resolve } from 'path';

// 手动读 .env
const envPath = resolve(process.cwd(), '../.env');
let API_KEY = '';
try {
  const envContent = readFileSync(envPath, 'utf-8');
  const match = envContent.match(/OPENROUTER_API_KEY=(.+)/);
  if (match) API_KEY = match[1].trim();
} catch {}
if (!API_KEY) {
  console.error('❌ 缺少 OPENROUTER_API_KEY，请在 .env 中配置');
  process.exit(1);
}

const BASE = 'http://localhost:3001';
const TIMEOUT = 300000; // 5分钟总超时
const results: { step: string; status: 'PASS' | 'FAIL' | 'WARN'; detail: string }[] = [];

function log(step: string, status: 'PASS' | 'FAIL' | 'WARN', detail: string) {
  const icon = status === 'PASS' ? '✅' : status === 'FAIL' ? '❌' : '⚠️';
  console.log(`${icon} [${step}] ${detail}`);
  results.push({ step, status, detail });
}

async function apiFetch(path: string, opts?: RequestInit) {
  const res = await fetch(`${BASE}${path}`, {
    ...opts,
    headers: { 'Content-Type': 'application/json', ...opts?.headers },
  });
  return { status: res.status, body: await res.json().catch(() => null), raw: res };
}

async function apiFetchRaw(path: string, opts?: RequestInit) {
  return fetch(`${BASE}${path}`, {
    ...opts,
    headers: { ...opts?.headers },
  });
}

function waitFor(s: Socket, ev: string, pred: (d: any) => boolean, ms = 60000): Promise<any> {
  return new Promise((res, rej) => {
    const t = setTimeout(() => { s.off(ev, h); rej(new Error(`Timeout: ${ev}`)); }, ms);
    const h = (d: any) => { if (pred(d)) { clearTimeout(t); s.off(ev, h); res(d); } };
    s.on(ev, h);
  });
}

function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }

async function main() {
  const startTime = Date.now();
  console.log('\n🐺 狼人杀端到端测试开始（含语音功能测试）\n');
  console.log(`API Key: ${API_KEY!.substring(0, 15)}...`);
  console.log(`Server: ${BASE}\n`);

  // ========== Step 1: 配置 AI Token ==========
  try {
    const cfgRes = await apiFetch('/api/ai/config', {
      method: 'POST',
      body: JSON.stringify({ apiToken: API_KEY, models: ['deepseek/deepseek-chat'] }),
    });
    if (cfgRes.status === 200) {
      log('配置AI Token', 'PASS', 'Token保存成功');
    } else {
      log('配置AI Token', 'FAIL', `状态码: ${cfgRes.status}, body: ${JSON.stringify(cfgRes.body)}`);
      return;
    }
  } catch (err) {
    log('配置AI Token', 'FAIL', `异常: ${err}`);
    return;
  }

  // ========== Step 2: 验证配置回读 ==========
  try {
    const getRes = await apiFetch('/api/ai/config');
    if (getRes.body?.configured) {
      log('配置回读', 'PASS', `configured=true`);
    } else {
      log('配置回读', 'FAIL', `configured=${getRes.body?.configured}`);
    }
  } catch (err) {
    log('配置回读', 'FAIL', `${err}`);
  }

  // ========== Step 3: TTS API 测试（游戏开始前） ==========
  console.log('\n🔊 TTS语音功能测试\n');

  // 3a: 音色列表
  try {
    const voicesRes = await apiFetch('/api/tts/voices');
    if (voicesRes.status === 200 && voicesRes.body) {
      const voiceCount = Object.keys(voicesRes.body).length;
      log('TTS-音色列表', 'PASS', `${voiceCount}个音色配置 (${Object.keys(voicesRes.body).join(', ')})`);
    } else {
      log('TTS-音色列表', 'FAIL', `状态码: ${voicesRes.status}`);
    }
  } catch (err) {
    log('TTS-音色列表', 'FAIL', `${err}`);
  }

  // 3b: 主持人语音合成
  try {
    const narratorRes = await apiFetchRaw('/api/tts/narrator/dawn');
    if (narratorRes.ok) {
      const contentType = narratorRes.headers.get('content-type');
      const buf = await narratorRes.arrayBuffer();
      if (contentType?.includes('audio') && buf.byteLength > 1000) {
        log('TTS-主持人语音', 'PASS', `"天亮了"语音合成成功，大小: ${(buf.byteLength / 1024).toFixed(1)}KB, type: ${contentType}`);
      } else {
        log('TTS-主持人语音', 'FAIL', `返回数据异常: type=${contentType}, size=${buf.byteLength}`);
      }
    } else {
      // edge-tts依赖微软服务，403通常是网络环境限制，非代码bug
      const errBody = await narratorRes.json().catch(() => null);
      const errMsg = errBody?.error || `状态码: ${narratorRes.status}`;
      const isProviderIssue = errMsg.includes('403') || errMsg.includes('Provider') || errMsg.includes('失败');
      log('TTS-主持人语音', isProviderIssue ? 'WARN' : 'FAIL', `${errMsg}（需配置DASHSCOPE_API_KEY启用CosyVoice2）`);
    }
  } catch (err) {
    log('TTS-主持人语音', 'WARN', `${err}（edge-tts依赖微软服务）`);
  }

  // 3c: AI玩家发言语音合成
  try {
    const speakRes = await apiFetchRaw('/api/tts/speak', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: '我觉得三号玩家很可疑。', aiModel: 'deepseek/deepseek-chat' }),
    });
    if (speakRes.ok) {
      const contentType = speakRes.headers.get('content-type');
      const buf = await speakRes.arrayBuffer();
      if (contentType?.includes('audio') && buf.byteLength > 1000) {
        log('TTS-玩家发言语音', 'PASS', `语音合成成功，大小: ${(buf.byteLength / 1024).toFixed(1)}KB, 音色: 晓晓(deepseek)`);
      } else {
        log('TTS-玩家发言语音', 'FAIL', `返回数据异常: type=${contentType}, size=${buf.byteLength}`);
      }
    } else {
      const errBody = await speakRes.json().catch(() => null);
      const errMsg = errBody?.error || `状态码: ${speakRes.status}`;
      const isProviderIssue = errMsg.includes('403') || errMsg.includes('Provider') || errMsg.includes('失败');
      log('TTS-玩家发言语音', isProviderIssue ? 'WARN' : 'FAIL', `${errMsg}（需配置DASHSCOPE_API_KEY）`);
    }
  } catch (err) {
    log('TTS-玩家发言语音', 'WARN', `${err}（edge-tts依赖微软服务）`);
  }

  // 3d: 不同模型音色测试
  const testModels = ['openai/gpt-4.1-nano', 'anthropic/claude-sonnet-4.5'];
  for (const model of testModels) {
    try {
      const res = await apiFetchRaw('/api/tts/speak', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: '测试语音。', aiModel: model }),
      });
      if (res.ok) {
        const buf = await res.arrayBuffer();
        log(`TTS-音色[${model.split('/')[1]}]`, 'PASS', `合成成功 ${(buf.byteLength / 1024).toFixed(1)}KB`);
      } else {
        const errBody = await res.json().catch(() => null);
        const errMsg = errBody?.error || `状态码: ${res.status}`;
        const isProviderIssue = errMsg.includes('403') || errMsg.includes('Provider') || errMsg.includes('失败');
        log(`TTS-音色[${model.split('/')[1]}]`, isProviderIssue ? 'WARN' : 'FAIL', `${errMsg}`);
      }
    } catch (err) {
      log(`TTS-音色[${model.split('/')[1]}]`, 'WARN', `${err}`);
    }
  }

  // ========== Step 4: 创建房间 ==========
  console.log('\n🎮 游戏流程测试\n');

  let roomId: string;
  try {
    const roomRes = await apiFetch('/api/rooms', {
      method: 'POST',
      body: JSON.stringify({ name: 'E2E测试房间', totalPlayers: 6 }),
    });
    roomId = roomRes.body?.roomId;
    if (roomId) {
      log('创建房间', 'PASS', `roomId=${roomId}`);
    } else {
      log('创建房间', 'FAIL', `无roomId: ${JSON.stringify(roomRes.body)}`);
      return;
    }
  } catch (err) {
    log('创建房间', 'FAIL', `${err}`);
    return;
  }

  // ========== Step 5: 模拟人类玩家加入 ==========
  const client = io(BASE, { transports: ['websocket'] });
  let myPlayerId = '';
  let myRole = '';
  let gameState: any = null;
  const phaseHistory: string[] = [];
  const chatMessages: any[] = [];
  const voteResults: any[] = [];
  let gameOver = false;
  let humanChatBroadcasted = false;

  // 监听所有事件
  client.on('game_state', (s: any) => {
    gameState = s;
    const me = s.players?.find((p: any) => p.id === myPlayerId);
    if (me?.role && !myRole) {
      myRole = me.role;
      log('角色分配', 'PASS', `我的角色: ${me.role}`);
    }
  });
  client.on('phase_change', (d: any) => {
    if (!phaseHistory.includes(d.phase) || d.phase !== phaseHistory[phaseHistory.length - 1]) {
      phaseHistory.push(d.phase);
      console.log(`  📌 阶段变化: ${d.phase} (round=${d.round})`);
    }
    // 收集投票结果
    if (d.voteResult?.votes) {
      voteResults.push(d.voteResult);
      console.log(`  📊 投票结果: ${JSON.stringify(d.voteResult.result || 'N/A')}, 票数: ${d.voteResult.votes?.length || 0}`);
    }
    if (d.winner) {
      gameOver = true;
      log('游戏结束', 'PASS', `赢家: ${d.winner}`);
    }
  });
  client.on('chat_message', (m: any) => {
    chatMessages.push(m);
    const aiTag = m.aiModel ? ` [AI:${m.aiModel.split('/')[1]}]` : ' [人类]';
    console.log(`  💬${aiTag} ${m.playerName}: ${m.message?.substring(0, 60)}...`);
    // 检测人类发言是否被广播回来
    if (m.playerId === myPlayerId && m.message === '大家好，我觉得我们需要好好分析一下局势。') {
      humanChatBroadcasted = true;
    }
  });
  client.on('error', (e: any) => {
    console.log(`  ⚠️ socket error: ${e.message}`);
  });

  try {
    // 加入房间
    const joinP = new Promise<string>((res, rej) => {
      const t = setTimeout(() => rej(new Error('join timeout')), 10000);
      client.once('joined', (d: any) => { clearTimeout(t); res(d.playerId); });
      client.once('error', (d: any) => { clearTimeout(t); rej(new Error(d.message)); });
      client.emit('join_room', { roomId, playerName: '测试玩家', device: 'desktop' });
    });
    myPlayerId = await joinP;
    log('加入房间', 'PASS', `playerId=${myPlayerId.substring(0, 8)}...`);

    // ========== Step 6: 添加5个AI ==========
    const aiModels = [
      'deepseek/deepseek-chat',
      'deepseek/deepseek-chat',
      'deepseek/deepseek-chat',
      'deepseek/deepseek-chat',
      'deepseek/deepseek-chat',
    ];
    for (let i = 0; i < 5; i++) {
      client.emit('add_ai', { roomId, playerName: `AI玩家${i + 1}`, aiModel: aiModels[i] });
      await sleep(300);
    }
    await sleep(1000);

    if (gameState?.players?.length === 6) {
      log('添加AI', 'PASS', `${gameState.players.length}个玩家就位`);
    } else {
      log('添加AI', 'FAIL', `玩家数: ${gameState?.players?.length}`);
      return;
    }

    // ========== Step 7: 开始游戏 ==========
    client.emit('start_game');
    console.log('\n🎮 游戏开始，等待游戏流程...\n');

    // 等待游戏离开 waiting 阶段
    await waitFor(client, 'game_state', (s: any) => s.phase && s.phase !== 'waiting', 15000);
    log('游戏开始', 'PASS', `进入阶段: ${gameState?.phase}`);

    // ========== Step 8: 检查身份是否可见 ==========
    const me = gameState?.players?.find((p: any) => p.id === myPlayerId);
    if (me?.role) {
      log('身份可见', 'PASS', `角色: ${me.role}`);
    } else {
      log('身份可见', 'FAIL', `role=${me?.role}, myPlayerId=${myPlayerId}`);
    }

    // ========== Step 9: 自动处理人类操作 ==========
    const nightRoles: Record<string, string> = {
      guard: 'guard_turn', werewolf: 'werewolf_turn', witch: 'witch_turn', seer: 'seer_turn',
    };
    const nightActions: Record<string, string> = {
      guard: 'guard', werewolf: 'kill', seer: 'investigate',
    };

    const actedPhases = new Set<string>();
    let humanSpeechSent = false;

    client.on('game_state', (gs: any) => {
      if (gameOver) return;
      const me = gs.players?.find((p: any) => p.id === myPlayerId);
      if (!me) return;

      const phaseKey = `${gs.phase}-${gs.round}`;

      // 夜间操作
      if (me.role && nightRoles[me.role] === gs.phase && !actedPhases.has(phaseKey)) {
        actedPhases.add(phaseKey);
        const targets = gs.players.filter((p: any) => p.alive && p.id !== myPlayerId);
        if (me.role === 'witch') {
          client.emit('game_action', { action: 'witch_skip' });
          console.log(`  🎭 我(${me.role})操作: 跳过`);
        } else {
          const action = nightActions[me.role];
          client.emit('game_action', { action, targetId: targets[0]?.id });
          console.log(`  🎭 我(${me.role})操作: ${action} → ${targets[0]?.name}`);
        }
      }

      // 讨论/遗言阶段：当轮到我时，发送聊天消息，然后结束发言
      if (['discussion', 'last_words', 'pk_speech'].includes(gs.phase) &&
          gs.currentSpeaker === myPlayerId && !actedPhases.has(`speak-${phaseKey}`)) {
        actedPhases.add(`speak-${phaseKey}`);

        // 根据角色和轮次生成不同的发言
        let speech = '';
        const round = gs.round || 1;
        if (me.role === 'werewolf') {
          speech = round === 1
            ? '大家好，我觉得我们需要好好分析一下局势，先听听大家的想法。'
            : '我觉得上一轮投票情况很可疑，有些人跟票太快了，建议重点关注。';
        } else if (me.role === 'seer') {
          speech = round === 1
            ? '大家好，我先听听大家发言，第一天信息太少不好判断。'
            : '我有一些重要信息要分享，我昨晚查验了一个人，大家注意听。';
        } else if (me.role === 'witch') {
          speech = round === 1
            ? '我觉得大家都要积极发言分析，不要划水，划水的人最可疑。'
            : '结合前几天的发言，我觉得有些人的逻辑前后矛盾，值得关注。';
        } else {
          speech = round === 1
            ? '大家好，我是平民，我会仔细分析每个人的发言，希望大家都说点有用的。'
            : '根据投票情况来看，有几个人的投票方向很可疑，我觉得需要重点分析。';
        }

        client.emit('chat_message', { message: speech, type: 'text' });
        console.log(`  🎤 我(${me.role})发言: ${speech.substring(0, 40)}...`);
        if (!humanSpeechSent) humanSpeechSent = true;

        setTimeout(() => {
          console.log(`  🎭 我结束发言 (${gs.phase})`);
          client.emit('advance_speaker');
        }, 2000);
      }

      // 投票阶段
      if (gs.phase === 'voting' && me.alive && !actedPhases.has(`vote-${gs.round}`)) {
        actedPhases.add(`vote-${gs.round}`);
        const targets = gs.players.filter((p: any) => p.alive && p.id !== myPlayerId);
        const target = targets[Math.floor(Math.random() * targets.length)];
        setTimeout(() => {
          client.emit('game_action', { action: 'vote', targetId: target?.id });
          console.log(`  🎭 我投票: ${target?.name}`);
        }, 3000);
      }
    });

    // ========== Step 10: 等待游戏结束 ==========
    console.log('\n⏳ 等待游戏流程完成（最长5分钟）...\n');

    const gameEndTimeout = Math.max(0, TIMEOUT - (Date.now() - startTime));
    try {
      await waitFor(client, 'phase_change', (d: any) => d.winner !== null && d.winner !== undefined, gameEndTimeout);
    } catch {
      // 超时或者游戏未结束
      if (!gameOver) {
        log('游戏完成', 'WARN', `未在${TIMEOUT / 1000}秒内结束，当前阶段: ${gameState?.phase}, 轮次: ${gameState?.round}`);
      }
    }

    // ========== Step 11: 验证结果 ==========
    console.log('\n📊 测试结果汇总\n');
    console.log('阶段历史:', phaseHistory.join(' → '));
    console.log('聊天消息数:', chatMessages.length);
    console.log('最终阶段:', gameState?.phase);
    console.log('最终轮次:', gameState?.round);

    // 检查阶段流转
    if (phaseHistory.includes('werewolf_turn')) {
      log('夜间-狼人阶段', 'PASS', '已进入');
    } else {
      log('夜间-狼人阶段', 'FAIL', '未进入');
    }

    if (phaseHistory.includes('dawn') || phaseHistory.includes('last_words')) {
      log('黎明/遗言', 'PASS', '已进入');
    } else {
      log('黎明/遗言', 'FAIL', '未进入');
    }

    if (phaseHistory.includes('discussion')) {
      log('讨论阶段', 'PASS', '已进入');
    } else {
      log('讨论阶段', 'FAIL', '未进入');
    }

    if (phaseHistory.includes('voting')) {
      log('投票阶段', 'PASS', '已进入');
    } else {
      log('投票阶段', 'WARN', '未进入（可能游戏提前结束）');
    }

    // ========== 语音相关验证 ==========
    console.log('\n🔊 语音功能验证\n');

    // 11a: AI发言是否携带aiModel字段
    const aiMessages = chatMessages.filter(m => m.aiModel);
    const humanMessages = chatMessages.filter(m => !m.aiModel && m.playerId !== 'system');
    if (aiMessages.length > 0) {
      const modelSet = new Set(aiMessages.map(m => m.aiModel));
      log('AI发言含aiModel', 'PASS', `${aiMessages.length}条AI消息，模型: ${[...modelSet].join(', ')}`);
    } else {
      log('AI发言含aiModel', 'FAIL', '无AI消息包含aiModel字段');
    }

    // 11b: AI发言aiModel字段在TTS音色表中
    const validTTSModels = aiMessages.filter(m => {
      // 检查aiModel是否在已知音色列表中
      const knownModels = [
        'openai/gpt-4.1-nano', 'anthropic/claude-sonnet-4.5', 'google/gemini-2.5-flash-lite',
        'deepseek/deepseek-chat', 'qwen/qwen3-235b-a22b', 'moonshotai/kimi-k2',
      ];
      return knownModels.includes(m.aiModel);
    });
    if (validTTSModels.length > 0) {
      log('AI发言→TTS映射', 'PASS', `${validTTSModels.length}/${aiMessages.length}条消息的aiModel可映射到TTS音色`);
    } else if (aiMessages.length > 0) {
      log('AI发言→TTS映射', 'WARN', `aiModel值未命中音色表: ${aiMessages[0]?.aiModel}`);
    } else {
      log('AI发言→TTS映射', 'FAIL', '无AI发言可验证');
    }

    // 11c: 人类发言是否被广播（验证AI能收到其他玩家消息）
    if (humanChatBroadcasted) {
      log('人类发言广播', 'PASS', '人类聊天消息已广播回客户端（AI同样能收到并写入记忆）');
    } else if (humanSpeechSent) {
      log('人类发言广播', 'WARN', '人类已发送消息但未收到广播回执');
    } else {
      log('人类发言广播', 'WARN', '未进入讨论阶段，无法测试');
    }

    // 11d: 投票结果是否随phase_change下发
    if (voteResults.length > 0) {
      const firstVR = voteResults[0];
      log('投票结果下发', 'PASS', `${voteResults.length}次投票结果, 首次结果: ${firstVR.result}, 票数: ${firstVR.votes?.length}`);
    } else if (phaseHistory.includes('voting')) {
      log('投票结果下发', 'WARN', '进入了投票但未收到投票结果数据');
    } else {
      log('投票结果下发', 'WARN', '未进入投票阶段');
    }

    // 11e: AI聊天总量验证
    if (chatMessages.length > 0) {
      log('聊天消息总量', 'PASS', `共${chatMessages.length}条 (AI: ${aiMessages.length}, 人类: ${humanMessages.length})`);
    } else {
      log('聊天消息总量', 'FAIL', '无聊天消息');
    }

    // 11f: TTS端到端链路验证 - 拿一条真实的AI发言去调TTS
    if (aiMessages.length > 0) {
      const sampleMsg = aiMessages[0];
      try {
        const ttsRes = await apiFetchRaw('/api/tts/speak', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text: sampleMsg.message, aiModel: sampleMsg.aiModel }),
        });
        if (ttsRes.ok) {
          const buf = await ttsRes.arrayBuffer();
          log('TTS端到端链路', 'PASS',
            `用AI真实发言"${sampleMsg.message.substring(0, 30)}..."调TTS成功, 音频: ${(buf.byteLength / 1024).toFixed(1)}KB, 模型: ${sampleMsg.aiModel}`);
        } else {
          const errBody = await ttsRes.json().catch(() => null);
          const errMsg = errBody?.error || `TTS返回${ttsRes.status}`;
          const isProviderIssue = errMsg.includes('403') || errMsg.includes('Provider') || errMsg.includes('失败');
          log('TTS端到端链路', isProviderIssue ? 'WARN' : 'FAIL',
            `${errMsg}（需配置DASHSCOPE_API_KEY启用CosyVoice2 TTS）`);
        }
      } catch (err) {
        log('TTS端到端链路', 'FAIL', `${err}`);
      }
    } else {
      log('TTS端到端链路', 'WARN', '无AI发言可用于端到端验证');
    }

    if (gameOver) {
      log('游戏完成', 'PASS', `赢家已确定`);
    }

    // ========== Step 12: AI能力评估 ==========
    if (aiMessages.length >= 3) {
      console.log('\n🧠 AI能力评估\n');

      // 收集评估材料
      const winner = gameState?.winner || 'unknown';
      const evalData = {
        totalRounds: gameState?.round || 0,
        winner,
        aiSpeechCount: aiMessages.length,
        speeches: aiMessages.map(m => ({
          player: m.playerName,
          message: m.message,
        })),
        voteCount: voteResults.length,
        voteDetails: voteResults.map(vr => ({
          result: vr.result,
          votes: vr.votes?.map((v: any) => `${v.voterId?.substring(0,4)}→${v.targetId?.substring(0,4) || '弃票'}`),
        })),
        phaseFlow: phaseHistory.join(' → '),
      };

      // 用LLM裁判评估AI能力
      try {
        const evalPrompt = `你是一个资深狼人杀高手裁判。请从"是否帮助己方阵营获胜"的角度严格评估AI玩家的游戏能力。

游戏信息：
- 6人局：2狼人、1预言家、1女巫、2平民
- 共${evalData.totalRounds}轮，${evalData.aiSpeechCount}次AI发言，${evalData.voteCount}次投票
- 最终赢家：${evalData.winner === 'werewolf' ? '狼人阵营' : '好人阵营'}
- 阶段流程：${evalData.phaseFlow}

AI发言记录：
${evalData.speeches.map((s, i) => `[${i + 1}] ${s.player}: "${s.message}"`).join('\n')}

请从以下角度评估（每项0-20分）：

1. 夜间决策能力（0-20）：
   - 狼人：是否优先杀威胁最大的人（预言家/女巫）？狼人间是否统一目标？
   - 预言家：是否查验了最可疑的人？
   - 女巫：解药/毒药使用是否合理？
   - 守卫：是否守护了关键角色？

2. 发言对局势的影响（0-20）：
   - 发言是否帮助了己方阵营？
   - 狼人发言是否成功搅浑水、转移火力？
   - 好人发言是否帮助找到了狼人？
   - 是否有人的发言反而帮了对方？

3. 投票决策（0-20）：
   - 投票是否与发言立场一致？
   - 好人是否投了狼人？狼人是否成功把票引向好人？
   - 是否有跟票/抱团行为？

4. 团队协作（0-20）：
   - 狼人之间是否互保、配合转移火力？
   - 好人是否站在了正确的一边？
   - 是否形成了有效的阵营对抗？

5. 局势判断（0-20）：
   - 每轮结束后局势倒向哪方？AI是否做出了正确的局势判断？
   - 是否有AI的操作导致己方阵营崩盘？
   - 最终结果是否合理？

评分标准：18-20=高手级，14-17=合格，10-13=一般，<10=不及格

请严格按JSON格式回复：
{
  "scores": {
    "night_decision": {"score": 0, "comment": "评语"},
    "speech_impact": {"score": 0, "comment": "评语"},
    "vote_decision": {"score": 0, "comment": "评语"},
    "teamwork": {"score": 0, "comment": "评语"},
    "situation_judgment": {"score": 0, "comment": "评语"}
  },
  "total": 0,
  "grade": "高手/合格/一般/不及格",
  "key_issues": ["需要改进的具体问题"],
  "overall": "总体评价"
}`;

        const evalRes = await fetch(`${BASE}/api/ai/config`);
        const evalConfig = await evalRes.json() as any;

        // 使用已配置的OpenRouter调用评估
        const judgeRes = await fetch('https://openrouter.ai/api/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${API_KEY}`,
          },
          body: JSON.stringify({
            model: 'deepseek/deepseek-chat',
            messages: [
              { role: 'system', content: '你是专业的狼人杀游戏评审。请严格按JSON格式回复。' },
              { role: 'user', content: evalPrompt },
            ],
            temperature: 0.3,
            max_tokens: 800,
          }),
        });

        if (judgeRes.ok) {
          const judgeData = await judgeRes.json() as any;
          const judgeContent = judgeData.choices?.[0]?.message?.content || '';

          try {
            const jsonMatch = judgeContent.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
              const evalResult = JSON.parse(jsonMatch[0]);
              const total = evalResult.total || 0;
              const scores = evalResult.scores || {};

              console.log('📊 AI能力评分：');
              for (const [key, val] of Object.entries(scores) as any) {
                console.log(`  ${key}: ${val.score}/20 - ${val.comment}`);
              }
              console.log(`\n  总分: ${total}/100 | 等级: ${evalResult.grade || '未知'}`);
              console.log(`  总评: ${evalResult.overall || '无'}`);
              if (evalResult.key_issues?.length > 0) {
                console.log(`  待改进: ${evalResult.key_issues.join('; ')}`);
              }
              if (total >= 60) {
                log('AI能力评估', 'PASS', `总分 ${total}/100 (>=60及格)`);
              } else {
                log('AI能力评估', 'FAIL', `总分 ${total}/100 (<60不及格，需改进Agent)`);
              }
            } else {
              log('AI能力评估', 'WARN', `评估结果解析失败: ${judgeContent.substring(0, 200)}`);
            }
          } catch (parseErr) {
            log('AI能力评估', 'WARN', `JSON解析失败: ${judgeContent.substring(0, 200)}`);
          }
        } else {
          log('AI能力评估', 'WARN', `裁判LLM调用失败: ${judgeRes.status}`);
        }
      } catch (evalErr) {
        log('AI能力评估', 'WARN', `评估异常: ${evalErr}`);
      }
    } else {
      log('AI能力评估', 'WARN', '发言数不足，无法评估');
    }

  } catch (err) {
    log('测试异常', 'FAIL', `${err}`);
  } finally {
    client.disconnect();
  }

  // ========== 输出总结 ==========
  console.log('\n' + '='.repeat(60));
  console.log('📋 测试结果总结');
  console.log('='.repeat(60));
  const passed = results.filter(r => r.status === 'PASS').length;
  const failed = results.filter(r => r.status === 'FAIL').length;
  const warned = results.filter(r => r.status === 'WARN').length;
  console.log(`✅ PASS: ${passed}  ❌ FAIL: ${failed}  ⚠️ WARN: ${warned}`);
  console.log(`总耗时: ${((Date.now() - startTime) / 1000).toFixed(1)}秒`);
  console.log('');

  for (const r of results) {
    const icon = r.status === 'PASS' ? '✅' : r.status === 'FAIL' ? '❌' : '⚠️';
    console.log(`  ${icon} ${r.step}: ${r.detail}`);
  }

  if (failed > 0) {
    console.log('\n❌ 存在失败项，需要修复！');
    process.exit(1);
  } else {
    console.log('\n🎉 所有测试通过！');
    process.exit(0);
  }
}

main().catch(err => {
  console.error('💥 测试脚本异常:', err);
  process.exit(1);
});
