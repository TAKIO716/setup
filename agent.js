/**
 * AGENT — Kalwi Alt Farm (Termux)
 * Jalankan: node agent.js
 */
const mqtt = require('mqtt');
const mineflayer = require('mineflayer');
const fs = require('fs');

// ═══════════════════════════════════════════════════════════
// CONFIG (UBAH PREFIX INI SESUAIKAN DENGAN MASTER & TAMPERMONKEY)
// ═══════════════════════════════════════════════════════════
const MQTT_URL = 'mqtt://broker.hivemq.com:1883';
const PREFIX = 'farmkalwi_09812'; // <--- GANTI INI
const PHONE_ID = 'HP-' + Date.now().toString().slice(-4) + Math.floor(Math.random()*100); 
const TASK_FILE = './current_task.json';

const BOT_CONFIG = {
    host: 'kalwi.id',
    port: 25565,
    version: '1.18.1',
    auth: 'offline',
    skipValidation: true,
    physicsEnabled: false,
    viewDistance: 'tiny',
    chat: 'commandsOnly',
    checkTimeoutInterval: 30000,
};

const DELAY = {
    state: 5000,
    reconnect: 15000,
};

let bot = null;
let currentTask = null;
let isConnecting = false;

function loadTask() {
    try {
        if (fs.existsSync(TASK_FILE)) {
            currentTask = JSON.parse(fs.readFileSync(TASK_FILE, 'utf8'));
            console.log(`[AGENT] Resume task sebelumnya: ${currentTask.nickname}`);
        }
    } catch(e) {}
}

function saveTask(task) {
    currentTask = task;
    if (task) fs.writeFileSync(TASK_FILE, JSON.stringify(task));
    else if (fs.existsSync(TASK_FILE)) fs.unlinkSync(TASK_FILE);
}

const ts = () => new Date().toISOString().slice(11, 19);
const log = (msg) => console.log(`[${ts()}] [${PHONE_ID}] ${msg}`);

log(`Starting Agent. Connecting to MQTT...`);
const client = mqtt.connect(MQTT_URL);

client.on('connect', () => {
    log(`MQTT Terhubung.`);
    client.subscribe(`${PREFIX}/task/${PHONE_ID}`);
    
    if (!currentTask) {
        client.publish(`${PREFIX}/request`, JSON.stringify({ phoneId: PHONE_ID }));
    } else if (!bot && !isConnecting) {
        connectBot();
    }
});

client.on('message', (topic, msg) => {
    if (topic === `${PREFIX}/task/${PHONE_ID}`) {
        let data;
        try { data = JSON.parse(msg.toString()); } catch(e) { return; }
        
        if (data.action === 'STANDBY') return;

        if (data.action === 'LOGIN') {
            if (currentTask && currentTask.nickname === data.nickname && bot) return;
            
            log(`Menerima tugas: ${data.nickname}`);
            saveTask(data);
            
            if (bot) { try { bot.quit(); } catch(e){} bot = null; }
            connectBot();
        }
    }
});

function connectBot() {
    if (isConnecting || !currentTask) return;
    isConnecting = true;

    log(`Connecting ke Minecraft sebagai ${currentTask.nickname}...`);

    try {
        bot = mineflayer.createBot({ ...BOT_CONFIG, username: currentTask.nickname });
    } catch (err) {
        log(`❌ Create bot gagal: ${err.message}`);
        isConnecting = false;
        scheduleReconnect();
        return;
    }

    bot.once('spawn', async () => {
        isConnecting = false;
        log(`✅ Spawned. Menjalankan Flow Login & Move...`);
        await runFlow();
    });

    bot.on('death', () => {
        log(`💀 Bot mati! Auto respawn...`);
        try { if (bot) bot.respawn(); } catch(e){}
    });

    bot.on('end', (reason) => {
        isConnecting = false;
        bot = null;
        log(`⚠️ Disconnected: ${reason || 'unknown'}`);
        if (currentTask) scheduleReconnect();
    });

    bot.on('error', (err) => log(`❌ Error: ${err.message}`));
    bot.on('kicked', (reason) => {
        let msg = reason;
        try { msg = JSON.parse(reason).text || reason; } catch {}
        log(`⚠️ Kicked: ${msg}`);
    });
}

async function runFlow() {
    try {
        log(`→ /login ${'*'.repeat(currentTask.password.length)}`);
        bot.chat(`/login ${currentTask.password}`);
        await new Promise(r => setTimeout(r, DELAY.state));
        
        if (!bot || !bot.entity) return;

        log(`→ /move skyblock`);
        bot.chat('/move skyblock');
        await new Promise(r => setTimeout(r, DELAY.state));
        
        if (!bot || !bot.entity) return;

        log(`✅ Bot di Skyblock. AFK Render Chunk Aktif.`);
        
        if (bot.physics && bot.physics.stopListeners) bot.physics.stopListeners();

        if (!currentTask.reported) {
            client.publish(`${PREFIX}/status`, JSON.stringify({ 
                phoneId: PHONE_ID, nickname: currentTask.nickname, status: 'success' 
            }));
            currentTask.reported = true;
            saveTask(currentTask);
        }

    } catch (err) {
        log(`❌ Flow error: ${err.message}`);
    }
}

function scheduleReconnect() {
    if (!currentTask) return;
    log(`🔄 Reconnect dalam ${DELAY.reconnect / 1000} detik...`);
    setTimeout(() => { if (currentTask) connectBot(); }, DELAY.reconnect);
}

loadTask();

process.on('SIGINT', () => {
    log('Shutting down agent...');
    if (bot) { try { bot.quit(); } catch {} }
    process.exit(0);
});
