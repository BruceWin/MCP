# # tools/list
$body = '{ "jsonrpc":"2.0","id":1,"method":"tools/list","params":{} }'

Invoke-RestMethod `
  -Uri "http://127.0.0.1:8787/mcp" `
  -Method POST `
  -Headers @{ Authorization = "Bearer $env:MCP_TOKEN"; "Content-Type"="application/json" } `
  -Body $body

# tools/call (search)
# Invoke-RestMethod `
#   -Uri "http://127.0.0.1:8787" `
#   -Method POST `
#   -Headers @{ Authorization="Bearer $env:MCP_TOKEN"; "Content-Type"="application/json"; "Accept"="application/json" } `
#   -Body '{ "jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"search","arguments":{"query":"jellyfish","top_k":3}} }'
