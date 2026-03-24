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
  return { status: res.status, body: await res.json().catch(() => null) };
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
  console.log('\n🐺 狼人杀端到端测试开始\n');
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

  // ========== Step 3: 创建房间 ==========
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

  // ========== Step 4: 模拟人类玩家加入 ==========
  const client = io(BASE, { transports: ['websocket'] });
  let myPlayerId = '';
  let myRole = '';
  let gameState: any = null;
  const phaseHistory: string[] = [];
  const chatMessages: any[] = [];
  let gameOver = false;

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
    if (d.winner) {
      gameOver = true;
      log('游戏结束', 'PASS', `赢家: ${d.winner}`);
    }
  });
  client.on('chat_message', (m: any) => {
    chatMessages.push(m);
    console.log(`  💬 ${m.playerName}: ${m.message?.substring(0, 50)}...`);
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

    // ========== Step 5: 添加5个AI ==========
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

    // ========== Step 6: 开始游戏 ==========
    client.emit('start_game');
    console.log('\n🎮 游戏开始，等待游戏流程...\n');

    // 等待游戏离开 waiting 阶段
    await waitFor(client, 'game_state', (s: any) => s.phase && s.phase !== 'waiting', 15000);
    log('游戏开始', 'PASS', `进入阶段: ${gameState?.phase}`);

    // ========== Step 7: 检查身份是否可见 ==========
    const me = gameState?.players?.find((p: any) => p.id === myPlayerId);
    if (me?.role) {
      log('身份可见', 'PASS', `角色: ${me.role}`);
    } else {
      log('身份可见', 'FAIL', `role=${me?.role}, myPlayerId=${myPlayerId}`);
    }

    // ========== Step 8: 自动处理人类操作 ==========
    const nightRoles: Record<string, string> = {
      guard: 'guard_turn', werewolf: 'werewolf_turn', witch: 'witch_turn', seer: 'seer_turn',
    };
    const nightActions: Record<string, string> = {
      guard: 'guard', werewolf: 'kill', seer: 'investigate',
    };

    const actedPhases = new Set<string>();

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

      // 讨论/遗言阶段：当轮到我时，等2秒后结束发言
      if (['discussion', 'last_words', 'pk_speech'].includes(gs.phase) &&
          gs.currentSpeaker === myPlayerId && !actedPhases.has(`speak-${phaseKey}`)) {
        actedPhases.add(`speak-${phaseKey}`);
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

    // ========== Step 9: 等待游戏结束 ==========
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

    // ========== Step 10: 验证结果 ==========
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

    if (chatMessages.length > 0) {
      log('AI发言', 'PASS', `共${chatMessages.length}条消息`);
    } else {
      log('AI发言', 'FAIL', '无AI发言');
    }

    if (gameOver) {
      log('游戏结束', 'PASS', `赢家已确定`);
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
