# $env:OPENAI_API_KEY = 'sk-...'
# $env:MCP_TOKEN      = '<same secret set via wrangler secret put --env dev>'

$headers = @{ Authorization = "Bearer $env:OPENAI_API_KEY"; "Content-Type"="application/json" }
$body = @{
  model = "gpt-5-mini"
  input = "DEMO only. Use the MCP tool to extract the five Jellyfish failover steps and the DEMO token string; include a citation."
  tools = @(@{
    type = "mcp"
    server_label = "acme-internal"
    server_url   = ""
    allowed_tools = @("search","fetch")
    require_approval = "never"
    headers = @{ Authorization = "Bearer " + $env:MCP_TOKEN }
  })
  tool_choice = "auto"
} | ConvertTo-Json -Depth 30

$response = Invoke-RestMethod -Uri "https://api.openai.com/v1/responses" -Method POST -Headers $headers -Body $body

# --- Robust printer for MCP runs (dump events + assistant text) ---

$hadToolEvents = $false

# If you want to sanity-check structure:
($response | ConvertTo-Json -Depth 60) | Out-File -Encoding utf8 .\last-response.json

$items = @($response.output)
if (-not $items -or $items.Count -eq 0) {
  Write-Host "(No $response.output array found; dumping full JSON...)" -ForegroundColor Yellow
  ($response | ConvertTo-Json -Depth 60) | Write-Host
  return
}

# Show what item types we got (helps when shapes change)
Write-Host "--- Items ---"
foreach ($i in $items) { Write-Host ("  type={0} id={1}" -f $i.type, $i.id) }
Write-Host "-------------`n"

foreach ($item in $items) {
  $type = [string]$item.type

  if ($type -eq "mcp_list_tools") {
    $hadToolEvents = $true
    Write-Host ("[mcp_list_tools] {0}" -f $item.server_label) -ForegroundColor Cyan
    foreach ($t in @($item.tools)) {
      Write-Host ("  - {0}: {1}" -f $t.name, $t.description)
      # If the server still returns snake_case, you can see it here:
      if ($t.input_schema) { Write-Host "    (note: server sent input_schema; should be inputSchema)" -ForegroundColor Yellow }
    }
    Write-Host ""
    continue
  }

  if ($type -eq "mcp_call") {
    $hadToolEvents = $true
    Write-Host ("[mcp_call] name={0} label={1}" -f $item.name, $item.server_label) -ForegroundColor DarkCyan
    if ($item.arguments) { Write-Host ("args: {0}" -f $item.arguments) }

    if ($item.error) {
      Write-Host ("ERROR: {0} {1} {2}" -f $item.error.type, $item.error.code, $item.error.message)
    } elseif ($item.output) {
      # Tool success: print json/text content parts
      $parts = @($item.output.content)
      $json  = ($parts | Where-Object { $_.type -eq "json" } | Select-Object -First 1).json
      $text  = ($parts | Where-Object { $_.type -eq "text" } | Select-Object -First 1).text
      if ($json) { $json | ConvertTo-Json -Depth 40 | Write-Host }
      elseif ($text) { Write-Host $text }
      else { Write-Host "(no content parts)" }
    } else {
      Write-Host "(no output and no error)"
    }
    Write-Host ""
    continue
  }

  if ($type -eq "message") {
    $ot = ($item.content | Where-Object { $_.type -eq "output_text" } | Select-Object -First 1).text
    if ($ot) {
      Write-Host "--- Assistant ---" -ForegroundColor Green
      Write-Host $ot
      Write-Host ""
    }
    continue
  }
}

if (-not $hadToolEvents) {
  Write-Host "(No MCP tool events were emitted.)" -ForegroundColor Yellow
}
