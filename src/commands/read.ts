import { Command } from 'commander';
import { getContext, handleError, outputResult } from '../cli/shared.js';
import { printPosts, printComments, formatPost } from '../lib/output.js';

export function registerReadCommands(program: Command): void {
  program
    .command('read <postId>')
    .description('Read a single post by ID or URL')
    .action(async (postId: string, _opts, cmd) => {
      try {
        const { client, json } = getContext(cmd.optsWithGlobals());
        const { post, comments } = await client.getPost(postId);

        if (json) {
          outputResult({ post, comments }, true);
        } else {
          if (post) {
            console.log(formatPost(post));
          } else {
            console.log('Post not found or could not be parsed.');
          }
        }
      } catch (err) {
        handleError(err);
      }
    });

  program
    .command('comments <postId>')
    .description('Show comments on a post')
    .action(async (postId: string, _opts, cmd) => {
      try {
        const { client, json } = getContext(cmd.optsWithGlobals());
        const { post, comments } = await client.getPost(postId);

        if (json) {
          outputResult({ post, comments }, true);
        } else {
          if (post) {
            console.log(formatPost(post));
            console.log();
          }
          console.log(`Comments (${comments.length}):`);
          printComments(comments);
        }
      } catch (err) {
        handleError(err);
      }
    });
}
