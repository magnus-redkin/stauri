<script lang="ts">
  import { i18n } from '$lib/i18n';
</script>

<div class="flex flex-col h-full border-r border-border bg-card">
  <div class="p-4 border-b border-border font-bold text-lg text-primary">{i18n.t('Settings')}</div>
  <div class="p-2">
    <button class="w-full text-left p-3 rounded-md bg-secondary font-medium">{i18n.t('General')}</button>
  </div>
</div>
