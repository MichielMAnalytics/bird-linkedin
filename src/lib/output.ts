import kleur from 'kleur';
import type { PostData, CommentData, ProfileData, ConversationData, MessageData } from './linkedin-client-utils.js';

export function formatPost(post: PostData): string {
  const lines: string[] = [];
  const header = `${kleur.bold(post.authorName)} ${kleur.dim(post.authorHandle ? '@' + post.authorHandle : '')}`;
  const date = kleur.dim(post.createdAt || '');

  lines.push(`${header} ${date}`);

  if (post.text) {
    // Truncate very long posts for display
    const displayText = post.text.length > 500
      ? post.text.substring(0, 500) + kleur.dim('... [truncated]')
      : post.text;
    lines.push(displayText);
  }

  if (post.media.length > 0) {
    for (const m of post.media) {
      lines.push(kleur.cyan(`[${m.type}]${m.url ? ' ' + m.url : ''}`));
    }
  }

  if (post.article) {
    lines.push(kleur.dim(`[Article: ${post.article.title}]`));
    if (post.article.url) lines.push(kleur.blue(post.article.url));
  }

  const stats = [
    `${kleur.red('\u2665')} ${post.likeCount}`,
    `${kleur.blue('\uD83D\uDCAC')} ${post.commentCount}`,
    `${kleur.green('\u27F3')} ${post.repostCount}`,
  ];

  lines.push(stats.join('  '));
  lines.push(kleur.dim(`ID: ${post.id} | ${post.url}`));

  return lines.join('\n');
}

export function formatComment(comment: CommentData): string {
  const lines: string[] = [];
  const header = `${kleur.bold(comment.authorName)} ${kleur.dim('@' + comment.authorHandle)}`;
  const date = kleur.dim(comment.createdAt ? new Date(comment.createdAt).toLocaleString() : '');

  lines.push(`  ${header} ${date}`);
  lines.push(`  ${comment.text}`);

  const stats = [];
  if (comment.likeCount > 0) stats.push(`${kleur.red('\u2665')} ${comment.likeCount}`);
  if (comment.replyCount > 0) stats.push(`${kleur.blue('\uD83D\uDCAC')} ${comment.replyCount}`);
  if (stats.length > 0) lines.push(`  ${stats.join('  ')}`);

  return lines.join('\n');
}

export function formatProfile(profile: ProfileData): string {
  const lines: string[] = [];
  lines.push(`${kleur.bold(profile.firstName + ' ' + profile.lastName)} ${kleur.dim('@' + profile.publicIdentifier)}`);
  if (profile.headline) lines.push(profile.headline);
  if (profile.location) lines.push(kleur.dim(`\uD83D\uDCCD ${profile.location}`));
  if (profile.followersCount) lines.push(`Followers: ${profile.followersCount}`);
  if (profile.connectionsCount) lines.push(`Connections: ${profile.connectionsCount}`);
  lines.push(kleur.dim(`URN: ${profile.entityUrn}`));
  return lines.join('\n');
}

export function printPosts(posts: PostData[]): void {
  if (posts.length === 0) {
    console.log(kleur.dim('No posts found.'));
    return;
  }
  for (let i = 0; i < posts.length; i++) {
    if (i > 0) console.log(kleur.dim('\u2500'.repeat(60)));
    console.log(formatPost(posts[i]));
  }
}

export function printComments(comments: CommentData[]): void {
  if (comments.length === 0) {
    console.log(kleur.dim('No comments found.'));
    return;
  }
  for (let i = 0; i < comments.length; i++) {
    if (i > 0) console.log(kleur.dim('  ' + '\u2500'.repeat(56)));
    console.log(formatComment(comments[i]));
  }
}

export function formatConversation(conv: ConversationData): string {
  const lines: string[] = [];
  const name = kleur.bold(conv.participantName || 'Unknown');
  const handle = conv.participantHandle ? kleur.dim(' @' + conv.participantHandle) : '';
  const time = kleur.dim(conv.lastMessageTime ? new Date(conv.lastMessageTime).toLocaleString() : '');
  const unread = conv.unread ? kleur.red(` [${conv.unreadCount} unread]`) : '';

  lines.push(`${name}${handle} ${time}${unread}`);
  if (conv.lastMessageText) {
    const preview = conv.lastMessageText.length > 100
      ? conv.lastMessageText.substring(0, 100) + '...'
      : conv.lastMessageText;
    lines.push(kleur.dim(`  ${preview}`));
  }
  return lines.join('\n');
}

export function formatMessage(msg: MessageData): string {
  const name = kleur.bold(msg.senderName || 'Unknown');
  const time = kleur.dim(msg.timestamp ? new Date(msg.timestamp).toLocaleString() : '');
  return `${name} ${time}\n  ${msg.text}`;
}

export function printConversations(conversations: ConversationData[]): void {
  if (conversations.length === 0) {
    console.log(kleur.dim('No conversations found.'));
    return;
  }
  for (let i = 0; i < conversations.length; i++) {
    if (i > 0) console.log(kleur.dim('\u2500'.repeat(60)));
    console.log(formatConversation(conversations[i]));
  }
}

export function printMessages(messages: MessageData[]): void {
  if (messages.length === 0) {
    console.log(kleur.dim('No messages found.'));
    return;
  }
  for (let i = 0; i < messages.length; i++) {
    if (i > 0) console.log(kleur.dim('  ' + '\u2500'.repeat(56)));
    console.log(formatMessage(messages[i]));
  }
}

export function printError(message: string): void {
  console.error(kleur.red(`Error: ${message}`));
}

export function printSuccess(message: string): void {
  console.log(kleur.green(`\u2713 ${message}`));
}

export function printInfo(message: string): void {
  console.log(kleur.blue(`\u2139 ${message}`));
}
