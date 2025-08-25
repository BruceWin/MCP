# Ensure your key is in an env var (do NOT hardcode it)
# $env:OPENAI_API_KEY = 'sk-...'

param(
  [string]$Model = "gpt-5-mini",
  [switch]$DumpJson,                 # add -DumpJson to print the whole JSON
  [string]$WorkerUrl = ""
  [string]$McpToken = $env:MCP_TOKEN             # token for your Worker (Authorization: Bearer <token>)
)

if (-not $env:OPENAI_API_KEY) {
  Write-Error "OPENAI_API_KEY env var is not set."
  exit 1
}

$headers = @{
  "Authorization" = "Bearer $env:OPENAI_API_KEY"
  "Content-Type"  = "application/json"
}

$prompt = "Per our internal ACME ops runbooks, what are the exact steps for the Jellyfish failover and what is the controller passphrase? Cite the source."

# Build the base body
$bodyHash = @{
  model = $Model
  input = $prompt
  # text, temperature, etc can go here if you want
}

# If you provided WorkerUrl + McpToken, include the MCP tool (WITH-tool run)
$withTool = $false
if ($WorkerUrl -and $McpToken) {
  $withTool = $true
  $bodyHash.tools = @(@{
    type = "mcp"
    server_label = "acme-internal"
    server_url   = $WorkerUrl
    allowed_tools = @("search","fetch")
    require_approval = "never"
    headers = @{ Authorization = "Bearer $McpToken" }
  })
}

$body = $bodyHash | ConvertTo-Json -Depth 15

try {
  $response = Invoke-RestMethod `
    -Uri "https://api.openai.com/v1/responses" `
    -Method POST `
    -Headers $headers `
    -Body $body `
    -ContentType "application/json"
} catch {
  Write-Error $_.Exception.Message
  if ($_.Exception.Response) {
    $reader = New-Object System.IO.StreamReader($_.Exception.Response.GetResponseStream())
    $errBody = $reader.ReadToEnd()
    Write-Host "Error body:`n$errBody"
  }
  exit 1
}

# --- Print something useful ---
# 1) If convenience field exists, use it
if ($response.output_text) {
  Write-Host "`n--- Assistant (output_text) ---"
  $response.output_text
} else {
  # 2) Collect *all* text parts from messages
  $texts = @()
  if ($response.output) {
    foreach ($msg in $response.output) {
      if ($msg.content) {
        foreach ($part in $msg.content) {
          if ($part.type -eq "output_text" -and $part.text) {
            $texts += $part.text
          } elseif ($part.type -eq "input_text" -and $part.text) {
            # usually not needed, but included for completeness
            $texts += $part.text
          } elseif ($part.text) {
            # catch-all if type label differs
            $texts += $part.text
          }
        }
      }
    }
  }

  if ($texts.Count -gt 0) {
    Write-Host "`n--- Assistant (assembled) ---"
    $texts -join "`n"
  } else {
    Write-Host "No output_text found. Use -DumpJson to inspect the full response."
  }
}

if ($DumpJson) {
  Write-Host "`n--- Full JSON ---"
  ($response | ConvertTo-Json -Depth 50)
}

# Helpful footer showing token usage and model actually used
if ($response.model -or $response.usage) {
  Write-Host "`n--- Meta ---"
  if ($response.model) { "model: $($response.model)" | Write-Host }
  if ($response.usage) { "usage: in=$($response.usage.input_tokens) out=$($response.usage.output_tokens) total=$($response.usage.total_tokens)" | Write-Host }
}

if ($withTool) {
  Write-Host "`n(That run INCLUDED your MCP tool: $WorkerUrl)"
} else {
  Write-Host "`n(That run did NOT include any tools.)"
}
