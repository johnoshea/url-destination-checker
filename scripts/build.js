#!/usr/bin/env node
// Build the ViolentMonkey userscript by concatenating src/ modules.
//
// Strips ES module `import` and `export` syntax. The resulting body is
// wrapped in an IIFE and prefixed with the userscript metadata block.

import { readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, "..");

// Order matters: dependencies first.
const SOURCES = [
  "src/config.js",
  "src/parsing.js",
  "src/classifier.js",
  "src/cache.js",
  "src/resolver.js",
  "src/tooltip.js",
  "src/hover.js",
  "src/main.js",
];

const HEADER = `// ==UserScript==
// @name         URL Destination Checker
// @namespace    https://github.com/johno/url_destination_checker
// @version      0.1.0
// @description  Hover a shortener or YouTube link to see its destination URL and page title.
// @match        *://*/*
// @run-at       document-idle
// @grant        GM_xmlhttpRequest
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_addStyle
// @noframes
// ==/UserScript==
`;

function stripModuleSyntax(src) {
  // Remove import statements (single-line or multi-line up to the closing semicolon).
  // Uses non-greedy [\s\S]*? so it stops at the first ; on its own line rather than
  // consuming the entire file when multiple imports exist.
  let out = src.replace(/^import\b[\s\S]*?;\s*$/gm, "");
  // Strip leading `export ` from declarations.
  out = out.replace(/^\s*export\s+(const|let|var|function|class|async\s+function)/gm, "$1");
  return out;
}

function buildBody() {
  const parts = [];
  for (const rel of SOURCES) {
    const src = readFileSync(join(repoRoot, rel), "utf8");
    parts.push(`// ===== ${rel} =====`);
    parts.push(stripModuleSyntax(src));
  }
  return parts.join("\n\n");
}

const body = buildBody();
const out = `${HEADER}\n(function () {\n"use strict";\n\n${body}\n\n})();\n`;

const outPath = join(repoRoot, "url-destination-checker.user.js");
writeFileSync(outPath, out, "utf8");
console.log(`built ${outPath} (${out.length} bytes)`);
