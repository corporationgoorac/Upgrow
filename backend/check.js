const { MessageMedia } = require('whatsapp-web.js'); 
const admin = require('firebase-admin');

const db = admin.firestore();

// ---------------------------------------------------------
// 1. THE MESSAGE LISTENER (Interactive Bot Logic)
// ---------------------------------------------------------
module.exports = function(client) {
    const monitorMemory = setInterval(async () => {
        const memoryUsage = process.memoryUsage().heapUsed / 1024 / 1024;
        if (memoryUsage > 450) { 
            console.log(`⚠️ High Memory Detected (${Math.round(memoryUsage)}MB). Purging message cache...`);
            if (client.pupPage) {
                await client.pupPage.evaluate(() => {
                    if (typeof window !== 'undefined' && window.Store && window.Store.Msg) { 
                        window.Store.Msg.clear();
                    }
                }).catch(() => {});
            }
        }
    }, 300000); 

    client.on('message', async (msg) => {
       const input = msg.body.replace(/\s+/g, '').toUpperCase();
       const accountPattern = /^[A-Z]\d{1,5}$/;

        if (accountPattern.test(input)) {
            console.log(`🔍 [BOT] Processing Request for: ${input}`);
            
            try {
                // 1. Fetch from Firestore 'customers' collection
                const q = await db.collection('customers').where('id', '==', input).get();
                
                if (q.empty) {
                    return msg.reply("❌ *Customer ID not found.*\nPlease check the ID and try again.\n\n❌ *வாடிக்கையாளர் எண் காணப்படவில்லை.*\nஎண்ணை சரிபார்த்து மீண்டும் முயற்சிக்கவும்.");
                }

                const customer = q.docs[0].data(); 
                const products = customer.products || [];
                
                if (products.length === 0) {
                    return msg.reply(`⚠️ Record found for *${customer.name}*, but no active products were found.\n\n⚠️ *${customer.name}* க்கான பதிவு உள்ளது, ஆனால் செயலில் உள்ள பொருட்கள் எதுவும் இல்லை.`);
                }

                // 2. Fetch Temporary Entries (Pending/Submitted Drafts) from daily_logs
                const tempDocs = await db.collection('daily_logs').where('activeCustomers', 'array-contains', input).get();
                const tempEntries = [];
                
                tempDocs.forEach(doc => {
                    const data = doc.data();
                    Object.keys(data).forEach(key => {
                        // Extract specific product entries that are in transit
                        if (key !== 'activeCustomers' && (data[key].status === 'pending' || data[key].status === 'submitted')) {
                            // Key format is usually "C44_0", so split by '_' and grab index 1
                            const parts = key.split('_');
                            if (parts.length > 1) {
                                tempEntries.push({
                                    ...data[key],
                                    productIndex: parseInt(parts[1])
                                });
                            }
                        }
                    });
                });

                await msg.reply(`✨ _Up Field_ Analytics\nFound *${products.length}* active product(s) for *${customer.name}*.\n\n📥 _Generating Statements..._ | _அறிக்கைகளை உருவாக்குகிறது..._`);

                // 3. Generate and Send specialized images for EACH product
                for (let i = 0; i < products.length; i++) {
                    const product = products[i];
                    // Filter temp entries specifically for THIS product index
                    const relevantTemps = tempEntries.filter(t => t.productIndex === i);
                    
                    const imageBuffer = await generateStatementImage(client, customer, product, relevantTemps);

                    const media = new MessageMedia('image/png', imageBuffer.toString('base64'), `Statement_${input}_${product.name.replace(/\s+/g, '_')}.png`);
                    
                    // ✨ UPDATED: Deep linking directly to your Upgrow GitHub Pages deployment
                    const caption = `👤 *Customer / வாடிக்கையாளர்:* ${customer.name}\n📦 *Product / பொருள்:* ${product.name}\n🆔 *Account / கணக்கு:* ${input}\n\n🌐 *View full payments details / முழு கட்டண விவரங்களை இங்கே காணவும்:*\nhttps://corporationgoorac.github.io/Upgrow/index.html?custId=${input}\n\n✨ _Up Field_`;

                    await client.sendMessage(msg.from, media, { caption: caption });
                }

                console.log(`✅ ${products.length} Statement(s) sent successfully for ${input}`);

            } catch (error) {
                console.error("❌ Bot Error:", error);
                msg.reply("⚠️ *System Busy:* Could not generate the image at this moment. Please try again in a few minutes.\n\n⚠️ *கணினி பிஸியாக உள்ளது:* தற்போது அறிக்கை உருவாக்க முடியவில்லை. சிறிது நேரம் கழித்து மீண்டும் முயற்சிக்கவும்.");
            }
        }
    });
};

// ---------------------------------------------------------
// 2. A4 IMAGE GENERATOR (DYNAMIC LIGHT/DARK THEME WITH CHITTAI LOGIC)
// ---------------------------------------------------------
async function generateStatementImage(client, customer, product, relevantTemps) {
    let page;
    try {
        if (!client.pupBrowser) {
            throw new Error("Puppeteer browser instance is not available. Client may be disconnected.");
        }

        page = await client.pupBrowser.newPage(); 
        await page.setViewport({ width: 800, height: 1131 });

        const isDarkTheme = Math.random() > 0.5;
        
        const theme = {
            bg: isDarkTheme ? '#050505' : '#f0f2f5',
            cardBg: isDarkTheme ? '#121212' : '#ffffff',
            textMain: isDarkTheme ? '#ffffff' : '#1c1e21',
            textMuted: isDarkTheme ? '#b3b3b3' : '#65676B',
            borderColor: isDarkTheme ? 'rgba(255, 255, 255, 0.1)' : 'rgba(0, 0, 0, 0.08)',
            tableBg: isDarkTheme ? '#1c1c1e' : '#f7f8fa',
            accentGradient: 'linear-gradient(45deg, #10B981, #059669)', // Switched to Up Field Green
            accentGreen: '#10B981',
            success: '#10B981',
            warning: '#f59e0b', 
            danger: '#ef4444'
        };

        const totalVal = parseFloat(product.total) || parseFloat(product.amount) || 0;
        
        // 1. Map approved payments
        let allTxns = (product.payments || []).map(pay => ({
            ...pay,
            status: pay.status || 'success'
        }));

        // 2. Map pending/draft payments
        relevantTemps.forEach(t => {
            allTxns.push({
                dueNumber: t.dueNumber,
                nextDue: t.nextDue,
                targetDue: t.targetDue,
                date: t.timestamp,
                amount: t.amount,
                status: 'pending' // 'pending' or 'submitted'
            });
        });

        // 3. UNIFIED CHITTAI vs NORMAL SORTING LOGIC
        // Map effective due for sorting purposes
        allTxns = allTxns.map((pay, i) => {
            return { ...pay, sno: i + 1, effectiveDue: pay.dueNumber || pay.nextDue || 0 };
        });

        if (product.isChittai) {
            // Chittai sorts by due number descending (newest due at top)
            allTxns.sort((a, b) => {
                if (a.effectiveDue !== b.effectiveDue) return b.effectiveDue - a.effectiveDue;
                const dateA = new Date(a.date || a.timestamp || 0);
                const dateB = new Date(b.date || b.timestamp || 0);
                return dateB - dateA;
            });
        } else {
            // Normal products sort purely chronologically
            allTxns.sort((a, b) => {
                const dateA = new Date(a.date || a.timestamp || 0);
                const dateB = new Date(b.date || b.timestamp || 0);
                return dateB - dateA; // Newest first
            });
        }

        // 4. Calculate Master Ledger Math
        let runningPaid = 0;
        let runningProcessing = 0;

        allTxns.forEach(pay => {
            const amt = parseFloat(pay.amount) || 0;
            const status = (pay.status).toLowerCase();
            if(status === "success" || status === "paid" || status === "completed") {
                runningPaid += amt;
            } else if (status === "pending" || status === "submitted" || status === "processing") {
                runningProcessing += amt;
            }
        });

        const outstanding = Math.max(0, totalVal - runningPaid - runningProcessing);
        const statusLabel = outstanding <= 0 ? "PAID IN FULL" : "PAYMENT DUE";
        const statusColor = outstanding <= 0 ? theme.success : theme.danger;

        // Display only the last 10 transactions
        const last10 = allTxns.slice(0, 10);

        // Helper for status badge rendering
        const getStatusBadge = (status) => {
            const s = status.toLowerCase();
            if(s === 'pending' || s === 'submitted' || s === 'processing') return `<span style="color: ${theme.warning}; font-size: 11px; font-weight: 800; letter-spacing: 0.5px;">PROCESSING</span>`;
            if(s.includes("fail") || s.includes("reject")) return `<span style="color: ${theme.danger}; font-size: 11px; font-weight: 800; letter-spacing: 0.5px;">FAILED</span>`;
            return `<span style="color: ${theme.success}; font-size: 11px; font-weight: 800; letter-spacing: 0.5px;">PAID</span>`;
        };
        
        // Helper to format due string
        const getDueString = (p) => {
            if (p.dueNumber) return `#${p.dueNumber}`;
            if (p.nextDue) {
                if (p.targetDue && p.targetDue > p.nextDue) return `#${p.nextDue}-${p.targetDue}`;
                return `#${p.nextDue}`;
            }
            return "-";
        }

        const htmlContent = `
        <!DOCTYPE html>
        <html>
        <head>
            <style>
                @import url('https://fonts.googleapis.com/css2?family=SF+Pro+Display:wght@400;600;700;800&display=swap');
                * { box-sizing: border-box; -webkit-font-smoothing: antialiased; }
                body { 
                    background: ${theme.bg}; color: ${theme.textMain}; 
                    font-family: -apple-system, BlinkMacSystemFont, 'SF Pro Display', sans-serif; 
                    margin: 0; padding: 60px; 
                    width: 800px; height: 1131px;
                    display: flex; flex-direction: column;
                }
                .meta-header { 
                    display: flex; justify-content: space-between; align-items: center;
                    margin-bottom: 50px;
                }
                .brand-logo {
                    font-size: 32px; font-weight: 800; background: ${theme.accentGradient};
                    -webkit-background-clip: text; -webkit-text-fill-color: transparent;
                }
                .brand-badge {
                    background: ${theme.borderColor}; padding: 8px 16px; border-radius: 20px;
                    font-size: 12px; font-weight: 600; text-transform: uppercase; letter-spacing: 1px;
                    color: ${theme.textMain};
                }
                
                .card {
                    background: ${theme.cardBg}; border: 1px solid ${theme.borderColor};
                    border-radius: 24px; padding: 40px; margin-bottom: 30px;
                    box-shadow: ${isDarkTheme ? '0 20px 40px rgba(0,0,0,0.4)' : '0 10px 30px rgba(0,0,0,0.05)'};
                }
                .cust-name { font-size: 42px; font-weight: 800; margin: 0 0 12px 0; letter-spacing: -1px; }
                .cust-info { color: ${theme.textMuted}; font-size: 16px; display: flex; gap: 20px; font-weight: 500; }
                
                .stats-row { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 20px; margin-bottom: 40px; }
                .stat-box { 
                    background: ${theme.cardBg}; padding: 25px; border-radius: 24px; 
                    border: 1px solid ${theme.borderColor};
                    border-top: 4px solid ${theme.borderColor};
                    box-shadow: ${isDarkTheme ? 'none' : '0 4px 15px rgba(0,0,0,0.03)'};
                }
                .stat-box.primary { border-top-color: ${theme.accentGreen}; }
                .stat-box.success { border-top-color: ${theme.success}; }
                .stat-box.danger { border-top-color: ${statusColor}; }
                
                .stat-label { font-size: 12px; color: ${theme.textMuted}; text-transform: uppercase; font-weight: 700; margin-bottom: 8px; letter-spacing: 0.5px; }
                .stat-val { font-size: 28px; font-weight: 800; color: ${theme.textMain}; }

                .ledger-section { flex: 1; }
                .ledger-head { font-size: 20px; font-weight: 800; margin-bottom: 20px; color: ${theme.textMain}; letter-spacing: -0.5px; display: flex; justify-content: space-between;}

                table { width: 100%; border-collapse: separate; border-spacing: 0 8px; }
                th { text-align: left; font-size: 13px; color: ${theme.textMuted}; padding: 0 20px; text-transform: uppercase; font-weight: 700; letter-spacing: 0.5px;}
                td { 
                    padding: 20px; background: ${theme.tableBg}; 
                    border-top: 1px solid ${theme.borderColor};
                    border-bottom: 1px solid ${theme.borderColor};
                    font-size: 15px; font-weight: 500;
                }
                td:first-child { border-left: 1px solid ${theme.borderColor}; border-radius: 16px 0 0 16px; }
                td:last-child { border-right: 1px solid ${theme.borderColor}; border-radius: 0 16px 16px 0; }
                
                .due-pill { 
                    background: ${isDarkTheme ? '#2c2c2e' : '#e4e6eb'}; 
                    color: ${theme.textMain};
                    padding: 6px 14px; border-radius: 10px; 
                    font-weight: 800; font-size: 14px; 
                }
                .amt-paid { color: ${theme.textMain}; font-weight: 700; font-family: monospace; font-size: 16px;}
                
                .site-footer { 
                    margin-top: auto; padding-top: 40px; border-top: 1px solid ${theme.borderColor};
                    display: flex; justify-content: space-between; align-items: center;
                    color: ${theme.textMuted}; font-size: 14px; font-weight: 500;
                }
                .brand-accent { color: ${theme.accentGreen}; font-weight: 700; font-style: italic; }
            </style>
        </head>
        <body>
            <div class="meta-header">
                <div class="brand-logo">UP FIELD</div>
                <div class="brand-badge">Automated Analytics</div>
            </div>

            <div class="card">
                <h1 class="cust-name">${customer.name}</h1>
                <div class="cust-info">
                    <span>🆔 Account: ${customer.id}</span>
                    <span>📦 Product: ${product.name}</span>
                    <span>${customer.place ? '📍 ' + customer.place : ''}</span>
                </div>
            </div>

            <div class="stats-row">
                <div class="stat-box primary">
                    <div class="stat-label">Product Value</div>
                    <div class="stat-val">₹${totalVal.toLocaleString()}</div>
                </div>
                <div class="stat-box success">
                    <div class="stat-label">Total Collected</div>
                    <div class="stat-val">₹${runningPaid.toLocaleString()}</div>
                </div>
                <div class="stat-box danger" style="border-top-color: ${statusColor}">
                    <div class="stat-label" style="color: ${statusColor}">${statusLabel}</div>
                    <div class="stat-val" style="color: ${statusColor}">₹${outstanding.toLocaleString()}</div>
                </div>
            </div>

            <div class="ledger-section">
                <div class="ledger-head">
                   <span>Recent Transactions & Processing</span>
                   <span style="font-size:14px; color:${theme.textMuted}; font-weight:500;">(Showing Last 10)</span>
                </div>
                <table>
                    <thead>
                        <tr>
                            <th width="20%">DUE / S.No</th>
                            <th width="30%">DATE</th>
                            <th width="25%">STATUS</th>
                            <th width="25%">AMOUNT</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${last10.length > 0 ? last10.map(p => {
                            const dStr = p.date ? new Date(p.date).toLocaleDateString('en-IN', { day:'2-digit', month:'short', year: 'numeric' }) : "Unknown Date";
                            return `
                            <tr>
                                <td><span class="due-pill">${product.isChittai ? getDueString(p) : p.sno}</span></td>
                                <td>${dStr}</td>
                                <td>${getStatusBadge(p.status)}</td>
                                <td class="amt-paid">₹${(parseFloat(p.amount)||0).toLocaleString()}</td>
                            </tr>
                            `
                        }).join('') : `<tr><td colspan="4" style="text-align:center;">No records found.</td></tr>`}
                    </tbody>
                </table>
            </div>

            <div class="site-footer">
                <div>Generated ${new Date().toLocaleDateString('en-IN')}</div>
                <div>Powered by <span class="brand-accent">Up Field Systems</span></div>
            </div>
        </body>
        </html>`;

        await page.setContent(htmlContent, { waitUntil: 'load' });
        
        await Promise.race([
            page.evaluateHandle('document.fonts.ready'),
            new Promise(resolve => setTimeout(resolve, 600))
        ]);

        const screenshot = await page.screenshot({ 
            fullPage: false, 
            type: 'png',
            omitBackground: true 
        });
        
        return screenshot;

    } catch (error) {
        console.error("Image generation error:", error);
        throw error;
    } finally {
        if (page && !page.isClosed()) {
            await page.close().catch(() => {}); 
        }
    }
}
