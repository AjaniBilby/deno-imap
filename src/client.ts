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
import { CapabilityError, CommandError } from './errors.ts';
import { CreateCancellablePromise } from './utils/promises.ts';
import { ImapConnection } from './connection.ts';
import * as engine from './engine.ts';

/**
 * Tell deno example checking that client is a know keyword
 * ```ts
 * declare const client: ImapClient;
 * ```
 */


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
    await this.#updateCapabilities();
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

  async #updateCapabilities(): Promise<string[]> {
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

  async #authenticate(mechanism: ImapAuthMechanism = 'PLAIN'): Promise<void> {
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

    await this.#updateCapabilities();
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

  /**
   * Lists available mailboxes on the server
   * @param reference Reference name for the mailbox hierarchy (default: '')
   * @param mailbox Mailbox name pattern to match (default: '*')
   * @returns Promise that resolves with an array of mailboxes
   * @example
   * ```ts
   * // List all mailboxes
   * const allMailboxes = await client.listMailboxes();
   * console.log(allMailboxes.map(mb => mb.name)); // ['INBOX', 'Sent', 'Drafts', ...]
   *
   * // List only mailboxes starting with 'INBOX'
   * const inboxMailboxes = await client.listMailboxes('', 'INBOX*');
   *
   * // List mailboxes in a specific folder
   * const projectMailboxes = await client.listMailboxes('Projects/', '*');
   * ```
   */
  async listMailboxes(reference = '', mailbox = '*'): Promise<ImapMailbox[]> {
    this.#assertConnected();
    if (!this.#authenticated) await this.#authenticate();

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

  /**
   * Gets the status of a specific mailbox
   * @param mailbox Name of the mailbox to check
   * @param items Status items to retrieve (default: ['MESSAGES', 'RECENT', 'UNSEEN', 'UIDNEXT', 'UIDVALIDITY'])
   * @returns Promise that resolves with mailbox status information
   * @example
   * ```ts
   * // Get full status of INBOX
   * const status = await client.getMailboxStatus('INBOX');
   * console.log(`INBOX has ${status.messages} messages, ${status.unseen} unread`);
   *
   * // Get only message counts
   * const counts = await client.getMailboxStatus('INBOX', ['MESSAGES', 'UNSEEN']);
   * console.log(`${counts.messages} total, ${counts.unseen} unread`);
   * ```
   */
  async getMailboxStatus(
    mailbox: string,
    items = ['MESSAGES', 'RECENT', 'UNSEEN', 'UIDNEXT', 'UIDVALIDITY'],
  ): Promise<Partial<ImapMailbox>> {
    this.#assertConnected();
    if (!this.#authenticated) await this.#authenticate();

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

  /**
   * Selects a mailbox for read/write access
   * @param mailbox Name of the mailbox to select
   * @param allowStale Whether to allow returning cached mailbox info if already selected (default: true)
   * @returns Promise that resolves with the selected mailbox information
   * ```ts
   * // Select INBOX for reading/writing emails
   * const inbox = await client.selectMailbox('INBOX');
   * console.log(`Selected ${inbox.name} with ${inbox.exists} messages`);
   *
   * // Force fresh selection even if already selected
   * const freshInbox = await client.selectMailbox('INBOX', false);
   *
   * // Select a different mailbox
   * const sent = await client.selectMailbox('Sent');
   */
  async selectMailbox(mailbox: string, allowStale = true): Promise<ImapMailbox> {
    this.#assertConnected();
    if (!this.#authenticated) await this.#authenticate();

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

  /**
   * Examines a mailbox for read-only access
   * @param mailbox Name of the mailbox to examine
   * @returns Promise that resolves with the mailbox information
   * @example
   * ```ts
   * // Examine INBOX in read-only mode
   * const inbox = await client.examineMailbox('INBOX');
   * console.log(`Examined ${inbox.name} with ${inbox.exists} messages (read-only)`);
   *
   * // Examine without affecting current selection
   * const drafts = await client.examineMailbox('Drafts');
   * console.log(`Drafts has ${drafts.unseen} unseen messages`);
   * ```
   */
  async examineMailbox(mailbox: string): Promise<ImapMailbox> {
    this.#assertConnected();
    if (!this.#authenticated) await this.#authenticate();

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

  /**
   * Finds multiple messages in a mailbox based on search criteria
   * @param mailbox Name of the mailbox to search
   * @param args Search criteria including where conditions, ordering, and data to include
   * @returns Promise that resolves with an array of matching messages
   * @example
   * ```ts
   * // Find all unread messages
   * const unread = await client.findMany('INBOX', {
   *   where: { flags: { hasNone: ['Seen'] } }
   * });
   *
   * // Find recent emails from a specific sender
   * const fromBoss = await client.findMany('INBOX', {
   *   where: {
   *     envelope: {
   *       from: { has: 'boss@company.com' },
   *       date: { gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) }
   *     }
   *   },
   *   include: { envelope: true, flags: true },
   *   orderBy: { receivedDate: 'desc' },
   *   take: 10
   * });
   *
   * // Find emails with specific subject
   * const reports = await client.findMany('INBOX', {
   *   where: {
   *     envelope: { subject: { contains: 'Daily Report' } }
   *   }
   * });
   * ```
   */
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

  /**
   * Finds the first message matching the search criteria
   * @param mailbox Name of the mailbox to search
   * @param args Search criteria including where conditions, ordering, and data to include
   * @returns Promise that resolves with the first matching message or undefined if none found
   * @example
   * ```ts
   * // Find the most recent unread email
   * const latestUnread = await client.findFirst('INBOX', {
   *   where:   { flags: { hasNone: ['Seen'] } },
   *   orderBy: { receivedDate: 'desc' },
   *   include: { envelope: true, body: true }
   * });
   *
   * if (latestUnread) {
   *   console.log(`Latest unread: ${latestUnread.envelope?.subject}`);
   * }
   *
   * // Find oldest message in mailbox
   * const oldest = await client.findFirst('INBOX', {
   *   orderBy: { receivedDate: 'asc' }
   * });
   * ```
   */
  async findFirst<T extends engine.FindManyImapMessageArgs>(
    mailbox: string,
    args: T,
  ): Promise<engine.FindManyResult<T>[number] | undefined> {
    args.take = 1;
    const group = await this.findMany(mailbox, args);
    return group[0] || undefined;
  }

  /**
   * Finds the first message matching the search criteria, throws if not found
   * @param mailbox Name of the mailbox to search
   * @param args Search criteria including where conditions, ordering, and data to include
   * @returns Promise that resolves with the first matching message
   * @throws {Error} If no message is found
   * @example
   * ```ts
   * // No need to check for undefined - will throw if not found
   * const message = await client.findFirstOrThrow('INBOX', {
   *   where: {
   *     envelope: { messageId: { equals: '<specific-id@domain.com>' } }
   *   },
   *   include: { body: true, headers: true }
   * });
   *
   * // Can directly use the result without null checks
   * console.log('Subject:', message.envelope.subject);
   * console.log('Body length:', message.body.length);
   *
   * // Find the latest unread email (throws if none exist)
   * const latestUnread = await client.findFirstOrThrow('INBOX', {
   *   where:   { flags: { hasNone: ['Seen'] } },
   *   orderBy: { receivedDate: 'desc' }
   * });
   *
   * // Guaranteed to have a message here
   * await client.updateMany('INBOX', {
   *   where: [{ uid: latestUnread.uid }],
   *   data: { flags: { add: ['Seen'] } }
   * });
   * ```
   */
  async findFirstOrThrow<T extends engine.FindManyImapMessageArgs>(
    mailbox: string,
    args: T,
  ): Promise<engine.FindManyResult<T>[number]> {
    const first = await this.findFirst(mailbox, args);
    if (!first) throw new Error('Unable to find email');

    return first;
  }

  /**
   * Updates multiple messages with new flags or moves them to another mailbox
   * @param mailbox Name of the mailbox containing the messages
   * @param args designed to take an output from findMany
   * @returns Promise that resolves when the update is complete
   * @example
   * ```ts
   * // Mark messages as read
   * await client.updateMany('INBOX', {
   *   where: [{ uid: 123 }, { uid: 456 }],
   *   data: { flags: { add: ['Seen'] } }
   * });
   *
   * // Flag important messages
   * await client.updateMany('INBOX', {
   *   where: [{ seq: 1 }, { seq: 2 }, { seq: 3 }],
   *   data: { flags: { add: ['Flagged'] } }
   * });
   *
   * // Move messages to Archive folder
   * await client.updateMany('INBOX', {
   *   where: [{ uid: 789 }],
   *   data: { mailbox: 'Archive' }
   * });
   *
   * // Remove draft flag and add seen flag
   * await client.updateMany('Drafts', {
   *   where: [{ uid: 999 }],
   *   data: {
   *     flags: {
   *       remove: ['Draft'],
   *       add: ['Seen']
   *     }
   *   }
   * });
   * ```
   */
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

  /**
   * Deletes multiple messages by marking them as deleted and expunging
   * @param mailbox Name of the mailbox containing the messages
   * @param args designed to take an output from findMany
   * @returns Promise that resolves when the deletion is complete
   * @example
   * ```ts
   * // Delete specific messages by UID
   * await client.deleteMany('INBOX', {
   *   where: [{ uid: 123 }, { uid: 456 }, { uid: 789 }]
   * });
   *
   * // Delete messages by sequence number
   * await client.deleteMany('Trash', {
   *   where: [{ seq: 1 }, { seq: 2 }, { seq: 3 }]
   * });
   *
   * // Combined UID and sequence deletion
   * await client.deleteMany('Spam', {
   *   where: [
   *     { seq: 5   },
   *     { uid: 100 },
   *     { uid: 200 }
   *   ]
   * });
   * ```
   */
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
            await this.#authenticate();

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
