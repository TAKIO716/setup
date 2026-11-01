const mqtt = require('mqtt');
const mineflayer = require('mineflayer');
const fs = require('fs');

const MQTT_URL = 'mqtt://broker.hivemq.com:1883';
const PREFIX = 'farmkalwi_09812'; // SAMAKAN
const PHONE_ID = 'HP-' + Date.now().toString().slice(-4) + Math.floor(Math.random()*100);
const TASK_FILE = './current_task.json';

// Topics
const T_REQ_TASK = `${PREFIX}/agent/request_task`; // Minta tugas ke Master
const T_PROCEED  = `${PREFIX}/agent/proceed`;      // Izin login dari Master
const T_STATUS   = `${PREFIX}/agent/status`;       // Lapor status

let bot = null;
let currentTask = null;
let isConnecting = false;
let whGranted = false;

const BOT_CONFIG = {
    host: 'kalwi.id', port: 25565, version: '1.18.1',
    auth: 'offline', skipValidation: true, physicsEnabled: false,
    viewDistance: 'tiny', chat: 'commandsOnly'
};

function loadTask() {
    try {
        if (fs.existsSync(TASK_FILE)) {
            const c = fs.readFileSync(TASK_FILE, 'utf8');
            if (c && c.trim() !== '') currentTask = JSON.parse(c);
        }
    } catch(e) { try { fs.unlinkSync(TASK_FILE); } catch(err){} }
}
function saveTask(t) {
    currentTask = t;
    if (t) fs.writeFileSync(TASK_FILE, JSON.stringify(t));
    else if (fs.existsSync(TASK_FILE)) fs.unlinkSync(TASK_FILE);
}

const log = (m) => console.log(`[${new Date().toISOString().slice(11, 19)}] [${PHONE_ID}] ${m}`);
const client = mqtt.connect(MQTT_URL);

// Loop minta tugas kalau lagi idle
function askForTask() {
    if (currentTask || !client.connected) return;
    client.publish(T_REQ_TASK, JSON.stringify({ phoneId: PHONE_ID }));
}

client.on('connect', () => {
    log(`MQTT Terhubung.`);
    client.subscribe(`${PREFIX}/task/${PHONE_ID}`); // Buat nerima instruksi login
    client.subscribe(T_PROCEED);                     // Buat nerima izin WH
    
    if (currentTask) {
        // Kalau ada sisa task (misal HP restart), langsung minta WH
        log(`Resume task ${currentTask.nickname}`);
        client.publish(`${PREFIX}/agent/request_wh`, JSON.stringify({ phoneId: PHONE_ID, nickname: currentTask.nickname }));
    } else {
        // Kalau kosong, minta tugas baru tiap 5 detik
        setInterval(askForTask, 5000);
    }
});

client.on('message', (topic, msg) => {
    let data; try { data = JSON.parse(msg.toString()); } catch(e) { return; }

    // 1. Dapet izin login dari Master (setelah WH sukses)
    if (topic === T_PROCEED && data.action === 'PROCEED') {
        if (currentTask && data.nickname === currentTask.nickname) {
            log(`✅ WH Granted. Connect ke MC!`);
            whGranted = true;
            connectBot();
        }
    }

    // 2. Dapet instruksi LOGIN dari Master (task baru)
    if (topic === `${PREFIX}/task/${PHONE_ID}`) {
        if (data.action === 'LOGIN') {
            log(`Menerima task baru: ${data.nickname}`);
            saveTask(data);
            // Minta WH ke Master untuk task ini
            client.publish(`${PREFIX}/agent/request_wh`, JSON.stringify({ phoneId: PHONE_ID, nickname: data.nickname }));
        }
    }
});

function connectBot() {
    if (isConnecting || !currentTask || !whGranted) return;
    isConnecting = true;
    log(`Connecting ke MC...`);

    try {
        bot = mineflayer.createBot({ ...BOT_CONFIG, username: currentTask.nickname });
    } catch (err) {
        isConnecting = false;
        log(`❌ Gagal createBot: ${err.message}`);
        return scheduleReconnect();
    }

    bot.once('spawn', async () => {
        isConnecting = false;
        log(`✅ Spawned. Login & Move...`);
        await runFlow();
    });

    bot.on('death', () => { if(bot) bot.respawn(); });

    bot.on('end', (reason) => {
        isConnecting = false;
        bot = null;
        log(`⚠️ Disconnected: ${reason}. Reconnect...`);
        if (currentTask) {
            whGranted = false;
            scheduleReconnect(); // Minta WH lagi
        }
    });

    bot.on('error', (err) => log(`❌ Error: ${err.message}`));
}

async function runFlow() {
    try {
        bot.chat(`/login ${currentTask.password}`);
        await new Promise(r => setTimeout(r, 5000));
        if (!bot || !bot.entity) return;

        bot.chat('/move skyblock');
        await new Promise(r => setTimeout(r, 5000));
        if (!bot || !bot.entity) return;

        log(`✅ Masuk Skyblock!`);
        if (bot.physics && bot.physics.stopListeners) bot.physics.stopListeners();

        client.publish(T_STATUS, JSON.stringify({ phoneId: PHONE_ID, nickname: currentTask.nickname, status: 'in_skyblock' }));
        
        // Tandai sukses
        currentTask.reported = true;
        saveTask(currentTask);

    } catch (err) { log(`❌ Flow error: ${err.message}`); }
}

function scheduleReconnect() {
    if (!currentTask) return;
    log(`🔄 Reconnect dalam 15 detik...`);
    setTimeout(() => {
        if (currentTask) {
            client.publish(`${PREFIX}/agent/request_wh`, JSON.stringify({ phoneId: PHONE_ID, nickname: currentTask.nickname }));
        }
    }, 15000);
}

loadTask();
process.on('SIGINT', () => { if (bot) bot.quit(); process.exit(0); });
