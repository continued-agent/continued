/**
 * Serialize data for an inline script without allowing a string value to close
 * the script element. JSON.stringify alone does not escape `</script>`.
 */
export function serializeForInlineScript(value: unknown): string {
  const serialized = JSON.stringify(value) ?? "null";
  return serialized.replace(/[<>&\u2028\u2029]/g, (character) => {
    switch (character) {
      case "<":
        return "\\u003c";
      case ">":
        return "\\u003e";
      case "&":
        return "\\u0026";
      case "\u2028":
        return "\\u2028";
      case "\u2029":
        return "\\u2029";
      default:
        return character;
    }
  });
}

export function getWebviewContentSecurityPolicy(
  cspSource: string,
  nonce: string,
  inDevelopmentMode: boolean,
): string {
  const developmentSource = inDevelopmentMode ? " http://localhost:5173" : "";

  return [
    "default-src 'none'",
    `img-src ${cspSource} https: data:`,
    `style-src ${cspSource} 'unsafe-inline'${developmentSource}`,
    `script-src 'nonce-${nonce}' ${cspSource}${developmentSource}`,
    `font-src ${cspSource} data:`,
    "connect-src https: http: wss: ws:",
  ].join("; ");
}
