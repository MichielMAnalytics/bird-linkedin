import { Command } from 'commander';
import { getContext, handleError, outputResult } from '../cli/shared.js';
import { formatProfile } from '../lib/output.js';

export function registerProfileCommands(program: Command): void {
  program
    .command('about <handle>')
    .description('Show profile info for a user')
    .action(async (handle: string, _opts, cmd) => {
      try {
        const { client, json } = getContext(cmd.optsWithGlobals());
        const profile = await client.getProfile(handle);

        if (json) {
          outputResult(profile, true);
        } else {
          if (profile) {
            console.log(formatProfile(profile));
          } else {
            console.log('Profile not found.');
          }
        }
      } catch (err) {
        handleError(err);
      }
    });
}
