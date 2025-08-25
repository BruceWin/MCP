# Ensure your key is in an env var (do NOT hardcode it)
# $env:OPENAI_API_KEY = 'sk-...'

$headers = @{
  "Authorization" = "Bearer $env:OPENAI_API_KEY"
  "Content-Type"  = "application/json"
}

$body = @{
  model = "gpt-4.1"
  input = "Per our internal ACME ops runbooks, what are the exact steps for the Jellyfish failover and what is the controller passphrase? Cite the source."
} | ConvertTo-Json

$response = Invoke-RestMethod `
  -Uri "https://api.openai.com/v1/responses" `
  -Method POST `
  -Headers $headers `
  -Body $body `
  -ContentType "application/json"

$response
