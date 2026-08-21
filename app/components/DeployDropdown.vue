<script setup lang="ts">
const props = defineProps<{
  /** Disables actions when a deploy is already running */
  deploying?: boolean
  /** Whether the project has GitHub configured */
  hasGithub?: boolean
  /** Whether the whole dropdown is disabled (no branch, etc.) */
  disabled?: boolean
  /** Whether the Vercel deploy action specifically is disabled (wrong state) */
  vercelDisabled?: boolean
  /** The action to select by default */
  defaultAction?: 'deploy' | 'githubAction'
  /** Button size */
  size?: 'sm' | 'md'
}>()

const emit = defineEmits<{
  (e: 'deploy'): void
  (e: 'runGithubAction'): void
}>()

const dropdownOpen = ref(false)
const dropdownEl = ref<HTMLElement | null>(null)
const menuRef = ref<HTMLElement | null>(null)
const focusedIndex = ref(-1)

const selectedActionId = ref(props.defaultAction || 'deploy')

// When selected action is disabled (e.g. github not configured), fallback to 'deploy'
watchEffect(() => {
  if (selectedActionId.value === 'githubAction' && !props.hasGithub) {
    selectedActionId.value = 'deploy'
  }
})

// Status tracking for each deployment method
const actionStatus = ref<Record<string, 'idle' | 'loading' | 'success' | 'error'>>({
  deploy: 'idle',
  githubAction: 'idle',
})
const actionMessage = ref<Record<string, string>>({})

interface DeployAction {
  id: string
  label: string
  shortLabel: string
  icon: string
  description: string
  disabled?: boolean
  disabledReason?: string
}

const actions = computed<DeployAction[]>(() => [
  {
    id: 'deploy',
    label: 'Deploy with Vercel',
    shortLabel: 'Deploy',
    icon: 'lucide:rocket',
    description: 'Push an empty commit to trigger Vercel deployment',
    disabled: props.disabled || props.vercelDisabled,
    disabledReason: props.vercelDisabled ? 'Only available for Canceled / Blocked deployments' : undefined,
  },
  {
    id: 'githubAction',
    label: 'Run GitHub Action',
    shortLabel: 'GitHub Action',
    icon: 'lucide:play-circle',
    description: 'Dispatch a GitHub Actions workflow',
    disabled: props.disabled || !props.hasGithub,
    disabledReason: !props.hasGithub ? 'No GitHub configuration found for this project' : undefined,
  },
])

const currentAction = computed(() => actions.value.find(a => a.id === selectedActionId.value) || actions.value[0])

function selectAction(id: string) {
  selectedActionId.value = id
  dropdownOpen.value = false
  // Execute immediately upon selection
  nextTick(() => {
    executeSelectedAction()
  })
}

function executeSelectedAction() {
  if (currentAction.value.disabled) return
  if (selectedActionId.value === 'deploy') emit('deploy')
  else if (selectedActionId.value === 'githubAction') emit('runGithubAction')
}

function toggleDropdown() {
  dropdownOpen.value = !dropdownOpen.value
  if (dropdownOpen.value) {
    focusedIndex.value = -1
    nextTick(() => {
      menuRef.value?.focus()
    })
  }
}

function closeDropdown() {
  dropdownOpen.value = false
  focusedIndex.value = -1
}

function onClickOutside(e: MouseEvent) {
  if (dropdownOpen.value && dropdownEl.value && !dropdownEl.value.contains(e.target as Node)) {
    closeDropdown()
  }
}

// Keyboard navigation
function onMenuKeydown(e: KeyboardEvent) {
  const enabledActions = actions.value.filter(a => !a.disabled)
  if (e.key === 'Escape') {
    e.preventDefault()
    closeDropdown()
  } else if (e.key === 'ArrowDown') {
    e.preventDefault()
    focusedIndex.value = Math.min(focusedIndex.value + 1, actions.value.length - 1)
    // Skip disabled items
    while (focusedIndex.value < actions.value.length && actions.value[focusedIndex.value]?.disabled) {
      focusedIndex.value++
    }
    if (focusedIndex.value >= actions.value.length) focusedIndex.value = actions.value.length - 1
  } else if (e.key === 'ArrowUp') {
    e.preventDefault()
    focusedIndex.value = Math.max(focusedIndex.value - 1, 0)
    while (focusedIndex.value >= 0 && actions.value[focusedIndex.value]?.disabled) {
      focusedIndex.value--
    }
    if (focusedIndex.value < 0) focusedIndex.value = 0
  } else if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault()
    const action = actions.value[focusedIndex.value]
    if (action && !action.disabled) {
      selectAction(action.id)
    }
  }
}

// Expose status setters for parent to update
function setActionStatus(id: string, status: 'idle' | 'loading' | 'success' | 'error', message?: string) {
  actionStatus.value[id] = status
  if (message) actionMessage.value[id] = message
  if (status === 'success' || status === 'error') {
    setTimeout(() => {
      actionStatus.value[id] = 'idle'
      delete actionMessage.value[id]
    }, 4000)
  }
}

defineExpose({ setActionStatus })

onMounted(() => {
  window.addEventListener('click', onClickOutside)
})

onUnmounted(() => {
  window.removeEventListener('click', onClickOutside)
})
</script>

<template>
  <div ref="dropdownEl" class="relative inline-flex">
    <div
      class="deploy-split-btn inline-flex items-stretch rounded-md overflow-hidden border border-border-tertiary transition-colors"
      :class="{ 'opacity-50 cursor-not-allowed': disabled }"
    >
      <!-- Main Action Button -->
      <button
        type="button"
        class="deploy-main-btn inline-flex items-center gap-1.5 bg-btn text-text-secondary font-medium transition-colors hover:enabled:bg-btn-hover hover:enabled:border-border-focus hover:enabled:text-text-primary focus:outline-none disabled:cursor-default"
        :class="size === 'sm' ? 'text-xs px-2.5 py-[3px]' : 'text-sm px-3 py-[6.4px]'"
        :disabled="deploying || disabled || currentAction.disabled"
        @click="executeSelectedAction"
      >
        <Icon v-if="deploying" name="lucide:loader-2" class="animate-spin" :class="size === 'sm' ? 'h-3 w-3' : 'h-4 w-4'" />
        <Icon v-else :name="currentAction.icon" :class="size === 'sm' ? 'h-3 w-3' : 'h-4 w-4'" />
        <span>{{ currentAction.shortLabel }}</span>
      </button>

      <!-- Dropdown Trigger (Chevron) -->
      <button
        type="button"
        class="deploy-chevron-btn inline-flex items-center bg-btn text-text-secondary border-l border-border-tertiary transition-colors hover:enabled:bg-btn-hover hover:enabled:text-text-primary focus:outline-none disabled:cursor-default"
        :class="[
          { 'bg-btn-hover text-text-primary': dropdownOpen },
          size === 'sm' ? 'px-1.5' : 'px-2'
        ]"
        :aria-expanded="dropdownOpen"
        :disabled="disabled"
        aria-haspopup="true"
        aria-label="More deployment options"
        @click.stop="toggleDropdown"
      >
        <Icon
          name="lucide:chevron-down"
          class="transition-transform duration-150"
          :class="[
            { 'rotate-180': dropdownOpen },
            size === 'sm' ? 'h-3.5 w-3.5' : 'h-4 w-4'
          ]"
        />
      </button>
    </div>

    <!-- Dropdown Menu -->
    <Transition name="deploy-dropdown">
      <div
        v-if="dropdownOpen"
        ref="menuRef"
        tabindex="-1"
        role="menu"
        class="deploy-menu absolute right-0 top-full mt-1.5 w-72 bg-card-modal border border-border-primary rounded-lg shadow-xl z-30 py-1 outline-none"
        @keydown="onMenuKeydown"
      >
        <!-- Menu Header -->
        <div class="px-3 pt-2 pb-1.5">
          <span class="text-[11px] font-semibold text-text-tertiary uppercase tracking-wider">Deployment</span>
        </div>

        <!-- Divider -->
        <div class="border-t border-border-secondary mx-2 mb-1" />

        <!-- Actions -->
        <button
          v-for="(action, index) in actions"
          :key="action.id"
          type="button"
          role="menuitem"
          class="deploy-menu-item w-full flex items-start gap-3 text-left px-3 py-2 transition-colors"
          :class="[
            action.disabled
              ? 'opacity-40 cursor-not-allowed'
              : 'cursor-pointer hover:bg-row-hover',
            focusedIndex === index && !action.disabled ? 'bg-row-hover' : '',
          ]"
          :disabled="action.disabled || deploying"
          :title="action.disabled ? action.disabledReason : undefined"
          @click="!action.disabled && selectAction(action.id)"
          @mouseenter="focusedIndex = index"
        >
          <!-- Icon -->
          <div class="shrink-0 mt-0.5">
            <Icon
              v-if="actionStatus[action.id] === 'loading'"
              name="lucide:loader-2"
              class="h-4 w-4 text-blue-text animate-spin"
            />
            <Icon
              v-else-if="actionStatus[action.id] === 'success'"
              name="lucide:check-circle-2"
              class="h-4 w-4 text-green-text"
            />
            <Icon
              v-else-if="actionStatus[action.id] === 'error'"
              name="lucide:alert-circle"
              class="h-4 w-4 text-red-text"
            />
            <Icon
              v-else-if="selectedActionId === action.id"
              name="lucide:check"
              class="h-4 w-4 text-blue-text"
            />
            <Icon
              v-else
              :name="action.icon"
              class="h-4 w-4 text-text-tertiary"
            />
          </div>

          <!-- Label + Description -->
          <div class="flex-1 min-w-0">
            <div class="text-[13px] font-medium text-text-primary leading-tight">
              {{ action.label }}
            </div>
            <div
              v-if="actionMessage[action.id]"
              class="text-[11px] mt-0.5 leading-tight"
              :class="actionStatus[action.id] === 'error' ? 'text-red-text' : actionStatus[action.id] === 'success' ? 'text-green-text' : 'text-text-tertiary'"
            >
              {{ actionMessage[action.id] }}
            </div>
            <div v-else class="text-[11px] text-text-quaternary mt-0.5 leading-tight">
              {{ action.disabled ? action.disabledReason : action.description }}
            </div>
          </div>

          <!-- Status badge for active action -->
          <div v-if="actionStatus[action.id] === 'loading'" class="shrink-0 mt-0.5">
            <span class="inline-flex items-center gap-1 text-[10px] text-blue-text bg-blue-bg rounded-full px-2 py-0.5 font-medium">
              Running
            </span>
          </div>
          <div v-else-if="actionStatus[action.id] === 'success'" class="shrink-0 mt-0.5">
            <span class="inline-flex items-center gap-1 text-[10px] text-green-text bg-green-bg rounded-full px-2 py-0.5 font-medium">
              Done
            </span>
          </div>
        </button>
      </div>
    </Transition>
  </div>
</template>

<style scoped>
/* Dropdown animation */
.deploy-dropdown-enter-active {
  transition: opacity 0.15s ease, transform 0.15s ease;
}
.deploy-dropdown-leave-active {
  transition: opacity 0.1s ease, transform 0.1s ease;
}
.deploy-dropdown-enter-from {
  opacity: 0;
  transform: translateY(-6px) scale(0.97);
}
.deploy-dropdown-leave-to {
  opacity: 0;
  transform: translateY(-4px) scale(0.98);
}

/* Focus ring for the full split button group */
.deploy-split-btn:focus-within {
  box-shadow: 0 0 0 2px rgba(0, 112, 243, 0.15);
  border-radius: 6px;
}

/* Subtle separator highlight on hover */
.deploy-chevron-btn:hover {
  border-left-color: rgba(255, 255, 255, 0.35);
}

/* Menu item focus state */
.deploy-menu-item:focus-visible {
  outline: none;
  background: var(--bg-row-hover);
}
</style>
