import { Command } from 'commander';
import { registerCheckCommands } from '../commands/check.js';
import { registerReadCommands } from '../commands/read.js';
import { registerHomeCommands } from '../commands/home.js';
import { registerUserPostsCommands } from '../commands/user-posts.js';
import { registerSearchCommands } from '../commands/search.js';
import { registerProfileCommands } from '../commands/profile.js';
import { registerPostCommands } from '../commands/post.js';

export function createProgram(): Command {
  const program = new Command();

  program
    .name('bird-linkedin')
    .description('LinkedIn CLI client using Voyager API')
    .version('1.0.0')
    .option('--json', 'Output as JSON')
    .option('--li-at <token>', 'li_at cookie (or set LI_AT env var)')
    .option('--jsessionid <token>', 'JSESSIONID cookie (or set JSESSIONID env var)')
    .option('--timeout <ms>', 'Request timeout in ms')
    .option('--verbose', 'Verbose output');

  registerCheckCommands(program);
  registerReadCommands(program);
  registerHomeCommands(program);
  registerUserPostsCommands(program);
  registerSearchCommands(program);
  registerProfileCommands(program);
  registerPostCommands(program);

  return program;
}
