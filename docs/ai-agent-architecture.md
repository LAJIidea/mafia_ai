# AI Agent 技术实现文档

## 一、整体架构

```
┌─────────────────────────────────────────────────────────────┐
│                     Game Server (Node.js)                    │
│                                                             │
│  ┌──────────────┐     ┌──────────────┐    ┌──────────────┐  │
│  │  GameEngine   │     │  AIManager   │    │   Socket.ts   │  │
│  │ (游戏状态机)   │     │ (Agent管理)   │    │ (事件调度)    │  │
│  └──────┬───────┘     └──────┬───────┘    └──────┬───────┘  │
│         │                    │                   │          │
│         │    getPlayerView   │   createAgent     │          │
│         │◄──────────────────►│◄─────────────────►│          │
│         │                    │                   │          │
│         │                    ▼                   │          │
│         │             ┌──────────────┐           │          │
│         │             │   AIAgent    │           │          │
│         │             │ ┌──────────┐ │           │          │
│         │             │ │  Memory  │ │           │          │
│         │             │ │  System  │ │           │          │
│         │             │ └──────────┘ │           │          │
│         │             │ ┌──────────┐ │           │          │
│         │             │ │  Prompt  │ │           │          │
│         │             │ │  Builder │ │           │          │
│         │             │ └──────────┘ │           │          │
│         │             │ ┌──────────┐ │           │          │
│         │             │ │ LLM API  │ │           │          │
│         │             │ │ (OpenR.) │ │           │          │
│         │             │ └──────────┘ │           │          │
│         │             └──────────────┘           │          │
│         │                    │                   │          │
└─────────┼────────────────────┼───────────────────┼──────────┘
          │                    │                   │
          ▼                    ▼                   ▼
    ┌──────────┐         ┌──────────┐        ┌──────────┐
    │ 游戏规则  │         │ OpenRouter│        │ 客户端    │
    │ 状态转换  │         │ LLM API  │        │ Socket.io │
    └──────────┘         └──────────┘        └──────────┘
```

## 二、核心类详解

### 2.1 AIAgent 类

**文件**: `server/src/ai/AIAgent.ts`

```typescript
class AIAgent {
  private config: AIConfig;    // { apiToken, baseUrl }
  private model: string;       // 如 "deepseek/deepseek-chat"
  private memory: string[];    // 记忆数组，按时间顺序存储游戏事件
}
```

#### 方法清单

| 方法 | 用途 | 输入 | 输出 |
|------|------|------|------|
| `decide()` | 夜间/投票等需要做决策的场景 | Player, GameState | ActionRequest |
| `generateSpeech()` | 白天讨论/遗言/PK发言 | Player, GameState | string (发言文本) |
| `addMemory()` | 写入一条记忆 | string | void |
| `buildPrompt()` | 构建决策prompt | Player, GameState | string |
| `buildSpeechPrompt()` | 构建发言prompt | Player, GameState | string |
| `callAPI()` | 调用LLM | string (prompt) | string (response) |
| `parseResponse()` | 解析LLM返回的JSON | string, Player, GameState | ActionRequest |
| `fallbackAction()` | LLM失败时的默认行为 | Player, GameState | ActionRequest |

### 2.2 AIManager 类

```typescript
class AIManager {
  private agents: Map<string, AIAgent>;  // playerId → AIAgent
  private config: AIConfig | null;

  setConfig(apiToken)             // 设置API Token
  createAgent(playerId, model)    // 创建agent实例
  getAgent(playerId)              // 获取agent
  removeAgent(playerId)           // 移除agent
}
```

## 三、AI决策流程

### 3.1 决策类操作（夜间行动/投票）

```
triggerAIActions()
  │
  ├─ 前置检查 ──────────────────────────────────────────┐
  │  • 游戏未结束                                        │
  │  • aiManager存在且有配置                              │
  │  • 狼人阶段：等人类狼人先投票完                        │
  │                                                     │
  ├─ 筛选需要行动的AI ──────────────────────────────────┐│
  │  • 存活的AI玩家（遗言阶段则是死亡的AI）              ││
  │  • 该阶段该角色需要行动                              ││
  │  • 本阶段尚未行动过（actedSet检查）                  ││
  │                                                     ││
  ├─ 延迟 1-3秒（模拟思考时间） ────────────────────────┤│
  │                                                     ││
  ├─ 3次重试循环 ───────────────────────────────────────┤│
  │  │                                                  ││
  │  ├─ agent.decide(player, gameState)                 ││
  │  │   ├─ buildPrompt()                               ││
  │  │   ├─ callAPI() ← 15秒超时                        ││
  │  │   ├─ parseResponse() ← 正则提取JSON              ││
  │  │   └─ 失败? → fallbackAction()                    ││
  │  │                                                  ││
  │  ├─ engine.handleAction(action)                     ││
  │  │   ├─ 成功 → 记录记忆，等待PHASE_MIN_DURATION     ││
  │  │   └─ 失败 → 等500ms重试                          ││
  │  │                                                  ││
  │  └─ 3次都失败 → 使用fallback默认行为                ││
  │                                                     ││
  └─ 递归处理下一个AI ──────────────────────────────────┘│
                                                         │
```

### 3.2 发言类操作（讨论/遗言/PK）

```
检测 currentSpeaker === aiPlayer.id
  │
  ├─ agent.generateSpeech(player, gameState)
  │   ├─ buildSpeechPrompt()
  │   ├─ callAPI() ← 15秒超时
  │   └─ 失败 → 返回"我没有什么特别想说的。"
  │
  ├─ 广播文字消息
  │   └─ io.emit('chat_message', { message, aiModel })
  │
  ├─ 异步TTS合成（不阻塞）
  │   └─ ttsService.synthesize() → io.emit('audio_broadcast')
  │
  ├─ 写入记忆
  │   ├─ 自己: "我发言: '...'"
  │   └─ 其他AI: "XXX说: '...'"
  │
  ├─ 推进发言者: engine.advanceSpeaker()
  │
  └─ 递归处理下一个AI发言
```

## 四、Prompt构建详解

### 4.1 决策Prompt结构

```
┌─────────────────────────────────────────┐
│ 系统消息 (System)                        │
│ "你是一个聪明的狼人杀玩家..."             │
├─────────────────────────────────────────┤
│ 用户消息 (User) = buildPrompt()          │
│                                         │
│ ┌─ 基础信息 ─────────────────────────┐  │
│ │ 你的名字：XXX                       │  │
│ │ 你的身份：狼人/预言家/...            │  │
│ │ 当前轮次：第N轮                     │  │
│ │ 当前阶段：XXX                       │  │
│ └────────────────────────────────────┘  │
│                                         │
│ ┌─ 存活玩家列表 ─────────────────────┐  │
│ │ - 玩家1 (ID: xxx)                  │  │
│ │ - 玩家2 (ID: xxx)                  │  │
│ │ ...                                │  │
│ └────────────────────────────────────┘  │
│                                         │
│ ┌─ 记忆（最近50条） ─────────────────┐  │
│ │ 玩家A说: "我觉得3号可疑"           │  │
│ │ 我发言: "大家注意2号的发言"         │  │
│ │ Round 1, voting: performed vote    │  │
│ │ ...                                │  │
│ └────────────────────────────────────┘  │
│                                         │
│ ┌─ 阶段特定指令 ─────────────────────┐  │
│ │ (见下方各角色详细prompt)             │  │
│ └────────────────────────────────────┘  │
└─────────────────────────────────────────┘
```

### 4.2 各角色/阶段的决策Prompt

#### 守卫回合 (GUARD_TURN)
```
你是守卫。选择你要守护的玩家（不能连续两晚守同一人）。
上一晚守护了：[lastGuardTarget 或 "无"]

请以JSON格式回复：
- 守护某人：{"action": "guard", "targetId": "玩家ID"}
- 不守护：{"action": "guard"}
```

#### 狼人回合 (WEREWOLF_TURN)
```
你是狼人。你的狼人队友：[队友名单]
选择你要杀害的目标（不能杀害狼人队友）。

请以JSON格式回复：
- 杀害某人：{"action": "kill", "targetId": "玩家ID"}
- 空刀：{"action": "kill"}
```

#### 女巫回合 (WITCH_TURN)
```
你是女巫。当前是第N轮。

[如果有人被杀:]
今晚 XXX 被狼人杀害了。你有解药。
[如果round>1且被杀者是自己:] 注意：被杀的是你自己，但非首晚不能自救。
[否则:] 你可以使用解药救人。

[如果有毒药:]
你有毒药，可以毒杀某人。注意：同一晚不能同时使用解药和毒药。

请以JSON格式回复：
- 使用解药：{"action": "witch_save"}
- 使用毒药：{"action": "witch_poison", "targetId": "玩家ID"}
- 跳过：{"action": "witch_skip"}
```

#### 预言家回合 (SEER_TURN)
```
你是预言家。选择你要查验的玩家。

请以JSON格式回复：
- 查验某人：{"action": "investigate", "targetId": "玩家ID"}
- 跳过：{"action": "investigate"}
```

#### 投票阶段 (VOTING)
```
根据讨论情况，投票放逐一名可疑玩家。

请以JSON格式回复：
- 投票：{"action": "vote", "targetId": "玩家ID"}
- 弃票：{"action": "vote"}
```

#### PK投票 (PK_VOTING)
```
平票PK！从以下候选人中选择一名放逐：
- 候选人A (ID: xxx)
- 候选人B (ID: xxx)

请以JSON格式回复：
- 投票：{"action": "vote", "targetId": "候选人ID"}
- 弃票：{"action": "vote"}
```

### 4.3 发言Prompt

```
你是一个狼人杀游戏的AI玩家。
你的名字是：XXX
你的真实身份是：[角色名]
当前是第N轮，发言阶段。

你的记忆：
[最近50条记忆]

请根据你的身份和策略，生成一段合理的发言（30-100字）。
注意：
- 如果你是狼人，你需要伪装自己
- 如果你是好人，你需要分析局势找出狼人
- 发言要自然，像真人玩家
- 直接回复发言内容，不要包含JSON或其他格式
```

## 五、LLM调用详解

### 5.1 callAPI 方法

```typescript
async callAPI(prompt: string): Promise<string> {
  // 15秒超时
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);

  const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    signal: controller.signal,
    headers: {
      'Authorization': `Bearer ${config.apiToken}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'https://mafia-game.app',
    },
    body: JSON.stringify({
      model: this.model,        // 如 "deepseek/deepseek-chat"
      messages: [
        { role: 'system', content: '你是一个聪明的狼人杀玩家...' },
        { role: 'user', content: prompt },
      ],
      temperature: 0.7,
      max_tokens: 500,
    }),
  });
}
```

### 5.2 Response解析

```typescript
parseResponse(response: string, player, gameState): ActionRequest {
  // 1. 正则提取JSON
  const jsonMatch = response.match(/\{[\s\S]*?\}/);
  if (jsonMatch) {
    const parsed = JSON.parse(jsonMatch[0]);
    return {
      playerId: player.id,
      action: parsed.action,
      targetId: parsed.targetId || undefined,
    };
  }
  // 2. 解析失败 → fallback
  return this.fallbackAction(player, gameState);
}
```

### 5.3 错误处理层次

```
Level 1: callAPI 内部
  └─ 15秒超时 → AbortError
  └─ HTTP错误 → 抛出异常
  └─ JSON解析失败 → 抛出异常

Level 2: decide/generateSpeech
  └─ callAPI失败 → fallbackAction() / 默认发言

Level 3: socket.ts doTriggerAIActions
  └─ 重试3次，每次间隔500ms
  └─ 3次都失败 → 使用硬编码fallback行为
```

## 六、记忆系统

### 6.1 记忆来源

| 来源 | 格式 | 触发位置 |
|------|------|---------|
| 人类文字发言 | `"玩家A说: '消息内容'"` | socket.ts chat_message事件 |
| 人类语音发言 | `"玩家A说: '转录文字'"` | socket.ts voice_audio事件 |
| AI发言(自己) | `"我发言: '发言内容'"` | socket.ts AI发言后 |
| AI发言(别人) | `"AI玩家B说: '发言内容'"` | socket.ts AI发言后 |
| AI行动记录 | `"Round 1, werewolf_turn: performed kill"` | socket.ts 行动成功后 |

### 6.2 记忆管理策略

```
添加记忆:  memory.push(event)
容量限制:  保留最近50条（memory.slice(-50)）
生命周期:  整局游戏持续，不会重置
信息密度:  纯文本，无结构化
```

### 6.3 记忆在Prompt中的使用

记忆被完整注入到prompt的"你的记忆"部分：
```
你的记忆（观察到的事件）：
玩家1说: "我是预言家，昨晚查验了3号是狼人"
AI玩家2说: "我觉得1号在撒谎"
我发言: "大家冷静分析一下"
Round 1, voting: performed vote
玩家3说: "我同意出3号"
...
```

## 七、Fallback默认行为

当LLM调用失败或返回无法解析的内容时：

| 阶段 | 默认行为 | 说明 |
|------|---------|------|
| GUARD_TURN | `guard(随机活人)` | 随机守护 |
| WEREWOLF_TURN | `kill(随机非狼人)` | 随机杀一个好人 |
| WITCH_TURN | `witch_skip` | 不用药 |
| SEER_TURN | `investigate(随机活人)` | 随机查验 |
| VOTING | `vote(随机活人)` | 随机投票 |
| PK_VOTING | `vote(随机PK候选人)` | 随机投PK候选人 |
| HUNTER_SHOOT | `shoot(随机活人)` | 随机开枪 |

## 八、特殊机制

### 8.1 狼人多人投票

```
1. 每个狼人各自独立投票（action: kill, targetId: xxx）
2. 投票记录存入 nightActions.werewolfVotes[]
3. 所有狼人投完后统计：
   - 多数票一致 → 杀害该玩家
   - 平票 → 随机从最高票中选一个
   - 全部空刀 → 平安夜
4. 人类狼人先投，AI狼人等人类投完再跟投
5. 狼人间可看到队友的投票意向（实时更新）
```

### 8.2 夜间阶段最低持续时间

```
GUARD_TURN:    15秒
WEREWOLF_TURN: 15秒
WITCH_TURN:    15秒
SEER_TURN:     15秒

AI行动后不会立即推进，等到最低时间到了才推进。
防止AI瞬间行动暴露身份。
```

### 8.3 已行动追踪（防重复行动）

```typescript
// 每当阶段+轮次变化时重置
const phaseKey = `${phase}-${round}`;
if (lastPhaseKey !== phaseKey) {
  actedSet = new Set();  // 清空
}

// AI行动成功后标记
actedSet.add(aiPlayer.id);

// 检查时跳过已行动的AI
if (actedSet.has(aiPlayer.id)) continue;
```

## 九、信息可见性（getPlayerView）

### AI能看到什么信息

| 角色 | 阶段 | 可见信息 |
|------|------|---------|
| 所有 | 任何 | 自己的角色、存活玩家列表、当前阶段 |
| 狼人 | 任何 | 其他狼人的身份（role字段不被清空） |
| 狼人 | WEREWOLF_TURN | werewolfVotes（队友投票意向） |
| 女巫 | WITCH_TURN | werewolfTarget（今晚被杀者） |
| 其他 | 夜间 | nightActions 全部为空 |
| 所有 | GAME_OVER | 所有人身份公开 |

### AI看不到什么

- 其他好人的角色（除非是狼人队友）
- 非本角色阶段的夜间行动详情
- 服务端的内部状态（如守卫的上一晚守护目标由prompt明确告知）

## 十、性能参数

| 参数 | 值 | 说明 |
|------|-----|------|
| LLM超时 | 15秒 | callAPI的AbortController |
| 决策重试 | 3次 | doTriggerAIActions中 |
| 重试间隔 | 500ms | 失败后等待 |
| AI延迟 | 1-3秒 | 模拟思考时间（随机） |
| 夜间最低时长 | 15秒 | 防AI瞬间行动 |
| 记忆上限 | 50条 | 超出截断旧记忆 |
| 发言长度 | 30-100字 | prompt中要求 |
| LLM温度 | 0.7 | temperature参数 |
| 最大token | 500 | max_tokens |
| TTS合成 | 异步 | 不阻塞游戏推进 |

## 十一、已知局限与改进方向

### 当前局限

1. **记忆无结构化**：纯文本存储，AI难以精确回忆特定事件
2. **无跨轮策略**：每次决策独立，没有长期策略规划
3. **单次API调用**：没有思维链(CoT)或多轮推理
4. **投票无博弈**：AI投票不考虑联盟/站队策略
5. **发言无情感**：不会根据局势变化调整语气
6. **无meta-game**：不会分析"哪些玩家是AI vs 人类"

### 可能的改进

1. **结构化记忆**：将记忆分为"事实"、"推断"、"怀疑"三类
2. **投票推理链**：先分析每个人的可疑度再决定投谁
3. **角色扮演一致性**：追踪自己之前的发言确保不矛盾
4. **联盟检测**：分析谁在保谁、谁在踩谁
5. **多模型差异化**：不同AI模型展现不同"性格"和决策风格
