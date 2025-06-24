import fs from 'fs/promises';
import { get_api_key } from './utils.js';
import fetch from 'node-fetch';

const OPENROUTER_API_URL = 'https://openrouter.ai/api/v1/chat/completions';
const DEFAULT_MODEL = 'anthropic/claude-3.5-sonnet';
const DEMO_PROMPT = 'Explain the basics of quantum computing in simple terms.';

async function extractUserPrompt() {
  try {
    const content = await fs.readFile('_PROMPT.md', 'utf8');
    const userSectionMatch = content.match(/### User\n([\s\S]*)/);
    if (userSectionMatch && userSectionMatch[1].trim() && !userSectionMatch[1].trim().startsWith('<!--')) {
      return userSectionMatch[1].trim();
    }
    console.log('No user prompt found in _PROMPT.md, using demo prompt.');
    return DEMO_PROMPT;
  } catch (error) {
    if (error.code === 'ENOENT') {
      console.log('_PROMPT.md not found, using demo prompt.');
      return DEMO_PROMPT;
    }
    throw new Error(`Failed to read _PROMPT.md: ${error.message}`);
  }
}

export async function runPrompt() {
  const apiKey = await get_api_key();
  if (!apiKey) {
    console.error('API key not set. Please run `gb9k set_api_key` first.');
    process.exit(1);
  }

  const prompt = await extractUserPrompt();

  const headers = {
    'Authorization': `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
    'HTTP-Referer': 'https://github.com/sosaysthecaptain/gb9k',
    'X-Title': 'gb9k',
  };

  const body = JSON.stringify({
    model: DEFAULT_MODEL,
    messages: [{ role: 'user', content: prompt }],
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