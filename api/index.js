import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { createClient } from '@supabase/supabase-js';
import TelegramBot from 'node-telegram-bot-api';
import { v4 as uuidv4 } from 'uuid';

const app = express();
app.use(cors());
app.use(express.json());

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

const botToken = process.env.TELEGRAM_BOT_TOKEN;
const adminChatId = parseInt(process.env.TELEGRAM_ADMIN_CHAT_ID, 10);

const bot = new TelegramBot(botToken);

const isAdmin = (chatId) => chatId === adminChatId;

const handleTelegramCommand = async (msg) => {
    const text = msg.text;
    const chatId = msg.chat.id;

    if (!isAdmin(chatId)) {
        return bot.sendMessage(chatId, "You are not authorized.");
    }

    if (text.startsWith('/create')) {
        const newKey = uuidv4();
        const { error } = await supabase.from('licenses').insert([{ key: newKey, status: 'active' }]);
        return bot.sendMessage(adminChatId, error ? `Error: ${error.message}` : `New key created successfully:\n\n\`${newKey}\``, { parse_mode: 'Markdown' });
    }

    if (text.startsWith('/list')) {
        const { data, error } = await supabase.from('licenses').select('*');
        if (error) return bot.sendMessage(adminChatId, `Error: ${error.message}`);
        let response = '📜 **License List** 📜\n\n';
        if (!data || data.length === 0) {
            response += 'No licenses found.';
        } else {
            data.forEach(lic => {
                response += `Key: \`${lic.key}\`\nStatus: \`${lic.status}\`\n\n`;
            });
        }
        return bot.sendMessage(adminChatId, response, { parse_mode: 'Markdown' });
    }

    const statusMatch = text.match(/\/status (.+) (.+)/);
    if (statusMatch) {
        const key = statusMatch[1];
        const newStatus = statusMatch[2];
        const { error } = await supabase.from('licenses').update({ status: newStatus }).eq('key', key);
        return bot.sendMessage(adminChatId, error ? `Error: ${error.message}` : `Key \`${key}\` status updated to \`${newStatus}\`.`, { parse_mode: 'Markdown' });
    }
    
    const deleteMatch = text.match(/\/delete (.+)/);
    if (deleteMatch) {
        const key = deleteMatch[1];
        const { error } = await supabase.from('licenses').delete().eq('key', key);
        return bot.sendMessage(adminChatId, error ? `Error: ${error.message}` : `Key \`${key}\` has been deleted.`, { parse_mode: 'Markdown' });
    }

    return bot.sendMessage(adminChatId, "Unknown command.");
};

app.get('/', (req, res) => {
    res.send('License Server is running.');
});

app.post('/api/webhook', async (req, res) => {
    try {
        if (req.body && req.body.message) {
            await handleTelegramCommand(req.body.message);
        }
    } catch (error) {
        console.error("Error processing webhook:", error);
    }
    res.sendStatus(200);
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

export default app;