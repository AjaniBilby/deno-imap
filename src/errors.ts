export class ImapError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ImapError';
  }
}

export class ImapAuthError extends ImapError {
  constructor(message: string) {
    super(message);
    this.name = 'ImapAuthError';
  }
}

export class ImapCommandError extends ImapError {
  /** The command that failed */
  command: string;
  /** The server response */
  response: string;
  /** The response code if available */
  responseCode?: string;

  constructor(command: string, response: string, responseCode?: string) {
    super(`Command "${command}" failed: ${response}${responseCode ? ` [${responseCode}]` : ''}`);
    this.name = 'ImapCommandError';
    this.command = command;
    this.response = response;
    this.responseCode = responseCode;
  }
}

export class ImapConnectionError extends ImapError {
  override cause?: Error;

  constructor(message: string, cause?: Error) {
    super(message);
    this.name = 'ImapConnectionError';
    this.cause = cause;
  }
}

export class ImapParseError extends ImapError {
  /** The data that failed to parse */
  data: string;

  constructor(message: string, data: string) {
    super(message);
    this.name = 'ImapParseError';
    this.data = data;
  }
}

export class ImapTimeoutError extends ImapError {
  /** The operation that timed out */
  operation: string;
  /** The timeout duration in milliseconds */
  timeout: number;

  constructor(operation: string, timeout: number) {
    super(`Operation "${operation}" timed out after ${timeout}ms`);
    this.name = 'ImapTimeoutError';
    this.operation = operation;
    this.timeout = timeout;
  }
}

export class ImapNotConnectedError extends ImapError {
  constructor(message = 'Not connected to IMAP server') {
    super(message);
    this.name = 'ImapNotConnectedError';
  }
}

export class ImapNoMailboxSelectedError extends ImapError {
  constructor(message = 'No mailbox selected') {
    super(message);
    this.name = 'ImapNoMailboxSelectedError';
  }
}

export class ImapCapabilityError extends ImapError {
  /** The required capability */
  capability: string;

  constructor(capability: string) {
    super(`Server does not support required capability: ${capability}`);
    this.name = 'ImapCapabilityError';
    this.capability = capability;
  }
}
