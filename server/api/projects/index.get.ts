import { defineEventHandler } from 'h3'
import { getProjects } from '~~/server/utils/projects'

export default defineEventHandler(() => {
  // jiraOrg is exposed (it's just a subdomain, not a secret) so the client can build
  // per-project Jira ticket links for the active project. Tokens are never returned.
  return getProjects().map(p => ({
    id: p.id,
    name: p.name,
    jiraOrg: p.jira?.org ?? null,
    hasGithub: !!p.github,
  }))
})
