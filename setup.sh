#!/data/data/com.termux/files/usr/bin/bash

# Warna
GREEN='\033[0;32m'
CYAN='\033[0;36m'
NC='\033[0m'

echo -e "${CYAN}=== Auto-Install Kalwi Agent ===${NC}"

# 1. Update & Upgrade Termux
echo -e "${GREEN}[1/5] Updating packages...${NC}"
pkg update -y && pkg upgrade -y

# 2. Install Dependencies
echo -e "${GREEN}[2/5] Installing Node.js, NPM, Wget...${NC}"
pkg install -y nodejs npm wget

# 3. Download agent.js dari GitHub
echo -e "${GREEN}[3/5] Downloading agent.js...${NC}"
AGENT_URL="https://raw.githubusercontent.com/TAKIO716/setup/refs/heads/main/agent.js"
wget -qO agent.js "$AGENT_URL"

if [ ! -f "agent.js" ]; then
    echo -e "\033[0;31m[❌] Gagal download agent.js. Cek URL GitHub lo!${NC}"
    exit 1
fi

# 4. Install Node Modules
echo -e "${GREEN}[4/5] Installing MQTT & Mineflayer (bisa makan waktu 1-2 menit)...${NC}"
npm install mqtt mineflayer

# 5. Setup Auto-Start & Wake Lock
echo -e "${GREEN}[5/5] Setting Termux Wake Lock...${NC}"
termux-wake-lock

# 6. Jalanin Bot
echo -e "${CYAN}=== Setup Selesai! Menjalankan Bot... ===${NC}"
while true; do
    node agent.js
    echo -e "\033[0;31mBot mati. Restart dalam 5 detik...\033[0m"
    sleep 5
done
