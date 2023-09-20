import 'dotenv/config';
import { Telegraf } from 'telegraf';
import { message } from 'telegraf/filters';
import * as sqlite from 'sqlite';
import sqlite3 from 'sqlite3';

const DB_FILE = 'nohellodb.sqlite3';
const bot = new Telegraf(process.env.TG_BOT_TOKEN);

// open the database
const db = await sqlite.open({
  filename: DB_FILE,
  driver: sqlite3.Database,
});

// Create a table to store user data
await db.exec("CREATE TABLE IF NOT EXISTS users (user_id INTEGER, group_id INTEGER, hi_count INTEGER DEFAULT 1, PRIMARY KEY (user_id, group_id))");
const initialCount = await db.get("SELECT count(*) as count FROM users");
console.log(`[*] db: ${DB_FILE}; count: ${initialCount.count}`);

// Define the maximum number of consecutive "Hi" messages before kicking
const maxHiCount = 2;

bot.on(message('text'), async (ctx) => {
    const groupId = ctx.chat.id;
    const userId = ctx.from.id;
    const username = ctx.from.username;
    const message = ctx.message.text;
    const messageId = ctx.message.message_id;
    
    // Check if the message is non-"Hi"
    if (!/^(hi|hey|hello)$/i.test(message)) {
        // Reset the hiCount if the user sends a non-greeting message
        await db.run("DELETE FROM users WHERE user_id = ? AND group_id = ?", [userId, groupId]);
        return;
    }
    
    if (ctx.chat.type === 'private' || await isAdmin(ctx)) return;

    await ctx.deleteMessage(messageId);

    // Retrieve the user's hiCount from the database or initialize if not present
    const dbUser = await db.get("SELECT hi_count FROM users WHERE user_id = ? AND group_id = ?", [userId, groupId]);
    const hiCount = dbUser ? dbUser.hi_count : 0;
    
    // Update the hiCount in the database
    const newHiCount = hiCount + 1;
    await db.run("INSERT OR REPLACE INTO users (user_id, group_id, hi_count) VALUES (?, ?, ?)", [userId, groupId, newHiCount]);

    // Check if it exceeds the limit
    if (newHiCount >= maxHiCount) {
        // Kick the user from the group
        await ctx.banChatMember(userId);
        await db.run("DELETE FROM users WHERE user_id = ? AND group_id = ?", [userId, groupId]);
        const replyMsg = await ctx.reply(`User @${username} has been kicked from the group for spamming.`);
        setTimeout(async () => {
            await ctx.unbanChatMember(userId);
            await ctx.deleteMessage(replyMsg.message_id);
        }, 5 * 1000);
        return;
    }

    // Reply with the link when the user says "Hi"
    const linkMsg = await ctx.reply(`Hey @${username}: To learn more about why we discourage saying "Hi" in the group, visit: https://nohello.net`);
    setTimeout(async () => {
        await ctx.deleteMessage(linkMsg.message_id);
    }, 25 * 1000);
});

// Cache to store admin status with a 10-minute expiration
const adminStatusCache = new Map();

// Function to check if a user is an admin
async function isAdmin(ctx) {
  const chatId = ctx.chat.id;
  const userId = ctx.from.id;

  // Check if the result is cached
  if (adminStatusCache.has(userId)) {
    return adminStatusCache.get(userId);
  }

  // Get chat member information for the user
  const chatMember = await ctx.telegram.getChatMember(chatId, userId);

  // Check if the user is an admin
  const isAdmin = chatMember.status === 'administrator' || chatMember.status === 'creator';

  // Cache the result for 10 minutes
  adminStatusCache.set(userId, isAdmin);
  setTimeout(() => {
    adminStatusCache.delete(userId);
  }, 10 * 60 * 1000); // 10 minutes in milliseconds

  return isAdmin;
}

bot.launch();

console.log('[*] Started bot, listening for messages.');
