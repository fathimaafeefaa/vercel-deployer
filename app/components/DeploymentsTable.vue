<script setup lang="ts">
interface Deployment {
  uid: string
  state: string
  target: string | null
  createdAt: number | null
  inspectorUrl: string | null
  branch: string | null
  commitSha: string | null
  commitMessage: string | null
  commitAuthor: string | null
  deployer?: string | null
  prUrl?: string | null
  prId?: string | null
  _pending?: boolean
  _originUid?: string
  _githubRunUrl?: string | null
}

const props = defineProps<{
  deployments: Deployment[]
  pendingDeployments: Deployment[]
  cancelling: string | null
  fdErrors: Record<string, string>
  collapsed: boolean
  jiraOrg: string | null
  hasGithub?: boolean
}>()

const emit = defineEmits<{
  (e: 'inspect', uid: string): void
  (e: 'cancel', event: MouseEvent, uid: string): void
  (e: 'forceDeploy', event: MouseEvent, uid: string, branch: string): void
  (e: 'runGithubAction', event: MouseEvent, uid: string, branch: string): void
  (e: 'openSettings'): void
  (e: 'update:collapsed', value: boolean): void
}>()

const { copiedKey: copied, copy } = useCopy()

const CANCELLABLE = new Set(['BUILDING', 'QUEUED', 'INITIALIZING'])
const DEPLOYABLE = new Set(['CANCELED', 'BLOCKED'])

const avatarErrors = ref<Record<string, boolean>>({})

function getJiraUrl(branch: string | null): string | null {
  const ticket = parseJiraKey(branch)
  return ticket && props.jiraOrg ? `https://${props.jiraOrg}.atlassian.net/browse/${ticket}` : null
}

function isPending(uid: string): boolean {
  return props.pendingDeployments.some(d => d._originUid === uid && d.state !== 'ERROR')
}

// Relative time formatting helpers
const rtf = new Intl.RelativeTimeFormat('en', { numeric: 'auto' })

function relativeTime(ts: number): string {
  const diffSec = (ts - Date.now()) / 1000
  const abs = Math.abs(diffSec)
  if (abs < 60) return rtf.format(Math.round(diffSec), 'second')
  if (abs < 3600) return rtf.format(Math.round(diffSec / 60), 'minute')
  if (abs < 86400) return rtf.format(Math.round(diffSec / 3600), 'hour')
  return rtf.format(Math.round(diffSec / 86400), 'day')
}

function getCreatedAtTime(ts: number | null): string {
  if (!ts) return '—'
  return relativeTime(ts)
}

function getCreatedAtDate(ts: number | null): string {
  if (!ts) return ''
  return new Intl.DateTimeFormat('en', {
    month: 'short',
    day: 'numeric',
  }).format(new Date(ts))
}

const localCollapsed = computed({
  get: () => props.collapsed,
  set: (val) => emit('update:collapsed', val)
})
</script>

<template>
  <!-- Mobile card list (hidden on md+) -->
  <div class="flex flex-col gap-2 md:hidden">
    <!-- Collapse toggle for mobile -->
    <div class="flex items-center gap-2 mb-1">
      <button
        class="inline-flex items-center gap-1.5 bg-btn border border-border-tertiary rounded-sm text-text-secondary cursor-pointer text-[11px] px-2 py-1 transition-colors hover:bg-btn-hover hover:border-border-focus hover:text-text-primary"
        :class="{ 'border-border-primary text-text-primary': localCollapsed }"
        :title="localCollapsed ? 'Expand branches (show all deployments)' : 'Collapse branches (latest per branch)'"
        @click.stop="localCollapsed = !localCollapsed"
      >
        <Icon v-if="localCollapsed" name="lucide:fold-vertical" class="h-3.5 w-3.5" />
        <Icon v-else name="lucide:unfold-vertical" class="h-3.5 w-3.5" />
        <span>{{ localCollapsed ? 'Expand' : 'Collapse' }}</span>
      </button>
    </div>

    <div
      v-for="d in deployments"
      :key="d.uid"
      class="border border-border-secondary rounded-lg px-4 py-3.5 flex flex-col gap-3"
      :class="[d._pending ? 'bg-orange-bg/10' : 'bg-card', !d._pending && 'cursor-pointer active:opacity-80']"
      @click="!d._pending && emit('inspect', d.uid)"
    >
      <!-- Row 1: branch + status -->
      <div class="flex items-start justify-between gap-3" @click.stop="!d._pending && emit('inspect', d.uid)">
        <div class="min-w-0 flex-1">
          <div class="flex items-center gap-1.5 flex-wrap">
            <span class="text-text-primary font-mono text-[13px] font-medium truncate">{{ d.branch }}</span>
            <span v-if="d.target === 'production'" class="bg-blue-bg border border-blue-border rounded-[3px] text-blue-text text-[10px] tracking-[0.04em] px-1.5 py-px shrink-0">
              Production
            </span>
          </div>
          <p v-if="d.commitMessage" class="text-text-tertiary text-xs mt-1 line-clamp-1" :class="{ 'italic': d._pending }">
            {{ d.commitMessage }}
          </p>
        </div>
        <DeploymentStatusBadge :state="d.state" :pulse="d._pending" class="shrink-0 mt-0.5" />
      </div>

      <!-- Row 2: meta — author · sha · time -->
      <div class="flex items-center gap-2 text-xs text-text-tertiary" @click.stop>
        <!-- Author -->
        <template v-if="d.deployer">
          <Icon name="lucide:user" class="h-3 w-3 shrink-0" />
          <span class="truncate max-w-25">{{ d.deployer }}</span>
        </template>
        <template v-else>
          <img
            v-if="d.commitAuthor && !avatarErrors[d.uid]"
            :src="`https://github.com/${d.commitAuthor.replace(/\[bot\]$/, '')}.png?size=32`"
            :alt="d.commitAuthor"
            @error="avatarErrors[d.uid] = true"
            class="rounded-full h-4 w-4 ring-1 ring-border-primary shrink-0"
          />
          <Icon v-else-if="d.commitAuthor" name="ri:github-fill" class="h-3.5 w-3.5 shrink-0" />
          <span class="truncate max-w-25">{{ d.commitAuthor || '—' }}</span>
        </template>

        <span class="text-text-quaternary">·</span>

        <!-- SHA with copy -->
        <template v-if="d.commitSha">
          <code class="font-mono text-[11px] text-text-quaternary">{{ d.commitSha.slice(0, 7) }}</code>
          <button
            @click.stop="copy(d.commitSha, `${d.uid}-sha`)"
            class="bg-transparent border-0 text-text-quaternary cursor-pointer inline-flex p-0 transition-colors hover:text-text-secondary"
            :class="{ 'text-green-text': copied === `${d.uid}-sha` }"
            :title="copied === `${d.uid}-sha` ? 'Copied!' : 'Copy SHA'"
          >
            <Icon v-if="copied !== `${d.uid}-sha`" name="lucide:copy" class="h-2.5 w-2.5" />
            <Icon v-else name="lucide:check" class="h-2.5 w-2.5 text-green-text" />
          </button>
          <span class="text-text-quaternary">·</span>
        </template>

        <!-- Time -->
        <span class="shrink-0">{{ getCreatedAtTime(d.createdAt) }}</span>
      </div>

      <!-- Row 3: actions -->
      <div class="flex items-center gap-2" @click.stop>
        <template v-if="d._pending">
          <div v-if="!d._githubRunUrl && d.state !== 'ERROR'">
            <Icon name="lucide:loader-2" class="animate-spin h-3.5 w-3.5 text-zinc-500" />
          </div>
          <a
            v-else-if="d._githubRunUrl"
            :href="d._githubRunUrl"
            target="_blank"
            rel="noopener noreferrer"
            class="inline-block text-[10px] font-semibold tracking-wide border rounded-sm px-2 py-[2.4px] transition-colors"
            :class="d.state === 'ERROR' ? 'bg-red-bg border-red-border text-red-text' : 'bg-orange-bg border-orange-border text-orange-text'"
          >
            {{ d.state === 'ERROR' ? 'View failure ↗' : 'View run ↗' }}
          </a>
        </template>

        <template v-else>
          <span v-if="fdErrors[d.uid]" class="text-[10px] font-semibold bg-red-bg border border-red-border text-red-text rounded-sm px-2 py-[2.4px]" :title="fdErrors[d.uid]">
            Error
          </span>

          <button
            v-if="CANCELLABLE.has(d.state?.toUpperCase())"
            :disabled="cancelling === d.uid"
            @click.stop="emit('cancel', $event, d.uid)"
            class="bg-transparent border border-red-border rounded-sm text-red-text cursor-pointer text-[11px] px-2 py-0.75 whitespace-nowrap transition-colors hover:bg-red-bg disabled:opacity-50"
          >
            {{ cancelling === d.uid ? '…' : 'Cancel' }}
          </button>

          <!-- PR -->
          <a
            v-if="d.prUrl"
            :href="d.prUrl"
            target="_blank"
            rel="noopener noreferrer"
            class="inline-flex items-center justify-center bg-btn border border-border-tertiary rounded-sm text-text-secondary p-1.25 transition-colors hover:bg-btn-hover hover:text-text-primary"
            title="View GitHub Pull Request"
          >
            <Icon name="ri:github-fill" class="h-3.5 w-3.5" />
          </a>
          <div v-else class="inline-flex items-center justify-center bg-btn border border-border-tertiary rounded-sm text-text-quaternary opacity-25 p-1.25" title="No PR">
            <Icon name="ri:github-fill" class="h-3.5 w-3.5" />
          </div>

          <!-- Jira -->
          <a
            v-if="getJiraUrl(d.branch)"
            :href="getJiraUrl(d.branch)!"
            target="_blank"
            rel="noopener noreferrer"
            class="inline-flex items-center justify-center bg-btn border border-border-tertiary rounded-sm text-text-secondary p-1.25 transition-colors hover:bg-btn-hover hover:text-text-primary"
            title="View Jira Ticket"
          >
            <Icon name="logos:jira" class="h-3.5 w-3.5" />
          </a>
          <div v-else class="inline-flex items-center justify-center bg-btn border border-border-tertiary rounded-sm text-text-quaternary opacity-25 p-1.25" title="No Jira">
            <Icon name="logos:jira" class="h-3.5 w-3.5" />
          </div>

          <!-- Deploy single arrow button -->
          <DeployDropdown
            :deploying="isPending(d.uid)"
            :has-github="hasGithub"
            :default-action="d.uid.startsWith('gh-') ? 'githubAction' : 'deploy'"
            :disabled="!d.branch"
            :vercel-disabled="!DEPLOYABLE.has(d.state?.toUpperCase())"
            size="sm"
            @deploy="d.branch && DEPLOYABLE.has(d.state?.toUpperCase()) && emit('forceDeploy', $event, d.uid, d.branch!)"
            @run-github-action="d.branch && emit('runGithubAction', $event, d.uid, d.branch!)"
          />
        </template>
      </div>
    </div>
  </div>

  <!-- Desktop table (hidden below md) -->
  <div class="hidden md:block border border-border-secondary rounded-lg overflow-x-auto">
    <table class="table-auto border-collapse text-sm w-full">
      <thead>
        <tr class="border-b border-border-secondary">
          <th scope="col" class="text-text-tertiary text-[11px] font-medium tracking-[0.06em] px-4 py-2.5 text-left uppercase whitespace-nowrap">
            <div class="flex items-center gap-1.5">
              <button
                class="inline-flex items-center bg-transparent border border-transparent rounded-sm text-text-quaternary cursor-pointer shrink-0 p-[2.4px] transition-colors hover:bg-btn hover:border-border-primary hover:text-text-secondary"
                :class="{ 'bg-btn border-border-primary text-text-primary': localCollapsed }"
                :title="localCollapsed ? 'Expand branches (show all deployments)' : 'Collapse branches (latest per branch)'"
                @click.stop="localCollapsed = !localCollapsed"
              >
                <Icon v-if="localCollapsed" name="lucide:fold-vertical" class="h-3.5 w-3.5" />
                <Icon v-else name="lucide:unfold-vertical" class="h-3.5 w-3.5" />
              </button>
              <span>Branch / Commit</span>
            </div>
          </th>
          <th scope="col" class="text-text-tertiary text-[11px] font-medium tracking-[0.06em] px-4 py-2.5 text-left uppercase whitespace-nowrap">Status</th>
          <th scope="col" class="text-text-tertiary text-[11px] font-medium tracking-[0.06em] px-4 py-2.5 text-left uppercase whitespace-nowrap">Created At</th>
          <th scope="col" class="text-text-tertiary text-[11px] font-medium tracking-[0.06em] px-4 py-2.5 text-left uppercase whitespace-nowrap">Commit Author</th>
          <th scope="col" class="text-text-tertiary text-[11px] font-medium tracking-[0.06em] px-4 py-2.5 text-left uppercase whitespace-nowrap">Actions</th>
        </tr>
      </thead>
      <tbody>
        <tr
          v-for="d in deployments"
          :key="d.uid"
          class="clickable-row group"
          :class="[
            d._pending ? 'cursor-default bg-orange-bg/20 hover:bg-orange-bg/30' : 'cursor-pointer hover:bg-row-hover'
          ]"
          @click="!d._pending && emit('inspect', d.uid)"
          @keydown.enter="!d._pending && emit('inspect', d.uid)"
          :tabindex="d._pending ? -1 : 0"
        >
          <!-- Branch / Commit Info -->
          <td class="border-b border-border-secondary group-last:border-b-0 px-4 py-3.25 align-middle">
            <div class="branch-row flex items-center gap-1.5">
              <span class="text-text-primary font-mono text-[13px] font-normal hover:underline">{{ d.branch }}</span>
              <button
                v-if="d.branch"
                @click.stop="copy(d.branch, `${d.uid}-branch`)"
                class="bg-transparent border-0 text-text-quaternary cursor-pointer inline-flex p-[1.6px] transition-colors hover:text-text-secondary shrink-0"
                :class="{ 'text-green-text': copied === `${d.uid}-branch` }"
                :title="copied === `${d.uid}-branch` ? 'Copied!' : 'Copy branch name'"
              >
                <Icon v-if="copied !== `${d.uid}-branch`" name="lucide:copy" class="h-2.5 w-2.5" />
                <Icon v-else name="lucide:check" class="h-2.5 w-2.5 text-green-text" />
              </button>
              <span v-if="d.target === 'production'" class="bg-blue-bg border border-blue-border rounded-[3px] text-blue-text inline-block text-[11px] tracking-[0.04em] px-1.5 py-[1.6px]">
                Production
              </span>
            </div>
            <div v-if="d.commitSha" class="flex items-baseline gap-[6.4px] mt-1">
              <code class="bg-btn border border-border-tertiary rounded-[3px] text-text-tertiary shrink-0 font-mono text-xs px-1.5 py-[0.8px]">
                {{ d.commitSha.slice(0, 7) }}
              </code>
              <button
                @click.stop="copy(d.commitSha, `${d.uid}-sha`)"
                class="bg-transparent border-0 text-text-quaternary cursor-pointer inline-flex p-[1.6px] transition-colors hover:text-text-secondary"
                :class="{ 'text-green-text': copied === `${d.uid}-sha` }"
                :title="copied === `${d.uid}-sha` ? 'Copied!' : 'Copy commit SHA'"
              >
                <Icon v-if="copied !== `${d.uid}-sha`" name="lucide:copy" class="h-2.5 w-2.5" />
                <Icon v-else name="lucide:check" class="h-2.5 w-2.5 text-green-text" />
              </button>
              <span class="text-text-tertiary text-[13px] max-w-75 truncate" :class="{ 'text-text-tertiary/80 italic': d._pending }">
                {{ d.commitMessage }}
              </span>
            </div>
          </td>

          <!-- Status -->
          <td class="border-b border-border-secondary group-last:border-b-0 px-4 py-3.25 align-middle">
            <div class="flex items-center gap-2">
              <DeploymentStatusBadge :state="d.state" :pulse="d._pending" />

              <button
                v-if="!d._pending && CANCELLABLE.has(d.state?.toUpperCase())"
                :disabled="cancelling === d.uid"
                @click.stop="emit('cancel', $event, d.uid)"
                class="bg-transparent border border-red-border rounded-sm text-red-text cursor-pointer text-[11px] px-1.5 py-[2.4px] whitespace-nowrap transition-colors hover:bg-red-bg hover:border-red-main disabled:opacity-50 disabled:cursor-default"
              >
                {{ cancelling === d.uid ? '…' : 'Cancel' }}
              </button>
            </div>
          </td>

          <!-- Created At -->
          <td class="border-b border-border-secondary group-last:border-b-0 px-4 py-3.25 align-middle text-sm whitespace-nowrap">
            <div class="text-text-primary font-normal leading-none mb-1">{{ getCreatedAtTime(d.createdAt) }}</div>
            <div class="text-text-tertiary text-xs font-normal" v-if="d.createdAt">{{ getCreatedAtDate(d.createdAt) }}</div>
          </td>

          <!-- Commit Author / Deployer -->
          <td class="border-b border-border-secondary group-last:border-b-0 px-4 py-3.25 align-middle">
            <div class="flex items-center gap-1.5 min-w-0">
              <template v-if="d.deployer">
                <div class="w-4 h-4 rounded-full bg-zinc-100 dark:bg-zinc-950 border border-border-primary flex items-center justify-center text-text-secondary shrink-0">
                  <Icon name="lucide:user" class="h-2.5 w-2.5" />
                </div>
                <span class="text-text-secondary text-sm truncate max-w-45" :title="d.deployer">{{ d.deployer }}</span>
              </template>
              <template v-else>
                <img
                  v-if="d.commitAuthor && !avatarErrors[d.uid]"
                  :src="`https://github.com/${d.commitAuthor.replace(/\[bot\]$/, '')}.png?size=32`"
                  :alt="d.commitAuthor"
                  @error="avatarErrors[d.uid] = true"
                  class="rounded-full h-4 w-4 ring-1 ring-border-primary shrink-0"
                />
                <div v-else-if="d.commitAuthor" class="w-4 h-4 rounded-full bg-card flex items-center justify-center text-text-tertiary shrink-0">
                  <Icon name="ri:github-fill" class="size-12" />
                </div>
                <span class="text-text-secondary text-sm truncate max-w-45" :title="d.commitAuthor || undefined">{{ d.commitAuthor || '—' }}</span>
              </template>
            </div>
          </td>

          <!-- Actions -->
          <td class="border-b border-border-secondary group-last:border-b-0 px-4 py-3.25 align-middle" @click.stop>
            <div class="flex items-center gap-2">
              <template v-if="d._pending">
                <div v-if="!d._githubRunUrl && d.state !== 'ERROR'" class="p-[2.4px]">
                  <Icon name="lucide:loader-2" class="animate-spin h-3.5 w-3.5 text-zinc-500" />
                </div>
                <a
                  v-else-if="d._githubRunUrl"
                  :href="d._githubRunUrl"
                  target="_blank"
                  rel="noopener noreferrer"
                  class="inline-block text-[10px] font-semibold tracking-wide border rounded-sm px-2 py-[2.4px] transition-colors"
                  :class="d.state === 'ERROR' ? 'bg-red-bg border-red-border text-red-text hover:bg-red-bg/80' : 'bg-orange-bg border-orange-border text-orange-text hover:bg-orange-bg/80'"
                >
                  {{ d.state === 'ERROR' ? 'View failure ↗' : 'View run ↗' }}
                </a>
              </template>

              <template v-else>
                <span v-if="fdErrors[d.uid]" class="inline-block text-[10px] font-semibold bg-red-bg border border-red-border text-red-text rounded-sm px-2 py-[2.4px]" :title="fdErrors[d.uid]">
                  Error
                </span>

                <a
                  v-if="d.prUrl"
                  :href="d.prUrl"
                  target="_blank"
                  rel="noopener noreferrer"
                  class="inline-flex items-center justify-center bg-btn border border-border-tertiary rounded-sm text-text-secondary cursor-pointer p-1.25 transition-colors hover:bg-btn-hover hover:border-border-focus hover:text-text-primary"
                  title="View GitHub Pull Request"
                >
                  <Icon name="ri:github-fill" class="h-3.75 w-3.75" />
                </a>
                <div
                  v-else
                  class="inline-flex items-center justify-center bg-btn border border-border-tertiary rounded-sm text-text-quaternary opacity-30 p-1.25"
                  title="No PR linked"
                >
                  <Icon name="ri:github-fill" class="h-3.75 w-3.75" />
                </div>

                <a
                  v-if="getJiraUrl(d.branch)"
                  :href="getJiraUrl(d.branch)!"
                  target="_blank"
                  rel="noopener noreferrer"
                  class="inline-flex items-center justify-center bg-btn border border-border-tertiary rounded-sm text-text-secondary cursor-pointer p-1.25 transition-colors hover:bg-btn-hover hover:border-border-focus hover:text-text-primary"
                  title="View Jira Ticket"
                >
                  <Icon name="logos:jira" class="h-3.75 w-3.75" />
                </a>
                <div
                  v-else
                  class="inline-flex items-center justify-center bg-btn border border-border-tertiary rounded-sm text-text-quaternary opacity-30 p-1.25"
                  title="No Jira ticket"
                >
                  <Icon name="logos:jira" class="h-3.75 w-3.75" />
                </div>

                <!-- Deploy single arrow button -->
                <DeployDropdown
                  :deploying="isPending(d.uid)"
                  :has-github="hasGithub"
                  :default-action="d.uid.startsWith('gh-') ? 'githubAction' : 'deploy'"
                  :disabled="!d.branch"
                  :vercel-disabled="!DEPLOYABLE.has(d.state?.toUpperCase())"
                  size="sm"
                  @deploy="d.branch && DEPLOYABLE.has(d.state?.toUpperCase()) && emit('forceDeploy', $event, d.uid, d.branch!)"
                  @run-github-action="d.branch && emit('runGithubAction', $event, d.uid, d.branch!)"
                />
              </template>
            </div>
          </td>
        </tr>
      </tbody>
    </table>
  </div>
</template>
