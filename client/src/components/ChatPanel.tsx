import { useState, useRef, useEffect } from 'react';

interface ChatMessage {
  playerId: string;
  playerName: string;
  message: string;
  type: 'voice' | 'text';
  timestamp: number;
}

interface Props {
  messages: ChatMessage[];
  onSend: (message: string) => void;
  canSpeak: boolean;
}

export default function ChatPanel({ messages, onSend, canSpeak }: Props) {
  const [input, setInput] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  const handleSend = () => {
    if (!input.trim() || !canSpeak) return;
    onSend(input.trim());
    setInput('');
  };

  return (
    <div className="flex flex-col h-full">
      <div className="px-4 py-3 border-b border-wolf/20">
        <h3 className="font-bold text-sm">💬 聊天记录</h3>
      </div>

      <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-3">
        {messages.map((msg, i) => (
          <div key={i} className="space-y-1">
            <div className="text-xs text-gray-500">{msg.playerName}</div>
            <div className="bg-night/60 rounded-lg px-3 py-2 text-sm">
              {msg.type === 'voice' && <span className="text-xs text-wolf mr-1">🎤</span>}
              {msg.message}
            </div>
          </div>
        ))}
        {messages.length === 0 && (
          <div className="text-center text-sm text-gray-500 mt-8">暂无消息</div>
        )}
      </div>

      <div className="p-4 border-t border-wolf/20">
        <div className="flex gap-2">
          <input
            type="text"
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleSend()}
            disabled={!canSpeak}
            placeholder={canSpeak ? '输入发言...' : '当前不可发言'}
            className="flex-1 bg-night/80 border border-wolf/30 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-wolf disabled:opacity-50"
          />
          <button
            onClick={handleSend}
            disabled={!canSpeak || !input.trim()}
            className="bg-wolf px-4 py-2 rounded-lg text-sm font-bold disabled:opacity-30"
          >
            发送
          </button>
        </div>
      </div>
    </div>
  );
}
