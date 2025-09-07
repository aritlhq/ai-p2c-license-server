import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { createClient } from '@supabase/supabase-js';

const app = express();
app.use(cors());
app.use(express.json());

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

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

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
    console.log(`License server listening on port ${PORT}`);
});