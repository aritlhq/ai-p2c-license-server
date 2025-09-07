import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { createClient } from '@supabase/supabase-js';
import TelegramBot from 'node-telegram-bot-api';
import { v4 as uuidv4 } from 'uuid';

const app = express();
app.use(express.json());

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

const botToken = process.env.TELEGRAM_BOT_TOKEN;
const adminChatId = parseInt(process.env.TELEGRAM_ADMIN_CHAT_ID, 10);

const bot = new TelegramBot(botToken);

const vercelUrl = process.env.VERCEL_URL;
const webhookUrl = `https://${vercelUrl}/api/server`;
bot.setWebHook(webhookUrl);

app.post(`/api/server`, (req, res) => {
    bot.processUpdate(req.body);
    res.sendStatus(200);
});

app.get('/', (req, res) => {
    res.send('License Server is running and webhook is set.');
});

app.post('/api/validate', async (req, res) => {
    const { licenseKey } = req.body;
    if (!licenseKey) {
        return res.status(400).json({ valid: false, message: 'License key is required.' });
    }
    try {
        const { data, error } = await supabase.from('licenses').select('status').eq('key', licenseKey).single();
        if (error || !data) {
            return res.status(404).json({ valid: false, message: 'License key not found.' });
        }
        if (data.status === 'active') {
            return res.json({ valid: true });
        } else {
            return res.status(403).json({ valid: false, message: `License key is inactive (status: ${data.status}).` });
        }
    } catch (err) {
        return res.status(500).json({ valid: false, message: 'An internal server error occurred.' });
    }
});

const isAdmin = (chatId) => chatId === adminChatId;

bot.onText(/\/create/, async (msg) => {
    if (!isAdmin(msg.chat.id)) return bot.sendMessage(msg.chat.id, "You are not authorized.");
    const newKey = uuidv4();
    const { error } = await supabase.from('licenses').insert([{ key: newKey, status: 'active' }]);
    bot.sendMessage(adminChatId, error ? `Error: ${error.message}` : `New key created successfully:\n\n\`${newKey}\``, { parse_mode: 'Markdown' });
});

bot.onText(/\/list/, async (msg) => {
    if (!isAdmin(msg.chat.id)) return;
    const { data, error } = await supabase.from('licenses').select('*');
    if (error) return bot.sendMessage(adminChatId, `Error: ${error.message}`);
    let response = '📜 **License List** 📜\n\n';
    if (data.length === 0) {
        response += 'No licenses found.';
    } else {
        data.forEach(lic => {
            response += `Key: \`${lic.key}\`\nStatus: \`${lic.status}\`\n\n`;
        });
    }
    bot.sendMessage(adminChatId, response, { parse_mode: 'Markdown' });
});

bot.onText(/\/status (.+) (.+)/, async (msg, match) => {
    if (!isAdmin(msg.chat.id)) return;
    const key = match[1];
    const newStatus = match[2];
    const { error } = await supabase.from('licenses').update({ status: newStatus }).eq('key', key);
    bot.sendMessage(adminChatId, error ? `Error: ${error.message}` : `Key \`${key}\` status updated to \`${newStatus}\`.`, { parse_mode: 'Markdown' });
});

bot.onText(/\/delete (.+)/, async (msg, match) => {
    if (!isAdmin(msg.chat.id)) return;
    const key = match[1];
    const { error } = await supabase.from('licenses').delete().eq('key', key);
    bot.sendMessage(adminChatId, error ? `Error: ${error.message}` : `Key \`${key}\` has been deleted.`, { parse_mode: 'Markdown' });
});

export default app;