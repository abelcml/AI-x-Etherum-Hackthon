import { requestOrigin } from '@/lib/oauth'

/**
 * OAuth 2.0 Protected Resource Metadata (RFC 9728), served at
 * /.well-known/oauth-protected-resource (and its /api/mcp path variant)
 * via next.config rewrites. Points MCP clients at the authorization
 * server that protects /api/mcp.
 */
export async function GET(request: Request) {
  const origin = requestOrigin(request)
  return Response.json({
    resource: `${origin}/api/mcp`,
    authorization_servers: [origin],
    scopes_supported: ['mcp'],
    bearer_methods_supported: ['header'],
  })
}
