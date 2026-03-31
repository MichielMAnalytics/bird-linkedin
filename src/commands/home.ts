import { Command } from 'commander';
import { getContext, handleError, outputResult } from '../cli/shared.js';
import { printPosts } from '../lib/output.js';

export function registerHomeCommands(program: Command): void {
  program
    .command('home')
    .description('Show home feed')
    .option('-c, --count <n>', 'Number of posts', '10')
    .option('-s, --start <n>', 'Start offset for pagination', '0')
    .action(async (opts, cmd) => {
      try {
        const globals = cmd.optsWithGlobals();
        const { client, json } = getContext(globals);
        const count = parseInt(opts.count, 10) || 10;
        const start = parseInt(opts.start, 10) || 0;
        const posts = await client.getHomeFeed(count, start);

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
