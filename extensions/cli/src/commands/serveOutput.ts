import chalk from "chalk";

export function logServeStartup({
  port,
  timeoutSeconds,
  token,
  generatedToken,
}: {
  port: number;
  timeoutSeconds: number;
  token: string;
  generatedToken: boolean;
}): void {
  console.log(chalk.green(`Server started on http://localhost:${port}`));
  if (generatedToken) {
    console.error(
      chalk.yellow(
        `Control plane token (pass as Authorization: Bearer <token>): ${token}`,
      ),
    );
  }
  console.log(chalk.dim("Endpoints:"));
  console.log(chalk.dim("  GET  /state      - Get current agent state"));
  console.log(
    chalk.dim(
      "  POST /message    - Send a message (body: { message: string })",
    ),
  );
  console.log(
    chalk.dim(
      "  POST /permission - Approve/reject tool (body: { requestId, approved })",
    ),
  );
  console.log(chalk.dim("  POST /pause      - Pause the current agent run"));
  console.log(
    chalk.dim("  GET  /diff       - Get git diff against main branch"),
  );
  console.log(
    chalk.dim("  POST /exit       - Gracefully shut down the server"),
  );
  console.log(
    chalk.dim(
      `\nServer will shut down after ${timeoutSeconds} seconds of inactivity`,
    ),
  );
}
