<#
.SYNOPSIS
    Deploys the latest TeamSync updates to the VM.
.DESCRIPTION
    This script is designed to be executed manually on the virtual machine.
    
    IMPORTANT SAFETY WARNING:
    - This script must be run MANUALLY by the user on the VM.
    - It is never triggered automatically.
    - The Antigravity coding agent should NEVER invoke this script directly under any circumstances.
#>

$ErrorActionPreference = "Stop"

try {
    Write-Host "[Deploy] Navigating to repository root..." -ForegroundColor Cyan
    Set-Location -Path "C:\var\www\teamsync"

    Write-Host "[Deploy] 1. Pulling latest master branch..." -ForegroundColor Cyan
    git fetch origin
    git checkout master
    git pull origin master

    Write-Host "[Deploy] 2. Building frontend assets..." -ForegroundColor Cyan
    Set-Location -Path "C:\var\www\teamsync\frontend"
    npm install
    npm run build

    Write-Host "[Deploy] 3. Restarting backend service..." -ForegroundColor Cyan
    Restart-Service -Name "TeamSyncBackend"

    Write-Host "[Deploy] 4. Reloading Caddy configuration..." -ForegroundColor Cyan
    Set-Location -Path "C:\var\www\teamsync"
    .\caddy.exe reload --config C:\var\www\teamsync\Caddyfile

    Write-Host "`n[Deploy] 5. Deployment completed successfully!" -ForegroundColor Green
    Write-Host "------------------------------------------------" -ForegroundColor Gray
    $commit = git rev-parse HEAD
    $branch = git branch --show-current
    Write-Host "Live Commit Hash: $commit" -ForegroundColor Yellow
    Write-Host "Live Git Branch:  $branch" -ForegroundColor Yellow
    Write-Host "------------------------------------------------" -ForegroundColor Gray
    Write-Host "Backend Service Status:" -ForegroundColor Yellow
    Get-Service -Name "TeamSyncBackend"
    Write-Host "------------------------------------------------" -ForegroundColor Gray
}
catch {
    Write-Error "Deployment failed on step: $_"
    exit 1
}
