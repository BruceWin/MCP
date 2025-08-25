$ErrorActionPreference = "Stop"

$uri = ""
$headers = @{
  Authorization = "Bearer $env:MCP_TOKEN"
  "Content-Type" = "application/json"
  Accept = "application/json"
}
$body = '{ "jsonrpc":"2.0","id":1,"method":"tools/list","params":{} }'

# 1) Get raw HTTP response
$raw = Invoke-WebRequest -Uri $uri -Method POST -Headers $headers -Body $body -ContentType "application/json"

"`n--- STATUS LINE ---"
$raw.StatusCode
"`n--- RAW HEADERS ---"
$raw.Headers | Out-String
"`n--- RAW CONTENT (string) ---"
$raw.Content

# 2) Parse JSON safely
try {
  $obj = $raw.Content | ConvertFrom-Json -ErrorAction Stop
  "`n--- PARSED JSON (pretty) ---"
  ($obj | ConvertTo-Json -Depth 40)
} catch {
  Write-Warning "Response wasn't valid JSON. Full raw content shown above."
}

# 3) If tools exist, show them
if ($obj.result -and $obj.result.tools) {
  "`n--- TOOLS ---"
  $obj.result.tools | Select-Object name, description | Format-Table -AutoSize
} else {
  Write-Warning "No result.tools found in parsed JSON."
}



# # tools/call (search)
# $res = Invoke-RestMethod `
#   -Uri "https://mcp-static-demo.bvrces.workers.dev/mcp" `
#   -Method POST `
#   -Headers @{ Authorization="Bearer $env:MCP_TOKEN"; "Content-Type"="application/json" } `
#   -Body '{ "jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"search","arguments":{"query":"jellyfish","top_k":3}} }'

# # Defensive expansion of tool result content
# $parts = @($res.result.content)

# if (-not $parts -or $parts.Count -eq 0) {
#   throw "Tool returned no content parts."
# }

# # $res is the Invoke-RestMethod result from /mcp
# $parts = @($res.result.content)
# if (-not $parts -or $parts.Count -eq 0) {
#   ($res | ConvertTo-Json -Depth 60) | Out-File -Encoding utf8 mcp-last-response.json
#   throw "Tool returned no content parts. Wrote mcp-last-response.json"
# }

# # Prefer a JSON content part
# $jsonPayload = ($parts | Where-Object { $_.type -eq "json" -and $_.json } | Select-Object -First 1).json
# if (-not $jsonPayload) {
#   # Fallback to a text part that contains JSON
#   $textPart = ($parts | Where-Object { $_.type -eq "text" -and $_.text } | Select-Object -First 1)
#   if ($textPart) {
#     try { $jsonPayload = $textPart.text | ConvertFrom-Json -ErrorAction Stop }
#     catch {
#       ($res | ConvertTo-Json -Depth 60) | Out-File -Encoding utf8 mcp-last-response.json
#       throw "Text part wasn’t JSON. Wrote mcp-last-response.json"
#     }
#   }
# }

# if (-not $jsonPayload) {
#   ($res | ConvertTo-Json -Depth 60) | Out-File -Encoding utf8 mcp-last-response.json
#   throw "No json/text payload found. Wrote mcp-last-response.json"
# }

# # Use it
# $jsonPayload.results | Format-Table id, title, url -AutoSize
