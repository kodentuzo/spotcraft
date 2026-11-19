<script lang="ts">
	import { Label as LabelPrimitive } from "bits-ui";
	import { cn } from "#ui/utils.js";

	let {
		ref = $bindable(null),
		class: className,
		...restProps
	}: LabelPrimitive.RootProps = $props();
</script>

<LabelPrimitive.Root
	bind:ref
	data-slot="label"
	class={cn(
		"label flex items-center gap-2 select-none",
		className
	)}
	{...restProps}
/>
