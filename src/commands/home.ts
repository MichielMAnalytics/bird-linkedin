import { Command } from 'commander';
import { getContext, handleError, outputResult } from '../cli/shared.js';
import { printPosts } from '../lib/output.js';

export function registerHomeCommands(program: Command): void {
  program
    .command('home')
    .description('Show home feed')
    .option('-c, --count <n>', 'Number of posts', '10')
    .action(async (opts, cmd) => {
      try {
        const globals = cmd.optsWithGlobals();
        const { client, json } = getContext(globals);
        const count = parseInt(opts.count, 10) || 10;
        const posts = await client.getHomeFeed(count);

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
