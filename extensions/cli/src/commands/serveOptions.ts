export function isEnvironmentInstallAllowed(options: {
  allowEnvironmentInstall?: boolean;
}): boolean {
  return options.allowEnvironmentInstall === true;
}
