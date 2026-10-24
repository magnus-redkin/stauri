<script lang="ts">
  import { i18n } from '$lib/i18n';

  let {
    value = $bindable(),
    placeholder = i18n.t('Password'),
    onEnter,
    autofocus = false,
    disabled = false
  }: {
    value: string;
    placeholder?: string;
    onEnter?: () => void;
    autofocus?: boolean;
    disabled?: boolean;
  } = $props();

  let input: HTMLInputElement | undefined = $state();

  // $effect срабатывает при изменении input (когда DOM готов)
  $effect(() => {
    if (autofocus && input) {
      // Небольшая задержка, чтобы Svelte завершил рендер
      const timer = setTimeout(() => input?.focus(), 50);
      return () => clearTimeout(timer);
    }
  });

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter' && onEnter) {
      e.preventDefault();
      onEnter();
    }
  }
</script>

<input
  bind:this={input}
  type="password"
  bind:value
  {placeholder}
  {disabled}
  onkeydown={handleKeydown}
  class="w-full px-3 py-2 border border-input rounded-md bg-background text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50 disabled:cursor-not-allowed"
/>
