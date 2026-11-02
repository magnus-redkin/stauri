<script lang="ts">
  import { onDestroy } from 'svelte';
  import { invoke } from '@tauri-apps/api/core';
  import { i18n } from '$lib/i18n';
  import { formatError } from '$lib/utils/errors';

  let { onBack, onSave }: { onBack: () => void; onSave: () => void } = $props();

  let wordCount = $state(0);
  let isLoading = $state(true);
  let error = $state('');
  let step = $state<1 | 2>(1);

  // Слова запрашиваются по одному через seed_word(index) и хранятся в
  // shownWords для отображения. Пользователю фразу нужно записать, поэтому
  // показать её неизбежно; цель этой схемы — не давать фразе покидать
  // Rust-процесс целиком (в виде одной строки, которую легко утащить)
  let shownWords = $state<{ index: number; word: string }[]>([]);

  // Индексы и ответы для проверки. Ожидаемые слова в webview не попадают:
  // сверку делает verify_seed_answer() на стороне Rust.
  let testIndices = $state<number[]>([]);
  let testAnswers = $state<string[]>(['', '', '', '']);
  let wordStatus = $state<(boolean | null)[]>([null, null, null, null]);
  let inputRefs: HTMLInputElement[] = [];

  async function loadWords() {
    try {
      const info = await invoke<{ word_count: number }>('fetch_seed_phrase');
      wordCount = info.word_count;

      const words: { index: number; word: string }[] = [];
      for (let i = 0; i < wordCount; i++) {
        words.push({ index: i, word: await invoke<string>('seed_word', { index: i }) });
      }
      shownWords = words;
    } catch (e: any) {
      error = formatError(e, i18n.t('Failed to load seed phrase'));
    } finally {
      isLoading = false;
    }
  }

  $effect(() => {
    loadWords();
  });

  // Фраза стирается из памяти Rust при уходе с экрана, даже если компонент
  // размонтирован аварийно (навигация, закрытие окна).
  onDestroy(() => {
    shownWords = [];
    testAnswers = ['', '', '', ''];
    invoke('clear_seed').catch(() => {});
  });

  const allCorrect = $derived(wordStatus.every((s) => s === true));

  async function copyPhrase() {
    // Собираем текст только на момент копирования, чтобы он не жил
    // в состоянии компонента.
    const parts: string[] = [];
    for (const w of shownWords) parts.push(w.word);
    await navigator.clipboard.writeText(parts.join(' '));
  }

  async function startVerification() {
    try {
      testIndices = await invoke<number[]>('seed_challenge', { count: 4 });
      step = 2;
      setTimeout(() => inputRefs[0]?.focus(), 100);
    } catch (e: any) {
      error = formatError(e, i18n.t('Failed to start verification'));
    }
  }

  async function handleInput(e: Event, position: number) {
    const value = (e.target as HTMLInputElement).value;
    testAnswers[position] = value;

    if (value.trim() === '') {
      wordStatus[position] = null;
      return;
    }

    // Сверку выполняет Rust: слово-эталон в webview не попадает.
    try {
      const res = await invoke<{ correct: boolean }>('verify_seed_answer', {
        index: testIndices[position],
        answer: value.trim(),
      });
      wordStatus[position] = res.correct;
    } catch {
      wordStatus[position] = null;
      return;
    }

    if (value.endsWith(' ') && position < testIndices.length - 1) {
      inputRefs[position + 1]?.focus();
      testAnswers[position] = value.trim();
    }
  }

  function checkAnswers() {
    if (allCorrect) onSave();
  }
</script>

<div class="p-8 max-w-2xl mx-auto w-full">
  {#if isLoading}
    <p>{i18n.t('Loading')}...</p>
  {:else if error}
    <p class="text-destructive">{error}</p>
  {:else if step === 1}
    <div class="flex justify-between items-center mb-4">
      <h2 class="text-2xl font-bold text-primary">{i18n.t('Create Seed Phrase')}</h2>
      <button
        onclick={copyPhrase}
        class="text-sm text-primary hover:underline flex items-center gap-1"
        title={i18n.t('Copy phrase')}
      >
        📋 {i18n.t('Copy')}
      </button>
    </div>

    <p class="text-sm text-destructive mb-4">
      {i18n.t('Write this down and store it safely. This is the only way to recover your account.')}
    </p>

    <div class="grid grid-cols-2 gap-2 p-4 bg-secondary/30 rounded-lg w-full max-w-md mb-6">
      {#each shownWords as w (w.index)}
        <div class="flex items-center gap-2">
          <span class="text-xs text-muted-foreground w-4 text-right select-none">{w.index + 1}.</span>
          <span class="font-mono font-medium">{w.word}</span>
        </div>
      {/each}
    </div>

    <button
      onclick={startVerification}
      class="w-full py-2 bg-primary text-primary-foreground rounded-md font-medium mb-2"
    >
      {i18n.t('Проверить сохраненную фразу')}
    </button>
    <button onclick={onBack} class="text-sm text-muted-foreground hover:underline">
      {i18n.t('Back')}
    </button>
  {:else}
    <h2 class="text-2xl font-bold text-primary mb-4">{i18n.t('Verify Seed Phrase')}</h2>
    <p class="text-sm text-muted-foreground mb-4">
      {i18n.t('Enter the following words from your seed phrase:')}
    </p>

    <div class="flex flex-col gap-3 max-w-md mb-6">
      {#each testIndices as wordIndex, i (i)}
        <div class="flex items-center gap-3">
          <span class="text-sm font-mono w-24 text-right text-muted-foreground">
            {i18n.t('Word')} {wordIndex + 1}:
          </span>
          <input
            bind:this={inputRefs[i]}
            type="text"
            value={testAnswers[i]}
            oninput={(e) => handleInput(e, i)}
            class="flex-1 h-10 border rounded-md px-3 font-mono transition-colors {wordStatus[i] === true ? 'border-green-500 bg-green-50 text-green-700' : wordStatus[i] === false ? 'border-red-500 bg-red-50 text-red-700' : 'border-input bg-background'}"
            placeholder={i18n.t('Enter word')}
          />
        </div>
      {/each}
    </div>

    <button
      onclick={checkAnswers}
      disabled={!allCorrect}
      class="w-full py-2 bg-primary text-primary-foreground rounded-md font-medium mb-2 disabled:opacity-50 disabled:cursor-not-allowed"
    >
      {i18n.t('Сохранить seed-фразу')}
    </button>
    <button onclick={() => step = 1} class="text-sm text-muted-foreground hover:underline">
      {i18n.t('Back to words')}
    </button>
  {/if}
</div>
