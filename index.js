import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { createClient } from '@supabase/supabase-js';
import TelegramBot from 'node-telegram-bot-api';
import { v4 as uuidv4 } from 'uuid';
import chalk from 'chalk';

const app = express();
app.use(cors());
app.use(express.json());
app.set('trust proxy', 1);

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

const botToken = process.env.TELEGRAM_BOT_TOKEN;
const adminChatId = parseInt(process.env.TELEGRAM_ADMIN_CHAT_ID, 10);
const bot = new TelegramBot(botToken, { polling: true });

const SESSION_TIMEOUT_MINUTES = 60;

app.get('/', (req, res) => {
    res.send('License Server is running.');
});

app.post('/api/validate', async (req, res) => {
    const { licenseKey } = req.body;
    const userIp = req.ip;

    if (!licenseKey) {
        return res.status(400).json({ valid: false, message: 'License key is required.' });
    }

    try {
        const { data, error } = await supabase
            .from('licenses')
            .select('status, current_ip, last_seen_at')
            .eq('key', licenseKey)
            .single();

        if (error || !data) {
            return res.status(404).json({ valid: false, message: 'License key not found.' });
        }

        if (data.status !== 'active') {
            return res.status(403).json({ valid: false, message: `License key is inactive (status: ${data.status}).` });
        }

        const now = new Date();
        const lastSeen = data.last_seen_at ? new Date(data.last_seen_at) : null;
        const minutesSinceLastSeen = lastSeen ? (now - lastSeen) / (1000 * 60) : Infinity;

        if (data.current_ip && data.current_ip !== userIp && minutesSinceLastSeen < SESSION_TIMEOUT_MINUTES) {
            return res.status(403).json({ valid: false, message: `License is currently active on another network. Please try again in an hour.` });
        }

        const { error: updateError } = await supabase
            .from('licenses')
            .update({ current_ip: userIp, last_seen_at: now.toISOString() })
            .eq('key', licenseKey);

        if (updateError) {
            throw new Error('Failed to update license session.');
        }

        return res.json({ valid: true });

    } catch (err) {
        console.error('Server error during validation:', err);
        return res.status(500).json({ valid: false, message: 'An internal server error occurred.' });
    }
});

app.post('/api/heartbeat', async (req, res) => {
    const { licenseKey } = req.body;
    if (!licenseKey) return res.sendStatus(400);

    const now = new Date();
    await supabase
        .from('licenses')
        .update({ last_seen_at: now.toISOString() })
        .eq('key', licenseKey);
    
    res.sendStatus(200);
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
    if (!data || data.length === 0) {
        response += 'No licenses found.';
    } else {
        data.forEach(lic => {
            const lastSeen = lic.last_seen_at ? new Date(lic.last_seen_at).toLocaleString('en-US') : 'Never';
            response += `Key: \`${lic.key}\`\nStatus: \`${lic.status}\`\nIP: \`${lic.current_ip || 'Not set'}\`\nLast Seen: \`${lastSeen}\`\n\n`;
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

bot.onText(/\/reset_session (.+)/, async (msg, match) => {
    if (!isAdmin(msg.chat.id)) return;
    const key = match[1];
    const { error } = await supabase.from('licenses').update({ current_ip: null, last_seen_at: null }).eq('key', key);
    bot.sendMessage(adminChatId, error ? `Error: ${error.message}` : `Session for key \`${key}\` has been reset.`, { parse_mode: 'Markdown' });
});

bot.onText(/\/delete (.+)/, async (msg, match) => {
    if (!isAdmin(msg.chat.id)) return;
    const key = match[1];
    const { error } = await supabase.from('licenses').delete().eq('key', key);
    bot.sendMessage(adminChatId, error ? `Error: ${error.message}` : `Key \`${key}\` has been deleted.`, { parse_mode: 'Markdown' });
});

bot.on('polling_error', (error) => {
    console.error(chalk.red('[Telegram Polling Error]'), error.message);
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, async () => {
    console.log(`License server listening on port ${PORT}`);
    try {
        await bot.sendMessage(adminChatId, "✅ License Bot (Heartbeat-based) is now online and connected.");
        console.log(chalk.green("Successfully sent startup message to Telegram admin."));
    } catch (error) {
        console.log(chalk.red.bold('\n[!] Warning: Could not send startup message to Telegram.'));
    }
});
