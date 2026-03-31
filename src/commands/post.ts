import { Command } from 'commander';
import { getContext, handleError } from '../cli/shared.js';
import { printInfo, printError as printErr } from '../lib/output.js';

export function registerPostCommands(program: Command): void {
  program
    .command('post <text>')
    .description('Create a new post (not yet active)')
    .option('--dry-run', 'Preview without posting')
    .action(async (text: string, opts, cmd) => {
      try {
        const { client } = getContext(cmd.optsWithGlobals());

        if (opts.dryRun) {
          printInfo('Dry run - would post:');
          console.log(text);
          return;
        }

        const result = await client.createPost(text);
        if (result.success) {
          printInfo('Post created!');
        } else {
          printErr(result.error || 'Failed to create post');
        }
      } catch (err) {
        handleError(err);
      }
    });

  program
    .command('reply <postId> <text>')
    .description('Reply to a post (not yet active)')
    .option('--dry-run', 'Preview without replying')
    .action(async (postId: string, text: string, opts, cmd) => {
      try {
        const { client } = getContext(cmd.optsWithGlobals());

        if (opts.dryRun) {
          printInfo(`Dry run - would reply to ${postId}:`);
          console.log(text);
          return;
        }

        const result = await client.replyToPost(postId, text);
        if (result.success) {
          printInfo('Reply posted!');
        } else {
          printErr(result.error || 'Failed to reply');
        }
      } catch (err) {
        handleError(err);
      }
    });
}
