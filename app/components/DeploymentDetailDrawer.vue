<script setup lang="ts">
interface DeploymentDetail {
  uid: string
  name: string
  state: string
  url: string
  target: string | null
  createdAt: number | null
  buildingAt: number | null
  readyAt: number | null
  buildDurationMs: number | null
  inspectorUrl: string | null
  branch: string | null
  commitSha: string | null
  commitMessage: string | null
  commitAuthor: string | null
  repoUrl: string | null
  prId: string | null
  ghOrg: string | null
  ghRepo: string | null
  regions: string[]
  creator: string | null
}

interface GhCheck { name: string; status: string; conclusion: string | null }
interface GhPr {
  number: number
  title: string
  state: string
  merged: boolean
  additions: number
  deletions: number
  changedFiles: number
  url: string
  baseBranch: string | null
  labels: { name: string; color: string }[]
  reviews: { approved: number; changesRequested: number }
  checks: GhCheck[]
}

interface JiraIssue {
  key: string
  summary: string
  status: string | null
  statusCategory: string | null
  type: string | null
  priority: string | null
  assignee: { name: string; avatar: string | null } | null
  reporter: string | null
  labels: string[]
  sprint: string | null
  storyPoints: number | null
  url: string
}

const props = defineProps<{
  uid: string | null
  projectId: string | null
}>()

const emit = defineEmits<{
  (e: 'close'): void
}>()

const CANCELLABLE = new Set(['BUILDING', 'QUEUED', 'INITIALIZING'])
const cancelling = ref(false)

const data = ref<DeploymentDetail | null>(null)
const pending = ref(false)
const error = ref<any>(null)

async function fetchDetails() {
  if (!props.uid || !props.projectId) {
    data.value = null
    return
  }
  pending.value = true
  error.value = null
  try {
    data.value = await $fetch<DeploymentDetail>(`/api/projects/${props.projectId}/deployments/${props.uid}`)
  } catch (err: any) {
    error.value = err
  } finally {
    pending.value = false
  }
}

async function cancelDeployment() {
  if (!props.uid || !props.projectId) return
  cancelling.value = true
  try {
    await $fetch(`/api/projects/${props.projectId}/deployments/${props.uid}/cancel`, { method: 'PATCH' })
    await fetchDetails()
  } finally {
    cancelling.value = false
  }
}

// Fetch deployment detail whenever props.uid changes
watch(() => props.uid, fetchDetails, { immediate: true })

const dtf = new Intl.DateTimeFormat('en', {
  month: 'short', day: 'numeric',
  hour: '2-digit', minute: '2-digit',
  hour12: false,
})

function formatTs(ts: number | null): string {
  return ts ? dtf.format(new Date(ts)) : ''
}

function formatDuration(ms: number | null): string {
  if (!ms) return ''
  const s = Math.round(ms / 1000)
  if (s < 60) return `${s}s`
  return `${Math.floor(s / 60)}m ${s % 60}s`
}

const jiraKey = computed(() => parseJiraKey(data.value?.branch ?? null))

const ghPr = ref<GhPr | null>(null)
const ghPrPending = ref(false)
const ghPrError = ref(false)

const jiraIssue = ref<JiraIssue | null>(null)
const jiraPending = ref(false)
const jiraError = ref(false)

// Fetch PR / Jira info when deployment detail changes
watch(data, async (d) => {
  ghPr.value = null
  jiraIssue.value = null
  ghPrError.value = false
  jiraError.value = false
  if (!d) return

  const fetches: Promise<void>[] = []

  if (d.prId && d.ghOrg && d.ghRepo && props.projectId) {
    ghPrPending.value = true
    fetches.push(
      $fetch<GhPr>(`/api/projects/${props.projectId}/github/pr`, { query: { owner: d.ghOrg, repo: d.ghRepo, pr: d.prId, sha: d.commitSha ?? '' } })
        .then(r => { ghPr.value = r })
        .catch(() => { ghPrError.value = true })
        .finally(() => { ghPrPending.value = false }),
    )
  }

  if (jiraKey.value && props.projectId) {
    jiraPending.value = true
    fetches.push(
      $fetch<JiraIssue>(`/api/projects/${props.projectId}/jira/issue`, { query: { key: jiraKey.value } })
        .then(r => { jiraIssue.value = r })
        .catch(() => { jiraError.value = true })
        .finally(() => { jiraPending.value = false }),
    )
  }

  await Promise.all(fetches)
})

function prStateLabel(pr: GhPr) {
  if (pr.merged) return 'Merged'
  return pr.state === 'open' ? 'Open' : 'Closed'
}

function prStateClass(pr: GhPr) {
  if (pr.merged) return 'bg-purple-500/10 border-purple-500/20 text-purple-400'
  return pr.state === 'open'
    ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400'
    : 'bg-zinc-800 border-zinc-700 text-zinc-400'
}

function jiraStatusClass(issue: JiraIssue) {
  const cat = issue.statusCategory
  if (cat === 'done') return 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400'
  if (cat === 'indeterminate') return 'bg-blue-500/10 border-blue-500/20 text-blue-400'
  return 'bg-zinc-800 border-zinc-700 text-zinc-400'
}

function openLink(url: string) {
  window.open(url, '_blank', 'noopener')
}

// Path appended to the Vercel deployment host to form the shareable preview URL.
const PREVIEW_PATH = '/auth/login?redirect=/'
const previewUrl = computed(() => {
  if (!data.value?.url) return ''
  if (data.value.url.startsWith('http')) return data.value.url
  return `https://${data.value.url}${PREVIEW_PATH}`
})

const { copiedKey: copied, copy } = useCopy()

// Close on ESC
onMounted(() => {
  const onKeydown = (e: KeyboardEvent) => {
    if (e.key === 'Escape') emit('close')
  }
  window.addEventListener('keydown', onKeydown)
  onUnmounted(() => {
    window.removeEventListener('keydown', onKeydown)
  })
})
</script>

<template>
  <div>
    <!-- Backdrop Overlay -->
    <Transition name="fade">
      <div v-if="uid" class="fixed inset-0 bg-black/60 backdrop-blur-[2px] z-40" @click="emit('close')" />
    </Transition>

    <!-- Side Sheet / Drawer -->
    <Transition name="slide">
      <div v-if="uid" class="fixed top-0 right-0 bottom-0 w-212.5 max-w-full bg-card border-l border-border-primary z-50 flex flex-col shadow-2xl h-screen overflow-hidden text-text-primary">
        <!-- Header -->
        <header class="flex items-center justify-between border-b border-border-secondary px-6 py-4 bg-page">
          <div class="flex items-center gap-2">
            <span class="text-sm font-semibold text-text-primary">Inspect Deployment</span>
          </div>
          <button @click="emit('close')" class="bg-transparent border-0 text-text-tertiary cursor-pointer text-base hover:text-text-primary transition-colors p-1 flex items-center justify-center">
            <Icon name="lucide:x" class="h-5 w-5" />
          </button>
        </header>

        <!-- Body -->
        <div class="flex-1 overflow-y-auto p-6 space-y-6">
          <!-- Skeleton Loader -->
          <div v-if="pending" class="animate-pulse space-y-6">
            <!-- Header Summary Skeleton -->
            <div class="flex items-center justify-between">
              <div class="flex items-center gap-3">
                <div class="h-6 w-16 bg-border-secondary rounded-sm" />
                <div class="h-6 w-32 bg-border-secondary rounded-sm" />
              </div>
              <div class="h-8 w-24 bg-border-secondary rounded-md" />
            </div>

            <!-- Meta Strip Skeleton -->
            <div class="bg-page border border-border-secondary rounded-lg px-4 py-3 space-y-4">
              <div class="flex justify-between"><div class="h-3.5 w-20 bg-border-secondary rounded-sm" /><div class="h-3.5 w-40 bg-border-secondary rounded-sm" /></div>
              <div class="flex justify-between border-t border-border-secondary pt-3"><div class="h-3.5 w-16 bg-border-secondary rounded-sm" /><div class="h-3.5 w-32 bg-border-secondary rounded-sm" /></div>
              <div class="flex justify-between border-t border-border-secondary pt-3"><div class="h-3.5 w-24 bg-border-secondary rounded-sm" /><div class="h-3.5 w-48 bg-border-secondary rounded-sm" /></div>
              <div class="flex justify-between border-t border-border-secondary pt-3"><div class="h-3.5 w-20 bg-border-secondary rounded-sm" /><div class="h-3.5 w-28 bg-border-secondary rounded-sm" /></div>
            </div>

            <!-- Integrations Skeleton -->
            <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div class="bg-page border border-border-secondary rounded-lg p-4 space-y-3">
                <div class="h-3.5 w-20 bg-border-secondary rounded-sm" />
                <div class="h-3 w-32 bg-border-secondary rounded-sm" />
              </div>
              <div class="bg-page border border-border-secondary rounded-lg p-4 space-y-3">
                <div class="h-3.5 w-20 bg-border-secondary rounded-sm" />
                <div class="h-3 w-32 bg-border-secondary rounded-sm" />
              </div>
            </div>

            <!-- Logs Skeleton -->
            <div class="h-62.5 bg-page border border-border-secondary rounded-lg p-4 space-y-2">
              <div class="h-3 w-3/4 bg-border-secondary rounded-sm" />
              <div class="h-3 w-1/2 bg-border-secondary rounded-sm" />
              <div class="h-3 w-5/6 bg-border-secondary rounded-sm" />
            </div>
          </div>

          <div v-else-if="error" class="flex flex-col items-center justify-center py-20 text-red-text text-[15px] gap-3">
            <Icon name="lucide:alert-triangle" class="h-6 w-6 text-rose-500" />
            <span>{{ error.message }}</span>
          </div>

          <template v-else-if="data">
            <!-- Header Summary -->
            <div class="flex items-start justify-between gap-4 flex-wrap">
              <div class="flex items-center gap-3 flex-wrap">
                <DeploymentStatusBadge :state="data.state" />
                <h2 class="text-base font-semibold tracking-[-0.02em] text-text-primary max-w-50 truncate" :title="data.name">{{ data.name }}</h2>
                <span v-if="data.target === 'production'" class="bg-blue-bg border border-blue-border rounded-[3px] text-blue-text text-[10px] tracking-[0.04em] px-1.5 py-px">
                  Production
                </span>
              </div>
              <div class="flex gap-2 shrink-0">
                <template v-if="data.url">
                  <a :href="data.url.startsWith('http') ? data.url : `https://${data.url}`" target="_blank" rel="noopener" class="bg-blue-main border border-blue-main rounded-md text-white text-xs px-3 py-1.25 no-underline transition-colors hover:bg-blue-main-hover hover:border-blue-main-hover">
                    {{ data.uid?.startsWith('gh-') && data.state !== 'READY' ? 'View Run Logs ↗' : 'Preview URL ↗' }}
                  </a>
                </template>
                <button
                  v-if="CANCELLABLE.has(data.state?.toUpperCase())"
                  :disabled="cancelling"
                  @click="cancelDeployment"
                  class="bg-transparent border border-red-border rounded-md text-red-text text-xs px-3 py-1.25 transition-colors hover:bg-red-bg hover:border-red-main"
                >
                  {{ cancelling ? 'Cancelling…' : 'Cancel' }}
                </button>
              </div>
            </div>

            <div v-if="data.uid?.startsWith('gh-')" class="flex flex-col items-center justify-center py-20 text-text-tertiary text-sm gap-4 bg-page border border-border-secondary rounded-lg mt-2">
              <Icon name="lucide:github" class="h-10 w-10 text-text-secondary" />
              <p>This deployment is running with GitHub Actions.</p>
              <p class="text-xs text-text-quaternary">Check the <a :href="data.url.startsWith('http') ? data.url : `https://${data.url}`" target="_blank" rel="noopener" class="text-blue-text hover:underline">Run Logs on GitHub</a> for more details.</p>
            </div>

            <template v-else>
              <!-- Meta Strip -->
              <div class="bg-page border border-border-secondary rounded-lg px-4 py-3 flex flex-col gap-2.5 mt-4">
                <!-- URL -->
                <div class="flex items-center gap-4 text-xs">
                  <span class="text-text-quaternary font-medium uppercase tracking-wider w-20 shrink-0">Preview URL</span>
                  <template v-if="data.url">
                    <a :href="data.url.startsWith('http') ? data.url : `https://${data.url}`" target="_blank" rel="noopener" class="text-text-primary font-mono no-underline hover:underline hover:text-text-primary flex-1 truncate">{{ data.url }}</a>
                    <button
                      @click="copy(previewUrl, 'url')"
                      class="bg-transparent border border-border-primary rounded-sm text-text-tertiary px-1.5 py-px cursor-pointer transition-colors hover:border-border-focus hover:text-text-secondary shrink-0"
                      :class="{ 'border-green-border text-green-text': copied === 'url' }"
                    >
                      {{ copied === 'url' ? 'Copied!' : 'Copy' }}
                    </button>
                  </template>
                  <span v-else class="text-text-tertiary font-mono flex-1 truncate">N/A</span>
                </div>

                <!-- Branch -->
                <div v-if="data.branch" class="flex items-center gap-4 text-xs border-t border-border-secondary pt-2.5">
                  <span class="text-text-quaternary font-medium uppercase tracking-wider w-20 shrink-0">Branch</span>
                  <a v-if="data.repoUrl" :href="`${data.repoUrl}/tree/${data.branch}`" target="_blank" rel="noopener" class="text-text-secondary font-mono no-underline hover:underline hover:text-text-primary flex-1 truncate">{{ data.branch }}</a>
                  <span v-else class="text-text-secondary font-mono flex-1 truncate">{{ data.branch }}</span>
                  <button
                    @click="copy(data.branch, 'branch')"
                    class="bg-transparent border border-border-primary rounded-sm text-text-tertiary px-1.5 py-px cursor-pointer transition-colors hover:border-border-focus hover:text-text-secondary shrink-0"
                    :class="{ 'border-green-border text-green-text': copied === 'branch' }"
                  >
                    {{ copied === 'branch' ? '✓' : 'Copy' }}
                  </button>
                </div>

                <!-- Commit -->
                <div v-if="data.commitSha" class="flex items-center gap-4 text-xs border-t border-border-secondary pt-2.5">
                  <span class="text-text-quaternary font-medium uppercase tracking-wider w-20 shrink-0">Commit ID</span>
                  <a v-if="data.repoUrl" :href="`${data.repoUrl}/commit/${data.commitSha}`" target="_blank" rel="noopener" class="bg-btn border border-border-tertiary rounded-[3px] text-text-tertiary font-mono px-1.5 py-px no-underline hover:text-text-secondary">{{ data.commitSha.slice(0, 7) }}</a>
                  <code v-else class="bg-btn border border-border-tertiary rounded-[3px] text-text-tertiary font-mono px-1.5 py-px">{{ data.commitSha.slice(0, 7) }}</code>
                  <span class="text-text-tertiary truncate flex-1" :title="data.commitMessage ?? undefined">{{ data.commitMessage }}</span>
                  <button
                    @click="copy(data.commitSha, 'sha')"
                    class="bg-transparent border border-border-primary rounded-sm text-text-tertiary px-1.5 py-px cursor-pointer transition-colors hover:border-border-focus hover:text-text-secondary shrink-0"
                    :class="{ 'border-green-border text-green-text': copied === 'sha' }"
                  >
                    {{ copied === 'sha' ? '✓' : 'Copy' }}
                  </button>
                </div>

                <!-- Author -->
                <div v-if="data.commitAuthor" class="flex items-center gap-4 text-xs border-t border-border-secondary pt-2.5">
                  <span class="text-text-quaternary font-medium uppercase tracking-wider w-20 shrink-0">Author</span>
                  <span class="text-text-secondary flex-1 truncate">
                    {{ data.commitAuthor }} <span v-if="data.createdAt" class="text-text-tertiary">· {{ formatTs(data.createdAt) }}</span>
                  </span>
                  <span v-if="data.buildDurationMs" class="text-text-tertiary shrink-0">built in {{ formatDuration(data.buildDurationMs) }}</span>
                </div>
              </div>

              <!-- Integrations Cards -->
              <div v-if="data.prId || jiraKey" class="grid grid-cols-1 md:grid-cols-2 gap-4">
                <!-- GitHub PR -->
                <div
                  v-if="data.prId"
                  @click="ghPr && openLink(ghPr.url)"
                  class="bg-page border border-border-secondary rounded-lg px-4 py-3 transition-colors hover:border-border-primary"
                  :class="{ 'cursor-pointer': !!ghPr }"
                >
                  <div class="flex items-center gap-2 mb-2">
                    <Icon name="lucide:git-pull-request" class="text-text-quaternary shrink-0 h-3.5 w-3.5" />
                    <span class="text-text-quaternary text-[10px] font-semibold tracking-[0.06em] uppercase flex-1">GitHub PR</span>
                    <div v-if="ghPrPending" class="animate-spin h-3 w-3 border border-border-primary border-t-border-focus rounded-full" />
                  </div>

                  <div v-if="ghPrPending" class="text-text-tertiary text-xs italic">Loading...</div>
                  <div v-else-if="ghPrError" class="text-red-text text-xs">Failed to load PR</div>
                  <div v-else-if="ghPr" class="space-y-1.5">
                    <div class="flex items-center gap-2">
                      <span class="border border-transparent rounded-sm inline-block text-[9px] font-semibold px-1 py-[0.5px] uppercase" :class="prStateClass(ghPr)">{{ prStateLabel(ghPr) }}</span>
                      <span class="text-text-secondary text-xs truncate">#{{ ghPr.number }}</span>
                    </div>
                    <div class="text-text-primary text-xs font-medium truncate" :title="ghPr.title">{{ ghPr.title }}</div>

                    <!-- Review Status -->
                    <div class="flex items-center gap-1.5 text-[11px] mt-1">
                      <Icon v-if="ghPr.reviews.approved > 0 && ghPr.reviews.changesRequested === 0" name="lucide:check-circle" class="h-3.5 w-3.5 text-emerald-400" />
                      <Icon v-else-if="ghPr.reviews.changesRequested > 0" name="lucide:alert-circle" class="h-3.5 w-3.5 text-rose-400" />
                      <Icon v-else name="lucide:eye" class="h-3.5 w-3.5 text-text-quaternary" />

                      <span v-if="ghPr.reviews.approved > 0 && ghPr.reviews.changesRequested === 0" class="font-medium text-emerald-400">
                        Approved ({{ ghPr.reviews.approved }})
                      </span>
                      <span v-else-if="ghPr.reviews.changesRequested > 0" class="font-medium text-rose-400">
                        Changes Requested ({{ ghPr.reviews.changesRequested }})
                      </span>
                      <span v-else class="text-text-tertiary">
                        No reviews
                      </span>
                    </div>

                    <!-- PR Labels -->
                    <div v-if="ghPr.labels && ghPr.labels.length > 0" class="flex flex-wrap gap-1 mt-2">
                      <span
                        v-for="l in ghPr.labels"
                        :key="l.name"
                        class="text-[9px] font-semibold px-1.5 py-px rounded-[3px] border"
                        :style="{
                          backgroundColor: `#${l.color}15`,
                          borderColor: `#${l.color}35`,
                          color: `#${l.color}`
                        }"
                      >
                        {{ l.name }}
                      </span>
                    </div>
                  </div>
                </div>

                <!-- Jira Ticket -->
                <div
                  v-if="jiraKey"
                  @click="jiraIssue && openLink(jiraIssue.url)"
                  class="bg-page border border-border-secondary rounded-lg px-4 py-3 transition-colors hover:border-border-primary"
                  :class="{ 'cursor-pointer': !!jiraIssue }"
                >
                  <div class="flex items-center gap-2 mb-2">
                    <Icon name="logos:jira" class="shrink-0 h-3.5 w-3.5" />
                    <span class="text-text-quaternary text-[10px] font-semibold tracking-[0.06em] uppercase flex-1">Jira Issue</span>
                    <div v-if="jiraPending" class="animate-spin h-3 w-3 border border-border-primary border-t-border-focus rounded-full" />
                  </div>

                  <div v-if="jiraPending" class="text-text-tertiary text-xs italic">Loading...</div>
                  <div v-else-if="jiraError" class="text-red-text text-xs">Failed to load issue</div>
                  <div v-else-if="jiraIssue" class="space-y-1.5">
                    <div class="flex items-center gap-2">
                      <span class="border border-transparent rounded-sm inline-block text-[9px] font-semibold px-1 py-[0.5px] uppercase" :class="jiraStatusClass(jiraIssue)">{{ jiraIssue.status }}</span>
                      <span class="text-blue-text font-mono text-[10px] font-semibold uppercase">{{ jiraIssue.key }}</span>
                    </div>
                    <div class="text-text-primary text-xs font-medium truncate" :title="jiraIssue.summary">{{ jiraIssue.summary }}</div>
                  </div>
                </div>
              </div>

              <!-- Build Logs -->
              <LogViewer :uid="props.uid!" :project-id="props.projectId!" />
            </template>
          </template>
        </div>
      </div>
    </Transition>
  </div>
</template>

<style scoped>
.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.25s ease;
}
.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}

.slide-enter-active,
.slide-leave-active {
  transition: transform 0.3s cubic-bezier(0.16, 1, 0.3, 1);
}
.slide-enter-from,
.slide-leave-to {
  transform: translateX(100%);
}
</style>
