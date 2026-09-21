import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const SCRIPT_PATH = join(dirname(fileURLToPath(import.meta.url)), "evaluate.mjs");

function environment(apiKey) {
  const env = { ...process.env };
  if (apiKey === undefined) {
    delete env.TYPESAFE_API_KEY;
  } else {
    env.TYPESAFE_API_KEY = apiKey;
  }
  return env;
}

function runCli(options) {
  const { args = [], input, preload } = options;
  const apiKey = Object.hasOwn(options, "apiKey") ? options.apiKey : "test-key";
  const nodeArgs = [];
  if (preload) {
    nodeArgs.push("--import", preload);
  }
  nodeArgs.push(SCRIPT_PATH, ...args);

  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, nodeArgs, {
      env: environment(apiKey),
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.stdin.on("error", (error) => {
      if (error.code !== "EPIPE") {
        reject(error);
      }
    });
    child.on("error", reject);
    child.on("close", (code, signal) => {
      resolve({ code, signal, stdout, stderr });
    });

    child.stdin.end(input);
  });
}

async function createSandbox(t) {
  const directory = await mkdtemp(join(tmpdir(), "typesafe-ai-test-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return directory;
}

async function writeSuccessPreload(directory) {
  const path = join(directory, "success-fetch.mjs");
  await writeFile(
    path,
    `globalThis.fetch = async (url, options) => new Response(JSON.stringify({
  url,
  method: options.method,
  authorization: options.headers.Authorization,
  request: JSON.parse(options.body),
}), { status: 200, headers: { "Content-Type": "application/json" } });\n`,
  );
  return path;
}

const validRequest = {
  state: "hello",
  questions: {
    greeting: {
      type: "noul",
      instructions: "Is this a greeting?",
    },
  },
};

test("evaluate reads a request file and writes the successful response only to stdout", async (t) => {
  const directory = await createSandbox(t);
  const preload = await writeSuccessPreload(directory);
  const requestPath = join(directory, "request.json");
  await writeFile(requestPath, JSON.stringify(validRequest));

  const result = await runCli({ args: [requestPath], preload });

  assert.equal(result.code, 0);
  assert.equal(result.signal, null);
  assert.equal(result.stderr, "");
  const response = JSON.parse(result.stdout);
  assert.equal(response.url, "https://api.typesafe.ai/v1/systemone");
  assert.equal(response.method, "POST");
  assert.equal(response.authorization, "Bearer test-key");
  assert.equal(response.request.model, "jev-latest");
  assert.deepEqual(response.request.state, validRequest.state);
});

test("evaluate reads a piped request from stdin", async (t) => {
  const directory = await createSandbox(t);
  const preload = await writeSuccessPreload(directory);

  const result = await runCli({ input: JSON.stringify(validRequest), preload });

  assert.equal(result.code, 0);
  assert.equal(result.stderr, "");
  assert.equal(JSON.parse(result.stdout).request.questions.greeting.type, "noul");
});

test("evaluate prints help to stdout without requiring an API key", async () => {
  const result = await runCli({ args: ["--help"], apiKey: undefined });

  assert.equal(result.code, 0);
  assert.match(result.stdout, /^Usage:/);
  assert.equal(result.stderr, "");
});

test("evaluate rejects a missing API key without writing to stdout", async () => {
  const result = await runCli({ input: JSON.stringify(validRequest), apiKey: undefined });

  assert.equal(result.code, 1);
  assert.equal(result.stdout, "");
  assert.match(result.stderr, /TYPESAFE_API_KEY is not set/);
});

test("evaluate rejects malformed JSON without writing to stdout", async () => {
  const result = await runCli({ input: "{bad json" });

  assert.equal(result.code, 1);
  assert.equal(result.stdout, "");
  assert.match(result.stderr, /Request is not valid JSON/);
});

test("evaluate rejects an empty questions object", async () => {
  const result = await runCli({
    input: JSON.stringify({ state: "hello", questions: {} }),
  });

  assert.equal(result.code, 1);
  assert.equal(result.stdout, "");
  assert.match(result.stderr, /non-empty "questions" object/);
});

test("evaluate omits API error bodies that may contain submitted state", async (t) => {
  const directory = await createSandbox(t);
  const preload = join(directory, "error-fetch.mjs");
  await writeFile(
    preload,
    `globalThis.fetch = async () => new Response(JSON.stringify({
  detail: "Rejected state: PRIVATE_STATE",
  state: "PRIVATE_STATE",
}), { status: 422, headers: { "Content-Type": "application/json" } });\n`,
  );

  const result = await runCli({
    input: JSON.stringify({ ...validRequest, state: "PRIVATE_STATE" }),
    preload,
  });

  assert.equal(result.code, 1);
  assert.equal(result.stdout, "");
  assert.match(result.stderr, /HTTP 422/);
  assert.match(result.stderr, /Response body omitted/);
  assert.doesNotMatch(result.stderr, /PRIVATE_STATE|Rejected state/);
});

test("evaluate reports a bounded request timeout", async (t) => {
  const directory = await createSandbox(t);
  const preload = join(directory, "timeout-fetch.mjs");
  await writeFile(
    preload,
    `AbortSignal.timeout = () => AbortSignal.abort(new DOMException("Synthetic timeout", "TimeoutError"));
globalThis.fetch = async (_url, options) => {
  if (!options.signal?.aborted) {
    throw new Error("Expected an aborted timeout signal");
  }
  throw options.signal.reason;
};\n`,
  );

  const result = await runCli({ input: JSON.stringify(validRequest), preload });

  assert.equal(result.code, 1);
  assert.equal(result.stdout, "");
  assert.match(result.stderr, /timed out after 10000 ms/);
});
