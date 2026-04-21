import { readdir, readFile, stat, writeFile, copyFile } from 'fs/promises';
import { existsSync } from 'fs';
import { resolve, join, relative, extname, basename } from 'path';
import { config } from './config.mjs';

const INTEGRATION_EXTENSIONS = new Set(['.xsl', '.xslt', '.xml', '.wsdl', '.xsd']);

export function resolveSafe(projectName, filePath) {
  const projectRoot = resolve(config.workspacePath, projectName);
  const absolute = resolve(projectRoot, filePath);
  if (!absolute.startsWith(config.workspacePath + '/') && absolute !== config.workspacePath) {
    const err = new Error(`Path traversal detected: ${filePath}`);
    err.code = 'PATH_TRAVERSAL_DETECTED';
    throw err;
  }
  return { absolute, projectRoot };
}

export async function findProject(projectName) {
  const projectPath = resolve(config.workspacePath, projectName);
  if (!existsSync(projectPath)) {
    return null;
  }
  const s = await stat(projectPath);
  return s.isDirectory() ? projectPath : null;
}

export async function listProjects() {
  const entries = await readdir(config.workspacePath, { withFileTypes: true });
  const projects = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (config.excludedDirs.has(entry.name)) continue;
    if (entry.name.startsWith('.')) continue;

    const projectPath = join(config.workspacePath, entry.name);
    const isStudio = existsSync(join(projectPath, '.project')) || existsSync(join(projectPath, 'ws', 'WSAR-INF'));

    if (!isStudio) continue;

    const projectStat = await stat(projectPath);
    let transformCount = 0;

    const wsarPath = join(projectPath, 'ws', 'WSAR-INF');
    if (existsSync(wsarPath)) {
      transformCount = await countTransforms(wsarPath);
    }

    projects.push({
      name: entry.name,
      path: projectPath,
      last_modified: projectStat.mtime.toISOString(),
      transform_count: transformCount,
    });
  }

  return projects.sort((a, b) => a.name.localeCompare(b.name));
}

async function countTransforms(dir) {
  let count = 0;
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
  for (const e of entries) {
    const ext = extname(e.name).toLowerCase();
    if (e.isFile() && (ext === '.xsl' || ext === '.xslt')) count++;
  }
  return count;
}

export async function walkDir(dirPath, { maxDepth = 10, currentDepth = 0, fileTypeFilter = null } = {}) {
  if (currentDepth > maxDepth) return [];

  const entries = await readdir(dirPath, { withFileTypes: true }).catch(() => []);
  const results = [];

  for (const entry of entries) {
    if (entry.name.startsWith('.') && entry.isDirectory()) continue;
    if (config.excludedDirs.has(entry.name)) continue;

    const fullPath = join(dirPath, entry.name);
    const ext = extname(entry.name).toLowerCase();

    if (entry.isDirectory()) {
      const children = await walkDir(fullPath, { maxDepth, currentDepth: currentDepth + 1, fileTypeFilter });
      results.push(...children);
    } else {
      if (config.excludedExtensions.has(ext)) continue;
      if (fileTypeFilter && !matchesFileType(ext, fileTypeFilter)) continue;
      results.push(fullPath);
    }
  }

  return results;
}

function matchesFileType(ext, fileType) {
  if (fileType === 'all') return INTEGRATION_EXTENSIONS.has(ext);
  if (fileType === 'xsl') return ext === '.xsl' || ext === '.xslt';
  if (fileType === 'xml') return ext === '.xml';
  return INTEGRATION_EXTENSIONS.has(ext);
}

export async function readFileSafe(absolute) {
  const maxBytes = config.maxFileSizeKb * 1024;
  const s = await stat(absolute);
  if (s.size > maxBytes) {
    const err = new Error(`File exceeds max size of ${config.maxFileSizeKb}KB (${Math.round(s.size / 1024)}KB)`);
    err.code = 'FILE_TOO_LARGE';
    throw err;
  }
  const content = await readFile(absolute, 'utf8');
  return { content, size_bytes: s.size, last_modified: s.mtime.toISOString() };
}

export async function writeFileSafe(absolute, content, createBackup) {
  const backupPath = absolute + '.bak';

  if (createBackup && existsSync(absolute)) {
    await copyFile(absolute, backupPath);
  }

  await writeFile(absolute, content, 'utf8');
  return {
    bytes_written: Buffer.byteLength(content, 'utf8'),
    backup_path: createBackup && existsSync(absolute) ? backupPath : null,
  };
}

export function relativeFromProject(projectRoot, absolutePath) {
  return relative(projectRoot, absolutePath);
}

export { extname, basename };
