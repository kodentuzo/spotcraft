<script lang="ts">
	import type { HTMLTextareaAttributes } from "svelte/elements";
	import { cn, type WithElementRef, type WithoutChildren } from "#ui/utils.js";

	let {
		ref = $bindable(null),
		value = $bindable(),
		class: className,
		"data-slot": dataSlot = "textarea",
		...restProps
	}: WithoutChildren<WithElementRef<HTMLTextareaAttributes>> = $props();
</script>

<textarea
	bind:this={ref}
	data-slot={dataSlot}
	class={cn(
		"textarea field-sizing-content",
		className
	)}
	bind:value
	{...restProps}></textarea>
