import * as commands from './commands/mod.ts';
import * as parsers from './parsers/mod.ts';
import type {
  Flag,
  ImapAuthMechanism,
  ImapFetchOptions,
  ImapMailbox,
  ImapMessage,
  ImapOptions,
} from './types/mod.ts';
import { CreateCancellablePromise } from './utils/promises.ts';
import { ImapConnection } from './connection.ts';
import { CapabilityError, CommandError } from './errors.ts';
import * as engine from './engine.ts';

const DEFAULT_OPTIONS: Partial<ImapOptions> = {
  autoReconnect: true,
  maxReconnectAttempts: 3,
  reconnectDelay: 1000,
  commandTimeout: 30000,
  tls: true,
};

/**
 * IMAP client implementation
 */
export class ImapClient {
  #capabilities: Set<string> = new Set();
  #connection: ImapConnection;
  #options: ImapOptions;
  #tagCounter = 0;

  #selectedMailbox?: ImapMailbox;
  #authenticated = false;

  /** Active command cancellable promises */
  #activeCommands: Map<
    string,
    ReturnType<typeof CreateCancellablePromise>
  > = new Map();
  /** Reconnection attempt counter */
  #reconnectAttempts = 0;
  /** Whether a reconnection is in progress */
  #isReconnecting = false;

  /**
   * Creates a new IMAP client
   * @param options Client options
   */
  constructor(options: ImapOptions) {
    this.#options = { ...DEFAULT_OPTIONS, ...options };
    this.#connection = new ImapConnection(this.#options);
  }

  /**
   * Whether the client is connected
   */
  get connected(): boolean {
    return this.#connection.connected;
  }

  /**
   * Whether the client is authenticated
   */
  get authenticated(): boolean {
    return this.#authenticated;
  }

  /**
   * Whether a reconnection is in progress
   */
  get reconnecting(): boolean {
    return this.#isReconnecting;
  }

  /**
   * Server capabilities
   */
  get capabilities(): string[] {
    return [...this.#capabilities];
  }

  /**
   * Currently selected mailbox
   */
  get selectedMailbox(): ImapMailbox | undefined {
    return this.#selectedMailbox;
  }

  /**
   * Connects to the IMAP server
   * @returns Promise that resolves when connected
   */
  async connect(): Promise<void> {
    if (this.connected) return;

    await this.#connection.connect();

    // Read the server greeting
    const greeting = await this.#connection.readLine();

    if (!greeting.startsWith('* OK')) {
      await this.#connection.disconnect();
      throw CommandError('connect', greeting);
    }

    // Get server capabilities
    await this.updateCapabilities();
  }

  /**
   * Disconnects from the IMAP server
   * Attempts to gracefully close the connection by sending a LOGOUT command
   */
  async disconnect(): Promise<void> {
    if (!this.connected) return;

    try {
      // First, cancel all active commands and wait for them to complete
      for (const [tag, cancellable] of this.#activeCommands) {
        const promise = cancellable.promise.catch(() => {
          // Ignore any errors from cancelled commands
        });
        cancellable.cancel('Disconnecting');
        await promise;
        this.#activeCommands.delete(tag);
      }

      // Try to send LOGOUT command with a shorter timeout
      try {
        const logoutTimeout = 2000; // 2 second timeout for LOGOUT
        const originalTimeout = this.#options.commandTimeout;
        this.#options.commandTimeout = logoutTimeout;
        await this.#executeCommand(commands.logout());
        this.#options.commandTimeout = originalTimeout;
      } catch (error) {
        console.warn('Error during LOGOUT command:', error);
      }
    } finally {
      // Disconnect the connection
      await this.#connection.disconnect();

      // Reset state
      this.#authenticated = false;
      this.#selectedMailbox = undefined;
      this.#capabilities.clear();
      this.#activeCommands.clear();

      // Reset reconnection state
      this.#reconnectAttempts = 0;
      this.#isReconnecting = false;
    }
  }

  /**
   * Reconnects to the IMAP server
   * @returns Promise that resolves when reconnected
   * @throws {ImapConnectionError} If reconnection fails
   */
  async forceReconnect(): Promise<void> {
    await this.#reconnect();
  }

  async updateCapabilities(): Promise<string[]> {
    const response = await this.#executeCommand(commands.capability());

    for (const line of response) {
      if (line.startsWith('* CAPABILITY')) {
        const capabilities = parsers.parseCapabilities(line);
        this.#capabilities = new Set(capabilities);
        return capabilities;
      }
    }

    return [];
  }

  async authenticate(mechanism: ImapAuthMechanism = 'PLAIN'): Promise<void> {
    this.#assertConnected();
    if (this.#authenticated) return;

    // Check if the server supports the requested auth mechanism
    const authCap = `AUTH=${mechanism}`;
    if (!this.#capabilities.has(authCap)) throw CapabilityError(authCap);

    switch (mechanism) {
      case 'PLAIN':
        await this.#authenticatePlain();
        break;
      case 'LOGIN':
        await this.#authenticateLogin();
        break;
      case 'OAUTH2':
      case 'XOAUTH2':
        throw new Error(
          `Authentication mechanism ${mechanism} not implemented yet`,
        );
      default:
        throw new Error(`Unknown authentication mechanism: ${mechanism}`);
    }

    this.#authenticated = true;

    await this.updateCapabilities();
  }

  async #authenticatePlain(): Promise<void> {
    const authString = `\u0000${this.#options.username}\u0000${this.#options.password}`;
    const base64Auth = btoa(authString);

    await this.#executeCommand(`AUTHENTICATE PLAIN ${base64Auth}`);
  }

  async #authenticateLogin(): Promise<void> {
    await this.#executeCommand(
      commands.login(this.#options.username, this.#options.password),
    );
  }

  async listMailboxes(reference = '', mailbox = '*'): Promise<ImapMailbox[]> {
    this.#assertConnected();
    if (!this.#authenticated) await this.authenticate();

    const response = await this.#executeCommand(
      commands.list(reference, mailbox),
    );
    const mailboxes: ImapMailbox[] = [];

    for (const line of response) {
      if (line.startsWith('* LIST')) {
        try {
          const mailbox = parsers.parseListResponse(line);
          mailboxes.push(mailbox);
        } catch (error) {
          console.warn('Failed to parse LIST response:', error);
        }
      }
    }

    return mailboxes;
  }

  async getMailboxStatus(
    mailbox: string,
    items = ['MESSAGES', 'RECENT', 'UNSEEN', 'UIDNEXT', 'UIDVALIDITY'],
  ): Promise<Partial<ImapMailbox>> {
    this.#assertConnected();
    if (!this.#authenticated) await this.authenticate();

    const response = await this.#executeCommand(commands.status(mailbox, items));

    for (const line of response) {
      if (line.startsWith('* STATUS')) {
        try {
          return parsers.parseStatus(line);
        } catch (error) {
          console.warn('Failed to parse STATUS response:', error);
        }
      }
    }

    return { name: mailbox };
  }

  async selectMailbox(mailbox: string, allowStale = true): Promise<ImapMailbox> {
    this.#assertConnected();
    if (!this.#authenticated) await this.authenticate();

    const response = await this.#executeCommand(commands.select(mailbox));
    const mailboxInfo = parsers.parseSelect(response);

    // already selected
    if (allowStale && this.#selectedMailbox?.name === mailbox) return this.#selectedMailbox;

    // Get the actual unseen count using STATUS command
    try {
      const status = await this.getMailboxStatus(mailbox, ['UNSEEN']);
      if (status.unseen !== undefined) {
        mailboxInfo.unseen = status.unseen;
      }
    } catch (error) {
      console.warn('Failed to get unseen count:', error);
    }

    this.#selectedMailbox = {
      name: mailbox,
      flags: mailboxInfo.flags || [],
      delimiter: '/', // Default delimiter
      ...mailboxInfo,
    };

    return this.#selectedMailbox;
  }

  async examineMailbox(mailbox: string): Promise<ImapMailbox> {
    this.#assertConnected();
    if (!this.#authenticated) await this.authenticate();

    const response = await this.#executeCommand(commands.examine(mailbox));
    const mailboxInfo = parsers.parseSelect(response);

    // Don't set as selected mailbox since it's read-only

    return {
      name: mailbox,
      flags: mailboxInfo.flags || [],
      delimiter: '/', // Default delimiter
      ...mailboxInfo,
    };
  }

  async findMany<T extends engine.FindManyImapMessageArgs>(
    mailbox: string,
    args: T,
  ): Promise<engine.FindManyResult<T>> {
    const out: ImapMessage[] = [];
    const include = args?.include || engine.INCLUDE_ALL;

    // ensure values to resolve the where are present
    if (args?.where) {
      if (args.where.receivedDate) include.receivedDate = true;
      if (args.where.flags) include.flags = true;
      if (args.where.envelope) include.envelope = true;

      // ensure the content type header is always present
      if (include.body) include.headers = true;
    }

    const orderBy = engine.MakeOrderBy(args.orderBy);
    if (orderBy.sort) {
      include.receivedDate = true;
      include.seq = true;
      include.uid = true;
    }

    const query = args.where ? engine.MakeWhereQuery(args.where) : '';

    const response = await this.#executeCommandIn(mailbox, `SEARCH ${query || 'ALL'}`);
    const result = response.find((x) => x.startsWith('* SEARCH'));

    if (!result) return out as engine.FindManyResult<T>;

    const ids = result
      .slice('* SEARCH'.length)
      .trim()
      .split(' ')
      .filter(Boolean)
      .map((x) => parseInt(x, 10))
      .filter((x) => !isNaN(x));

    if (ids.length < 1) return out as engine.FindManyResult<T>;

    // fetch efficiently
    if (orderBy.fetch) ids.sort(orderBy.fetch);
    const take = args.take || ids.length;

    let cursor = 0;
    while (cursor < ids.length) {
      const batchSize = Math.max(10, Math.min(take, ids.length - cursor, 50));

      const batch = await this.#fetch(mailbox, ids.slice(cursor, cursor + batchSize).join(','), {
        envelope: include.envelope,
        uid: include.uid,
        bodyStructure: include.body,
        internalDate: include.receivedDate,
        allHeaders: include.headers,
        flags: include.flags,
        full: include.body,
      });

      for (const mail of batch) {
        if (args.where && !engine.MatchesWhere(args.where, mail)) continue;
        out.push(mail);
      }

      cursor += batchSize;

      // shrink the array if over fitted
      if (out.length > take) {
        out.length = take;
        if (orderBy.limited) break; // we know we've seen everything we need
      }

      if (orderBy.sort) out.sort(orderBy.sort);
    }

    return out as engine.FindManyResult<T>;
  }

  async findFirst<T extends engine.FindManyImapMessageArgs>(
    mailbox: string,
    args: T,
  ): Promise<engine.FindManyResult<T>[number] | undefined> {
    args.take = 1;
    const group = await this.findMany(mailbox, args);
    return group[0] || undefined;
  }

  async findFirstOrThrow<T extends engine.FindManyImapMessageArgs>(
    mailbox: string,
    args: T,
  ): Promise<engine.FindManyResult<T>[number]> {
    const first = await this.findFirst(mailbox, args);
    if (!first) throw new Error('Unable to find email');

    return first;
  }

  async updateMany(mailbox: string, args: {
    where: Array<{ seq?: number; uid?: number }>;

    data: {
      flags: Partial<Record<'add' | 'remove' | 'set', Flag[]>>;
      mailbox?: string;
    };
  }) {
    const seq = new Set<number>();
    const uid = new Set<number>();

    for (const mail of args.where) {
      if (mail.uid) { // prefer uid if possible
        uid.add(mail.uid);
        continue;
      }
      if (mail.seq) {
        seq.add(mail.seq);
        continue;
      }
    }

    const sequence = {
      seq: seq.size > 0 ? [...seq.values()].join(',') : undefined,
      uid: uid.size > 0 ? [...uid.values()].join(',') : undefined,
    };

    if (args.data.flags.add) {
      const flags = args.data.flags.add.map((x) =>
        '\\' + x[0].toUpperCase() + x.slice(1).toLocaleLowerCase()
      );
      if (sequence.seq) {
        await this.#executeCommandIn(mailbox, commands.store(sequence.seq, flags, 'add', false));
      }
      if (sequence.uid) {
        await this.#executeCommandIn(mailbox, commands.store(sequence.uid, flags, 'add', true));
      }
    }

    if (args.data.flags.set) {
      const flags = args.data.flags.set.map((x) =>
        '\\' + x[0].toUpperCase() + x.slice(1).toLocaleLowerCase()
      );
      if (sequence.seq) {
        await this.#executeCommandIn(mailbox, commands.store(sequence.seq, flags, 'set', false));
      }
      if (sequence.uid) {
        await this.#executeCommandIn(mailbox, commands.store(sequence.uid, flags, 'set', true));
      }
    }

    if (args.data.flags.remove) {
      const flags = args.data.flags.remove.map((x) =>
        '\\' + x[0].toUpperCase() + x.slice(1).toLocaleLowerCase()
      );
      if (sequence.seq) {
        await this.#executeCommandIn(mailbox, commands.store(sequence.seq, flags, 'remove', false));
      }
      if (sequence.uid) {
        await this.#executeCommandIn(mailbox, commands.store(sequence.uid, flags, 'remove', true));
      }
    }

    if (args.data.mailbox) {
      if (!this.#capabilities.has('move')) {
        throw new Error('Server does not support the move command');
      }

      if (sequence.seq) {
        await this.#executeCommandIn(mailbox, commands.move(sequence.seq, mailbox, false));
      }
      if (sequence.uid) {
        await this.#executeCommandIn(mailbox, commands.move(sequence.uid, mailbox, false));
      }
    }
  }

  async deleteMany(mailbox: string, args: {
    where: Array<{ seq?: number; uid?: number }>;
  }) {
    await this.updateMany(mailbox, {
      where: args.where,
      data: {
        flags: { add: ['Deleted'] },
      },
    });

    await this.#executeCommand(commands.expunge());
  }

  /**
   * Fetches messages
   * @deprecated
   * @param sequence Message sequence set
   * @param options Fetch options
   * @returns Promise that resolves with the messages
   */
  async #fetch(
    mailbox: string,
    sequence: string,
    options: ImapFetchOptions,
  ): Promise<ImapMessage[]> {
    await this.selectMailbox(mailbox);
    const response = await this.#executeCommand(
      commands.fetch(sequence, options),
    );

    // Parse the fetch response
    const messages: ImapMessage[] = [];

    // Group the response lines by message
    const messageGroups: string[][] = [];
    let currentGroup: string[] = [];
    let inLiteral = false;
    let literalSize = 0;
    let literalCollected = 0;

    for (const line of response) {
      // Check if this is the start of a new message
      // Format: * 1 FETCH (...)
      const fetchMatch = line.match(/^\* (\d+) FETCH/i);

      if (fetchMatch && !inLiteral) {
        // If we were collecting lines for a message, add them to the groups
        if (currentGroup.length > 0) {
          messageGroups.push(currentGroup);
          currentGroup = [];
        }

        // Start a new group
        currentGroup.push(line);

        // Check if this line contains a literal string
        const literalMatch = line.match(/\{(\d+)\}$/);
        if (literalMatch) {
          inLiteral = true;
          literalSize = parseInt(literalMatch[1], 10);
          literalCollected = 0;
        }
      } else {
        // Add the line to the current group
        currentGroup.push(line);

        // If we're collecting a literal, update the count
        if (inLiteral) {
          literalCollected += line.length + 2; // +2 for CRLF

          // Check if we've collected the entire literal
          if (literalCollected >= literalSize) {
            inLiteral = false;
          }
        }
      }
    }

    // Add the last group if it's not empty
    if (currentGroup.length > 0) {
      messageGroups.push(currentGroup);
    }

    // Parse each message group
    for (const group of messageGroups) {
      try {
        const messageData = parsers.parseFetch(group);

        if (messageData && messageData.seq) messages.push(messageData);
      } catch (error) {
        console.warn('Failed to parse FETCH response:', error);
      }
    }

    return messages;
  }

  /**
   * Executes an IMAP command
   * @deprecated
   * @param command Command to execute
   * @returns Promise that resolves with the response lines
   */
  async #executeCommand(command: string): Promise<string[]> {
    this.#assertConnected();

    const tag = this.#generateTag();

    // Create a cancellable timeout promise
    const timeoutMs = this.#options.commandTimeout || 30000;
    const cancellable = CreateCancellablePromise<string[]>(
      async () => {
        // Send the command
        await this.#connection.writeLine(`${tag} ${command}`);

        // Wait for the response
        const responseLines: string[] = [];

        // eslint-disable-next-line no-constant-condition
        while (true) {
          const line = await this.#connection.readLine();
          responseLines.push(line);

          if (line.startsWith(tag)) {
            // Command completed
            if (!line.includes('OK')) throw CommandError(command, line);
            break;
          }
        }

        return responseLines;
      },
      {
        message: `Command timeout: ${command}`,
        ms: timeoutMs,
      },
    );

    // Store the cancellable promise for potential early cancellation
    this.#activeCommands.set(tag, cancellable);

    try {
      // Wait for the command to complete or timeout
      return await cancellable.promise;
    } catch (error) {
      this.#activeCommands.delete(tag);
      throw error;
    } finally {
      this.#activeCommands.delete(tag);
    }
  }

  async #executeCommandIn(mailbox: string, command: string) {
    await this.selectMailbox(mailbox);
    return await this.#executeCommand(command);
  }

  /**
   * Generates a unique command tag
   * @returns Command tag
   */
  #generateTag(): string {
    this.#tagCounter++;
    return `A${this.#tagCounter.toString().padStart(4, '0')}`;
  }

  /**
   * Attempts to reconnect to the IMAP server
   * @returns Promise that resolves when reconnected
   * @throws {ImapConnectionError} If reconnection fails after max attempts
   */
  async #reconnect(): Promise<void> {
    // If already reconnecting, wait for that to complete
    if (this.#isReconnecting) return;

    this.#isReconnecting = true;
    this.#reconnectAttempts = 0;

    // Track the backoff timeout so we can clear it if needed
    let backoffTimeout: number | undefined;

    try {
      // Save the currently selected mailbox to reselect after reconnection
      let previousMailbox: string | undefined;
      if (this.#selectedMailbox) {
        previousMailbox = this.#selectedMailbox.name;
      }

      // Disconnect if still connected
      if (this.connected) await this.#connection.disconnect();

      // Reset state
      this.#authenticated = false;
      this.#selectedMailbox = undefined as ImapMailbox | undefined;
      this.#capabilities.clear();

      // Try to reconnect with exponential backoff
      while (this.#reconnectAttempts < this.#options.maxReconnectAttempts!) {
        try {
          console.info(
            `Reconnection attempt ${
              this.#reconnectAttempts + 1
            }/${this.#options.maxReconnectAttempts}...`,
          );

          // Wait with exponential backoff
          const delay = this.#options.reconnectDelay! * Math.pow(2, this.#reconnectAttempts);

          // Use a promise with a stored timeout ID so we can clear it if needed
          await new Promise<void>((resolve) => {
            backoffTimeout = setTimeout(() => {
              backoffTimeout = undefined;
              resolve();
            }, delay);
          });

          // Try to connect
          await this.connect();

          // If connected, authenticate
          if (this.connected) {
            await this.authenticate();

            // If previously had a mailbox selected, reselect it
            if (previousMailbox && this.#authenticated) {
              await this.selectMailbox(previousMailbox);
            }

            console.info('Reconnection successful');
            this.#reconnectAttempts = 0;
            return;
          }
        } catch (error) {
          console.warn(
            `Reconnection attempt ${this.#reconnectAttempts + 1} failed:`,
            error,
          );
        }

        this.#reconnectAttempts++;
      }

      // If we get here, all reconnection attempts failed
      const error = new Error(
        `Failed to reconnect after ${this.#options.maxReconnectAttempts} attempts`,
      );
      throw error;
    } finally {
      // Clear any pending backoff timeout
      if (backoffTimeout !== undefined) {
        clearTimeout(backoffTimeout);
        backoffTimeout = undefined;
      }

      this.#isReconnecting = false;
    }
  }

  #assertConnected() {
    if (!this.connected) throw new Error('Not connected to IMAP server');
  }
}
