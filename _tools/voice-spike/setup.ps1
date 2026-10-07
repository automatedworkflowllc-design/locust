$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$root = $PSScriptRoot
$cache = Join-Path $root '.cache'
New-Item -ItemType Directory -Force -Path "$cache/tmp" | Out-Null
$env:TEMP = "$cache/tmp"
$env:TMP = "$cache/tmp"
if (Test-Path -LiteralPath "$cache/sapi.exe") { Remove-Item -LiteralPath "$cache/sapi.exe" }
Add-Type -Path "$root/Sapi.cs" -ReferencedAssemblies System.Speech -OutputAssembly "$cache/sapi.exe" -OutputType ConsoleApplication
& "$cache/sapi.exe" generate "$cache/source.wav"
if ($LASTEXITCODE -ne 0) { throw 'Speech synthesis failed' }
function Get-VerifiedFile($url, $destination, $hash) {
    if (-not (Test-Path -LiteralPath $destination)) { Invoke-WebRequest -Uri $url -OutFile $destination -UseBasicParsing }
    if ((Get-FileHash -LiteralPath $destination).Hash.ToLowerInvariant() -ne $hash) { throw "SHA-256 mismatch: $destination" }
}
Get-VerifiedFile 'https://github.com/ggml-org/whisper.cpp/releases/download/b5454/whisper-bin-x64.zip' "$cache/whisper.zip" '6ba69e3482d7826214f90a6a9c84ca07782aec1e1d0c6a7c30c994fd5d816ccb'
Get-VerifiedFile 'https://huggingface.co/ggerganov/whisper.cpp/resolve/5359861c739e955e79d9a303bcbc70fb988958b1/ggml-tiny.en-q5_1.bin' "$cache/ggml-tiny.en-q5_1.bin" 'c77c5766f1cef09b6b7d47f21b546cbddd4157886b3b5d6d4f709e91e66c7c2b'
if (-not (Test-Path -LiteralPath "$cache/whisper")) { Expand-Archive -LiteralPath "$cache/whisper.zip" -DestinationPath "$cache/whisper" }
New-Item -ItemType Directory -Force -Path "$cache/native" | Out-Null
foreach ($name in @('whisper-cli.exe','whisper.dll','ggml.dll','ggml-base.dll','ggml-cpu-x64.dll','ggml-cpu-haswell.dll')) {
    Copy-Item -LiteralPath "$cache/whisper/Release/$name" -Destination "$cache/native/$name" -Force
}
