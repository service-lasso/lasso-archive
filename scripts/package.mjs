import { spawnSync } from "node:child_process";
import { chmod, cp, mkdir, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const archiveVersion = process.env.ARCHIVE_VERSION ?? "26.01";
const targetPlatform = process.env.TARGET_PLATFORM ?? process.platform;

export function providerContractForVersion(version = archiveVersion) {
  return {
  contractVersion: "service-lasso.archive-provider.v1",
  serviceId: "@archive",
  provider: "lasso-archive",
  upstream: {
    vendor: "7-Zip",
    repo: "ip7z/7zip",
    version,
  },
  defaultFormat: "7z",
  commandEnv: "ARCHIVE_TOOL",
  supportedFormats: ["7z", "zip", "tar", "gzip", "bzip2", "xz", "rar"],
  operations: {
    create: {
      description: "Create an archive from one or more Service Lasso-validated source paths.",
      argv: ["a", "<archivePath>", "<sourcePath...>", "-t7z", "-y"],
      returns: ["archivePath", "format", "sizeBytes", "sha256", "providerVersion"],
    },
    extract: {
      description: "Extract an archive into a Service Lasso-validated target directory.",
      argv: ["x", "<archivePath>", "-o<targetDirectory>", "-y"],
      returns: ["targetDirectory", "format", "providerVersion"],
    },
    list: {
      description: "List archive entries for preview and restore validation where the format supports it.",
      argv: ["l", "<archivePath>"],
      returns: ["entries", "format", "providerVersion"],
    },
    test: {
      description: "Verify archive readability/integrity where the format supports it.",
      argv: ["t", "<archivePath>"],
      returns: ["ok", "format", "providerVersion"],
    },
  },
  failureCodes: {
    missingSource: "archive.source_not_found",
    badArchive: "archive.invalid_or_unreadable",
    unsupportedPlatform: "archive.unsupported_platform",
    providerUnavailable: "archive.provider_unavailable",
  },
  safety: {
    pathPolicyOwner: "service-lasso-core",
    noSecretsInLogs: true,
    encryptionIsNotAuthorization: true,
  },
  };
}

export const providerContract = providerContractForVersion();

export const targets = {
  win32: {
    upstreamAsset: "7z2601-extra.7z",
    archiveType: "zip",
    command: ".\\bin\\7za.exe",
    binary: "bin/7za.exe",
    copyEntries: [
      ["x64/7za.exe", "bin/7za.exe"],
      ["x64/7za.dll", "bin/7za.dll"],
      ["x64/7zxa.dll", "bin/7zxa.dll"],
      ["License.txt", "License.txt"],
      ["readme.txt", "readme.txt"],
      ["history.txt", "History.txt"],
    ],
  },
  linux: {
    upstreamAsset: "7z2601-linux-x64.tar.xz",
    archiveType: "tar.gz",
    command: "./bin/7zz",
    binary: "bin/7zz",
    copyEntries: [
      ["7zz", "bin/7zz"],
      ["License.txt", "License.txt"],
      ["readme.txt", "readme.txt"],
      ["History.txt", "History.txt"],
    ],
  },
  darwin: {
    upstreamAsset: "7z2601-mac.tar.xz",
    archiveType: "tar.gz",
    command: "./bin/7zz",
    binary: "bin/7zz",
    copyEntries: [
      ["7zz", "bin/7zz"],
      ["License.txt", "License.txt"],
      ["readme.txt", "readme.txt"],
      ["History.txt", "History.txt"],
    ],
  },
};

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    stdio: "inherit",
    shell: false,
    ...options,
  });

  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed with exit code ${result.status}`);
  }
}

export function assetName(platform, version = archiveVersion) {
  const target = targets[platform];
  if (!target) {
    throw new Error(`Unsupported target platform: ${platform}`);
  }
  return `lasso-archive-7zip-${version}-${platform}.${target.archiveType === "zip" ? "zip" : "tar.gz"}`;
}

async function download(url, destination) {
  if (existsSync(destination)) {
    return;
  }

  const response = await fetch(url, {
    headers: {
      "user-agent": "service-lasso-lasso-archive-packager",
    },
  });

  if (!response.ok || !response.body) {
    throw new Error(`Failed to download ${url}: ${response.status} ${response.statusText}`);
  }

  const bytes = Buffer.from(await response.arrayBuffer());
  await writeFile(destination, bytes);
}

async function extractUpstream(upstreamArchive, target, extractRoot) {
  await mkdir(extractRoot, { recursive: true });
  if (target.upstreamAsset.endsWith(".7z")) {
    run("7z", ["x", upstreamArchive, `-o${extractRoot}`, "-y"]);
    return;
  }
  run("tar", ["-xf", upstreamArchive, "-C", extractRoot]);
}

async function compressPackage(packageRoot, outputPath, archiveType) {
  await mkdir(path.dirname(outputPath), { recursive: true });
  await rm(outputPath, { force: true });

  if (archiveType === "zip") {
    run("powershell", [
      "-NoLogo",
      "-NoProfile",
      "-Command",
      `Compress-Archive -Path ${JSON.stringify(path.join(packageRoot, "*"))} -DestinationPath ${JSON.stringify(outputPath)} -Force`,
    ]);
    return outputPath;
  }

  run("tar", ["-czf", outputPath, "-C", packageRoot, "."]);
  return outputPath;
}

export async function packageArchive(platform = targetPlatform, version = archiveVersion) {
  const target = targets[platform];
  if (!target) {
    throw new Error(`Unsupported target platform: ${platform}`);
  }
  if (!/^\d+\.\d+$/.test(version)) {
    throw new Error(`Expected 7-Zip version like "26.01", got "${version}".`);
  }

  const upstreamUrl = `https://github.com/ip7z/7zip/releases/download/${version}/${target.upstreamAsset}`;
  const vendorRoot = path.join(repoRoot, "vendor", version, platform);
  const outputRoot = path.join(repoRoot, "output", "package", version, platform);
  const extractRoot = path.join(outputRoot, "extract");
  const packageRoot = path.join(outputRoot, "payload");
  const upstreamArchive = path.join(vendorRoot, target.upstreamAsset);
  const outputPath = path.join(repoRoot, "dist", assetName(platform, version));

  await mkdir(vendorRoot, { recursive: true });
  await rm(outputRoot, { recursive: true, force: true });
  await mkdir(path.join(packageRoot, "bin"), { recursive: true });

  await download(upstreamUrl, upstreamArchive);
  await extractUpstream(upstreamArchive, target, extractRoot);

  for (const [from, to] of target.copyEntries) {
    const source = path.join(extractRoot, from);
    if (!existsSync(source)) {
      throw new Error(`Expected upstream file was not found: ${source}`);
    }
    await cp(source, path.join(packageRoot, to), { recursive: true });
  }

  if (target.archiveType !== "zip") {
    await chmod(path.join(packageRoot, target.binary), 0o755);
  }

  await writeFile(
    path.join(packageRoot, "SERVICE-LASSO-PACKAGE.json"),
    `${JSON.stringify(
      {
        serviceId: "@archive",
        upstream: {
          vendor: "7-Zip",
          repo: "ip7z/7zip",
          version,
          asset: target.upstreamAsset,
          url: upstreamUrl,
          release: version,
        },
        packagedBy: "service-lasso/lasso-archive",
        platform,
        arch: "x64",
        command: target.command,
        distribution: "7-Zip console tools",
        providerContract: "SERVICE-LASSO-PROVIDER-CONTRACT.json",
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
  await writeFile(
    path.join(packageRoot, "SERVICE-LASSO-PROVIDER-CONTRACT.json"),
    `${JSON.stringify(providerContractForVersion(version), null, 2)}\n`,
    "utf8",
  );

  await compressPackage(packageRoot, outputPath, target.archiveType);
  console.log(`[lasso-archive] packaged ${outputPath}`);
  return outputPath;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await packageArchive();
}
