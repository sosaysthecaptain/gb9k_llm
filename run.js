import fs from 'fs/promises';
import path from 'path';
import { get_api_key, getAllCodeFiles, getModels, formatPrice } from './utils.js';
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
const SYSTEM_MESSAGE = `You are a coding assistant. You will receive: (1) a list of relevant files, (2) the contents of those files, and (3) the user's prompt and subsequent conversation. Provide useful modifications to files in code blocks labeled with the file name after the opening triple backticks, and then the operation (<REWRITE>, <MODIFICATION>) (e.g., \`\`\`main.js <REWRITE>). Separate each code file modification with a line containing only three dashes (---).`;

function calculatePrice(promptTokens, completionTokens, model, models) {
  const modelInfo = models.find(m => m.id === model);
  if (!modelInfo || !modelInfo.pricing) {
    return null;
  }

  const promptCost = (modelInfo.pricing.prompt || 0) * promptTokens;
  const completionCost = (modelInfo.pricing.completion || 0) * completionTokens;
  return {
    promptCost,
    completionCost,
    totalCost: promptCost + completionCost,
    promptTokens,
    completionTokens,
    pricing: modelInfo.pricing
  };
}

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

  // Extract context
  const contextMatch = content.match(/### Context\n([\s\S]*?)(?=\n###|\n---|$)/);
  const contextFiles = contextMatch
    ? contextMatch[1]
        .split('\n')
        .map(line => line.trim().replace(/^- /, ''))
        .filter(line => line)
    : [];

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

  return { model, contextFiles, messages };
}

async function getFileContents(contextFiles) {
  if (contextFiles.length === 0) {
    return '';
  }

  // Resolve context file paths relative to current directory
  const specificPaths = contextFiles.map(file => path.resolve(process.cwd(), file));
  // Only exclude _PROMPT files, not the context files themselves
  const excludePaths = new Set();
  const files = await getAllCodeFiles(process.cwd(), specificPaths, excludePaths);

  if (files.length === 0) {
    console.warn('No valid code files found for the provided context.');
    return '';
  }

  const fileContents = await Promise.all(
    files.map(async file => {
      const relativePath = path.relative(process.cwd(), file);
      try {
        const content = await fs.readFile(file, 'utf8');
        return { relativePath, content };
      } catch (error) {
        console.warn(`Failed to read file ${relativePath}: ${error.message}`);
        return null;
      }
    })
  );

  // Filter out any failed reads
  return fileContents
    .filter(item => item !== null)
    .map(({ relativePath, content }) => `/* ~~~ ${relativePath} ~~~ */\n${content}`)
    .join('\n\n');
}

async function initializePromptFile(promptFile) {
  const originalContent = await fs.readFile(promptFile, 'utf8');
  // Ensure the file ends with ### LLM section for incremental updates
  if (!originalContent.includes('### LLM')) {
    await fs.appendFile(promptFile, '\n\n### LLM\n', { encoding: 'utf8' });
  }
}

async function appendToPromptFile(promptFile, content, isFinal = false) {
  // Append content to the ### LLM section
  await fs.appendFile(promptFile, content, { encoding: 'utf8' });
  if (isFinal) {
    // Add new ### User section after streaming is complete
    await fs.appendFile(promptFile, '\n\n### User\n<!-- Enter your next prompt here, then execute `gb9k run` -->', { encoding: 'utf8' });
  }
}

export async function listModels() {
  const apiKey = await get_api_key();
  if (!apiKey) {
    console.error('API key not set. Please run `gb9k set_api_key` first.');
    process.exit(1);
  }

  const models = await getModels(apiKey);
  if (!Array.isArray(models) || models.length === 0) {
    console.error('No models available or invalid response from API.');
    process.exit(1);
  }

  // Sort models by their likely code capability
  const modelPriority = {
    'claude-3': 1,
    'gemini-2': 2,
    'gemini-pro': 2,
    'gpt-4': 3,
    'claude-2': 4,
    'mixtral': 5,
    'llama': 6
  };

  const sortedModels = models.sort((a, b) => {
    const getPriority = (model) => {
      if (!model || !model.id) return 999;
      for (const [key, priority] of Object.entries(modelPriority)) {
        if (model.id.toLowerCase().includes(key)) return priority;
      }
      return 999;
    };
    return getPriority(a) - getPriority(b);
  });

  console.log('\nAvailable Models (sorted by estimated code capability):');
  console.log('========================================================================================');
  console.log('Model ID                                                  Input Price       Output Price          ');
  console.log('========================================================================================');

  for (const model of sortedModels) {
    const inputPrice = formatPrice(model.pricing?.prompt);
    const outputPrice = formatPrice(model.pricing?.completion);
    console.log(
      `${model.id.padEnd(50)}        ${inputPrice.padEnd(10)}        ${outputPrice.padEnd(30)}`
    );
  }
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

  let model, contextFiles, messages;
  try {
    ({ model, contextFiles, messages } = await parsePromptFile(promptFile));
  } catch (error) {
    console.error(`Error parsing prompt file: ${error.message}`);
    process.exit(1);
  }

  if (messages.length === 0) {
    console.error('No valid conversation messages found in the prompt file.');
    process.exit(1);
  }

  await initializePromptFile(promptFile);

  const apiMessages = [
    { role: 'system', content: SYSTEM_MESSAGE },
    { role: 'user', content: `Relevant files:\n${contextFiles.length > 0 ? contextFiles.join('\n') : 'None'}` },
  ];

  if (contextFiles.length > 0) {
    const fileContents = await getFileContents(contextFiles);
    if (fileContents) {
      apiMessages.push({ role: 'user', content: `File contents:\n${fileContents}` });
    }
  }

  apiMessages.push(...messages);

  // Fetch models for pricing information
  const models = await getModels(apiKey);

  const headers = {
    'Authorization': `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
    'HTTP-Referer': 'https://github.com/sosaysthecaptain/gb9k',
    'X-Title': 'gb9k',
  };

  const body = JSON.stringify({
    model,
    messages: apiMessages,
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

    let responseText = '';
    let promptTokens = 0;
    let completionTokens = 0;

    for await (const chunk of response.body) {
      const lines = chunk.toString('utf8').split('\n').filter(line => line.trim());
      for (const line of lines) {
        if (line.startsWith('data: ')) {
          const data = line.slice(6);
          if (data === '[DONE]') {
            await appendToPromptFile(promptFile, '', true);
            break;
          }
          try {
            const parsed = JSON.parse(data);
            const content = parsed.choices[0]?.delta?.content;
            if (content) {
              responseText += content;
              await appendToPromptFile(promptFile, content);
            }
            // Update token counts if available in the response
            if (parsed.usage) {
              promptTokens = parsed.usage.prompt_tokens || 0;
              completionTokens = parsed.usage.completion_tokens || 0;
            }
          } catch (error) {
            console.error('Error parsing stream chunk:', error.message);
          }
        }
      }
    }

    // If token counts weren't provided, estimate them
    if (!promptTokens) {
      promptTokens = Math.ceil(apiMessages.reduce((acc, msg) => acc + msg.content.length / 4, 0));
    }
    if (!completionTokens) {
      completionTokens = Math.ceil(responseText.length / 4);
    }

    const pricing = calculatePrice(promptTokens, completionTokens, model, models);
    if (pricing) {
      console.log('\nUsage Statistics:');
      console.log(`Input tokens: ${pricing.promptTokens.toLocaleString()}`);
      console.log(`Output tokens: ${pricing.completionTokens.toLocaleString()}`);
      console.log(`\nEstimated Costs:`);
      console.log(`Input: $${pricing.promptCost.toFixed(4)}`);
      console.log(`Output: $${pricing.completionCost.toFixed(4)}`);
      console.log(`Total: $${pricing.totalCost.toFixed(4)}`);
    }

  } catch (error) {
    console.error('Error during API call:', error.message);
    process.exit(1);
  }
}