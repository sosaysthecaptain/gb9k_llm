#!/usr/bin/env node

import fs from 'fs/promises';
import path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';
import { prompt_user_for_api_key, getAllCodeFiles } from './utils.js';
import { runPrompt, listModels } from './run.js';
const execAsync = promisify(exec);
const { default: clipboardy } = await import('clipboardy');

function countLines(text) {
  return text.split('\n').length;
}

function estimateTokens(text) {
  return Math.round(text.length / 4);
}

function formatNumber(num) {
  if (num >= 1000000) return (num / 1000000).toFixed(1) + 'm';
  if (num >= 1000) return (num / 1000).toFixed(1) + 'k';
  return num;
}

function showHelp() {
  console.log(`
Usage: gb9k [command] [options] [path1 path2 ...]

Commands:
  copy              Concatenates code files and copies to clipboard without writing to any file
  cleanup           Deletes all markdown files starting with _PROMPT
  run               Sends the user prompt from _PROMPT.md to OpenRouter and streams the response
	models            Lists available models sorted by capability, with pricing
  set_api_key       Sets or updates the API key for the tool
  (default)         Concatenates code files, copies to clipboard, writes to _PROMPT.md, and opens in VS Code

Options:
  --help            Show this help message and exit
  --file <filename> Write the output to the specified file (only for default command)
  --exclude path1 [path2 ...]
                    Exclude specified files or directories from processing

Arguments:
  path1 path2 ...   Specific files or directories to include (if provided, only these are processed)

Examples:
  gb9k copy                   # Copy code files to clipboard without writing
  gb9k cleanup                # Delete all _PROMPT*.md files
  gb9k run                    # Run the prompt in _PROMPT.md via OpenRouter
  gb9k set_api_key            # Set or update the API key
  gb9k                        # Default: process files, copy to clipboard, write to _PROMPT.md
  gb9k --file output.txt      # Default with writing to output.txt
  gb9k --exclude src/dir2     # Default but exclude src/dir2
    `);
}

async function cleanupPromptFiles() {
  const items = await fs.readdir(process.cwd(), { withFileTypes: true });
  for (const item of items) {
    if (item.isFile() && item.name.startsWith('_PROMPT') && item.name.endsWith('.md')) {
      const fullPath = path.join(process.cwd(), item.name);
      await fs.unlink(fullPath);
      console.log(`Deleted ${item.name}`);
    }
  }
  console.log('Cleanup complete');
}

async function processFiles(specificPaths, excludePaths) {
  const files = await getAllCodeFiles(process.cwd(), specificPaths.length > 0 ? specificPaths : null, excludePaths);

  if (files.length === 0) {
    console.log('No code files found');
    return null;
  }

  const fileContents = await Promise.all(
    files.map(async file => {
      const relativePath = path.relative(process.cwd(), file);
      const content = await fs.readFile(file, 'utf8');
      return { relativePath, content };
    })
  );

  const result = fileContents
    .map(({ relativePath, content }) => `/* ~~~ ${relativePath} ~~~ */\n${content}`)
    .join('\n\n');

  const fileCount = files.length;
  const lineCount = countLines(result);
  const tokenCount = estimateTokens(result);

  console.log('\nIncluded files:');
  fileContents.forEach(({ relativePath }) => {
    console.log(`- ${relativePath}`);
  });

  console.log('\nStats:');
  console.log(`- Number of files: ${formatNumber(fileCount)}`);
  console.log(`- Number of lines: ${formatNumber(lineCount)}`);
  console.log(`- Estimated tokens: ${formatNumber(tokenCount)}`);

  return { result, fileContents };
}

async function main() {
  try {
    const args = process.argv.slice(2);

    if (args.includes('--help')) {
      showHelp();
      return;
    }

    const command = args[0] && !args[0].startsWith('--') ? args[0] : null;
    const argsWithoutCommand = command ? args.slice(1) : args;

    if (command === 'run') {
      await runPrompt();
      return;
    }

    if (command === 'cleanup') {
      await cleanupPromptFiles();
      return;
    }

    if (command === 'set_api_key') {
      await prompt_user_for_api_key();
      return;
    }

		if (command === 'models') {
      await listModels();
      return;
    }

    let outputFile = null;
    let fileNext = false;
    const remainingArgsAfterFile = argsWithoutCommand.filter(arg => {
      if (arg === '--file') {
        fileNext = true;
        return false;
      }
      if (fileNext) {
        if (arg.startsWith('--')) {
          fileNext = false;
          return true;
        }
        outputFile = arg;
        return false;
      }
      return true;
    });

    let excludePaths = new Set();
    let excludeNext = false;
    const remainingArgs = remainingArgsAfterFile.filter(arg => {
      if (arg === '--exclude') {
        excludeNext = true;
        return false;
      }
      if (excludeNext) {
        if (arg.startsWith('--')) {
          excludeNext = false;
          return true;
        }
        excludePaths.add(arg);
        return false;
      }
      return true;
    });

    const specificPaths = remainingArgs
      .map(p => path.resolve(p))
      .filter(p => !excludePaths.has(p));

    const processed = await processFiles(specificPaths, excludePaths);
    if (!processed) {
      return;
    }
    const { result, fileContents } = processed;

    await clipboardy.write(result);
    console.log('Content copied to clipboard');

    if (command === 'copy') {
      return;
    }

    const fileList = fileContents.map(({ relativePath }) => `- ${relativePath}`).join('\n');
    const promptContent = `<!--
Enter your prompt at the bottom, then execute \`gb9k run\`
When done, run \`gb9k cleanup\` to delete this file
-->

### Model
anthropic/claude-3.5-sonnet

### Context
${fileList}

-----------

### User
`;
    await fs.writeFile('_PROMPT.md', promptContent);
    console.log('Content written to _PROMPT.md');

    if (outputFile) {
      await fs.writeFile(outputFile, result);
      console.log(`Content written to ${outputFile}`);
    }

    try {
      await execAsync('code _PROMPT.md');
      console.log('Opened _PROMPT.md in VS Code');
    } catch (error) {
      console.error('Error opening _PROMPT.md in VS Code:', error.message);
    }

  } catch (error) {
    console.error('Error:', error.message);
    process.exit(1);
  }
}

main();