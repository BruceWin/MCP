<# 
.SYNOPSIS
  Test an MCP tool server (Cloudflare Worker) locally and via OpenAI Responses API.

.PARAMETER WorkerUrl
  The MCP server URL. Use http://127.0.0.1:8787 for local, or your workers.dev URL for remote.

.PARAMETER McpToken
  Bearer token your Worker expects (Authorization header). For local dev, match .dev.vars (e.g., dev-secret-123).

.PARAMETER OpenAIKey
  Your OpenAI API key. If omitted, script will try $env:OPENAI_API_KEY.

.PARAMETER Model
  OpenAI model for Responses API tests. Default: gpt-4.1

.PARAMETER SkipOpenAI
  If set, skip OpenAI A/B calls (local-only testing).

.EXAMPLES
  # Local-only testing (make sure `wrangler dev` is running and .dev.vars has MCP_TOKEN="dev-secret-123")
  .\Test-MCP.ps1 -WorkerUrl http://127.0.0.1:8787 -McpToken dev-secret-123 -SkipOpenAI

  # End-to-end with a public Worker URL
  $env:OPENAI_API_KEY = "sk-..."
  .\Test-MCP.ps1 -WorkerUrl https://mcp-static-demo.your.workers.dev -McpToken "<secret>"
#>

param(
  [string]$WorkerUrl = "http://127.0.0.1:8787",
  [string]$McpToken  = "dev-secret-123",
  [string]$OpenAIKey = $env:OPENAI_API_KEY,
  [string]$Model     = "gpt-4.1",
  [switch]$SkipOpenAI
)

# Ensure TLS 1.2+
try { [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12 } catch {}

function Write-Section($title) {
  Write-Host ""
  Write-Host "==== $title ====" -ForegroundColor Cyan
}

function Invoke-GetJson($url) {
  try {
    return Invoke-RestMethod -Uri $url -Method GET -Headers @{ "Accept" = "application/json" }
  } catch {
    Write-Warning $_.Exception.Message
    throw
  }
}

function Invoke-PostJson($url, $bodyObj, $headers = @{}) {
  $json = $bodyObj | ConvertTo-Json -Depth 12
  try {
    return Invoke-RestMethod -Uri $url -Method POST -Body $json -ContentType "application/json" -Headers $headers
  } catch {
    Write-Warning $_.Exception.Message
    if ($_.Exception.Response -and $_.Exception.Response.StatusCode) {
      Write-Warning ("StatusCode: {0}" -f $_.Exception.Response.StatusCode.value__)
    }
    throw
  }
}

# ---------- Local MCP tool tests ----------
Write-Section "MCP Tool - /tools/list"
$tools = Invoke-GetJson "$WorkerUrl/tools/list"
$tools | ConvertTo-Json -Depth 12 | Write-Output

Write-Section "MCP Tool - /tools/search (query='jellyfish')"
$auth = @{ Authorization = "Bearer $McpToken" }
$searchBody = @{ query = "jellyfish"; top_k = 3 }
$search = Invoke-PostJson "$WorkerUrl/tools/search" $searchBody $auth
$search | ConvertTo-Json -Depth 12 | Write-Output

# Try fetching the first hit, if any
if ($search.results -and $search.results.Count -gt 0) {
  $docId = $search.results[0].id
  Write-Section "MCP Tool - /tools/fetch (id='$docId')"
  $fetchBody = @{ id = $docId }
  $fetch = Invoke-PostJson "$WorkerUrl/tools/fetch" $fetchBody $auth
  $fetch | ConvertTo-Json -Depth 12 | Write-Output
} else {
  Write-Host "No search results to fetch." -ForegroundColor Yellow
}

# ---------- OpenAI Responses API A/B test ----------
if (-not $SkipOpenAI) {
  if (-not $OpenAIKey) {
    Write-Warning "OPENAI API key is missing. Set -OpenAIKey or `$env:OPENAI_API_KEY. Skipping OpenAI tests."
  } elseif (-not $WorkerUrl.StartsWith("https")) {
    Write-Warning "WorkerUrl is not HTTPS/public. The OpenAI runtime cannot reach localhost. Use 'wrangler dev --remote' or deploy. Skipping OpenAI tests."
  } else {
    $oaiHeaders = @{
      Authorization = "Bearer $OpenAIKey"
      "Content-Type" = "application/json"
    }
    $prompt = "Per our internal ACME runbooks, what are the exact steps for the Jellyfish failover and the controller passphrase? Cite the source."

    # A) WITH the tool
    Write-Section "OpenAI Responses API (WITH tool)"
    $withToolBody = @{
      model = $Model
      input = $prompt
      tools = @(@{
        type = "mcp"
        server_label = "acme-internal"
        server_url = $WorkerUrl
        allowed_tools = @("search","fetch")
        require_approval = "never"
        headers = @{ Authorization = "Bearer $McpToken" }
      })
    }
    $withResp = Invoke-PostJson "https://api.openai.com/v1/responses" $withToolBody $oaiHeaders

    if ($withResp.output_text) {
      Write-Host "`n--- WITH TOOL: output_text ---" -ForegroundColor Green
      $withResp.output_text | Write-Output
    } else {
      Write-Host "`n--- WITH TOOL: full JSON ---" -ForegroundColor Green
      $withResp | ConvertTo-Json -Depth 20 | Write-Output
    }

    # B) WITHOUT the tool
    Write-Section "OpenAI Responses API (WITHOUT tool)"
    $withoutToolBody = @{
      model = $Model
      input = $prompt
      # Optional: tool_choice = "none"
    }
    $withoutResp = Invoke-PostJson "https://api.openai.com/v1/responses" $withoutToolBody $oaiHeaders

    if ($withoutResp.output_text) {
      Write-Host "`n--- WITHOUT TOOL: output_text ---" -ForegroundColor Yellow
      $withoutResp.output_text | Write-Output
    } else {
      Write-Host "`n--- WITHOUT TOOL: full JSON ---" -ForegroundColor Yellow
      $withoutResp | ConvertTo-Json -Depth 20 | Write-Output
    }

    Write-Section "A/B Completed"
    Write-Host "You should see private details & a citation in the WITH TOOL answer (e.g., passphrase), and no such details WITHOUT the tool." -ForegroundColor Cyan
  }
}
