import fs from 'fs/promises';
import path from 'path';
import { get_api_key } from './utils.js';
import fetch from 'node-fetch';

const OPENROUTER_API_URL = 'https://openrouter.ai/api/v1/chat/completions';
const VALID_MODELS = [
  'anthropic/claude-3.5-sonnet',
  'meta-llama/llama-3.1-405b-instruct',
  'openai/gpt-4o',
  'mistral/mixtral-8x22b-instruct',
  'google/gemini-pro-1.5',
  'meta-llama/llama-4-maverick',
  'meta-llama/llama-3-70b-instruct',
  'mistral/mistral-small-3.1',
  'openrouter/optimus-alpha',
  'cloudflare/gemma-7b',
  'cloudflare/llama-3.3-70b',
  'cloudflare/llama-3.1-70b',
  'cloudflare/deepseek-r1-distill-qwen-32b',
  'openrouter/auto',
];
const DEFAULT_MODEL = 'anthropic/claude-3.5-sonnet';
const SYSTEM_MESSAGE = 'You are a helpful AI assistant designed to provide accurate and concise answers based on the provided conversation and context.';

async function findPromptFile() {
  const items = await fs.readdir(process.cwd(), { withFileTypes: true });
  for (const item of items) {
    if (item.isFile() && item.name.startsWith('_PROMPT') && item.name.endsWith('.md')) {
      return path.join(process.cwd(), item.name);
    }
  }
  throw new Error('No markdown file starting with _PROMPT found in the current directory.');
}

async function parsePromptFile(filePath) {
  const content = await fs.readFile(filePath, 'utf8');

  // Extract model
  const modelMatch = content.match(/### Model\n([\s\S]*?)(?=\n###|\n---|$)/);
  let model = modelMatch ? modelMatch[1].trim() : DEFAULT_MODEL;
  if (!VALID_MODELS.includes(model)) {
    console.warn(`Invalid model ID: ${model}. Falling back to ${DEFAULT_MODEL}. Valid models are: ${VALID_MODELS.join(', ')}`);
    model = DEFAULT_MODEL;
  }

  // Extract conversation after ---
  const conversationMatch = content.match(/---\n([\s\S]*)$/);
  if (!conversationMatch) {
    throw new Error('No conversation section found after --- in the prompt file.');
  }

  const conversationText = conversationMatch[1];
  const messages = [];
  const messageRegex = /(### (User|LLM)\n([\s\S]*?))(?=### (User|LLM)\n|$)/g;
  let match;

  while ((match = messageRegex.exec(conversationText)) !== null) {
    const role = match[2].toLowerCase() === 'user' ? 'user' : 'assistant';
    const content = match[3].trim();
    if (content) {
      messages.push({ role, content });
    }
  }

  return { model, messages };
}

export async function runPrompt() {
  const apiKey = await get_api_key();
  if (!apiKey) {
    console.error('API key not set. Please run `gb9k set_api_key` first.');
    process.exit(1);
  }

  let promptFile;
  try {
    promptFile = await findPromptFile();
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }

  let model, messages;
  try {
    ({ model, messages } = await parsePromptFile(promptFile));
  } catch (error) {
    console.error(`Error parsing prompt file: ${error.message}`);
    process.exit(1);
  }

  if (messages.length === 0) {
    console.error('No valid conversation messages found in the prompt file.');
    process.exit(1);
  }

  const headers = {
    'Authorization': `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
    'HTTP-Referer': 'https://github.com/sosaysthecaptain/gb9k',
    'X-Title': 'gb9k',
  };

  const body = JSON.stringify({
    model,
    messages: [{ role: 'system', content: SYSTEM_MESSAGE }, ...messages],
    stream: true,
  });

  try {
    const response = await fetch(OPENROUTER_API_URL, {
      method: 'POST',
      headers,
      body,
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`OpenRouter API error: ${response.status} ${errorText}`);
    }

    console.log('Streaming response from OpenRouter:');
    for await (const chunk of response.body) {
      const lines = chunk.toString('utf8').split('\n').filter(line => line.trim());
      for (const line of lines) {
        if (line.startsWith('data: ')) {
          const data = line.slice(6);
          if (data === '[DONE]') {
            console.log('\nStreaming complete.');
            break;
          }
          try {
            const parsed = JSON.parse(data);
            const content = parsed.choices[0]?.delta?.content;
            if (content) {
              process.stdout.write(content);
            }
          } catch (error) {
            console.error('Error parsing stream chunk:', error.message);
          }
        }
      }
    }
  } catch (error) {
    console.error('Error during API call:', error.message);
    process.exit(1);
  }
}