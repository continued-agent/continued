export function isEnvironmentInstallAllowed(options: {
  allowEnvironmentInstall?: boolean;
}): boolean {
  return options.allowEnvironmentInstall === true;
}

/** Parse a positive CLI integer without accepting partial or overflowing values. */
export function parseServeInteger(
  value: string | undefined,
  optionName: string,
  defaultValue: number,
  maximum: number,
): number {
  const rawValue = value ?? String(defaultValue);
  if (!/^[1-9]\d*$/.test(rawValue)) {
    throw new Error(
      `Invalid --${optionName}: expected an integer between 1 and ${maximum}.`,
    );
  }

  const parsed = Number(rawValue);
  if (!Number.isSafeInteger(parsed) || parsed > maximum) {
    throw new Error(
      `Invalid --${optionName}: expected an integer between 1 and ${maximum}.`,
    );
  }

  return parsed;
}

export function parseServeTimeout(value: string | undefined): number {
  return parseServeInteger(value, "timeout", 300, 2_147_483);
}

export function parseServePort(value: string | undefined): number {
  return parseServeInteger(value, "port", 8000, 65_535);
}
