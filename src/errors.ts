export function CommandError(command: string, response: string, responseCode?: string) {
  return new Error(
    `Command "${command}" failed: ${response}${responseCode ? ` [${responseCode}]` : ''}`,
  );
}

export function CapabilityError(capability: string) {
  return new Error(`Server does not support required capability: ${capability}`);
}
