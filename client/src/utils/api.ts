const API_BASE = '/api';

export async function fetchRooms() {
  const res = await fetch(`${API_BASE}/rooms`);
  return res.json();
}

export async function createRoom(name: string, totalPlayers: number, roleConfig?: Record<string, number>) {
  const res = await fetch(`${API_BASE}/rooms`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, totalPlayers, roleConfig }),
  });
  return res.json();
}

export async function getRoom(roomId: string) {
  const res = await fetch(`${API_BASE}/rooms/${roomId}`);
  return res.json();
}

export async function getPresets() {
  const res = await fetch(`${API_BASE}/presets`);
  return res.json();
}

export async function getPresetConfig(count: number) {
  const res = await fetch(`${API_BASE}/presets/${count}`);
  return res.json();
}

export async function getQRCode() {
  const res = await fetch(`${API_BASE}/qrcode`);
  return res.json();
}

export async function saveAIConfig(apiToken: string, models: string[]) {
  const res = await fetch(`${API_BASE}/ai/config`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ apiToken, models }),
  });
  return res.json();
}

export async function getAIConfig() {
  const res = await fetch(`${API_BASE}/ai/config`);
  return res.json();
}

export async function getAIModels() {
  const res = await fetch(`${API_BASE}/ai/models`);
  return res.json();
}
