import { getSession } from '@/lib/get-session'
import { redirect } from 'next/navigation'
import { AuthForm } from '@/components/auth-form'
import { isGithubLoginEnabled } from '@/lib/github-oauth'

export default async function SignUpPage() {
  const session = await getSession()
  if (session?.user) redirect('/')
  return <AuthForm mode="sign-up" githubEnabled={await isGithubLoginEnabled()} />
}
