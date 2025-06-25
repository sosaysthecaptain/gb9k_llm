<!--
Enter your prompt at the bottom, then execute `gb9k run`
When done, run `gb9k cleanup` to delete this file
-->

### Model
anthropic/claude-3.5-sonnet

### Context
- README.md
- main.js
- package.json
- run.js
- utils.js

-----------

### User
I wanna add a command, `gb9k models`, which gets a list of models, prioritizing big flagship ones good at code, like Gemini 2.5, claude 3.5, grok, etc. It should list one line each, including prices. Is there an endpoint that can provide us with this? If so, we should store it in a file wherever we're storing the key. If not, explain to me your recommended course of action.

### LLM
OpenRouter provides an endpoint `/api/v1/models` that can give us real-time model information, including pricing. Let's implement this feature by modifying the relevant files.

```main.js
// Add to the showHelp() function:
  models            Lists available models sorted by capability, with pricing
```

```utils.js
import fetch from 'node-fetch';

const CONFIG_DIR = path.join(os.homedir(), '.gb9k');
const API_KEY_FILE = path.join(CONFIG_DIR, 'api_key');
const MODELS_CACHE_FILE = path.join(CONFIG_DIR, 'models_cache.json');
const MODELS_CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours in milliseconds

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

    const models = await response.json();
    const cacheData = {
      timestamp: Date.now(),
      models
    };

    await fs.writeFile(MODELS_CACHE_FILE, JSON.stringify(cacheData, null, 2));
    return models;
  } catch (error) {
    console.error('Error fetching models:', error.message);
    return null;
  }
}

export async function getModels(apiKey) {
  try {
    // Try to read from cache first
    const cacheExists = await fs.access(MODELS_CACHE_FILE)
      .then(() => true)
      .catch(() => false);

    if (cacheExists) {
      const cacheData = JSON.parse(await fs.readFile(MODELS_CACHE_FILE, 'utf8'));
      const cacheAge = Date.now() - cacheData.timestamp;

      if (cacheAge < MODELS_CACHE_TTL) {
        return cacheData.models;
      }
    }

    // Cache doesn't exist or is too old, fetch fresh data
    return await fetchAndCacheModels(apiKey);
  } catch (error) {
    console.error('Error getting models:', error.message);
    return null;
  }
}

// Function to format pricing
export function formatPrice(price) {
  if (!price) return 'N/A';
  const pricePerToken = price * 1000; // Convert to price per 1K tokens
  return `$${pricePerToken.toFixed(3)}/1K`;
}
```

```run.js
// Add this function to run.js
export async function listModels() {
  const apiKey = await get_api_key();
  if (!apiKey) {
    console.error('API key not set. Please run `gb9k set_api_key` first.');
    process.exit(1);
  }

  const models = await getModels(apiKey);
  if (!models) {
    console.error('Failed to fetch models information.');
    process.exit(1);
  }

  // Sort models by their likely code capability
  const modelPriority = {
    'claude-3': 1,
    'gemini-2': 2,
    'gpt-4': 3,
    'claude-2': 4,
    'mixtral': 5,
    'llama': 6
  };

  const sortedModels = models.sort((a, b) => {
    const getPriority = (model) => {
      for (const [key, priority] of Object.entries(modelPriority)) {
        if (model.id.toLowerCase().includes(key)) return priority;
      }
      return 999;
    };
    return getPriority(a) - getPriority(b);
  });

  console.log('\nAvailable Models (sorted by estimated code capability):');
  console.log('------------------------------------------------');
  console.log('Model ID                    Input Price    Output Price');
  console.log('------------------------------------------------');

  for (const model of sortedModels) {
    const inputPrice = formatPrice(model.pricing?.input);
    const outputPrice = formatPrice(model.pricing?.output);
    console.log(
      `${model.id.padEnd(26)} ${inputPrice.padEnd(14)} ${outputPrice}`
    );
  }
}
```

```main.js
// Add to the command handling in main()
    if (command === 'models') {
      await listModels();
      return;
    }
```

This implementation:

1. Adds a new `models` command that fetches and displays available models from OpenRouter
2. Caches the results for 24 hours to avoid unnecessary API calls
3. Sorts models by their likely code capability (prioritizing newer, more capable models)
4. Shows pricing per 1K tokens for both input and output
5. Stores the cache in the same directory as the API key

To use it, users would run:
```bash
gb9k models
```

The output would look something like:
```
Available Models (sorted by estimated code capability):
------------------------------------------------
Model ID                    Input Price    Output Price
------------------------------------------------
anthropic/claude-3-opus     $0.015/1K     $0.075/1K
google/gemini-2.5-pro      $0.005/1K     $0.015/1K
openai/gpt-4-turbo         $0.010/1K     $0.030/1K
anthropic/claude-2         $0.008/1K     $0.024/1K
mistral/mixtral-8x7b       $0.002/1K     $0.006/1K
...
```

This approach gives users up-to-date information about available models and their pricing, while being efficient with API usage through caching. The sorting helps users quickly find the most capable models for coding tasks.

### User
<!-- Enter your next prompt here, then execute `gb9k run` -->