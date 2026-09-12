const fs = require("fs");
const crypto = require("crypto");
const path = require("path");
const { rimrafSync } = require("rimraf");
const tar = require("tar");
const { RIPGREP_VERSION, TARGET_TO_RIPGREP_RELEASE } = require("./targets");
const AdmZip = require("adm-zip");
const { ProxyAgent } = require("undici");

const RIPGREP_BASE_URL = `https://github.com/BurntSushi/ripgrep/releases/download/${RIPGREP_VERSION}`;
const RIPGREP_SHA256 = {
  "ripgrep-14.1.1-x86_64-apple-darwin.tar.gz":
    "fc87e78f7cb3fea12d69072e7ef3b21509754717b746368fd40d88963630e2b3",
  "ripgrep-14.1.1-aarch64-apple-darwin.tar.gz":
    "24ad76777745fbff131c8fbc466742b011f925bfa4fffa2ded6def23b5b937be",
  "ripgrep-14.1.1-x86_64-unknown-linux-musl.tar.gz":
    "4cf9f2741e6c465ffdb7c26f38056a59e2a2544b51f7cc128ef28337eeae4d8e",
  "ripgrep-14.1.1-aarch64-unknown-linux-gnu.tar.gz":
    "c827481c4ff4ea10c9dc7a4022c8de5db34a5737cb74484d62eb94a95841ab2f",
  "ripgrep-14.1.1-x86_64-pc-windows-msvc.zip":
    "d0f534024c42afd6cb4d38907c25cd2b249b79bbe6cc1dbee8e3e37c2b6e25a1",
};

/**
 * Downloads a file from a URL to a specified path
 *
 * @param {string} url - The URL to download from
 * @param {string} destPath - The destination path for the downloaded file
 * @returns {Promise<void>}
 */
async function downloadFile(url, destPath) {
  // Use the built-in fetch API instead of node-fetch
  // Use proxy if set in environment variables
  const proxy = process.env.https_proxy || process.env.HTTPS_PROXY;
  const agent = proxy ? new ProxyAgent(proxy) : undefined;

  const response = await fetch(url, {
    redirect: "follow", // Automatically follow redirects
    dispatcher: agent,
  });

  if (!response.ok) {
    throw new Error(`Failed to download file, status code: ${response.status}`);
  }

  // Get the response as an array buffer and write it to the file
  const buffer = await response.arrayBuffer();
  fs.writeFileSync(destPath, Buffer.from(buffer));
}

function verifySha256(filePath, expectedHash) {
  const actualHash = crypto
    .createHash("sha256")
    .update(fs.readFileSync(filePath))
    .digest("hex");
  if (actualHash !== expectedHash) {
    throw new Error(
      `Downloaded ripgrep archive failed SHA-256 verification (expected ${expectedHash}, got ${actualHash})`,
    );
  }
}

/**
 * Extracts an archive to a specified directory
 *
 * @param {string} archivePath - Path to the archive file
 * @param {string} targetDir - Directory to extract the archive to
 * @param {string} platform - Platform identifier (e.g., 'darwin', 'linux', 'win32')
 * @returns {Promise<void>}
 */
async function extractArchive(archivePath, targetDir, platform) {
  if (platform === "win32" || archivePath.endsWith(".zip")) {
    // Simple zip extraction for Windows - extract rg.exe
    const zip = new AdmZip(archivePath);

    const rgEntry = zip
      .getEntries()
      .find((entry) => entry.entryName.endsWith("rg.exe"));

    if (!rgEntry) {
      throw new Error("Could not find rg.exe in the downloaded archive");
    }

    // Extract the found rg.exe file to the target directory
    const entryData = rgEntry.getData();
    fs.writeFileSync(path.join(targetDir, "rg.exe"), entryData);
  } else {
    await tar.extract({
      file: archivePath,
      cwd: targetDir,
      strip: 1, // Strip the top-level directory
      filter: (path) => path.endsWith("/rg"),
    });
  }
}
/**
 * Downloads and installs ripgrep for the specified target
 *
 * @param {string} target - Target platform-arch (e.g., 'darwin-x64')
 * @param {string} targetDir - Directory to install ripgrep to
 * @returns {Promise<string>} - Path to the installed ripgrep binary
 */
async function downloadRipgrep(target, targetDir) {
  // Get the ripgrep release file name for the target
  const releaseFile = TARGET_TO_RIPGREP_RELEASE[target];
  if (!releaseFile) {
    throw new Error(`Unsupported target: ${target}`);
  }

  const platform = target.split("-")[0];
  const downloadUrl = `${RIPGREP_BASE_URL}/${releaseFile}`;
  const tempDir = path.join(targetDir, "temp");

  // Create temp directory
  fs.mkdirSync(tempDir, { recursive: true });

  const archivePath = path.join(tempDir, releaseFile);

  try {
    // Download the ripgrep release
    console.log(`[info] Downloading ripgrep from ${downloadUrl}`);
    await downloadFile(downloadUrl, archivePath);
    verifySha256(archivePath, RIPGREP_SHA256[releaseFile]);

    // Extract the archive
    console.log(`[info] Extracting ripgrep to ${targetDir}`);
    await extractArchive(archivePath, targetDir, platform);

    // Make the binary executable on Unix-like systems
    if (platform !== "win32") {
      const rgPath = path.join(targetDir, "rg");
      fs.chmodSync(rgPath, 0o755);
    }

    // Clean up
    rimrafSync(tempDir);

    // Return the path to the ripgrep binary
    const binName = platform === "win32" ? "rg.exe" : "rg";
    return path.join(targetDir, binName);
  } catch (error) {
    console.error(`[error] Failed to download ripgrep for ${target}:`, error);
    // Clean up temp directory on error
    rimrafSync(tempDir);
    throw error;
  }
}

module.exports = {
  downloadRipgrep,
  RIPGREP_VERSION,
};
