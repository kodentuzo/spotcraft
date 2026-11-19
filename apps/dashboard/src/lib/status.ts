/**
 * How a container's state and health read on screen. Status is never color alone: every state
 * has its own word, and `bad` marks the ones that need a look.
 */
export function statusView(state: string, health: string): { label: string; bad: boolean } {
  if (state === 'running' && health === 'unhealthy') return { label: 'Unhealthy', bad: true }
  if (state === 'running' && health === 'starting') return { label: 'Starting', bad: false }
  if (state === 'running')
    return { label: health === 'healthy' ? 'Healthy' : 'Running', bad: false }
  if (state === 'restarting') return { label: 'Restarting', bad: true }
  if (state === 'missing') return { label: 'Not running', bad: true }
  return { label: state.charAt(0).toUpperCase() + state.slice(1), bad: true }
}

/** Docker's "Up 3 hours (healthy)" without the health, which the status badge already shows. */
export const runningFor = (status: string) => status.replace(/\s*\(.*\)$/, '')
