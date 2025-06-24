import readline from 'readline/promises';
import os from 'os';
import fs from 'fs/promises';
import path from 'path';

const CONFIG_DIR = path.join(os.homedir(), '.gb9k');
const API_KEY_FILE = path.join(CONFIG_DIR, 'api_key');

export async function ask_question(question, validResponses = null) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  let response;
  do {
    response = await rl.question(question + ' ');
    if (validResponses && !validResponses.includes(response.toLowerCase())) {
      console.log(`Please enter one of: ${validResponses.join(', ')}}`);
    }
  } while (validResponses && !validResponses.includes(response.toLowerCase()));

  rl.close();
  return response;
}

export async function set_api_key(api_key) {
  if (!api_key || typeof api_key !== 'string') {
    console.log('API key cleared');
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