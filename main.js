#!/usr/bin/env node

import fs from 'fs/promises';
import path from 'path';
const { default: clipboardy } = await import('clipboardy');

const VALID_EXTENSIONS = [
	'.js', '.ts', '.jsx', '.tsx',
	'.json', '.py', '.java', '.cpp',
	'.c', '.cs', '.rb', '.php', '.go', '.md', '.txt'
];

async function getAllCodeFiles(dir, specificPaths = null, excludePaths = new Set()) {
	let files = [];

	// Normalize exclude paths to absolute paths and resolve them
	const normalizedExcludePaths = Array.from(excludePaths).map(p => path.resolve(p));

	// If specific paths are provided, process them (they can be files or directories)
	if (specificPaths) {
		for (const sp of specificPaths) {
			const resolvedPath = path.resolve(sp);
			// Skip if this path is in the exclude list
			if (normalizedExcludePaths.includes(resolvedPath)) {
				continue;
			}

			const stat = await fs.stat(resolvedPath);
			if (stat.isDirectory()) {
				files.push(...await getAllCodeFiles(resolvedPath, null, excludePaths));
			} else if (stat.isFile() &&
			(VALID_EXTENSIONS.some(ext => resolvedPath.endsWith(ext)) ||
			path.basename(resolvedPath) === 'package.json')) {
				files.push(resolvedPath);
			}
		}
		return files;
	}

	// Otherwise, recursively process the directory
	const items = await fs.readdir(dir, { withFileTypes: true });

	for (const item of items) {
		const fullPath = path.join(dir, item.name);

		// Skip if this path is in the exclude list
		if (normalizedExcludePaths.includes(fullPath)) {
			continue;
		}

		// Skip unwanted directories by default
		if (item.isDirectory() && (
			item.name === 'node_modules' ||
			item.name === '.git' ||
			item.name === 'dist' ||
			item.name === 'build'
		)) {
			continue;
		}

		// Skip specific unwanted files by default
		if (item.isFile() && (
			item.name === 'package-lock.json' ||
			item.name === 'yarn.lock' ||
			item.name === '.gitignore'
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

function countLines(text) {
	return text.split('\n').length;
}

// Rough token estimation: 1 token ≈ 4 characters (common heuristic for code)
function estimateTokens(text) {
	return Math.round(text.length / 4);
}

// Format numbers with k, m suffixes
function formatNumber(num) {
	if (num >= 1000000) return (num / 1000000).toFixed(1) + 'm';
	if (num >= 1000) return (num / 1000).toFixed(1) + 'k';
	return num;
}

function showHelp() {
	console.log(`
Usage: gb9k [options] [path1 path2 ...]

Concatenates code files into a single prompt, separated by file paths, and copies to clipboard.
Optionally writes to a specified file if --file is provided with a filename.

Options:
  --help            Show this help message and exit
  --file <filename> Write the output to the specified file in addition to copying to clipboard
  --exclude path1 [path2 ...]
                    Exclude specified files or directories from processing

Arguments:
  path1 path2 ...   Specific files or directories to include (if provided, only these are processed)

Examples:
  gb9k                        # Process all code files in current directory and subdirectories
  gb9k --file output.txt      # Same as above, but also write to output.txt
  gb9k src/file1.js src/dir   # Process only specified file and directory
  gb9k --exclude src/dir2     # Process all files except those in src/dir2
  gb9k --file custom.txt --exclude file1.js src/dir2 src/file2.js
                                     # Process file2.js, exclude file1.js and dir2, and write to custom.txt
    `);
	}

	async function main() {
		try {
			const args = process.argv.slice(2);

			// Check for --help flag
			if (args.includes('--help')) {
				showHelp();
				return;
			}

			// Handle --file flag and collect the filename
			let outputFile = null;
			let fileNext = false;
			const remainingArgsAfterFile = args.filter(arg => {
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

			// Handle --exclude flag and collect paths to exclude
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

			const files = await getAllCodeFiles(process.cwd(), specificPaths.length > 0 ? specificPaths : null, excludePaths);

			if (files.length === 0) {
				console.log('No code files found');
				return;
			}

			// Process files and collect stats
			const fileContents = await Promise.all(
				files.map(async file => {
					const relativePath = path.relative(process.cwd(), file);
					const content = await fs.readFile(file, 'utf8');
					return { relativePath, content };
				})
			);

			// Concatenate contents with separators
			const result = fileContents
			.map(({ relativePath, content }) => `/* ~~~ ${relativePath} ~~~ */\n${content}`)
			.join('\n\n');

			// Calculate stats
			const fileCount = files.length;
			const lineCount = countLines(result);
			const tokenCount = estimateTokens(result);

			// Copy to clipboard first
			await clipboardy.write(result);
			console.log('Content copied to clipboard');

			// Log included files
			console.log('\nIncluded files:');
			fileContents.forEach(({ relativePath }) => {
				console.log(`- ${relativePath}`);
			});

			// Log stats with formatted numbers
			console.log('\nStats:');
			console.log(`- Number of files: ${formatNumber(fileCount)}`);
			console.log(`- Number of lines: ${formatNumber(lineCount)}`);
			console.log(`- Estimated tokens: ${formatNumber(tokenCount)}`);

			// Write to file if --file flag was provided with a filename
			if (outputFile) {
				await fs.writeFile(outputFile, result);
				console.log(`Content written to ${outputFile}`);
			}

		} catch (error) {
			console.error('Error:', error);
			process.exit(1);
		}
	}

	main();