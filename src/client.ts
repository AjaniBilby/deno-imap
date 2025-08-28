import * as commands from './commands/mod.ts';
import * as parsers from './parsers/mod.ts';
import type {
	ImapAuthMechanism,
	ImapFetchOptions,
	ImapMailbox,
	ImapMessage,
	ImapOptions,
	ImapSearchCriteria,
} from './types/mod.ts';
import { createCancellablePromise } from './utils/promises.ts';
import { ImapConnection } from './connection.ts';
import {
	ImapAuthError,
	ImapCapabilityError,
	ImapCommandError,
	ImapConnectionError,
	ImapNoMailboxSelectedError,
	ImapNotConnectedError,
	ImapTimeoutError,
} from './errors.ts';
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
		ReturnType<typeof createCancellablePromise>
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
			throw new ImapCommandError('connect', greeting);
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
		if (!this.connected) throw new ImapNotConnectedError();

		if (this.#authenticated) return;

		// Check if the server supports the requested auth mechanism
		const authCap = `AUTH=${mechanism}`;
		if (!this.#capabilities.has(authCap)) throw new ImapCapabilityError(authCap);

		try {
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
		} catch (error) {
			// Only transform ImapCommandError to ImapAuthError
			if (error instanceof ImapCommandError) {
				throw new ImapAuthError(`Authentication failed: ${error.response}`);
			}
			// Let other errors propagate naturally
			throw error;
		}
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
		if (!this.connected) throw new ImapNotConnectedError();

		if (!this.#authenticated) await this.authenticate();

		const response = await this.#executeCommand(
			commands.list(reference, mailbox)
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
		if (!this.connected) {
			throw new ImapNotConnectedError();
		}

		if (!this.#authenticated) {
			await this.authenticate();
		}

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
		if (!this.connected) throw new ImapNotConnectedError();
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
		if (!this.connected) throw new ImapNotConnectedError();

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

	async closeMailbox(): Promise<void> {
		if (!this.connected) throw new ImapNotConnectedError();
		if (!this.#authenticated) throw new ImapNotConnectedError('Not authenticated');
		if (!this.#selectedMailbox) return;

		await this.#executeCommand(commands.close());
		this.#selectedMailbox = undefined;
	}

	async createMailbox(mailbox: string): Promise<void> {
		if (!this.connected) throw new ImapNotConnectedError();
		if (!this.#authenticated) await this.authenticate();

		await this.#executeCommand(commands.create(mailbox));
	}

	async deleteMailbox(mailbox: string): Promise<void> {
		if (!this.connected) throw new ImapNotConnectedError();

		if (!this.#authenticated) await this.authenticate();

		await this.#executeCommand(commands.deleteMailbox(mailbox));

		// If the deleted mailbox is the currently selected one, clear it
		if (this.#selectedMailbox && this.#selectedMailbox.name === mailbox) {
			this.#selectedMailbox = undefined;
		}
	}

	async renameMailbox(oldName: string, newName: string): Promise<void> {
		if (!this.connected) throw new ImapNotConnectedError();
		if (!this.#authenticated) await this.authenticate();

		await this.#executeCommand(commands.rename(oldName, newName));

		// If the renamed mailbox is the currently selected one, update its name
		if (this.#selectedMailbox && this.#selectedMailbox.name === oldName) {
			this.#selectedMailbox.name = newName;
		}
	}

	async subscribeMailbox(mailbox: string): Promise<void> {
		if (!this.connected) {
			throw new ImapNotConnectedError();
		}

		if (!this.#authenticated) {
			await this.authenticate();
		}

		await this.#executeCommand(commands.subscribe(mailbox));
	}

	/**
	 * Unsubscribes from a mailbox
	 * @param mailbox Mailbox name
	 * @returns Promise that resolves when unsubscribed
	 */
	async unsubscribeMailbox(mailbox: string): Promise<void> {
		if (!this.connected) {
			throw new ImapNotConnectedError();
		}

		if (!this.#authenticated) {
			await this.authenticate();
		}

		await this.#executeCommand(commands.unsubscribe(mailbox));
	}

	async findMany<T extends engine.FindManyImapMessageArgs>(mailbox: string, args: T): Promise<engine.FindManyResult<T>> {
		await this.selectMailbox(mailbox);

		const out: engine.FindManyResult<T> = [];
		const include = args?.include || engine.INCLUDE_ALL;

		// ensure values to resolve the where are present
		if (args?.where) {
			if (args.where.receivedDate) include.receivedDate = true;
			if (args.where.flags)        include.flags        = true;
			if (args.where.envelope)     include.envelope     = true;
		}

		const orderBy = engine.MakeOrderBy(args.orderBy);
		if (orderBy.sort) {
			include.receivedDate = true;
			include.seq = true;
			include.uid = true;
		}

		const query = args.where ? engine.MakeWhereQuery(args.where) : "";

		const response = await this.#executeCommand(`SEARCH ${query || "ALL"}`);
		const result = response.find(x => x.startsWith("* SEARCH "));
		if (!result) return out;

		const ids = result
			.slice("* SEARCH ".length)
			.trim()
			.split(' ')
			.filter(Boolean)
			.map(x => parseInt(x, 10))
			.filter(x => !isNaN(x));

		if (orderBy.fetch) ids.sort(orderBy.fetch);

		return out;
	}

	async findFirst<T extends engine.FindManyImapMessageArgs>(mailbox: string, args: T): Promise<engine.FindManyResult<T>[number] | undefined> {
		args.take = 1;
		const group = await this.findMany(mailbox, args);
		return group[0] || undefined;
	}

	async findFirstOrThrow<T extends engine.FindManyImapMessageArgs>(mailbox: string, args: T): Promise<engine.FindManyResult<T>[number]> {
		const first = await this.findFirst(mailbox, args);
		if (!first) throw new Error("Unable to find email");

		return first;
	}

	/**
	 * Searches for messages
	 * @deprecated
	 * @param criteria Search criteria
	 * @param charset Character set
	 * @returns Promise that resolves with the message numbers
	 */
	async search(
		criteria: ImapSearchCriteria,
		charset?: string,
	): Promise<number[]> {
		if (!this.connected) {
			throw new ImapNotConnectedError();
		}

		if (!this.#authenticated) {
			await this.authenticate();
		}

		if (!this.#selectedMailbox) {
			throw new ImapNoMailboxSelectedError();
		}

		const response = await this.#executeCommand(
			commands.search(criteria, charset),
		);

		for (const line of response) {
			if (line.startsWith('* SEARCH')) {
				try {
					return parsers.parseSearch(line);
				} catch (error) {
					console.warn('Failed to parse SEARCH response:', error);
				}
			}
		}

		return [];
	}

	/**
	 * Fetches messages
	 * @param sequence Message sequence set
	 * @param options Fetch options
	 * @returns Promise that resolves with the messages
	 */
	async fetch(
		sequence: string,
		options: ImapFetchOptions,
	): Promise<ImapMessage[]> {
		if (!this.connected) throw new ImapNotConnectedError();
		if (!this.#authenticated) await this.authenticate();
		if (!this.#selectedMailbox) throw new ImapNoMailboxSelectedError();

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
	 * Sets flags on messages
	 * @param sequence Message sequence set
	 * @param flags Flags to set
	 * @param action Action to perform
	 * @param useUid Whether to use UIDs
	 * @returns Promise that resolves when the flags are set
	 */
	async setFlags(
		sequence: string,
		flags: string[],
		action: 'set' | 'add' | 'remove' = 'set',
		useUid = false,
	): Promise<void> {
		if (!this.connected)        throw new ImapNotConnectedError();
		if (!this.#authenticated)   await this.authenticate();
		if (!this.#selectedMailbox) throw new ImapNoMailboxSelectedError();

		await this.#executeCommand(commands.store(sequence, flags, action, useUid));
	}

	/**
	 * Copies messages to another mailbox
	 * @param sequence Message sequence set
	 * @param mailbox Destination mailbox
	 * @param useUid Whether to use UIDs
	 * @returns Promise that resolves when the messages are copied
	 */
	async copyMessages(
		sequence: string,
		mailbox: string,
		useUid = false,
	): Promise<void> {
		if (!this.connected) {
			throw new ImapNotConnectedError();
		}

		if (!this.#authenticated) {
			await this.authenticate();
		}

		if (!this.#selectedMailbox) {
			throw new ImapNoMailboxSelectedError();
		}

		await this.#executeCommand(commands.copy(sequence, mailbox, useUid));
	}

	/**
	 * Moves messages to another mailbox
	 * @param sequence Message sequence set
	 * @param mailbox Destination mailbox
	 * @param useUid Whether to use UIDs
	 * @returns Promise that resolves when the messages are moved
	 */
	async moveMessages(
		sequence: string,
		mailbox: string,
		useUid = false,
	): Promise<void> {
		if (!this.connected) {
			throw new ImapNotConnectedError();
		}

		if (!this.#authenticated) {
			await this.authenticate();
		}

		if (!this.#selectedMailbox) {
			throw new ImapNoMailboxSelectedError();
		}

		// Check if the server supports MOVE
		if (this.#capabilities.has('MOVE')) {
			await this.#executeCommand(commands.move(sequence, mailbox, useUid));
		} else {
			// Fall back to COPY + STORE + EXPUNGE
			await this.copyMessages(sequence, mailbox, useUid);
			await this.setFlags(sequence, ['\\Deleted'], 'add', useUid);
			await this.#executeCommand(commands.expunge());
		}
	}

	/**
	 * Expunges deleted messages
	 * @returns Promise that resolves when the messages are expunged
	 */
	async expunge(): Promise<void> {
		if (!this.connected) throw new ImapNotConnectedError();
		if (!this.#authenticated) await this.authenticate();
		if (!this.#selectedMailbox) throw new ImapNoMailboxSelectedError();

		await this.#executeCommand(commands.expunge());
	}

	/**
	 * Appends a message to a mailbox
	 * @param mailbox Mailbox name
	 * @param message Message content
	 * @param flags Message flags
	 * @param date Message date
	 * @returns Promise that resolves when the message is appended
	 */
	async appendMessage(
		mailbox: string,
		message: string,
		flags?: string[],
		date?: Date,
	): Promise<void> {
		if (!this.connected) throw new ImapNotConnectedError();
		if (!this.#authenticated) await this.authenticate();

		const tag = this.#generateTag();
		const timeoutMs = this.#options.commandTimeout || 30000;

		const cancellable = createCancellablePromise<void>(
			async () => {
				try {
					// Send the APPEND command
					const command = commands.append(mailbox, message, flags, date);
					await this.#connection.writeLine(`${tag} ${command}`);

					// Wait for the continuation response
					const response = await this.#connection.readLine();

					if (!response.startsWith('+')) {
						throw new ImapCommandError('APPEND', response);
					}

					// Send the message content
					await this.#connection.writeLine(message);

					// Wait for the command completion
					while (true) {
						const line = await this.#connection.readLine();

						if (line.startsWith(tag)) {
							// Command completed
							if (!line.includes('OK')) {
								throw new ImapCommandError('APPEND', line);
							}
							break;
						}
					}
				} catch (error) {
					// If the error is from the connection (e.g., socket timeout),
					// clean up and rethrow
					if (
						error instanceof ImapTimeoutError ||
						error instanceof ImapConnectionError
					) {
						// If the connection was lost, attempt to reconnect if enabled
						if (
							this.#options.autoReconnect &&
							error instanceof ImapConnectionError
						) {
							try {
								await this.#reconnect();

								// If reconnection was successful, retry the append operation
								// Note: The message may have been partially appended before the connection was lost
								await this.appendMessage(mailbox, message, flags, date);
								return;
							} catch (_reconnectError) {
								// If reconnection failed, throw the original error
								throw error;
							}
						}
					}

					throw error;
				}
			},
			timeoutMs,
			`APPEND command timeout`,
		);

		// Store the cancellable promise for potential early cancellation
		this.#activeCommands.set(tag, cancellable);

		try {
			await cancellable.promise;
		} finally {
			this.#activeCommands.delete(tag);
		}
	}

	/**
	 * Executes an IMAP command
	 * @param command Command to execute
	 * @returns Promise that resolves with the response lines
	 */
	async #executeCommand(command: string): Promise<string[]> {
		if (!this.connected) throw new ImapNotConnectedError();

		const tag = this.#generateTag();

		// Create a cancellable timeout promise
		const timeoutMs = this.#options.commandTimeout || 30000;
		const cancellable = createCancellablePromise<string[]>(
			async () => {
				try {
					// Send the command
					await this.#connection.writeLine(`${tag} ${command}`);

					// Wait for the response
					const responseLines: string[] = [];

					while (true) {
						const line = await this.#connection.readLine();
						responseLines.push(line);

						if (line.startsWith(tag)) {
							// Command completed
							if (!line.includes('OK')) {
								throw new ImapCommandError(command, line);
							}
							break;
						}
					}

					return responseLines;
				} catch (error) {
					// If the error is from the connection (e.g., socket timeout),
					// clean up and rethrow
					if (error instanceof ImapTimeoutError) {
						console.warn(`Command timed out: ${command}. Disconnecting...`);
						await this.#connection.disconnect();

						// Reconnect if enabled
						if (this.#options.autoReconnect) {
							try {
								await this.#reconnect();
								console.log('Reconnected after command timeout');
							} catch (reconnectError) {
								throw new ImapConnectionError(
									`Command timed out and reconnection failed: ${error.message}`,
									reconnectError instanceof Error
										? reconnectError
										: new Error(String(reconnectError)),
								);
							}
						}
					}

					throw error;
				}
			},
			timeoutMs,
			`Command timeout: ${command}`,
		);

		// Store the cancellable promise for potential early cancellation
		this.#activeCommands.set(tag, cancellable);

		try {
			// Wait for the command to complete or timeout
			return await cancellable.promise;
		} catch (error) {
			// Automatically disconnect on timeout
			if (error instanceof ImapTimeoutError) {
				console.warn(`Command timed out: ${command}. Disconnecting...`);
				await this.#connection.disconnect();

				// Reconnect if enabled
				if (this.#options.autoReconnect) {
					try {
						await this.#reconnect();
						console.log('Reconnected after command timeout');
					} catch (reconnectError) {
						throw new ImapConnectionError(
							`Command timed out and reconnection failed: ${error.message}`,
							reconnectError instanceof Error ? reconnectError : new Error(String(reconnectError)),
						);
					}
				}
			}

			throw error;
		} finally {
			this.#activeCommands.delete(tag);
		}
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
			if (this.connected) {
				await this.#connection.disconnect();
			}

			// Reset state
			this.#authenticated = false;
			this.#selectedMailbox = undefined as ImapMailbox | undefined;
			this.#capabilities.clear();

			// Try to reconnect with exponential backoff
			while (this.#reconnectAttempts < this.#options.maxReconnectAttempts!) {
				try {
					console.log(
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

						console.log('Reconnection successful');
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
			const error = new ImapConnectionError(
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
}
