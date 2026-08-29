import * as readline from "readline";

/**
 * Creates a promise-based question prompt using readline
 * Properly handles backspace and Ctrl+C
 */
export function question(prompt: string): Promise<string> {
  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      terminal: true,
    });

    // Handle Ctrl+C properly
    rl.on("SIGINT", () => {
      console.log("\n");
      rl.close();
      process.exit(0);
    });

    rl.question(prompt, (answer) => {
      rl.close();
      resolve(answer);
    });
  });
}

/**
 * Reads a secret without echoing its contents to the terminal.
 * Falls back to the regular prompt when raw mode is unavailable (for example,
 * in tests or other non-interactive environments).
 */
export function secretQuestion(prompt: string): Promise<string> {
  const stdin = process.stdin;
  const stdout = process.stdout;
  const setRawMode = (
    stdin as NodeJS.ReadStream & { setRawMode?: (mode: boolean) => void }
  ).setRawMode;

  if (!stdin.isTTY || typeof setRawMode !== "function") {
    return question(prompt);
  }

  return new Promise((resolve, reject) => {
    let answer = "";
    const wasRaw = Boolean(
      (stdin as NodeJS.ReadStream & { isRaw?: boolean }).isRaw,
    );

    const cleanup = () => {
      stdin.removeListener("data", onData);
      setRawMode.call(stdin, wasRaw);
      stdin.pause();
    };

    const onData = (chunk: Buffer | string) => {
      for (const character of chunk.toString()) {
        if (character === "\u0003") {
          cleanup();
          stdout.write("\n");
          reject(new Error("Input cancelled"));
          return;
        }

        if (character === "\r" || character === "\n") {
          cleanup();
          stdout.write("\n");
          resolve(answer);
          return;
        }

        if (character === "\u0008" || character === "\u007f") {
          if (answer.length > 0) {
            answer = answer.slice(0, -1);
            stdout.write("\b \b");
          }
          continue;
        }

        if (character.charCodeAt(0) < 32) {
          continue;
        }

        answer += character;
        stdout.write("*");
      }
    };

    stdout.write(prompt);
    setRawMode.call(stdin, true);
    stdin.resume();
    stdin.on("data", onData);
  });
}

/**
 * Creates a prompt with limited choices
 * @param prompt The prompt to display
 * @param choices Array of valid choices
 * @param defaultChoice Default choice if user presses enter
 * @param limitMessage Message to show when invalid choice is entered
 */
export async function questionWithChoices(
  prompt: string,
  choices: string[],
  defaultChoice?: string,
  limitMessage?: string,
): Promise<string> {
  while (true) {
    const answer = await question(prompt);

    // Handle default choice
    if (answer === "" && defaultChoice !== undefined) {
      return defaultChoice;
    }

    // Check if answer is valid
    if (choices.includes(answer)) {
      return answer;
    }

    // Show limit message if provided
    if (limitMessage) {
      console.log(limitMessage);
    }
  }
}
