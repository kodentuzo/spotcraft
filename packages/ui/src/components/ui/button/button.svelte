<script lang="ts" module>
	import type { HTMLAnchorAttributes, HTMLButtonAttributes } from "svelte/elements";
	import { tv, type VariantProps } from "tailwind-variants";
	import { cn, type WithElementRef } from "#ui/utils.js";

	// spotstrap's btn classes (ADR 0033): 44px, or 36px with a 44px hit area for the small sizes.
	export const buttonVariants = tv({
		base: "btn",
		variants: {
			variant: {
				default: "",
				outline: "btn-outline",
				secondary: "btn-secondary",
				ghost: "btn-ghost",
				destructive: "btn-destructive",
				link: "btn-link",
			},
			size: {
				default: "",
				xs: "btn-compact",
				sm: "btn-compact",
				lg: "",
				icon: "btn-icon",
				"icon-xs": "btn-icon btn-compact",
				"icon-sm": "btn-icon btn-compact",
				"icon-lg": "btn-icon",
			},
		},
		defaultVariants: {
			variant: "default",
			size: "default",
		},
	});

	export type ButtonVariant = VariantProps<typeof buttonVariants>["variant"];
	export type ButtonSize = VariantProps<typeof buttonVariants>["size"];

	export type ButtonProps = WithElementRef<HTMLButtonAttributes> &
		WithElementRef<HTMLAnchorAttributes> & {
			variant?: ButtonVariant;
			size?: ButtonSize;
		};
</script>

<script lang="ts">
	let {
		class: className,
		variant = "default",
		size = "default",
		ref = $bindable(null),
		href = undefined,
		type = "button",
		disabled,
		children,
		...restProps
	}: ButtonProps = $props();
</script>

{#if href}
	<a
		bind:this={ref}
		data-slot="button"
		class={cn(buttonVariants({ variant, size }), className)}
		href={disabled ? undefined : href}
		aria-disabled={disabled}
		role={disabled ? "link" : undefined}
		tabindex={disabled ? -1 : undefined}
		{...restProps}
	>
		{@render children?.()}
	</a>
{:else}
	<button
		bind:this={ref}
		data-slot="button"
		class={cn(buttonVariants({ variant, size }), className)}
		{type}
		{disabled}
		{...restProps}
	>
		{@render children?.()}
	</button>
{/if}
