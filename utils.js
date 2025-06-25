import readline from 'readline/promises';
import os from 'os';
import fs from 'fs/promises';
import path from 'path';
import fetch from 'node-fetch';

const CONFIG_DIR = path.join(os.homedir(), '.gb9k');
const API_KEY_FILE = path.join(CONFIG_DIR, 'api_key');
const MODELS_CACHE_FILE = path.join(CONFIG_DIR, 'models_cache.json');
const MODELS_CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours in milliseconds

const VALID_EXTENSIONS = [
  '.js', '.ts', '.jsx', '.tsx',
  '.json', '.py', '.java', '.cpp',
  '.c', '.cs', '.rb', '.php', '.go', '.md', '.txt'
];

export async function fetchAndCacheModels(apiKey) {
  try {
    const response = await fetch('https://openrouter.ai/api/v1/models', {
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'HTTP-Referer': 'https://github.com/sosaysthecaptain/gb9k',
      }
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch models: ${response.status}`);
    }

    const responseData = await response.json();
    const models = responseData.data || [];

    // Only cache if we have valid model data
    if (Array.isArray(models) && models.length > 0) {
      const cacheData = {
        timestamp: Date.now(),
        models
      };
      await fs.writeFile(MODELS_CACHE_FILE, JSON.stringify(cacheData, null, 2));
      console.debug(`Cached ${models.length} models to ${MODELS_CACHE_FILE}`); // Debug log
      return models;
    } else {
      console.error('No valid models in API response; not caching.');
      return [];
    }
  } catch (error) {
    console.error('Error fetching models:', error.message);
    return [];
  }
}

export async function getModels(apiKey) {
  try {
    // Check if cache file exists
    const cacheExists = await fs.access(MODELS_CACHE_FILE)
      .then(() => true)
      .catch(() => false);

    if (cacheExists) {
      let cacheData;
      try {
        cacheData = JSON.parse(await fs.readFile(MODELS_CACHE_FILE, 'utf8'));
      } catch (error) {
        console.error('Invalid cache file; clearing cache:', error.message);
        await fs.unlink(MODELS_CACHE_FILE).catch(() => {}); // Remove invalid cache
        return await fetchAndCacheModels(apiKey); // Fetch fresh data
      }

      // Validate cache contents
      if (
        cacheData &&
        typeof cacheData === 'object' &&
        Array.isArray(cacheData.models) &&
        cacheData.models.length > 0 &&
        typeof cacheData.timestamp === 'number'
      ) {
        const cacheAge = Date.now() - cacheData.timestamp;
        if (cacheAge < MODELS_CACHE_TTL) {
          console.debug(`Using cached models (${cacheData.models.length} models, age: ${cacheAge / 1000}s)`); // Debug log
          return cacheData.models;
        }
      } else {
        console.error('Cache is invalid or empty; clearing cache.');
        await fs.unlink(MODELS_CACHE_FILE).catch(() => {}); // Remove invalid cache
      }
    }

    // No valid cache; fetch fresh data
    console.debug('No valid cache found; fetching fresh models.');
    return await fetchAndCacheModels(apiKey);
  } catch (error) {
    console.error('Error getting models:', error.message);
    return [];
  }
}

// Function to format pricing
export function formatPrice(price) {
  if (!price) return 'N/A';
  const pricePerToken = price * 1000; // Convert to price per 1K tokens
  return `$${pricePerToken.toFixed(3)}/1K`;
}

export async function ask_question(question, validResponses = null) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  let response;
  do {
    response = await rl.question(question + ' ');
    if (validResponses && !validResponses.includes(response.toLowerCase())) {
      console.log(`Please enter one of: ${validResponses.join(', ')}`);
    }
  } while (validResponses && !validResponses.includes(response.toLowerCase()));

  rl.close();
  return response;
}

export async function set_api_key(api_key) {
  if (!api_key || typeof api_key !== 'string') {
    console.log('No API key provided.');
    return;
  }

  // Ensure config directory exists
  try {
    await fs.mkdir(CONFIG_DIR, { recursive: true, mode: 0o755 });
  } catch (error) {
    throw new Error(`Failed to create config directory: ${error.message}`);
  }

  // Write API key to file
  await fs.writeFile(API_KEY_FILE, api_key, {
    mode: 0o600, // Read/write for owner only
    encoding: 'utf-8',
  });
  console.log('API key successfully set');
}

export async function get_api_key() {
  try {
    return await fs.readFile(API_KEY_FILE, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') {
      return null; // No API key set
    }
    throw new Error(`Failed to read API key: ${error.message}`);
  }
}

export async function prompt_user_for_api_key() {
  const existingKey = await get_api_key();
  if (existingKey) {
    const lastFour = existingKey.slice(-4);
    const overwrite = await ask_question(`API key ending in -${lastFour} already exists. Overwrite? (y/n): `, ['y', 'n']);
    if (overwrite.toLowerCase() === 'n') {
      console.log('Operation cancelled');
      return;
    }
  }
  const apiKey = await ask_question('Enter your API key: ');
  await set_api_key(apiKey);
}

export async function getAllCodeFiles(dir, specificPaths = null, excludePaths = new Set()) {
  let files = [];
  const normalizedExcludePaths = Array.from(excludePaths).map(p => path.resolve(p));

  if (specificPaths) {
    for (const sp of specificPaths) {
      const resolvedPath = path.resolve(sp);
      if (normalizedExcludePaths.includes(resolvedPath)) {
        continue;
      }

      const stat = await fs.stat(resolvedPath);
      if (stat.isDirectory()) {
        files.push(...await getAllCodeFiles(resolvedPath, null, excludePaths));
      } else if (stat.isFile() &&
        (VALID_EXTENSIONS.some(ext => resolvedPath.endsWith(ext)) ||
          path.basename(resolvedPath) === 'package.json') &&
        !path.basename(resolvedPath).startsWith('_PROMPT')) {
        files.push(resolvedPath);
      }
    }
    return files;
  }

  const items = await fs.readdir(dir, { withFileTypes: true });

  for (const item of items) {
    const fullPath = path.join(dir, item.name);

    if (normalizedExcludePaths.includes(fullPath)) {
      continue;
    }

    if (item.isDirectory() && (
      item.name === 'node_modules' ||
      item.name === '.git' ||
      item.name === 'dist' ||
      item.name === 'build'
    )) {
      continue;
    }

    if (item.isFile() && (
      item.name === 'package-lock.json' ||
      item.name === 'yarn.lock' ||
      item.name === '.gitignore' ||
      item.name.startsWith('_PROMPT')
    )) {
      continue;
    }

    if (item.isDirectory()) {
      files.push(...await getAllCodeFiles(fullPath, null, excludePaths));
    } else if (VALID_EXTENSIONS.some(ext => item.name.endsWith(ext)) ||
      item.name === 'package.json') {
      files.push(fullPath);
    }
  }

  return files;
}