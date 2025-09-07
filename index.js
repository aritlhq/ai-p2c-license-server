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

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

const botToken = process.env.TELEGRAM_BOT_TOKEN;
const adminChatId = parseInt(process.env.TELEGRAM_ADMIN_CHAT_ID, 10);

const bot = new TelegramBot(botToken, { polling: true });

app.get('/', (req, res) => {
    res.send('License Server is running.');
});

app.post('/api/validate', async (req, res) => {
    const { licenseKey } = req.body;

    if (!licenseKey) {
        return res.status(400).json({ valid: false, message: 'License key is required.' });
    }

    try {
        const { data, error } = await supabase
            .from('licenses')
            .select('status')
            .eq('key', licenseKey)
            .single();

        if (error || !data) {
            console.log(`Validation failed for key: ${licenseKey}`);
            return res.status(404).json({ valid: false, message: 'License key not found.' });
        }

        if (data.status === 'active') {
            console.log(`Validation successful for key: ${licenseKey}`);
            return res.json({ valid: true });
        } else {
            console.log(`Validation failed for key ${licenseKey}, status: ${data.status}`);
            return res.status(403).json({ valid: false, message: `License key is inactive (status: ${data.status}).` });
        }

    } catch (err) {
        console.error('Server error during validation:', err);
        return res.status(500).json({ valid: false, message: 'An internal server error occurred.' });
    }
});

const isAdmin = (chatId) => chatId === adminChatId;

bot.onText(/\/create/, async (msg) => {
    if (!isAdmin(msg.chat.id)) return bot.sendMessage(msg.chat.id, "You are not authorized.");

    const newKey = uuidv4();
    const { error } = await supabase.from('licenses').insert([{ key: newKey, status: 'active' }]);

    if (error) {
        bot.sendMessage(adminChatId, `Error creating key: ${error.message}`);
    } else {
        bot.sendMessage(adminChatId, `New key created successfully:\n\n\`${newKey}\``, { parse_mode: 'Markdown' });
    }
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

bot.on('polling_error', (error) => {
    console.error(chalk.red('[Telegram Polling Error]'), error.message);
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, async () => {
    console.log(`License server listening on port ${PORT}`);
    try {
        await bot.sendMessage(adminChatId, "✅ License Bot is now online and connected.");
        console.log(chalk.green("Successfully sent startup message to Telegram admin."));
    } catch (error) {
        console.log(chalk.red.bold('\n[!] Warning: Could not send startup message to Telegram.'));
        console.log(chalk.yellow('Please ensure you have started a chat with your bot from your admin account.'));
        console.log(chalk.gray('The server will continue to run, but you will not receive notifications until this is fixed.'));
    }
});
