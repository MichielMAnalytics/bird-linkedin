import { Command } from 'commander';
import { getContext, handleError, outputResult } from '../cli/shared.js';
import { printPosts } from '../lib/output.js';
import { formatProfile } from '../lib/output.js';

export function registerSearchCommands(program: Command): void {
  program
    .command('search <query>')
    .description('Search for posts/content')
    .option('-c, --count <n>', 'Number of results', '10')
    .action(async (query: string, opts, cmd) => {
      try {
        const globals = cmd.optsWithGlobals();
        const { client, json } = getContext(globals);
        const count = parseInt(opts.count, 10) || 10;
        const posts = await client.searchPosts(query, count);

        if (json) {
          outputResult(posts, true);
        } else {
          printPosts(posts);
        }
      } catch (err) {
        handleError(err);
      }
    });

  program
    .command('search-people <query>')
    .description('Search for people')
    .option('-c, --count <n>', 'Number of results', '10')
    .action(async (query: string, opts, cmd) => {
      try {
        const globals = cmd.optsWithGlobals();
        const { client, json } = getContext(globals);
        const count = parseInt(opts.count, 10) || 10;
        const people = await client.searchPeople(query, count);

        if (json) {
          outputResult(people, true);
        } else {
          if (people.length === 0) {
            console.log('No results found.');
          } else {
            for (let i = 0; i < people.length; i++) {
              if (i > 0) console.log('---');
              console.log(formatProfile(people[i]));
            }
          }
        }
      } catch (err) {
        handleError(err);
      }
    });
}
