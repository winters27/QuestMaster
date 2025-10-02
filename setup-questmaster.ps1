# QuestMaster Setup Script - Full Installation
# Handles everything from scratch: Node.js, pnpm, Vencord, and QuestMaster

param(
    [string]$VencordPath = "",
    [switch]$SkipNodeCheck,
    [switch]$FreshInstall
)

$ErrorActionPreference = "Stop"
$QUESTMASTER_REPO = "https://github.com/winters27/QuestMaster.git"

Write-Host "=== QuestMaster Full Setup Script ===" -ForegroundColor Cyan
Write-Host ""

# Function to test if path is valid Vencord installation
function Test-VencordPath {
    param([string]$Path)
    
    if (-not (Test-Path $Path)) {
        return $false
    }
    
    $packageJson = Join-Path $Path "package.json"
    if (-not (Test-Path $packageJson)) {
        return $false
    }
    
    try {
        $content = Get-Content $packageJson -Raw | ConvertFrom-Json
        return $content.name -eq "vencord"
    } catch {
        return $false
    }
}

# Check Node.js
Write-Host "Checking Node.js installation..." -ForegroundColor Yellow
$nodeVersion = $null
try {
    $nodeVersion = & node --version 2>$null
} catch {}

if (-not $nodeVersion) {
    Write-Host "ERROR: Node.js is not installed" -ForegroundColor Red
    Write-Host ""
    Write-Host "Please install Node.js v18 or higher from:" -ForegroundColor Yellow
    Write-Host "https://nodejs.org/" -ForegroundColor Cyan
    Write-Host ""
    Write-Host "After installing Node.js, run this script again." -ForegroundColor Yellow
    exit 1
}

# Parse version
$nodeVersionNumber = [int]($nodeVersion -replace 'v(\d+)\..*', '$1')
if ($nodeVersionNumber -lt 18) {
    Write-Host "ERROR: Node.js version $nodeVersion is too old" -ForegroundColor Red
    Write-Host "Please upgrade to Node.js v18 or higher from:" -ForegroundColor Yellow
    Write-Host "https://nodejs.org/" -ForegroundColor Cyan
    exit 1
}

Write-Host "Node.js $nodeVersion detected" -ForegroundColor Green

# Check for git
Write-Host ""
Write-Host "Checking for git..." -ForegroundColor Yellow
$gitVersion = $null
try {
    $gitVersion = & git --version 2>$null
} catch {}

if (-not $gitVersion) {
    Write-Host "ERROR: Git is required but not installed" -ForegroundColor Red
    Write-Host "Please install Git from:" -ForegroundColor Yellow
    Write-Host "https://git-scm.com/download/win" -ForegroundColor Cyan
    Write-Host ""
    Write-Host "After installing Git, run this script again." -ForegroundColor Yellow
    exit 1
}

Write-Host "Git detected: $gitVersion" -ForegroundColor Green

# Check/Install pnpm
Write-Host ""
Write-Host "Checking for pnpm..." -ForegroundColor Yellow
$pnpmVersion = $null
try {
    $pnpmVersion = & pnpm --version 2>$null
} catch {}

if (-not $pnpmVersion) {
    Write-Host "pnpm not found. Installing pnpm..." -ForegroundColor Yellow
    npm install -g pnpm
    
    if ($LASTEXITCODE -ne 0) {
        Write-Host "ERROR: Failed to install pnpm" -ForegroundColor Red
        exit 1
    }
    
    # Verify installation
    try {
        $pnpmVersion = & pnpm --version 2>$null
    } catch {}
    
    if (-not $pnpmVersion) {
        Write-Host "ERROR: pnpm installation failed" -ForegroundColor Red
        exit 1
    }
    
    Write-Host "pnpm $pnpmVersion installed successfully" -ForegroundColor Green
} else {
    Write-Host "pnpm $pnpmVersion is already installed" -ForegroundColor Green
}

# Determine Vencord installation path
Write-Host ""
Write-Host "=== Vencord Installation ===" -ForegroundColor Cyan
Write-Host ""

if ($FreshInstall -or $VencordPath -eq "") {
    Write-Host "Searching for existing Vencord installation..." -ForegroundColor Yellow
    
    # Common Vencord locations
    $commonPaths = @(
        "$env:USERPROFILE\Documents\Vencord",
        "$env:USERPROFILE\Desktop\Vencord",
        "$env:USERPROFILE\Vencord",
        "C:\Vencord"
    )
    
    $foundPath = $null
    foreach ($path in $commonPaths) {
        if (Test-VencordPath $path) {
            $foundPath = $path
            Write-Host "Found Vencord at: $foundPath" -ForegroundColor Green
            break
        }
    }
    
    if ($foundPath -and -not $FreshInstall) {
        Write-Host ""
        $useFound = Read-Host "Use this installation? (Y/n)"
        if ($useFound -eq "" -or $useFound -eq "Y" -or $useFound -eq "y") {
            $VencordPath = $foundPath
        }
    }
    
    # If no path found or user wants fresh install
    if ($VencordPath -eq "") {
        Write-Host ""
        Write-Host "No Vencord installation found." -ForegroundColor Yellow
        $installNew = Read-Host "Clone Vencord now? (Y/n)"
        
        if ($installNew -eq "" -or $installNew -eq "Y" -or $installNew -eq "y") {
            Write-Host ""
            Write-Host "Where should Vencord be installed?" -ForegroundColor Yellow
            Write-Host "Press Enter for default location: $env:USERPROFILE\Documents\Vencord" -ForegroundColor Gray
            $installLocation = Read-Host "Path"
            
            if ($installLocation -eq "") {
                $installLocation = "$env:USERPROFILE\Documents\Vencord"
            }
            
            # Create parent directory if needed
            $parentDir = Split-Path -Parent $installLocation
            if (-not (Test-Path $parentDir)) {
                New-Item -ItemType Directory -Path $parentDir -Force | Out-Null
            }
            
            # Clone Vencord
            Write-Host ""
            Write-Host "Cloning Vencord..." -ForegroundColor Yellow
            git clone https://github.com/Vendicated/Vencord.git $installLocation
            
            if ($LASTEXITCODE -ne 0) {
                Write-Host "ERROR: Failed to clone Vencord" -ForegroundColor Red
                exit 1
            }
            
            $VencordPath = $installLocation
            Write-Host "Vencord cloned successfully" -ForegroundColor Green
        } else {
            Write-Host ""
            Write-Host "Please enter the path to your Vencord installation:" -ForegroundColor Yellow
            $VencordPath = Read-Host "Path"
        }
    }
}

# Validate path
if (-not (Test-VencordPath $VencordPath)) {
    Write-Host "ERROR: Invalid Vencord installation at: $VencordPath" -ForegroundColor Red
    Write-Host "Please ensure the path contains a valid Vencord installation." -ForegroundColor Red
    exit 1
}

Write-Host ""
Write-Host "Using Vencord installation at: $VencordPath" -ForegroundColor Green

# Navigate to Vencord directory
Push-Location $VencordPath

# Check if dependencies need to be installed
$nodeModules = Join-Path $VencordPath "node_modules"
$needsDependencies = -not (Test-Path $nodeModules)

if ($needsDependencies) {
    Write-Host ""
    Write-Host "Installing Vencord dependencies (this may take a few minutes)..." -ForegroundColor Yellow
    pnpm install --frozen-lockfile
    
    if ($LASTEXITCODE -ne 0) {
        Write-Host "ERROR: Failed to install Vencord dependencies" -ForegroundColor Red
        Pop-Location
        exit 1
    }
    
    Write-Host "Dependencies installed successfully" -ForegroundColor Green
} else {
    Write-Host ""
    Write-Host "Vencord dependencies are already installed" -ForegroundColor Green
    
    $updateDeps = Read-Host "Update dependencies? (y/N)"
    if ($updateDeps -eq "y" -or $updateDeps -eq "Y") {
        Write-Host "Updating dependencies..." -ForegroundColor Yellow
        pnpm install --frozen-lockfile
        
        if ($LASTEXITCODE -ne 0) {
            Write-Host "WARNING: Failed to update dependencies" -ForegroundColor Yellow
        } else {
            Write-Host "Dependencies updated successfully" -ForegroundColor Green
        }
    }
}

Pop-Location

# Install QuestMaster plugin
Write-Host ""
Write-Host "=== Installing QuestMaster Plugin ===" -ForegroundColor Cyan
Write-Host ""

$userpluginsPath = Join-Path $VencordPath "src\userplugins"
$destPath = Join-Path $userpluginsPath "questMaster"

# Ensure userplugins directory exists
if (-not (Test-Path $userpluginsPath)) {
    New-Item -ItemType Directory -Path $userpluginsPath -Force | Out-Null
}

# Check if plugin already exists
if (Test-Path $destPath) {
    Write-Host "WARNING: QuestMaster already exists at this location" -ForegroundColor Yellow
    $overwrite = Read-Host "Overwrite with latest version from GitHub? (y/N)"
    if ($overwrite -ne "y" -and $overwrite -ne "Y") {
        Write-Host "Skipping plugin installation" -ForegroundColor Yellow
        $installPlugin = $false
    } else {
        Remove-Item $destPath -Recurse -Force
        $installPlugin = $true
    }
} else {
    $installPlugin = $true
}

if ($installPlugin) {
    # Clone QuestMaster from GitHub
    Write-Host "Cloning QuestMaster from GitHub..." -ForegroundColor Yellow
    $tempPath = Join-Path $env:TEMP "QuestMaster-temp"
    
    # Clean up any existing temp directory
    if (Test-Path $tempPath) {
        Remove-Item $tempPath -Recurse -Force
    }
    
    git clone $QUESTMASTER_REPO $tempPath
    
    if ($LASTEXITCODE -ne 0) {
        Write-Host "ERROR: Failed to clone QuestMaster repository" -ForegroundColor Red
        Write-Host "Please check your internet connection and try again" -ForegroundColor Yellow
        exit 1
    }
    
    # Copy the questMaster folder to userplugins
    $sourcePath = Join-Path $tempPath "questMaster"
    
    if (-not (Test-Path $sourcePath)) {
        Write-Host "ERROR: Plugin files not found in repository" -ForegroundColor Red
        Write-Host "Repository structure may have changed" -ForegroundColor Yellow
        Remove-Item $tempPath -Recurse -Force
        exit 1
    }
    
    Write-Host "Copying plugin files..." -ForegroundColor Yellow
    Copy-Item $sourcePath -Destination $destPath -Recurse
    
    # Clean up temp directory
    Remove-Item $tempPath -Recurse -Force
    
    if (-not (Test-Path $destPath)) {
        Write-Host "ERROR: Failed to copy plugin files" -ForegroundColor Red
        exit 1
    }
    
    Write-Host "Plugin files installed successfully" -ForegroundColor Green
}

# Build Vencord
Write-Host ""
Write-Host "Building Vencord with QuestMaster..." -ForegroundColor Yellow
Push-Location $VencordPath
pnpm build --dev

if ($LASTEXITCODE -ne 0) {
    Write-Host "ERROR: Build failed" -ForegroundColor Red
    Write-Host "Check the error messages above for details" -ForegroundColor Yellow
    Pop-Location
    exit 1
}

Write-Host "Build completed successfully" -ForegroundColor Green

# Inject Vencord
Write-Host ""
$inject = Read-Host "Inject Vencord into Discord now? (Y/n)"
if ($inject -eq "" -or $inject -eq "Y" -or $inject -eq "y") {
    Write-Host ""
    Write-Host "NOTE: Discord must be completely closed for injection to work" -ForegroundColor Yellow
    $continue = Read-Host "Press Enter when Discord is closed, or 'n' to skip injection"
    
    if ($continue -ne "n" -and $continue -ne "N") {
        Write-Host "Injecting Vencord..." -ForegroundColor Yellow
        pnpm uninject 2>$null  # Uninject first (ignore errors if not injected)
        Start-Sleep -Seconds 1
        pnpm inject
        
        if ($LASTEXITCODE -eq 0) {
            Write-Host "Vencord injected successfully" -ForegroundColor Green
        } else {
            Write-Host "WARNING: Injection may have failed" -ForegroundColor Yellow
            Write-Host "You may need to:" -ForegroundColor Yellow
            Write-Host "  1. Ensure Discord is completely closed" -ForegroundColor Yellow
            Write-Host "  2. Run PowerShell as Administrator" -ForegroundColor Yellow
            Write-Host "  3. Try running 'pnpm inject' manually from $VencordPath" -ForegroundColor Yellow
        }
    }
} else {
    Write-Host ""
    Write-Host "Skipping injection. To inject later, run:" -ForegroundColor Yellow
    Write-Host "  cd $VencordPath" -ForegroundColor Cyan
    Write-Host "  pnpm inject" -ForegroundColor Cyan
}

Pop-Location

# Final instructions
Write-Host ""
Write-Host "=== Setup Complete ===" -ForegroundColor Cyan
Write-Host ""
Write-Host "Installation Summary:" -ForegroundColor Yellow
Write-Host "  Vencord Path: $VencordPath"
Write-Host "  Plugin Path: $destPath"
Write-Host "  Repository: $QUESTMASTER_REPO"
Write-Host ""
Write-Host "Next steps:" -ForegroundColor Yellow
Write-Host "  1. Close Discord completely (including system tray)"
Write-Host "  2. Restart Discord"
Write-Host "  3. Go to Settings > Vencord > Plugins"
Write-Host "  4. Search for 'QuestMaster' and enable it"
Write-Host ""
Write-Host "Troubleshooting:" -ForegroundColor Yellow
Write-Host "  - If Discord doesn't start, run: pnpm uninject (from Vencord directory)"
Write-Host "  - To rebuild: pnpm build --dev (from Vencord directory)"
Write-Host "  - To re-inject: pnpm inject (from Vencord directory)"
Write-Host "  - To update QuestMaster: run this script again and choose to overwrite"
Write-Host ""
Write-Host "Press any key to exit..."
$null = $Host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown")