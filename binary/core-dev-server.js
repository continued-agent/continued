const path = require("path");

// The TCP core transport processes arbitrary JSON messages, so it requires an
// explicit shared secret in addition to the dev flag.
if (!process.env.CONTINUE_DEVELOPMENT_TOKEN) {
  throw new Error(
    "CONTINUE_DEVELOPMENT_TOKEN must be set to run the TCP dev core",
  );
}
process.env.CONTINUE_DEVELOPMENT = true;

process.env.CONTINUE_GLOBAL_DIR = path.join(
  process.env.PROJECT_DIR,
  "extensions",
  ".continue-debug",
);

require("./out/index.js");
