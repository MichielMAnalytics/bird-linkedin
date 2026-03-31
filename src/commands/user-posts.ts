import { Command } from 'commander';
import { getContext, handleError, outputResult } from '../cli/shared.js';
import { printPosts } from '../lib/output.js';

export function registerUserPostsCommands(program: Command): void {
  program
    .command('user-posts <handle>')
    .description('Show posts from a user')
    .option('-c, --count <n>', 'Number of posts', '10')
    .action(async (handle: string, opts, cmd) => {
      try {
        const globals = cmd.optsWithGlobals();
        const { client, json } = getContext(globals);
        const count = parseInt(opts.count, 10) || 10;
        const posts = await client.getUserPosts(handle, count);

        if (json) {
          outputResult(posts, true);
        } else {
          printPosts(posts);
        }
      } catch (err) {
        handleError(err);
      }
    });
}
