<script lang="ts">
  import { hue } from '#lib/icon.ts'

  /** `sm` for a list row, `lg` for a page header, `xl` for the deployment card. */
  let { name, host, size = 'sm' }: { name: string; host?: string; size?: 'sm' | 'lg' | 'xl' } =
    $props()

  const box = { sm: 'size-12', lg: 'size-16', xl: 'size-32' }
  const letter = { sm: 'text-lg', lg: 'text-2xl', xl: 'text-7xl' }
  const icon = { sm: 32, lg: 40, xl: 80 }

  let iconFailed = $state(false)
  // An icon that failed before the page hydrated fired its error event too early: check it.
  const checkIcon = (img: HTMLImageElement) => {
    if (img.complete && img.naturalWidth === 0) iconFailed = true
  }
</script>

<!-- The app's icon from its own site, or its initial, on a color of its own. -->
<div
  class="tile relative flex shrink-0 items-center justify-center {box[size]}"
  style="--hue: {hue(name)}"
  aria-hidden="true"
>
  <span class="font-heading font-bold uppercase {letter[size]}">{name.charAt(0)}</span>
  {#if !iconFailed}
    <img
      src="/{name}/icon?host={encodeURIComponent(host ?? '')}"
      alt=""
      width={icon[size]}
      height={icon[size]}
      style="width: {icon[size]}px; height: {icon[size]}px"
      class="absolute object-contain"
      onerror={() => (iconFailed = true)}
      {@attach checkIcon}
    />
  {/if}
</div>

<style>
  .tile {
    background: oklch(0.92 0.05 var(--hue));
    color: oklch(0.45 0.09 var(--hue));
  }
  @media (prefers-color-scheme: dark) {
    .tile {
      background: oklch(0.32 0.07 var(--hue));
      color: oklch(0.8 0.08 var(--hue));
    }
  }
</style>
