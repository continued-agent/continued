const { spawn } = require("child_process");
const path = require("path");
const fs = require("fs");
const fsPromises = require("fs/promises");

const npmInstallArgs = process.env.CI === "true" ? ["ci"] : ["install"];
// Windows cannot execute .cmd files directly without a shell. Invoke the
// trusted command interpreter explicitly while keeping npm arguments separate
// from a shell command string.
const npmCommand =
  process.platform === "win32" ? process.env.ComSpec || "cmd.exe" : "npm";
const npmCommandPrefix =
  process.platform === "win32" ? ["/d", "/s", "/c", "npm.cmd"] : [];

function runCommand(command, args, cwd, packageName) {
  const displayCommand = [command, ...args].join(" ");
  return new Promise((resolve, reject) => {
    console.log(`Starting ${packageName}: ${displayCommand}`);

    const child = spawn(command, args, {
      cwd,
      stdio: "pipe",
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (data) => {
      stdout += data.toString();
    });

    child.stderr.on("data", (data) => {
      stderr += data.toString();
    });

    child.on("close", (code) => {
      if (code === 0) {
        console.log(
          `✅ ${packageName}: ${displayCommand} completed successfully`,
        );
        resolve({ packageName, command: displayCommand, stdout, stderr });
      } else {
        console.error(
          `❌ ${packageName}: ${displayCommand} failed with code ${code}`,
        );
        console.error(`stderr: ${stderr}`);
        console.error(`stdout: ${stdout}`);
        reject(
          new Error(
            `${packageName} failed: ${displayCommand} (exit code ${code})`,
          ),
        );
      }
    });

    child.on("error", (error) => {
      console.error(
        `❌ ${packageName}: Failed to start ${displayCommand}:`,
        error,
      );
      reject(error);
    });
  });
}

// Helper function to build a package (install + build)
async function buildPackage(packageName, cleanNodeModules = false) {
  const packagePath = path.join(__dirname, "..", "packages", packageName);

  if (!fs.existsSync(packagePath)) {
    throw new Error(`Package directory not found: ${packagePath}`);
  }

  if (cleanNodeModules) {
    const nodeModulesPath = path.join(packagePath, "node_modules");
    if (fs.existsSync(nodeModulesPath)) {
      console.log(`🧹 Cleaning node_modules for ${packageName}`);
      await fsPromises.rm(nodeModulesPath, { recursive: true, force: true });
    }
  }

  await runCommand(
    npmCommand,
    [...npmCommandPrefix, ...npmInstallArgs],
    packagePath,
    `${packageName} (install)`,
  );

  return runCommand(
    npmCommand,
    [...npmCommandPrefix, "run", "build"],
    packagePath,
    `${packageName} (build)`,
  );
}

async function buildPackagesInParallel(packages, cleanNodeModules = false) {
  const buildPromises = packages.map((pkg) =>
    buildPackage(pkg, cleanNodeModules),
  );
  return Promise.all(buildPromises);
}

async function main() {
  try {
    console.log("🚀 Starting package builds...\n");

    // Phase 1: Build foundation packages (no local dependencies)
    await buildPackagesInParallel(["config-types", "terminal-security"]);

    // Phase 2: Build packages that depend on config-types
    await buildPackagesInParallel(["fetch", "config-yaml", "llm-info"]);

    // Phase 3: Build packages that depend on other local packages
    await buildPackagesInParallel(["openai-adapters", "continue-sdk"]);

    console.log("🎉 All packages built successfully!");
  } catch (error) {
    console.error("💥 Build failed:", error.message);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}
