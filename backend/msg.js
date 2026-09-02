require('dotenv').config(); 

// =========================================================
// 📱 CONFIGURE YOUR WHATSAPP NUMBER HERE 
// =========================================================
const LINKING_PHONE_NUMBER = process.env.PHONE;

if (!LINKING_PHONE_NUMBER) {
    console.error("⚠️ [WARNING] 'PHONE' secret is missing!");
}

const { Client, LocalAuth } = require('whatsapp-web.js'); 
const qrcode = require('qrcode'); 
const admin = require('firebase-admin');
const cron = require('node-cron');
const fs = require('fs');       

process.on('unhandledRejection', (reason, promise) => {
    console.error('⚠️ [ANTI-CRASH] Unhandled Rejection at:', promise, 'reason:', reason);
});
process.on('uncaughtException', (err) => {
    console.error('⚠️ [ANTI-CRASH] Uncaught Exception:', err);
});

if (!admin.apps.length) {
    console.warn("⚠️ [SAFETY CATCH] Firebase Admin was not initialized prior.");
    admin.initializeApp(); 
}
const db = admin.firestore();

let systemInitialized = false; 
const messageQueue = {}; 
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

const processedDocs = new Set(); 
setInterval(() => {
    processedDocs.clear();
    console.log("🧹 Cleared processedDocs cache to free memory.");
}, 12 * 60 * 60 * 1000); 

async function safeSendMessage(client, jid, message, agentName) {
    try {
        const waId = await client.getNumberId(jid);
        const finalId = waId ? waId._serialized : jid;
        const chat = await client.getChatById(finalId);
        
        await chat.sendMessage(message);
        console.log(`✅ Message successfully sent to ${agentName || jid}`);
        return true;
    } catch (error) {
        console.error(`❌ Primary send failed for ${agentName || jid}:`, error.message);
        try {
            await client.sendMessage(jid, message);
            return true;
        } catch (finalErr) {
            console.error(`Critial Failure: Could not reach ${jid}:`, finalErr.message);
            return false;
        }
    }
}

// --- MESSAGE TEMPLATES ---
function getRandomReminderTemplate(agentName, count, formattedAmount) {
    const draftWord = count === 1 ? 'draft' : 'drafts';
    const isAre = count === 1 ? 'is' : 'are';
    const itThem = count === 1 ? 'it' : 'them';
    const thisThese = count === 1 ? 'this' : 'these';

    const greetings = [
        `*UP FIELD REMINDER* 🏢\n\nHello *${agentName}*,`,
        `*UP FIELD ALERT* 🏢\n\nHi *${agentName}*,`,
        `*UP FIELD DRAFT ALERT* 🏢\n\nHello *${agentName}*,`
    ];

    const bodies = [
        `You currently have *${count} ${draftWord}* totaling *₹${formattedAmount}* waiting in your app.`,
        `We noticed you have *${count} pending ${draftWord}* worth *₹${formattedAmount}* securely saved in your account.`,
        `Our system shows *${count} ${draftWord}* with a total of *₹${formattedAmount}* pending your action.`
    ];

    const closings = [
        `Please ensure you submit ${itThem} to the admin queue before the end of your shift today.`,
        `Make sure to clear your drafts by submitting ${itThem} to the admin queue today.`,
        `Ensure ${thisThese} ${isAre} fully submitted so the admins can review ${itThem}.`
    ];
    
    const g = greetings[Math.floor(Math.random() * greetings.length)];
    const b = bodies[Math.floor(Math.random() * bodies.length)];
    const c = closings[Math.floor(Math.random() * closings.length)];
    return `${g}\n${b}\n\n${c}`;
}

function getRandomConfirmationTemplate(agentName, count, formattedAmount, timeNow) {
    const entryWord = count === 1 ? 'entry' : 'entries';
    const hasHave = count === 1 ? 'has' : 'have';

    const headings = [
        `*UP FIELD* 🏢\n*Submission Confirmed* ✅\n\n`,
        `*UP FIELD* 🏢\n*Successfully Submitted* ✅\n\n`
    ];

    const praises = [`Great job, *${agentName}*!`, `Excellent work, *${agentName}*!`, `Well done, *${agentName}*!`];

    const bodies = [
        `You have successfully submitted *${count} ${entryWord}* totaling *₹${formattedAmount}* to the pending queue at ${timeNow}.`,
        `*${count} ${entryWord}* totaling *₹${formattedAmount}* ${hasHave} been officially pushed to the pending queue at ${timeNow}.`
    ];
    
    const h = headings[Math.floor(Math.random() * headings.length)];
    const p = praises[Math.floor(Math.random() * praises.length)];
    const b = bodies[Math.floor(Math.random() * bodies.length)];
    return `${h}${p} ${b}`;
}

// ---------------------------------------------------------
// 1. WHATSAPP CLIENT INITIALIZATION
// ---------------------------------------------------------
console.log("⏳ Initializing WhatsApp Engine...");

// Cross-Platform Browser Detector (Works on Windows & Linux)
const getBrowserPath = () => {
    const paths = [
        'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
        'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
        '/usr/bin/chromium',
        '/usr/bin/chromium-browser',
        '/usr/bin/google-chrome',
        '/usr/bin/google-chrome-stable',
        '/snap/bin/chromium'
    ];
    for (const p of paths) {
        if (fs.existsSync(p)) return p;
    }
    return undefined; // Falls back to internal Puppeteer browser if installed
};

const client = new Client({
    authStrategy: new LocalAuth({ dataPath: './whatsapp-session' }),
    authTimeoutMs: 60000, 
    puppeteer: {
        executablePath: getBrowserPath(), 
        headless: true, 
        timeout: 60000, 
        args: [
            '--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu', '--no-first-run',
            '--ignore-certificate-errors', '--disable-web-security', '--disable-features=IsolateOrigins,site-per-process',
            '--no-zygote', '--disable-accelerated-2d-canvas', '--disable-software-rasterizer', 
            '--js-flags="--max-old-space-size=512"', 
            '--user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        ]
    }
});

client.on('qr', async (qr) => {
    console.log('🔄 Authentication required. Generating QR code...');
    try {
        await qrcode.toFile('qr-code.png', qr, { color: { dark: '#000000', light: '#ffffff' }});
        console.log(`🔢 SUCCESS: QR code generated and saved to UI.`);
    } catch (err) {
        console.error('❌ Failed to generate QR code:', err.message);
    }
});

client.on('ready', () => {
    console.log('✅ WhatsApp Web Client is READY and CONNECTED!');
    if (!systemInitialized) {
        setupScheduledJobs();
        setupFirestoreListener();
        systemInitialized = true;
    }
    try { if (fs.existsSync('qr-code.png')) fs.unlinkSync('qr-code.png'); } catch (fsErr) {}
});

setInterval(async () => {
    try {
        const memoryUsage = process.memoryUsage().heapUsed / 1024 / 1024;
        if (memoryUsage > 450) {
            console.log(`⚠️ High Memory Detected (${Math.round(memoryUsage)}MB). Purging WhatsApp DOM cache...`);
            if (client && client.pupPage && !client.pupPage.isClosed()) {
                await client.pupPage.evaluate(() => {
                    if (window.Store && window.Store.Msg) window.Store.Msg.clear();
                }).catch(() => {});
            }
        }
    } catch (memErr) {}
}, 300000); 

client.on('auth_failure', msg => console.error('❌ WhatsApp Authentication Failed:', msg));

client.on('disconnected', (reason) => {
    console.log('❌ WhatsApp Disconnected:', reason);
    client.destroy().then(() => {
        connectionRetries = 0; 
        startWhatsAppClient(); 
    }).catch(e => console.error('⚠️ Failed to reboot client:', e.message));
});

let connectionRetries = 0;
const MAX_RETRIES = 10;

async function startWhatsAppClient() {
    console.log(`🚀 Booting WhatsApp Client (Attempt ${connectionRetries + 1}/${MAX_RETRIES})...`);
    if (connectionRetries >= MAX_RETRIES) {
        console.error("❌ CRITICAL: Maximum connection retries exceeded.");
        process.exit(1);
    }
    try {
        await client.initialize();
        connectionRetries = 0; 
    } catch (err) {
        console.error("❌ WhatsApp Engine Failed to Start:", err.message);
        try { await client.destroy(); } catch (destroyErr) {}
        connectionRetries++;
        const retryDelay = Math.min(15000 * connectionRetries, 60000); 
        setTimeout(startWhatsAppClient, retryDelay);
    }
}
startWhatsAppClient();

// ---------------------------------------------------------
// 2. FETCH AGENT DETAILS (UPDATED: Queries 'users' collection)
// ---------------------------------------------------------
const userCache = new Map(); 
setInterval(() => { userCache.clear(); }, 24 * 60 * 60 * 1000); 

async function getAgentDetails(uid) {
    if (userCache.has(uid)) return userCache.get(uid);

    try {
        const userDoc = await db.collection('users').doc(uid).get();
        if (!userDoc.exists) return null;
        
        const data = userDoc.data();
        if (!data.phone) return null;

        let cleanNumber = data.phone.replace(/\D/g, ''); 
        if (cleanNumber.length === 10) cleanNumber = '91' + cleanNumber;
        let formattedPhone = cleanNumber + '@c.us';
        
        const details = { name: data.name || 'Agent', phone: formattedPhone };
        userCache.set(uid, details);
        return details;
    } catch (e) {
        console.error(`Error fetching user ${uid} from Auth:`, e.message);
        return null;
    }
}

// ---------------------------------------------------------
// 3. CRON JOB: 5 PM & 10 PM DRAFT REMINDER (UPDATED: daily_logs)
// ---------------------------------------------------------
function setupScheduledJobs() {
    const runAlerts = async () => {
        const timeNow = new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', hour12: true });
        console.log(`[${timeNow}] ⏰ Running Draft Alert Check...`);
        
        try {
            const snap = await db.collection('daily_logs').get();
            if (snap.empty) return;

            const agentStats = {}; 
            
            snap.forEach(doc => {
                const uid = doc.id.split('_')[0]; // Extract UID from document name
                if (!uid) return;
                
                const data = doc.data();
                Object.keys(data).forEach(key => {
                    if (key !== 'activeCustomers' && data[key].status === 'pending') {
                        if (!agentStats[uid]) agentStats[uid] = { count: 0, totalAmount: 0 };
                        agentStats[uid].count++;
                        agentStats[uid].totalAmount += parseFloat(data[key].amount || 0);
                    }
                });
            });

            for (const [uid, stats] of Object.entries(agentStats)) {
                if(stats.count > 0) {
                    const agent = await getAgentDetails(uid);
                    if (agent && agent.phone) {
                        const formattedAmount = stats.totalAmount.toLocaleString('en-IN', { maximumFractionDigits: 2 });
                        const msg = getRandomReminderTemplate(agent.name, stats.count, formattedAmount);
                        await sleep(500); 
                        await safeSendMessage(client, agent.phone, msg, agent.name);
                    }
                }
            }
        } catch (error) {
            console.error('Error in Cron:', error);
        }
    };

    cron.schedule('0 17 * * *', runAlerts, { scheduled: true, timezone: "Asia/Kolkata" });
    cron.schedule('0 22 * * *', runAlerts, { scheduled: true, timezone: "Asia/Kolkata" });
}

// ---------------------------------------------------------
// 4. FIRESTORE LISTENER (UPDATED: Watches daily_logs for 'submitted')
// ---------------------------------------------------------
function setupFirestoreListener() {
    let isInitialLoad = true;

    db.collection('daily_logs').onSnapshot(async (snapshot) => {
        if (isInitialLoad) {
            isInitialLoad = false;
            console.log(`✅ Initial Firestore sync complete. Now watching for fresh submissions...`);
            return;
        }

        const submissionsByAgent = {};

        snapshot.docChanges().forEach((change) => {
            if (change.type === 'added' || change.type === 'modified') {
                const data = change.doc.data();
                const uid = change.doc.id.split('_')[0];
                
                Object.keys(data).forEach(key => {
                    if (key !== 'activeCustomers' && data[key].status === 'submitted') {
                        const uniqueId = `${change.doc.id}_${key}`; // Ensure we only message once per submitted item
                        if (processedDocs.has(uniqueId)) return;
                        processedDocs.add(uniqueId);
                        
                        if (data[key].submittedBySystem) return; // Ignore cron job submits
                        
                        if (!submissionsByAgent[uid]) submissionsByAgent[uid] = { count: 0, totalAmount: 0 };
                        submissionsByAgent[uid].count++;
                        submissionsByAgent[uid].totalAmount += parseFloat(data[key].amount || 0);
                    }
                });
            }
        });

        for (const [uid, stats] of Object.entries(submissionsByAgent)) {
            if (!messageQueue[uid]) {
                messageQueue[uid] = { count: 0, totalAmount: 0, timer: null };
            }
            
            messageQueue[uid].count += stats.count;
            messageQueue[uid].totalAmount += stats.totalAmount;

            if (messageQueue[uid].timer) clearTimeout(messageQueue[uid].timer);

            messageQueue[uid].timer = setTimeout(async () => {
                const finalStats = { count: messageQueue[uid].count, totalAmount: messageQueue[uid].totalAmount };
                delete messageQueue[uid];
                
                const agent = await getAgentDetails(uid);
                if (agent && agent.phone) {
                    const timeNow = new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', hour12: true });
                    const formattedAmount = finalStats.totalAmount.toLocaleString('en-IN', { maximumFractionDigits: 2 });
                    const msg = getRandomConfirmationTemplate(agent.name, finalStats.count, formattedAmount, timeNow);
                    
                    await sleep(500); 
                    await safeSendMessage(client, agent.phone, msg, agent.name);
                }
            }, 3400); 
        }
    }, (error) => {
        console.error("❌ Firestore Listener Error:", error);
    });
}

// ==========================================
// 5. EXTERNAL REQUIRE CHECK (Always runs at the end)
// ==========================================
if (fs.existsSync('./check.js')) {
    try {
        require('./check.js')(client); 
        console.log("🔍 check.js external script executed successfully.");
    } catch (error) {
        console.error("❌ Failed to execute check.js:", error.message);
    }
}

module.exports = {
    restartClient: async () => {
        try { await client.destroy(); } catch(e) {}
        try { if (fs.existsSync('qr-code.png')) fs.unlinkSync('qr-code.png'); } catch (fsErr) {}
        setTimeout(startWhatsAppClient, 2000);
    }
};