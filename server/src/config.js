// Central config, read once from the environment. No secrets are ever sent to clients.
import path from 'node:path';

const int = (v, d) => (v && !Number.isNaN(+v) ? +v : d);

export const config = {
  port: int(process.env.PORT, 8787),
  apiKey: process.env.ANTHROPIC_API_KEY || '',
  model: process.env.LUZY_MODEL || 'claude-opus-5',
  subagentModel: process.env.SUBAGENT_MODEL || 'claude-haiku-4-5',
  effort: process.env.LUZY_EFFORT || 'high',
  workspaceDir: path.resolve(process.env.WORKSPACE_DIR || './workspace'),
  allowedOrigins: (process.env.ALLOWED_ORIGINS || 'http://localhost:8888')
    .split(',').map(s => s.trim()).filter(Boolean),
  cmdTimeoutMs: int(process.env.CMD_TIMEOUT_MS, 60000),
  maxOutputBytes: int(process.env.MAX_OUTPUT_BYTES, 200000),
  maxTurns: int(process.env.MAX_TURNS, 24),
};

export function assertConfigured() {
  if (!config.apiKey) {
    throw new Error('ANTHROPIC_API_KEY is not set — the backend cannot start without it.');
  }
}
