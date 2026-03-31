import { Command } from 'commander';
import { getContext, handleError, outputResult } from '../cli/shared.js';
import { printSuccess } from '../lib/output.js';

export function registerCheckCommands(program: Command): void {
  program
    .command('whoami')
    .description('Show the authenticated user')
    .action(async (_opts, cmd) => {
      try {
        const { client, json } = getContext(cmd.optsWithGlobals());
        const me = await client.getMe();
        if (json) {
          outputResult(me, true);
        } else {
          printSuccess(`Logged in as ${me.firstName} ${me.lastName} (@${me.publicIdentifier})`);
        }
      } catch (err) {
        handleError(err);
      }
    });

  program
    .command('check')
    .description('Check if credentials are valid')
    .action(async (_opts, cmd) => {
      try {
        const { client } = getContext(cmd.optsWithGlobals());
        const me = await client.getMe();
        printSuccess(`Auth OK: ${me.firstName} ${me.lastName} (@${me.publicIdentifier})`);
      } catch (err) {
        handleError(err);
      }
    });
}
