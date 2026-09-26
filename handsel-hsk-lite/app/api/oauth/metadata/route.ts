import { requestOrigin } from '@/lib/oauth'

/**
 * OAuth 2.0 Authorization Server Metadata (RFC 8414), served at
 * /.well-known/oauth-authorization-server via a next.config rewrite.
 * Claude/ChatGPT MCP connectors read this to drive the whole flow:
 * dynamic registration → authorize (PKCE) → token.
 */
export async function GET(request: Request) {
  const origin = requestOrigin(request)
  return Response.json({
    issuer: origin,
    authorization_endpoint: `${origin}/oauth/authorize`,
    token_endpoint: `${origin}/api/oauth/token`,
    registration_endpoint: `${origin}/api/oauth/register`,
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code'],
    code_challenge_methods_supported: ['S256'],
    token_endpoint_auth_methods_supported: ['none'],
    scopes_supported: ['mcp'],
  })
}
