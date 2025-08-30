export * from '../utils/promises.ts';

/**
 * Creates a mailbox hierarchy
 * @deprecated
 * @param client IMAP client
 * @param path Mailbox path
 * @param delimiter Delimiter to use
 * @returns Promise that resolves when the mailbox hierarchy is created
 */
// export async function createMailboxHierarchy(
//   client: ImapClient,
//   path: string,
//   delimiter = '/',
// ): Promise<void> {
//   const parts = path.split(delimiter);
//   let currentPath = '';

//   for (const part of parts) {
//     if (currentPath) {
//       currentPath += delimiter;
//     }

//     currentPath += part;

//     try {
//       await client.createMailbox(currentPath);
//     } catch (error: unknown) {
//       // Ignore errors if the mailbox already exists
//       if (error instanceof Error && !error.message.includes('ALREADYEXISTS')) {
//         throw error;
//       }
//     }
//   }
// }

/**
 * Gets all mailboxes in a hierarchy
 * @deprecated
 * @param client IMAP client
 * @param reference Reference name (usually empty string)
 * @param pattern Mailbox name pattern
 * @returns Promise that resolves with the mailboxes
//  */
// export async function getMailboxHierarchy(
//   client: ImapClient,
//   reference = '',
//   pattern = '*',
// ): Promise<Map<string, string[]>> {
//   const mailboxes = await client.listMailboxes(reference, pattern);
//   const hierarchy = new Map<string, string[]>();

//   for (const mailbox of mailboxes) {
//     const parts = mailbox.name.split(mailbox.delimiter);
//     let parent = '';

//     for (let i = 0; i < parts.length - 1; i++) {
//       if (parent) {
//         parent += mailbox.delimiter;
//       }

//       parent += parts[i];
//     }

//     if (!hierarchy.has(parent)) {
//       hierarchy.set(parent, []);
//     }

//     hierarchy.get(parent)?.push(mailbox.name);
//   }

//   return hierarchy;
// }
