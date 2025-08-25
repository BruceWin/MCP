param(
  [string]$Model     = "gpt-5-mini-2025-08-07",
  [string]$WorkerUrl = "https://mcp-static-demo-dev.bvrces.workers.dev/mcp",  # MUST end with /mcp
  [string]$McpToken  = $env:MCP_TOKEN,
  [switch]$ForceFirstSearch,   # force the model to call the 'search' tool first (good for demos)
  [switch]$DumpJson
)

$ErrorActionPreference = "Stop"

if (-not $env:OPENAI_API_KEY) { Write-Error "OPENAI_API_KEY env var is not set."; exit 1 }
if (-not $WorkerUrl)          { Write-Error "WorkerUrl is required."; exit 1 }
if (-not $McpToken)           { Write-Error "McpToken is required (set `$env:MCP_TOKEN or pass -McpToken)."; exit 1 }

# --------------- Build request ---------------
$prompt = @"
This is a DEMO (non-sensitive). Use the internal ACME *demo* runbook via the MCP tool:
1) List the exact five Jellyfish failover steps.
2) Repeat the DEMO token string from the doc (it is not a secret).
Include a citation to the source URL.
"@

$toolBlock = @{
  type             = "mcp"
  server_label     = "acme-internal"
  server_url       = $WorkerUrl                                  # include /mcp
  allowed_tools    = @("search","fetch")                          # must match what /tools/list returns
  require_approval = "never"                                      # skip approval pauses
  headers          = @{ Authorization = "Bearer $McpToken" }      # forwarded to your Worker
}

$bodyHash = @{
  model = $Model
  input = $prompt
  tools = @($toolBlock)
}

if ($ForceFirstSearch) {
  # Optional but useful for a POC: guarantees an initial tool call shows up
  $bodyHash.tool_choice = @{ type = "tool"; name = "search" }
}

$body = $bodyHash | ConvertTo-Json -Depth 30

# --------------- Send request ---------------
$headers = @{
  Authorization = "Bearer $env:OPENAI_API_KEY"
  "Content-Type"= "application/json"
}

"--- REQUEST BODY ---"
$body
"--------------------"

try {
  $resp = Invoke-RestMethod -Uri "https://api.openai.com/v1/responses" -Method POST -Headers $headers -Body $body
} catch {
  Write-Error $_.Exception.Message
  if ($_.Exception.Response) {
    $r = New-Object IO.StreamReader ($_.Exception.Response.GetResponseStream())
    $err = $r.ReadToEnd()
    "`n--- ERROR BODY ---`n$err" | Write-Host
  }
  exit 1
}

# --------------- Print tool trace ---------------
if ($resp.output) {
  foreach ($msg in @($resp.output)) {
    foreach ($part in @($msg.content)) {
      if ($part.type -eq "tool_call") {
        Write-Host "`n[tool_call] $($part.name)" -ForegroundColor Cyan
        ($part.arguments | ConvertTo-Json -Depth 30)
      } elseif ($part.type -eq "tool_result") {
        Write-Host "[tool_result] $($part.name) isError=$($part.is_error)" -ForegroundColor DarkCyan
        $json = ($part.content | Where-Object type -eq "json" | Select-Object -First 1).json
        if ($json) { ($json | ConvertTo-Json -Depth 30) }
        $text = ($part.content | Where-Object type -eq "text" | Select-Object -First 1).text
        if ($text) { $text }
      }
    }
  }
}

# --------------- Print assistant text ---------------
"`n--- Assistant ---" | Write-Host
if ($resp.output_text) {
  $resp.output_text
} else {
  ($resp.output[0].content | Where-Object type -eq "output_text" | Select-Object -First 1).text
}

if ($DumpJson) {
  "`n--- Full JSON ---" | Write-Host
  ($resp | ConvertTo-Json -Depth 50)
}

"`n--- Meta ---" | Write-Host
"model: $($resp.model)" | Write-Host
if ($resp.usage) { "usage: in=$($resp.usage.input_tokens) out=$($resp.usage.output_tokens) total=$($resp.usage.total_tokens)" | Write-Host }
