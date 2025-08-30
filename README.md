![heroic email delivery](https://github.com/user-attachments/assets/225be12e-9bf9-4faa-a4f2-2f7719fb5254)

# deno-imap

A heroic IMAP (Internet Message Access Protocol) client for Deno.

## Features

- Full IMAP protocol support
- TLS/SSL support
- Authentication (PLAIN, LOGIN)
- Mailbox management (list, create, delete, rename)
- Message operations (search, fetch, move, copy, delete)
- Flag management (mark as read/unread, flag/unflag)
- Comprehensive TypeScript types
- Promise-based API
- Utility functions for common operations

## Installation

You can import the module directly from the JSR registry:

```typescript
import { ImapClient } from 'jsr:@workingdevshero/deno-imap';
```

Or import it from GitHub:

```typescript
import { ImapClient } from 'https://raw.githubusercontent.com/workingdevshero/deno-imap/main/mod.ts';
```

## Basic Usage

```typescript
import { ImapClient } from 'jsr:@workingdevshero/deno-imap';

// Create a new IMAP client
const client = new ImapClient({
  host: 'imap.example.com',
  port: 993,
  tls: true,
  username: 'user@example.com',
  password: 'password',
});

// Connect and authenticate
await client.connect();
await client.authenticate();

// List mailboxes
const mailboxes = await client.listMailboxes();
console.log('Available mailboxes:', mailboxes);

// Get the 10 oldest unread messages 
const mailbox = await imap.findMany('INBOX', {
  where: {
    envelope: {
      from: { has: "sender@example.com" },
      to:   { has: "me@example.com" }
    },
    flags: { hasNone: [ 'Seen' ]}
  },
  include: { uid: true, envelope: true, body: true },
  orderBy: { seq: 'asc' },
  take: 10
});

// Display message details
for (const message of mailbox) {
  console.log('Message #', message.seq);
  console.log('Subject:', message.envelope.subject);
  console.log(
    'From:',
    message.envelope?.from.[0].mailbox + '@' + message.envelope.from.[0].host,
  );
  console.log('Date:', message.envelope?.date);
  console.log(
    'To:',
    message.envelope.from.map(a => `${a.mailbox}@${a.host}`).join(", ")
  );
  console.log(
    'Attachments:',
    message.body.attachments.map(x => x.filename).join(", ")
  )
}

// Disconnect
client.disconnect();
```

## Using Environment Variables

For security and flexibility, you can store your IMAP connection details in environment variables:

```typescript
const client = new ImapClient({
  host: Deno.env.get('IMAP_HOST')!,
  port: parseInt(Deno.env.get('IMAP_PORT')!),
  tls: Deno.env.get('IMAP_USE_TLS') !== 'false',
  username: Deno.env.get('IMAP_USERNAME')!,
  password: Deno.env.get('IMAP_PASSWORD')!,
});
```

Create a `.env` file with your connection details:

```
IMAP_HOST="imap.example.com"
IMAP_PORT=993
IMAP_USERNAME="user@example.com"
IMAP_PASSWORD="your_password_here"
IMAP_USE_TLS="true"
```

Then run your script with the `--env-file` flag:

```bash
deno run --allow-net --allow-env --env-file=.env your_script.ts
```

## Examples

<!-- The [examples](./examples) directory contains sample code demonstrating how to use the IMAP client:

- [Basic Example](./examples/basic.ts): Demonstrates connecting to an IMAP server, listing
  mailboxes, and checking the INBOX status.
- [Search Example](./examples/search.ts): Shows how to search for messages using various criteria.
- [Fetch Example](./examples/fetch.ts): Demonstrates how to fetch and decode message content,
  including handling multipart messages and different encodings.
- [Mailboxes Example](./examples/mailboxes.ts): Shows how to manage mailboxes, including creating,
  renaming, and deleting them.
- [Advanced Example](./examples/advanced.ts): Shows more advanced features like searching, fetching
  message content, and manipulating messages.
- [Attachments Example](./examples/attachments.ts): Demonstrates how to find messages with
  attachments, fetch attachment data, properly decode it based on the encoding (BASE64,
  QUOTED-PRINTABLE, etc.), and save attachments to a local folder.

To run the examples, create a `.env` file with your IMAP server details, then run:

```bash
# Run the basic example
deno run --allow-net --allow-env --env-file=.env examples/basic.ts

# Run the search example
deno run --allow-net --allow-env --env-file=.env examples/search.ts

# Run the fetch example
deno run --allow-net --allow-env --env-file=.env examples/fetch.ts

# Run the mailboxes example
deno run --allow-net --allow-env --env-file=.env examples/mailboxes.ts

# Run the advanced example
deno run --allow-net --allow-env --env-file=.env examples/advanced.ts

# Run the attachments example
deno run --allow-net --allow-env --env-file=.env --allow-write --allow-read examples/attachments.ts
``` -->

## License

MIT
