
## Prerequisites

### Required
- Node.js v18 or higher – [Download](https://nodejs.org/)
- Git – [Download](https://git-scm.com/download/win)

#### Install on Linux/macOS:
```bash
# Node.js (using nvm)
curl -fsSL https://raw.githubusercontent.com/nvm-sh/nvm/master/install.sh | bash
nvm install 18

# Git
sudo apt install git -y        # Debian/Ubuntu
brew install git               # macOS (Homebrew)
```

#### Install on Windows:
- Install Node.js from [nodejs.org](https://nodejs.org/)
- Install Git from [git-scm.com](https://git-scm.com/download/win)

### Automatic Installation
- `pnpm` – Will be installed automatically by the script if not present

---

## Installation Methods

### Method 1: Automated Install (Recommended)

#### Windows (PowerShell)
```powershell
# Run setup script
.\setup-questmaster.ps1
```

Fresh PC install:
```powershell
.\setup-questmaster.ps1 -FreshInstall
```

This script handles:
- Checking Node.js and Git  
- Installing pnpm  
- Cloning Vencord and QuestMaster  
- Building and injecting Vencord  

### Method 2: Manual Installation

1. **Install prerequisites**
```bash
npm install -g pnpm
```

2. **Install or locate Vencord**
```bash
git clone https://github.com/Vendicated/Vencord.git ~/Documents/Vencord
cd ~/Documents/Vencord
pnpm install --frozen-lockfile
```

3. **Install QuestMaster**
```bash
cd src/userplugins
git clone https://github.com/winters27/QuestMaster.git questMaster
cd ../..
```

4. **Build & Inject Vencord**
```bash
pnpm build --dev
pnpm uninject
pnpm inject
```

5. **Enable Plugin**
- Restart Discord  
- Go to **Settings → Vencord → Plugins**  
- Enable **QuestMaster**  

---

## Updating

### Automatic Update
```powershell
.\setup-questmaster.ps1
```

### Manual Update
```bash
cd Vencord/src/userplugins/questMaster
git pull
cd ../../..
pnpm build --dev
```

---

## Uninstallation

```bash
cd Vencord
# Disable plugin in Discord first
rm -rf src/userplugins/questMaster
pnpm build --dev
```

To remove Vencord completely:
```bash
pnpm uninject
rm -rf Vencord
```

---

## Quick Reference

**Install (auto):**
```powershell
.\setup-questmaster.ps1
```

**Install (manual):**
```bash
cd Vencord/src/userplugins
git clone https://github.com/winters27/QuestMaster.git questMaster
cd ../..
pnpm build --dev
pnpm inject
```

**Update:**
```bash
cd Vencord/src/userplugins/questMaster
git pull
cd ../../..
pnpm build --dev
```

**Uninstall:**
```bash
cd Vencord
rm -rf src/userplugins/questMaster
pnpm build --dev
```
