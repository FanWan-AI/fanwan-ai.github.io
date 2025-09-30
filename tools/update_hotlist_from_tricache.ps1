# Backup original hotlist and run Node updater
Copy-Item -Path "data\ai\modelswatch\projects_hotlist.json" -Destination "data\ai\modelswatch\projects_hotlist.json.bak" -Force

Write-Host "Backup created: data/ai/modelswatch/projects_hotlist.json.bak"

# Check for node
$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) {
  Write-Error "Node.js not found in PATH. Install Node.js or add it to PATH and retry."
  exit 1
}

Write-Host "Invoking Node script: tools/update_hotlist_from_tricache.mjs"
node "tools/update_hotlist_from_tricache.mjs"
Write-Host "Node script finished. See data/ai/modelswatch/projects_hotlist.updated.json for details."
