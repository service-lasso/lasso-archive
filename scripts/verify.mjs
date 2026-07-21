import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { assetName, packageArchive, targets } from "./package.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const version = process.env.ARCHIVE_VERSION ?? "26.01";
const platforms = process.env.TARGET_PLATFORM ? [process.env.TARGET_PLATFORM] : Object.keys(targets);

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function assertHealthchecksContract(manifest) {
  assert(!Object.hasOwn(manifest, "healthcheck"), "Manifest must not use singular healthcheck.");

  if (!Object.hasOwn(manifest, "healthchecks")) {
    return;
  }

  assert(Array.isArray(manifest.healthchecks), "Manifest healthchecks must be an array.");
  const ids = new Set();
  for (const [index, check] of manifest.healthchecks.entries()) {
    assert(check && typeof check === "object" && !Array.isArray(check), `Healthcheck ${index} must be an object.`);
    assert(typeof check.id === "string" && check.id.trim() !== "", `Healthcheck ${index} must include a stable id.`);
    assert(!ids.has(check.id), `Duplicate healthcheck id: ${check.id}`);
    ids.add(check.id);
  }
}

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: repoRoot,
      stdio: ["ignore", "pipe", "pipe"],
      shell: false,
      ...options,
    });

    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr?.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    child.once("error", reject);
    child.once("close", (code) => {
      if (code === 0) {
        resolve({ stdout, stderr });
      } else {
        reject(new Error(`${command} ${args.join(" ")} failed with exit code ${code}\n${stdout}\n${stderr}`));
      }
    });
  });
}

async function extractArtifact(artifact, destination) {
  await rm(destination, { recursive: true, force: true });
  await mkdir(destination, { recursive: true });
  await run("tar", ["-xf", artifact, "-C", destination]);
}

async function assertFile(filePath) {
  const result = await stat(filePath);
  assert(result.isFile() && result.size > 0, `Expected non-empty file: ${filePath}`);
}

async function smokeCurrentPlatform(artifact, platform) {
  const verifyRoot = path.join(repoRoot, "output", "verify", version, platform);
  const extractRoot = path.join(verifyRoot, "extract");
  await extractArtifact(artifact, extractRoot);

  const command = path.join(extractRoot, targets[platform].binary);
  await assertFile(command);

  const metadata = JSON.parse(await readFile(path.join(extractRoot, "SERVICE-LASSO-PACKAGE.json"), "utf8"));
  assert(metadata.serviceId === "@archive", `Unexpected serviceId: ${JSON.stringify(metadata)}`);
  assert(metadata.upstream?.vendor === "7-Zip", `Unexpected upstream vendor: ${JSON.stringify(metadata)}`);
  assert(metadata.upstream?.version === version, `Unexpected upstream version: ${JSON.stringify(metadata)}`);
  assert(metadata.packagedBy === "service-lasso/lasso-archive", `Unexpected packager: ${JSON.stringify(metadata)}`);
  assert(metadata.platform === platform, `Unexpected platform: ${JSON.stringify(metadata)}`);

  const info = await run(command, ["i"], { cwd: extractRoot });
  const output = `${info.stdout}\n${info.stderr}`;
  assert(output.includes("7-Zip"), "7-Zip info output did not include product name.");
  assert(output.includes("Formats"), "7-Zip info output did not include supported formats.");

  const workRoot = path.join(verifyRoot, "roundtrip");
  const inputRoot = path.join(workRoot, "input");
  const outputRoot = path.join(workRoot, "output");
  const archivePath = path.join(workRoot, "sample.7z");
  await rm(workRoot, { recursive: true, force: true });
  await mkdir(inputRoot, { recursive: true });
  await mkdir(outputRoot, { recursive: true });
  await writeFile(path.join(inputRoot, "hello.txt"), "hello from lasso-archive\n", "utf8");

  await run(command, ["a", archivePath, path.join(inputRoot, "hello.txt"), "-y"], { cwd: workRoot });
  await run(command, ["x", archivePath, `-o${outputRoot}`, "-y"], { cwd: workRoot });
  const extracted = await readFile(path.join(outputRoot, "hello.txt"), "utf8");
  assert(extracted === "hello from lasso-archive\n", "7-Zip roundtrip content mismatch.");

  console.log(`[lasso-archive] command smoke passed for ${platform}`);
}

const manifest = JSON.parse(await readFile(path.join(repoRoot, "service.json"), "utf8"));
assert(manifest.id === "@archive", `Unexpected service id: ${manifest.id}`);
assert(manifest.role === "provider", "Archive service must be a provider.");
assert(manifest.version === `7zip-${version}`, `Unexpected manifest version: ${manifest.version}`);
assertHealthchecksContract(manifest);
assert(manifest.artifact?.source?.repo === "service-lasso/lasso-archive", "Manifest must point at lasso-archive releases.");
assert(manifest.artifact?.source?.channel === "latest", "Archive provider should track latest releases for update checks.");
assert(manifest.updates?.mode === "notify", "Archive provider should use notify-only update policy.");
for (const key of ["ARCHIVE_HOME", "ARCHIVE_TOOL", "SEVENZIP_HOME", "SEVENZIP"]) {
  assert(typeof manifest.globalenv?.[key] === "string", `Missing globalenv ${key}`);
}

const artifacts = [];
for (const platform of platforms) {
  const target = targets[platform];
  assert(manifest.artifact?.platforms?.[platform]?.assetName === assetName(platform, version), `Unexpected asset name for ${platform}.`);
  assert(manifest.artifact?.platforms?.[platform]?.archiveType === target.archiveType, `Unexpected archive type for ${platform}.`);
  assert(manifest.artifact?.platforms?.[platform]?.command === target.command, `Unexpected command for ${platform}.`);

  const artifact = await packageArchive(platform, version);
  await assertFile(artifact);
  artifacts.push({ platform, artifact });
}

const currentArtifact = artifacts.find((entry) => entry.platform === process.platform);
if (currentArtifact) {
  await smokeCurrentPlatform(currentArtifact.artifact, currentArtifact.platform);
}

const checksums = await Promise.all(artifacts.map(async ({ artifact }) => {
  const hash = createHash("sha256").update(await readFile(artifact)).digest("hex");
  return `${hash}  ${path.basename(artifact)}`;
}));

console.log(`[lasso-archive] verified manifest and packaged ${artifacts.length} artifact(s)`);
console.log(checksums.join("\n"));
