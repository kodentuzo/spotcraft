<script lang="ts">
	import { AlertDialog as AlertDialogPrimitive } from "bits-ui";
	import { cn } from "#ui/utils.js";

	let {
		ref = $bindable(null),
		class: className,
		...restProps
	}: AlertDialogPrimitive.OverlayProps = $props();
</script>

<AlertDialogPrimitive.Overlay
	bind:ref
	data-slot="alert-dialog-overlay"
	class={cn("dialog-backdrop z-50", className)}
	{...restProps}
/>
