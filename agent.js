const mqtt = require('mqtt');
const mineflayer = require('mineflayer');
const fs = require('fs');

const MQTT_URL = 'mqtt://broker.hivemq.com:1883';
const PREFIX = 'farmkalwi_09812';
const PHONE_ID = 'HP-' + Date.now().toString().slice(-4) + Math.floor(Math.random()*100);
const TASK_FILE = './current_task.json';

const T_REQ_TASK = `${PREFIX}/agent/request_task`; 
const T_REQ_WH   = `${PREFIX}/agent/request_wh`;   
const T_PROCEED  = `${PREFIX}/agent/proceed`;      
const T_STATUS   = `${PREFIX}/agent/status`;       
const T_FAILED   = `${PREFIX}/agent/failed`;        // BARU

let bot = null;
let currentTask = null;
let isConnecting = false;
let whDone = false;
let failCount = 0;

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

// Minta task tiap 5 detik kalau nganggur
setInterval(() => {
    if (!currentTask && client.connected && !isConnecting) {
        client.publish(T_REQ_TASK, JSON.stringify({ phoneId: PHONE_ID }));
    }
}, 5000);

client.on('connect', () => {
    log(`MQTT Terhubung.`);
    client.subscribe(`${PREFIX}/task/${PHONE_ID}`); 
    client.subscribe(T_PROCEED);                     
    
    if (currentTask && !bot && !whDone) {
        log(`Resume task ${currentTask.nickname}`);
        client.publish(T_REQ_WH, JSON.stringify({ phoneId: PHONE_ID, nickname: currentTask.nickname }));
    }
});

client.on('message', (topic, msg) => {
    let data; try { data = JSON.parse(msg.toString()); } catch(e) { return; }

    if (topic === T_PROCEED && data.action === 'PROCEED') {
        if (currentTask && data.nickname === currentTask.nickname) {
            log(`✅ WH Granted. Connect ke MC!`);
            whDone = true;
            connectBot();
        }
    }

    if (topic === `${PREFIX}/task/${PHONE_ID}`) {
        if (data.action === 'LOGIN') {
            log(`Dapet tugas baru: ${data.nickname}`);
            saveTask(data);
            whDone = true;
            failCount = 0;
            connectBot();
        }
    }
});

function connectBot() {
    if (isConnecting || !currentTask || !whDone) return;
    isConnecting = true;
    log(`Connecting ke MC... (fail count: ${failCount})`);

    try {
        bot = mineflayer.createBot({ ...BOT_CONFIG, username: currentTask.nickname });
    } catch (err) {
        isConnecting = false;
        log(`❌ Gagal createBot: ${err.message}`);
        return handleFailure('createBot error: ' + err.message);
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
        log(`⚠️ Disconnected: ${reason}`);
        if (currentTask) {
            whDone = false;
            // Kalau putus karena kicked/error, lapor failed
            if (/error|kick|banned|whitelist/i.test(String(reason))) {
                handleFailure('disconnect: ' + reason);
            } else {
                scheduleReconnect();
            }
        }
    });

    bot.on('error', (err) => {
        log(`❌ Error: ${err.message}`);
        // Kalau error fatal (ECONNREFUSED, timeout), lapor failed
        if (/ECONNREFUSED|ETIMEDOUT|timeout/i.test(err.message)) {
            handleFailure('error: ' + err.message);
        }
    });

    bot.on('kicked', (reason) => {
        let msg = reason; try { msg = JSON.parse(reason).text || reason; } catch {}
        log(`⚠️ Kicked: ${msg}`);
        // Kalo kicked karena whitelist, lapor failed
        if (/whitelist|not registered|tidak terdaftar/i.test(msg)) {
            handleFailure('kicked: ' + msg);
        }
    });
}

function handleFailure(reason) {
    failCount++;
    log(`❌ Failure #${failCount}: ${reason}`);
    
    if (currentTask && failCount >= 3) {
        log(`Report failure ke Master (${currentTask.nickname})`);
        client.publish(T_FAILED, JSON.stringify({ 
            phoneId: PHONE_ID, 
            nickname: currentTask.nickname, 
            reason 
        }));
        // Reset task
        saveTask(null);
        whDone = false;
        failCount = 0;
    } else {
        scheduleReconnect();
    }
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
        currentTask.reported = true;
        saveTask(currentTask);
        failCount = 0;

    } catch (err) { 
        log(`❌ Flow error: ${err.message}`);
        handleFailure('flow: ' + err.message);
    }
}

function scheduleReconnect() {
    if (!currentTask) return;
    log(`🔄 Minta WH ulang dalam 15 detik...`);
    setTimeout(() => {
        if (currentTask && !whDone) {
            client.publish(T_REQ_WH, JSON.stringify({ phoneId: PHONE_ID, nickname: currentTask.nickname }));
        }
    }, 15000);
}

loadTask();
process.on('SIGINT', () => { if (bot) bot.quit(); process.exit(0); });
