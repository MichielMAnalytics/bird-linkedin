import { Command } from 'commander';
import { getContext, handleError } from '../cli/shared.js';
import { printInfo, printSuccess, printError as printErr } from '../lib/output.js';

const REACTION_TYPES = ['LIKE', 'PRAISE', 'EMPATHY', 'INTEREST', 'APPRECIATION', 'ENTERTAINMENT'] as const;
type ReactionType = typeof REACTION_TYPES[number];

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
    .description('Reply to a post')
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

  program
    .command('react <postId>')
    .description('React to a post (like, celebrate, love, insightful, funny)')
    .option('-t, --type <type>', 'Reaction type: like, celebrate, love, insightful, funny, support', 'like')
    .action(async (postId: string, opts, cmd) => {
      try {
        const { client } = getContext(cmd.optsWithGlobals());

        const typeMap: Record<string, ReactionType> = {
          like: 'LIKE',
          celebrate: 'PRAISE',
          love: 'EMPATHY',
          insightful: 'INTEREST',
          interesting: 'INTEREST',
          funny: 'ENTERTAINMENT',
          support: 'APPRECIATION',
        };

        const reactionType = typeMap[opts.type?.toLowerCase()] as ReactionType;
        if (!reactionType) {
          printErr(`Unknown reaction type "${opts.type}". Use: like, celebrate, love, insightful, funny, support`);
          process.exit(1);
        }

        const result = await client.reactToPost(postId, reactionType);
        if (result.success) {
          printSuccess(`Reacted with ${opts.type} ✓`);
        } else {
          printErr(result.error || 'Failed to react');
        }
      } catch (err) {
        handleError(err);
      }
    });
}
