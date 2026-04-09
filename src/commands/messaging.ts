import { Command } from 'commander';
import { getContext, outputResult, handleError } from '../cli/shared.js';
import { printSuccess, printError as printErr, printInfo } from '../lib/output.js';
import { formatConversation, formatMessage, printConversations, printMessages } from '../lib/output.js';

export function registerMessagingCommands(program: Command): void {
  program
    .command('conversations')
    .description('List recent conversations')
    .option('-c, --count <n>', 'Number of conversations', '20')
    .action(async (opts, cmd) => {
      try {
        const { client, json } = getContext(cmd.optsWithGlobals());
        const { conversations } = await client.getConversations(parseInt(opts.count, 10));
        if (json) {
          outputResult(conversations, true);
        } else {
          printConversations(conversations);
        }
      } catch (err) {
        handleError(err);
      }
    });

  program
    .command('chat <handle>')
    .description('View conversation with a user')
    .option('-c, --count <n>', 'Number of messages', '20')
    .action(async (handle: string, opts, cmd) => {
      try {
        const { client, json } = getContext(cmd.optsWithGlobals());

        const found = await client.findConversation(handle);
        if (!found || !found.conversationUrn) {
          printErr(`No conversation found with "${handle}"`);
          process.exit(1);
        }

        const messages = await client.getMessages(found.conversationUrn, parseInt(opts.count, 10));
        if (json) {
          outputResult(messages, true);
        } else {
          printInfo(`Conversation with ${handle}`);
          printMessages(messages);
        }
      } catch (err) {
        handleError(err);
      }
    });

  program
    .command('dm <handle> <text>')
    .description('Send a direct message')
    .option('--dry-run', 'Preview without sending')
    .action(async (handle: string, text: string, opts, cmd) => {
      try {
        const { client, json } = getContext(cmd.optsWithGlobals());

        if (opts.dryRun) {
          printInfo(`Dry run — would send to ${handle}:`);
          console.log(text);
          return;
        }

        const result = await client.sendDM(handle, text);
        if (result.success) {
          if (json) {
            outputResult({ success: true, messageUrn: result.messageUrn }, true);
          } else {
            printSuccess(`Message sent to ${handle}`);
          }
        } else {
          printErr(result.error || 'Failed to send message');
        }
      } catch (err) {
        handleError(err);
      }
    });
}
