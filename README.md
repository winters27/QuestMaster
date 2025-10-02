# QuestMaster Installation Guide

QuestMaster is a Vencord plugin that automatically completes Discord quests in the background.  

---

## Prerequisites

You will need the following installed on your system:

- **Node.js v18 or higher** – [Download](https://nodejs.org/)  
- **Git** – [Download](https://git-scm.com/download/win)  
- **pnpm** – Installed globally via npm  

#### Install on Linux/macOS:
```bash
# Node.js (using nvm)
curl -fsSL https://raw.githubusercontent.com/nvm-sh/nvm/master/install.sh | bash
nvm install 18

# Git
sudo apt install git -y        # Debian/Ubuntu
brew install git               # macOS (Homebrew)

# pnpm
npm install -g pnpm
```

#### Install on Windows:
- Install Node.js from [nodejs.org](https://nodejs.org/)  
- Install Git from [git-scm.com](https://git-scm.com/download/win)  
- Install pnpm:
```powershell
npm install -g pnpm
```

---

## Manual Installation

### Step 1: Clone Vencord
If you don’t already have Vencord:
```bash
cd ~/Documents
git clone https://github.com/Vendicated/Vencord.git
cd Vencord
pnpm install --frozen-lockfile
```

### Step 2: Add QuestMaster
From your Vencord directory:
```bash
cd src/userplugins
git clone https://github.com/winters27/QuestMaster.git questMaster
cd ../..
```

Your folder structure should look like:
```
Vencord/
 └── src/
     └── userplugins/
         └── questMaster/
             ├── index.tsx
             ├── README.md
             └── components/
                 ├── QuestButton.tsx
                 └── QuestButton.css
```

### Step 3: Build Vencord
```bash
pnpm build --dev
```

### Step 4: Inject Vencord
```bash
pnpm uninject
pnpm inject
```

### Step 5: Enable QuestMaster
1. Restart Discord (fully close it, including from the system tray)  
2. Go to **Settings → Vencord → Plugins**  
3. Search for **QuestMaster**  
4. Enable the plugin  

---

## Updating QuestMaster

```bash
cd Vencord/src/userplugins/questMaster
git pull
cd ../../..
pnpm build --dev
```

Restart Discord after updating.

---

## Uninstallation

To remove QuestMaster:
```bash
cd Vencord
rm -rf src/userplugins/questMaster
pnpm build --dev
```

To remove Vencord completely:
```bash
pnpm uninject
rm -rf Vencord
```

---

## Supported Quest Types

- **Video Quests:** Simulates video watching (browser + desktop)  
- **Desktop Gameplay Quests:** Spoofs a running game process (desktop only)  
- **Stream Quests:** Simulates streaming activity (desktop only, requires at least one other person in voice channel)  
- **Activity Quests:** Sends heartbeats for activity-based quests  

---

## Troubleshooting

- Rebuild if plugin doesn’t appear:  
  ```bash
  pnpm build --dev
  ```
- Check Node.js version:  
  ```bash
  node --version
  ```
  (must be v18+)  
- Run PowerShell as Administrator on Windows if injection fails  
- Ensure Discord is fully restarted after building  
