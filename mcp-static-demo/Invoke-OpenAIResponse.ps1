# Ensure your key is in an env var (do NOT hardcode it)
# $env:OPENAI_API_KEY = 'sk-...'

$headers = @{
  "Authorization" = "Bearer $env:OPENAI_API_KEY"
  "Content-Type"  = "application/json"
}

$body = @{
  model = "gpt-5-mini"              # or pin the snapshot: "gpt-5-mini-2025-08-07"
  input = "Per our internal ACME ops runbooks, what are the exact steps for the Jellyfish failover and what is the controller passphrase? Cite the source."
} | ConvertTo-Json -Depth 5

$response = Invoke-RestMethod `
  -Uri "https://api.openai.com/v1/responses" `
  -Method POST `
  -Headers $headers `
  -Body $body `
  -ContentType "application/json"

# Prefer the convenience field if present
if ($response.output_text) {
  $response.output_text
} else {
  # Fallback: expand the message content array
  $response.output[0].content `
  | Where-Object { $_.type -eq "output_text" } `
  | ForEach-Object { $_.text }
}
