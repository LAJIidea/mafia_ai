import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { saveAIConfig, getAIConfig, getAIModels } from '../utils/api';

interface Model {
  id: string;
  name: string;
  provider: string;
}

export default function Settings() {
  const navigate = useNavigate();
  const [apiToken, setApiToken] = useState('');
  const [models, setModels] = useState<Model[]>([]);
  const [configured, setConfigured] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');

  useEffect(() => {
    getAIModels().then(setModels).catch(() => {});
    getAIConfig().then(data => {
      setConfigured(data.configured);
    }).catch(() => {});
  }, []);

  const handleSave = async () => {
    if (!apiToken.trim()) return;
    setSaving(true);
    try {
      const result = await saveAIConfig(apiToken, models.map(m => m.id));
      if (result.success) {
        setMessage('配置保存成功！');
        setConfigured(true);
      } else {
        setMessage('保存失败：' + (result.error || '未知错误'));
      }
    } catch (err) {
      setMessage('保存失败');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="min-h-screen night-overlay p-4 md:p-8">
      <div className="max-w-2xl mx-auto space-y-6">
        <button
          onClick={() => navigate('/')}
          className="text-wolf hover:text-white transition-colors"
        >
          ← 返回首页
        </button>

        <h1 className="text-3xl font-black text-center">
          <span className="text-wolf">AI</span> 设置
        </h1>

        {/* API Token */}
        <div className="bg-dawn/50 rounded-2xl p-6 border border-wolf/20 space-y-4">
          <h2 className="text-xl font-bold text-wolf">OpenRouter API Token</h2>
          <p className="text-sm text-gray-400">
            所有AI玩家通过 OpenRouter 统一接入。请在 openrouter.ai 获取 API Token。
          </p>

          <input
            type="password"
            placeholder="输入 OpenRouter API Token"
            value={apiToken}
            onChange={e => setApiToken(e.target.value)}
            className="w-full bg-night/80 border border-wolf/30 rounded-lg px-4 py-3 text-white placeholder-gray-500 focus:outline-none focus:border-wolf"
          />

          {configured && (
            <div className="text-sm text-village">✓ API Token 已配置</div>
          )}
        </div>

        {/* 支持的模型 */}
        <div className="bg-dawn/50 rounded-2xl p-6 border border-seer/20 space-y-4">
          <h2 className="text-xl font-bold text-seer">支持的AI模型</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {models.map(model => (
              <div key={model.id} className="bg-night/40 rounded-lg p-4 flex items-center gap-3">
                <div className="text-2xl">🤖</div>
                <div>
                  <div className="font-bold text-sm">{model.name}</div>
                  <div className="text-xs text-gray-500">{model.provider}</div>
                  <div className="text-xs text-gray-600 font-mono mt-1">{model.id}</div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {message && (
          <div className={`rounded-lg px-4 py-3 text-sm ${
            message.includes('成功') ? 'bg-village/20 text-village' : 'bg-blood/20 text-blood'
          }`}>
            {message}
          </div>
        )}

        <button
          onClick={handleSave}
          disabled={!apiToken.trim() || saving}
          className="w-full bg-gradient-to-r from-wolf to-seer py-3 rounded-lg font-bold text-lg transition-all hover:opacity-90 disabled:opacity-50"
        >
          {saving ? '保存中...' : '保存配置'}
        </button>
      </div>
    </div>
  );
}
