<script lang="ts">
  // A few line icons on a 24-unit grid, drawn here rather than pulled in from an icon package.
  const paths = {
    apps: 'M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z',
    users: 'M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM2 21v-1a6 6 0 0 1 12 0v1M16 3.5a4 4 0 0 1 0 7M18 14a6 6 0 0 1 4 6v1',
    server: 'M3 4h18v6H3zM3 14h18v6H3zM7 7h.01M7 17h.01',
    plus: 'M12 5v14M5 12h14',
    logout: 'M9 21H5V3h4M16 17l5-5-5-5M21 12H9',
    usage: 'M3 3v18h18M7 15l4-4 3 3 6-6',
    logs: 'M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01',
    globe: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18',
    archive: 'M3 4h18v4H3zM5 8v12h14V8M10 12h4',
    settings: 'M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0M14 4v4M8 10v4M16 16v4',
    menu: 'M4 6h16M4 12h16M4 18h16',
    updown: 'M8 9l4-4 4 4M8 15l4 4 4-4',
  }

  let { name, class: className = 'size-5' }: { name: keyof typeof paths; class?: string } = $props()
</script>

<svg
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="1.75"
  stroke-linecap="round"
  stroke-linejoin="round"
  class={className}
  aria-hidden="true"
><path d={paths[name]} /></svg>
