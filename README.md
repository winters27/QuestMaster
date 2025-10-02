# QuestMaster Installation Guide


## Prerequisites

### Required
- Node.js v18 or higher – [Download](https://nodejs.org/)
- Git – [Download](https://git-scm.com/download/win)

### Automatic Installation
- `pnpm` – Will be installed automatically by the script if not present

---

## Installation Methods

### Method 1: One-Shot Automated Install (Recommended)

This method handles everything automatically, including cloning Vencord if needed.

#### Windows (PowerShell)
1. Download `setup-questmaster.ps1` from the repository
2. Open PowerShell in the same directory as the script
3. Run:
   ```powershell
   .\setup-questmaster.ps1
   ```
4. Follow the prompts

The script will:
- Verify Node.js and Git are installed  
- Install pnpm if needed  
- Detect or clone Vencord  
- Install all dependencies with `--frozen-lockfile`  
- Clone and install QuestMaster from GitHub  
- Build Vencord  
- Optionally inject into Discord  

#### Fresh PC Installation
For a completely new setup run:
```powershell
.\setup-questmaster.ps1 -FreshInstall
```

---

### Updating QuestMaster
To update to the latest version run:
```powershell
.\setup-questmaster.ps1
```
When prompted about the existing installation, choose to overwrite.

---

### Method 2: Manual Installation

#### Step 1: Install Prerequisites
Ensure you have Node.js v18+ and Git installed.  
Install pnpm globally:
```bash
npm install -g pnpm
```

#### Step 2: Install or Locate Vencord

**Option A: Clone Vencord (if you don’t have it)**
```bash
cd ~/Documents
git clone https://github.com/Vendicated/Vencord.git
cd Vencord
pnpm install --frozen-lockfile
```

**Option B: Use existing Vencord installation**  
Navigate to your existing Vencord directory.

#### Step 3: Install QuestMaster
From your Vencord directory:
```bash
cd src/userplugins
git clone https://github.com/winters27/QuestMaster.git questMaster
cd ../..
```

Your structure should look like:
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

#### Step 4: Build Vencord
```bash
pnpm build --dev
```

#### Step 5: Inject Vencord
```bash
pnpm uninject
pnpm inject
```

#### Step 6: Restart Discord
- Close Discord completely (check system tray)  
- Restart Discord  
- Go to Settings → Vencord → Plugins  
- Search for "QuestMaster"  
- Enable the plugin  

---

## Configuration

After enabling the plugin, you can configure it in Settings → Vencord → Plugins → QuestMaster:

- **Show Quests Button (Top Bar):** Display quest button in window's top bar (default: on)  
- **Show Quests Button (Settings Bar):** Display quest button in settings sidebar (default: off)  
- **Show Quest Badges:** Display colored status badges (default: on)  

---

## Usage

Once enabled, QuestMaster automatically:
- Monitors available Discord quests  
- Begins completion when you enroll in a quest  
- Tracks progress via console logs  
- Completes quests in the background  

### Quest Button
The quest button shows:
- **Red badge:** Enrollable quests available  
- **Yellow badge:** Currently enrolled in quests  
- **Green badge:** Completed quests ready to claim  

Click the button to navigate to Discord's quest home page.

---

## Supported Quest Types

### Video Quests
Automatically simulates video watching progress at an accelerated rate. Works in browser and desktop.

### Desktop Gameplay Quests
Spoofs a running game process. Requires Discord desktop application - does not work in browser.

### Stream Quests
Simulates streaming activity. Requirements:
- Discord desktop application  
- You must stream any window in a voice channel  
- At least one other person must be in the voice channel  

### Activity Quests
Automatically sends heartbeat requests to progress activity-based quests.

---

## Troubleshooting

### Plugin doesn't appear in the list
- Verify files are in `Vencord/src/userplugins/questMaster/`  
- Check browser console for errors (`Ctrl+Shift+I`)  
- Rebuild:
  ```bash
  pnpm build --dev
  ```
- Ensure Discord is fully restarted  

### Build fails
- Ensure you're in the Vencord root directory  
- Try:
  ```bash
  pnpm install --frozen-lockfile
  ```
- Check Node.js version:
  ```bash
  node --version
  ```
  (must be v18+)  
- Check for syntax errors in console output  

### Plugin won't enable
- Check DevTools console (`Ctrl+Shift+I`) for error messages  
- Verify all component files are present  
- Try disabling other plugins to check for conflicts  

### Injection fails
- Ensure Discord is completely closed (including system tray)  
- Run PowerShell as Administrator  
- Try manual injection:
  ```bash
  cd Vencord && pnpm inject
  ```

### Quests not completing
- Check browser console for progress logs  
- Ensure you've enrolled in the quest through Discord  
- For desktop/stream quests, verify you're using Discord desktop app  
- For stream quests, ensure at least one other person is in voice channel  

### Script execution policy error (PowerShell)
If you get an execution policy error, run:
```powershell
Set-ExecutionPolicy -Scope CurrentUser -ExecutionPolicy RemoteSigned
```

---

## Updating

### Automatic Update
```powershell
.\setup-questmaster.ps1
```
Choose to overwrite when prompted.

### Manual Update
```bash
cd Vencord/src/userplugins/questMaster
git pull
cd ../../..
pnpm build --dev
```
Restart Discord.

---

## Uninstallation

1. Disable the plugin in Discord settings  
2. Delete the `questMaster` folder from `Vencord/src/userplugins/`  
3. Rebuild:
   ```bash
   pnpm build --dev
   ```
4. Restart Discord  

To completely remove Vencord:
```bash
cd Vencord
pnpm uninject
rm -rf Vencord
```

---

## Technical Details

QuestMaster integrates with Discord's internal systems:
- Hooks into QuestsStore for quest data monitoring  
- Patches RunningGameStore for desktop gameplay spoofing  
- Patches ApplicationStreamingStore for stream activity simulation  
- Uses Discord's REST API for progress updates  
- Respects rate limits and quest timing requirements  

---

## Limitations
- Browser mode only supports video quests  
- Desktop gameplay and stream quests require Discord desktop application  
- Stream quests require at least one other participant in voice channel  
- Some quests may have specific requirements or restrictions  
- Progress tracking depends on Discord's internal APIs  

---

## Support

For issues, questions, or contributions:
- Open an issue on GitHub: [QuestMaster Issues](https://github.com/winters27/QuestMaster)  
- Check existing issues for solutions  
- Provide console logs when reporting bugs  

---

## Author
- **winters27** (681989594341834765)

## License
- GPL-3.0-or-later

---

## Quick Reference

**Install (automated):**
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
# Disable plugin in Discord first
rm -rf src/userplugins/questMaster
pnpm build --dev
```
