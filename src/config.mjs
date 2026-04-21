import { readFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { config as loadDotenv } from 'dotenv';

loadDotenv();

const __dirname = dirname(fileURLToPath(import.meta.url));
const CONFIG_PATH = resolve(__dirname, '..', 'config.json');

function loadConfig() {
  let file = {};
  if (existsSync(CONFIG_PATH)) {
    file = JSON.parse(readFileSync(CONFIG_PATH, 'utf8'));
  }

  const workspacePath = process.env.STUDIO_WORKSPACE_PATH || file.workspace_path;

  if (!workspacePath) {
    process.stderr.write('[studio-mcp] ERROR: workspace_path not configured. Set STUDIO_WORKSPACE_PATH or add it to config.json\n');
    process.exit(1);
  }

  if (!existsSync(workspacePath)) {
    process.stderr.write(`[studio-mcp] ERROR: Workspace path does not exist: ${workspacePath}\n`);
    process.exit(1);
  }

  return {
    workspacePath: resolve(workspacePath),
    maxFileSizeKb: file.max_file_size_kb ?? 500,
    backupOnWrite: file.backup_on_write ?? true,
    excludedDirs: new Set(file.excluded_dirs ?? ['.git', '.settings', 'bin', 'build', 'node_modules', '.metadata', '.plugins']),
    excludedExtensions: new Set(file.excluded_extensions ?? ['.class', '.jar', '.zip', '.bak']),
  };
}

export const config = loadConfig();
