#!/usr/bin/env node

import { readFile } from "node:fs/promises";

const API_ENDPOINT = "https://api.typesafe.ai/v1/systemone";
const API_TIMEOUT_MS = 10_000;
const DEFAULT_MODEL = "jev-latest";

function printUsage(stream = process.stdout) {
  stream.write(`Usage: node scripts/evaluate.mjs [request.json | -]

Reads a TypeSafe System One request from a file or stdin.
Requires TYPESAFE_API_KEY in the environment.
`);
}

function fail(message) {
  throw new Error(message);
}

async function readRequestSource(argument) {
  if (argument && argument !== "-") {
    try {
      return await readFile(argument, "utf8");
    } catch (error) {
      fail(`Cannot read request file "${argument}": ${error.message}`);
    }
  }

  if (process.stdin.isTTY) {
    fail("Provide a request file or pipe request JSON through stdin.");
  }

  process.stdin.setEncoding("utf8");
  let source = "";
  for await (const chunk of process.stdin) {
    source += chunk;
  }
  return source;
}

function parseRequest(source) {
  let request;

  try {
    request = JSON.parse(source);
  } catch (error) {
    fail(`Request is not valid JSON: ${error.message}`);
  }

  if (request === null || typeof request !== "object" || Array.isArray(request)) {
    fail("Request must be a JSON object.");
  }

  if (!Object.hasOwn(request, "state")) {
    fail('Request must contain a "state" field.');
  }

  const { questions } = request;
  if (
    questions === null ||
    typeof questions !== "object" ||
    Array.isArray(questions) ||
    Object.keys(questions).length === 0
  ) {
    fail('Request must contain a non-empty "questions" object.');
  }

  return {
    ...request,
    model: request.model ?? DEFAULT_MODEL,
  };
}

async function evaluate(request, apiKey) {
  let response;

  try {
    response = await fetch(API_ENDPOINT, {
      method: "POST",
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(request),
      signal: AbortSignal.timeout(API_TIMEOUT_MS),
    });
  } catch (error) {
    if (error.name === "TimeoutError") {
      fail(`TypeSafe API request timed out after ${API_TIMEOUT_MS} ms.`);
    }
    fail(`TypeSafe API request failed: ${error.message}`);
  }

  if (!response.ok) {
    await response.body?.cancel();
    fail(`TypeSafe API returned HTTP ${response.status}. Response body omitted to protect request data.`);
  }

  const body = await response.text();
  try {
    return JSON.parse(body);
  } catch (error) {
    fail(`TypeSafe API returned invalid JSON: ${error.message}`);
  }
}

async function main() {
  const nodeMajor = Number.parseInt(process.versions.node.split(".")[0], 10);
  if (nodeMajor < 20) {
    fail(`Node.js 20 or newer is required; found ${process.versions.node}.`);
  }

  const args = process.argv.slice(2);
  if (args.includes("--help") || args.includes("-h")) {
    printUsage();
    return;
  }

  if (args.length > 1) {
    printUsage(process.stderr);
    fail("Expected at most one request file.");
  }

  const apiKey = process.env.TYPESAFE_API_KEY?.trim();
  if (!apiKey) {
    fail("TYPESAFE_API_KEY is not set.");
  }

  const source = await readRequestSource(args[0]);
  const request = parseRequest(source);
  const response = await evaluate(request, apiKey);
  process.stdout.write(`${JSON.stringify(response, null, 2)}\n`);
}

try {
  await main();
} catch (error) {
  process.stderr.write(`Error: ${error.message}\n`);
  process.exitCode = 1;
}
