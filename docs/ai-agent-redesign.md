# AI Agent 重构设计方案

## 一、当前问题诊断

| 问题 | 影响 | 严重度 |
|------|------|--------|
| 记忆扁平无结构 | AI老是分析第一天发言，忽略最新信息 | 高 |
| 缺少游戏状态摘要 | AI不知道谁死了、怎么死的 | 高 |
| 每次单轮对话 | 无上下文延续，每次决策像新人 | 高 |
| 无思考日志 | 无法复盘AI决策逻辑 | 中 |
| 无游戏事件追踪 | 投票结果、死亡信息丢失 | 高 |

## 二、重构架构

### 2.1 Agent 内部结构

```
AIAgent (重构后)
├── conversationHistory: Message[]    ← 多轮对话历史（持续整局）
├── gameKnowledge: GameKnowledge      ← 结构化游戏知识
│   ├── round: number                 ← 当前轮次
│   ├── alivePlayers: Player[]        ← 存活玩家
│   ├── deadPlayers: DeadRecord[]     ← 死亡记录（谁、哪天、怎么死的）
│   ├── voteHistory: VoteRound[]      ← 每轮投票记录
│   ├── myActions: ActionRecord[]     ← 自己的行动历史
│   └── suspicions: Map<id, number>   ← 怀疑度评分
├── thoughtLog: ThoughtEntry[]        ← 思考日志（可导出复盘）
└── methods
    ├── updateKnowledge(gameState)     ← 每次行动前同步场上信息
    ├── buildContext()                 ← 构建当前上下文摘要
    ├── think(situation) → thought     ← 思考+记录
    └── act(thought) → action          ← 基于思考做决策
```

### 2.2 多轮对话设计

**之前（每次独立调用）：**
```
messages = [
  { role: "system", content: "你是狼人杀玩家..." },
  { role: "user", content: "超长的prompt，包含所有记忆" },
]
```

**重构后（持续对话窗口）：**
```
messages = [
  { role: "system", content: "你是XXX，身份是狼人..." },         // 开局设定（固定）
  { role: "user", content: "[第1天·夜晚] 狼人回合，请决策" },    // 第1夜
  { role: "assistant", content: "我选择杀害3号..." },            // AI回复
  { role: "user", content: "[第1天·白天] 昨晚3号被杀...发言" },  // 第1天白天
  { role: "assistant", content: "我觉得5号很可疑..." },          // AI发言
  { role: "user", content: "[第1天·投票] 请投票" },              // 投票
  { role: "assistant", content: '{"action":"vote","targetId":"5"}' },
  { role: "user", content: "[第2天·夜晚] 投票结果：5号被放逐..." }, // 第2夜
  ...
]
```

### 2.3 上下文管理策略

```
对话历史超过20条时:
1. 保留 system 消息（不压缩）
2. 将旧对话压缩为"游戏摘要"：
   "第1天：3号被狼人杀害，5号被投票放逐。
    第2天：1号被杀害，女巫救了1号，平安夜。投票4号被放逐。"
3. 最近3轮的对话保持原文
4. 总token控制在3000以内
```

### 2.4 结构化游戏知识

每次AI需要行动前，自动同步：

```typescript
interface GameKnowledge {
  round: number;
  totalPlayers: number;

  alivePlayers: Array<{
    id: string;
    name: string;
    role?: string;       // 仅自己和已知身份
    suspicionLevel: number; // 0-10怀疑度
  }>;

  deadPlayers: Array<{
    id: string;
    name: string;
    diedRound: number;
    deathCause: 'night_death' | 'vote_exile' | 'hunter_shot';  // 夜间死亡不区分狼杀/毒杀
    revealedRole?: string; // 死后公开身份（如果有）
  }>;

  voteHistory: Array<{
    round: number;
    votes: Array<{ voter: string; target: string | null }>;
    result: string; // "5号被放逐" / "平安" / "平票PK"
  }>;

  speechHistory: Array<{
    round: number;
    phase: 'day' | 'night' | 'pk';
    speaker: string;
    content: string;
  }>;
}
```

### 2.5 思考日志设计

```typescript
interface ThoughtEntry {
  timestamp: number;
  round: number;
  phase: string;
  playerName: string;
  aiModel: string;

  // 输入
  situation: string;      // 当前局面描述
  promptSent: string;     // 发给LLM的完整prompt

  // 输出
  rawResponse: string;    // LLM原始回复
  parsedAction: any;      // 解析后的行动
  reasoning?: string;     // AI给出的推理（如果有）

  // 结果
  actionSuccess: boolean;
  engineMessage?: string;

  // 耗时
  llmLatencyMs: number;
}
```

日志写入文件 `logs/ai_thoughts_[roomId].jsonl`，每行一个JSON，可用于复盘。

## 三、Prompt重构

### 3.1 System消息（开局设定，整局不变）

```
你是一个经验丰富的狼人杀高手，名字叫{name}。
你的身份是{role}。

你的游戏风格：
- 逻辑分析能力强，善于从发言中找出矛盾
- 投票有明确理由，不随大流
- 如果是狼人，会巧妙伪装，合理甩锅
- 如果是好人，会积极推理，保护同伴
- 发言简洁有力，30-80字，像真人玩家

重要规则：
- 回复决策时使用JSON格式：{"action": "xxx", "targetId": "xxx"}
- 回复发言时直接输出文字，不加JSON
- 每次决策前先简要说明你的推理过程
```

### 3.2 每轮User消息格式

```
===== 第{round}天 · {phase_name} =====

【场上状况】
- 存活：{alive_count}人 ({player_list})
- 已死亡：
  · 第1天夜：玩家3 (夜间死亡)
  · 第1天白天：玩家5 (被投票放逐)
  · 第2天夜：无人死亡 (平安夜)

【本轮信息】
{phase_specific_info}

【你的任务】
{action_instruction}
```

### 3.3 按天分隔的发言记录（注入到User消息中）

```
【第1天发言记录】
- 玩家1: "我是预言家，昨晚查验了3号是狼人"
- 玩家2: "我觉得1号在撒谎，预言家不会这么早跳"
- 我: "大家冷静分析，我觉得2号的反应很可疑"
  → 投票结果：5号被放逐（3票），平安

【第2天发言记录】
- 玩家1: "昨晚我又查了4号，是好人"
- 玩家4: "1号如果是真预言家请继续查验"
- 我: "我支持1号的查验结果"
  → 投票结果：...

【当前回合】
(最新发言，如果有的话)
```

## 四、决策流程重构

```
游戏事件触发
  │
  ├─ 1. updateKnowledge(gameState)
  │     同步最新游戏状态到 gameKnowledge
  │     检测新的死亡事件、投票结果等
  │
  ├─ 2. buildContext()
  │     生成当前局面的结构化描述
  │     按天分隔发言记录
  │     构建User消息
  │
  ├─ 3. 添加到 conversationHistory
  │     如果超过20条，压缩旧对话
  │
  ├─ 4. callAPI(conversationHistory)
  │     发送完整对话历史给LLM
  │     获取回复
  │
  ├─ 5. 记录思考日志
  │     保存输入prompt、输出、推理过程、耗时
  │
  ├─ 6. 将assistant回复加入conversationHistory
  │
  └─ 7. 解析回复 → 执行行动
```

## 五、上下文窗口管理

### 5.1 Token预算分配

```
总预算: ~3000 tokens (给LLM留1000 tokens回复空间)

分配:
- System消息:     ~300 tokens (固定)
- 游戏状态摘要:   ~200 tokens (动态)
- 旧轮摘要:       ~500 tokens (压缩后)
- 最近2轮完整对话: ~1500 tokens (保留原文)
- 当前轮指令:      ~500 tokens (当前任务)
```

### 5.2 压缩策略

当对话超过20条消息时：
```
1. 统计总对话长度
2. 将第1-N天的对话压缩为摘要：
   "第1天：玩家3被杀，讨论中玩家1自称预言家查了3号是狼人，
    玩家5被投票放逐。你当时发言支持了1号。"
3. 保留最近2天的完整对话
4. 更新 conversationHistory = [system, 摘要, 最近对话...]
```

## 六、AI能力评估标准

### 6.1 评分维度（满分100）

| 维度 | 权重 | 评估标准 |
|------|------|---------|
| **信息利用** | 25分 | 是否正确引用场上信息（死亡、投票结果） |
| **逻辑推理** | 25分 | 发言是否有逻辑链条，投票是否有依据 |
| **角色扮演** | 20分 | 狼人是否成功伪装，好人是否积极推理 |
| **策略性** | 15分 | 投票是否有战略考虑，不是随机投 |
| **发言质量** | 15分 | 发言是否自然、有内容、不重复 |

### 6.2 自动评估方法

E2E测试中增加AI评估agent：
```
1. 收集整局游戏的所有发言和决策
2. 检查：
   - AI发言是否提及了正确的死亡信息
   - AI投票是否与发言立场一致
   - 狼人AI是否在伪装（不自爆）
   - 好人AI是否在尝试找狼
   - 发言是否有新内容（vs 重复第一天的话）
3. 用另一个LLM调用来评分（裁判模式）
```

## 七、实现文件清单

| 文件 | 改动 |
|------|------|
| `server/src/ai/AIAgent.ts` | 重写：多轮对话、结构化记忆、思考日志 |
| `server/src/ai/GameKnowledge.ts` | 新建：游戏知识管理 |
| `server/src/ai/ThoughtLogger.ts` | 新建：思考日志记录 |
| `server/src/ai/ContextManager.ts` | 新建：上下文窗口管理 |
| `server/src/socket.ts` | 修改：同步更多游戏事件给AI |
| `server/src/e2e-test.ts` | 修改：增加AI能力评估 |

## 八、预期效果

| 指标 | 当前 | 重构后 |
|------|------|--------|
| AI是否知道谁死了 | ❌ 不知道 | ✅ 结构化死亡记录 |
| AI是否记得之前发言 | ⚠️ 扁平记忆 | ✅ 按天分隔+上下文延续 |
| AI投票是否有逻辑 | ⚠️ 常随机 | ✅ 基于推理链 |
| AI发言是否重复 | ❌ 常重复第一天 | ✅ 关注最新信息 |
| 可复盘性 | ❌ 无日志 | ✅ 完整思考日志 |
| 狼人伪装能力 | ⚠️ 简单 | ✅ 策略性伪装 |
