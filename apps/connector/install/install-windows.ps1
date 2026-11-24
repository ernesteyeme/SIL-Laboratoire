<#
.SYNOPSIS
  Installe le connecteur d'automate du LIMS sur un poste Windows (démarrage automatique, relance en cas d'arrêt).

.DESCRIPTION
  À lancer dans PowerShell « Exécuter en tant qu'administrateur », depuis le dossier du connecteur :

    powershell -ExecutionPolicy Bypass -File install\install-windows.ps1 -Config C:\Users\labo\Downloads\config.json
    powershell -ExecutionPolicy Bypass -File install\install-windows.ps1 -Uninstall -Name xn1000

  -Config  fichier config.json émis par le LIMS (Automates → l'automate → Émettre la clé)
  -Name    nom court (lettres minuscules, chiffres, tirets) ; défaut : code de l'automate lu dans la clé
  -Ca      certificat de l'autorité locale du serveur (adresse http ou fichier) ; défaut : http://<serveur>/lims-ca.crt s'il est publié

  Résultat : C:\ProgramData\LIMS\connecteur-<nom>\ (programme, config.json réservé aux administrateurs, données),
  tâche planifiée « LIMS connecteur <nom> » lancée au démarrage de Windows sous le compte SYSTEM,
  règle du pare-feu Windows pour le port d'écoute (mode tcp-server).
#>
param(
  [string]$Config,
  [string]$Name,
  [string]$Ca,
  [switch]$Uninstall
)
$ErrorActionPreference = 'Stop'
function Ok($m) { Write-Host "OK  $m" -ForegroundColor Green }
function Info($m) { Write-Host "    $m" }
function Fail($m) { Write-Host "ERREUR  $m" -ForegroundColor Red; exit 1 }

$principal = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  Fail "Ouvrez PowerShell avec « Exécuter en tant qu'administrateur », puis relancez la commande."
}

$Root = Join-Path $env:ProgramData 'LIMS'

if ($Uninstall) {
  if (-not $Name) { Fail 'Indiquez le connecteur à retirer : -Name <nom>' }
  $dest = Join-Path $Root "connecteur-$Name"
  $task = "LIMS connecteur $Name"
  if (Get-ScheduledTask -TaskName $task -ErrorAction SilentlyContinue) {
    Stop-ScheduledTask -TaskName $task -ErrorAction SilentlyContinue
    Unregister-ScheduledTask -TaskName $task -Confirm:$false
  }
  Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" | Where-Object { $_.CommandLine -like "*$dest*" } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }
  Get-NetFirewallRule -DisplayName "LIMS connecteur $Name" -ErrorAction SilentlyContinue | Remove-NetFirewallRule
  Ok "Connecteur $Name retiré. Données conservées dans $dest (file d'attente, journaux)."
  exit 0
}

if (-not $Config -or -not (Test-Path $Config)) { Fail 'Fichier de configuration introuvable : -Config C:\chemin\config.json' }
$node = (Get-Command node.exe -ErrorAction SilentlyContinue).Source
if (-not $node) { Fail 'Node.js 20 ou plus est requis : installez la version LTS depuis https://nodejs.org, puis relancez.' }
$major = [int]((& $node -p "process.versions.node.split('.')[0]").Trim())
if ($major -lt 20) { Fail "Node.js 20 ou plus est requis (trouvé : $(& $node -v))." }

$cfg = Get-Content -Raw -Encoding UTF8 $Config | ConvertFrom-Json
foreach ($k in 'apiUrl', 'instrumentKey', 'mode', 'protocol') {
  if (-not $cfg.$k) { Fail "Paramètre manquant dans config.json : $k" }
}
if (-not $Name) {
  if ($cfg.instrumentKey -match '^sil_([a-z0-9-]+)_') { $Name = $Matches[1].ToLower() } else { $Name = 'automate' }
}
if ($Name -notmatch '^[a-z0-9][a-z0-9-]{0,30}$') { Fail "Nom invalide : $Name (minuscules, chiffres, tirets)." }

$src = Split-Path -Parent $PSScriptRoot
$dest = Join-Path $Root "connecteur-$Name"
$task = "LIMS connecteur $Name"
New-Item -ItemType Directory -Force -Path $dest, (Join-Path $dest 'donnees') | Out-Null

# Arrêt d'une version précédente avant de remplacer le programme.
if (Get-ScheduledTask -TaskName $task -ErrorAction SilentlyContinue) { Stop-ScheduledTask -TaskName $task -ErrorAction SilentlyContinue }
Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" | Where-Object { $_.CommandLine -like "*$dest*" } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }

if (Test-Path (Join-Path $dest 'src')) { Remove-Item -Recurse -Force (Join-Path $dest 'src') }
Copy-Item -Recurse (Join-Path $src 'src') (Join-Path $dest 'src')
Copy-Item (Join-Path $src 'package.json') $dest -Force
if (Test-Path (Join-Path $src 'README.md')) { Copy-Item (Join-Path $src 'README.md') $dest -Force }

$cfg.dataDir = 'donnees'
$cfgPath = Join-Path $dest 'config.json'
$json = $cfg | ConvertTo-Json -Depth 10
[IO.File]::WriteAllText($cfgPath, $json, (New-Object Text.UTF8Encoding($false)))
# La clé du connecteur est un secret : accès réservé à SYSTEM et aux administrateurs.
& icacls $cfgPath /inheritance:r /grant:r '*S-1-5-18:F' '*S-1-5-32-544:F' | Out-Null

# Certificat de l'autorité locale du laboratoire.
$caFile = $null
$apiUri = [Uri]$cfg.apiUrl
if (-not $Ca -and $apiUri.Scheme -eq 'https') {
  try {
    Invoke-WebRequest -UseBasicParsing -TimeoutSec 10 -Uri "http://$($apiUri.Host)/lims-ca.crt" -Method Head | Out-Null
    $Ca = "http://$($apiUri.Host)/lims-ca.crt"
  } catch { }
}
if ($Ca) {
  $caFile = Join-Path $dest 'lims-ca.crt'
  if ($Ca -match '^https?://') { Invoke-WebRequest -UseBasicParsing -TimeoutSec 20 -Uri $Ca -OutFile $caFile } else { Copy-Item $Ca $caFile -Force }
  try { $cert = New-Object Security.Cryptography.X509Certificates.X509Certificate2($caFile) } catch { Fail "$Ca n'est pas un certificat." }
  $sha = [BitConverter]::ToString((New-Object Security.Cryptography.SHA256Managed).ComputeHash($cert.RawData)).Replace('-', ':')
  Info "Autorité locale : $($cert.Subject)"
  Info "Empreinte SHA-256 : $sha"
  Info '  -> comparez-la à celle affichée sur le serveur par : sudo lims certificate show'
}

# Lanceur : relance le connecteur 5 s après tout arrêt (coupure, mise à jour de Node.js…).
$runner = Join-Path $dest 'lancer.cmd'
$lines = @('@echo off', 'cd /d "%~dp0"')
if ($caFile) { $lines += "set NODE_EXTRA_CA_CERTS=$caFile" }
$lines += ':boucle'
$lines += "`"$node`" `"$dest\src\index.mjs`" `"$cfgPath`" >> `"$dest\donnees\service.log`" 2>&1"
$lines += 'timeout /t 5 /nobreak > nul'
$lines += 'goto boucle'
[IO.File]::WriteAllLines($runner, $lines, (New-Object Text.ASCIIEncoding))

$action = New-ScheduledTaskAction -Execute 'cmd.exe' -Argument "/c `"$runner`""
$trigger = New-ScheduledTaskTrigger -AtStartup
$principalTask = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable `
  -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) -MultipleInstances IgnoreNew
Register-ScheduledTask -TaskName $task -Action $action -Trigger $trigger -Principal $principalTask -Settings $settings `
  -Description "Transmet au LIMS les résultats de l'automate $Name." -Force | Out-Null

if ($cfg.mode -eq 'tcp-server' -and $cfg.port) {
  Get-NetFirewallRule -DisplayName $task -ErrorAction SilentlyContinue | Remove-NetFirewallRule
  New-NetFirewallRule -DisplayName $task -Direction Inbound -Protocol TCP -LocalPort ([int]$cfg.port) -Action Allow | Out-Null
  Info "Pare-feu Windows : port TCP $($cfg.port) ouvert pour l'automate."
}
if ($cfg.mode -eq 'folder') {
  $watch = if ([IO.Path]::IsPathRooted($cfg.folder)) { $cfg.folder } else { Join-Path $dest ($(if ($cfg.folder) { $cfg.folder } else { 'depot' })) }
  New-Item -ItemType Directory -Force -Path $watch | Out-Null
  Info "Dossier surveillé : $watch (l'automate ou son logiciel doit y déposer ses fichiers)"
}

Start-ScheduledTask -TaskName $task
Start-Sleep -Seconds 6
$log = Get-ChildItem (Join-Path $dest 'donnees') -Filter 'connecteur-*.log' -ErrorAction SilentlyContinue | Sort-Object LastWriteTime | Select-Object -Last 1
if ($log) { Get-Content $log.FullName -Tail 5 | ForEach-Object { Info $_ } }
if (Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" | Where-Object { $_.CommandLine -like "*$dest*" }) {
  Ok "Connecteur $Name démarré ; il redémarre avec Windows et se relance seul en cas d'arrêt."
} else {
  Fail "Le connecteur ne tourne pas : voir $dest\donnees\service.log"
}
Info "Journaux : $dest\donnees (journal du jour, file d'attente, archives)"
