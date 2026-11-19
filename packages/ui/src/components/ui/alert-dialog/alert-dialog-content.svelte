<script lang="ts">
	import { AlertDialog as AlertDialogPrimitive } from "bits-ui";
	import type { ComponentProps } from "svelte";
	import { cn, type WithoutChild, type WithoutChildrenOrChild } from "#ui/utils.js";
	import AlertDialogOverlay from "./alert-dialog-overlay.svelte";
	import AlertDialogPortal from "./alert-dialog-portal.svelte";

	let {
		ref = $bindable(null),
		class: className,
		size = "default",
		portalProps,
		...restProps
	}: WithoutChild<AlertDialogPrimitive.ContentProps> & {
		size?: "default" | "sm";
		portalProps?: WithoutChildrenOrChild<ComponentProps<typeof AlertDialogPortal>>;
	} = $props();
</script>

<AlertDialogPortal {...portalProps}>
	<AlertDialogOverlay />
	<AlertDialogPrimitive.Content
		bind:ref
		data-slot="alert-dialog-content"
		data-size={size}
		class={cn(
			"dialog z-50 outline-none",
			className
		)}
		{...restProps}
	/>
</AlertDialogPortal>
