import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  navState,
  record,
  goBack,
  goForward,
  resetNavigation,
  registerNavigationApplier,
  _debugStack,
  type NavSnapshot,
} from './navStore.svelte';

function snap(overrides: Partial<NavSnapshot> = {}): NavSnapshot {
  return {
    section: 'home',
    chatId: null,
    dappView: null,
    communityId: null,
    showRecovery: false,
    showCreateSeed: false,
    ...overrides,
  };
}

describe('navStore', () => {
  let applied: NavSnapshot[];

  beforeEach(() => {
    resetNavigation();
    applied = [];
    registerNavigationApplier((s) => applied.push(s));
  });

  it('не пишет повтор того же экрана', () => {
    record(snap());
    record(snap());
    record(snap());
    expect(_debugStack()).toHaveLength(1);
  });

  it('пишет различающиеся экраны', () => {
    record(snap({ section: 'home' }));
    record(snap({ section: 'chat', chatId: '0xabc' }));
    expect(_debugStack()).toHaveLength(2);
  });

  it('назад возвращает предыдущий снимок', () => {
    record(snap({ section: 'home' }));
    record(snap({ section: 'chat', chatId: '0xabc' }));

    expect(goBack()).toBe(true);
    expect(applied).toHaveLength(1);
    expect(applied[0].section).toBe('home');
    expect(applied[0].chatId).toBeNull();
  });

  it('вперёд возвращает вперёд после шага назад', () => {
    record(snap({ section: 'home' }));
    record(snap({ section: 'chat', chatId: '0xabc' }));

    goBack();
    expect(goForward()).toBe(true);
    expect(applied.at(-1)?.section).toBe('chat');
    expect(applied.at(-1)?.chatId).toBe('0xabc');
  });

  it('назад с начала истории ничего не делает', () => {
    record(snap());
    expect(goBack()).toBe(false);
    expect(applied).toHaveLength(0);
  });

  it('вперёд в конце истории ничего не делает', () => {
    record(snap({ section: 'home' }));
    record(snap({ section: 'chat' }));
    expect(goForward()).toBe(false);
    expect(applied).toHaveLength(0);
  });

  it('новый переход из середины отбрасывает «будущее»', () => {
    record(snap({ section: 'home' }));
    record(snap({ section: 'chat' }));
    record(snap({ section: 'wallet' }));

    goBack(); // теперь на 'chat'
    record(snap({ section: 'settings' }));

    // В стопке: home, chat, settings. wallet отброшен.
    // Ключ — все шесть полей снимка через `|`, пустые дают пустые сегменты.
    expect(_debugStack()).toEqual([
      'home|||||',
      'chat|||||',
      'settings|||||',
    ]);
    expect(goForward()).toBe(false);
  });

  it('флаги canBack/canForward отражают позицию', () => {
    record(snap({ section: 'home' }));
    expect(navState.canBack).toBe(false);
    expect(navState.canForward).toBe(false);

    record(snap({ section: 'chat' }));
    expect(navState.canBack).toBe(true);
    expect(navState.canForward).toBe(false);

    goBack();
    expect(navState.canBack).toBe(false);
    expect(navState.canForward).toBe(true);
  });

  it('различает dApp-экраны внутри одного раздела', () => {
    record(snap({ section: 'dapps', dappView: null }));
    record(snap({ section: 'dapps', dappView: 'communities' }));
    record(snap({ section: 'dapps', dappView: 'communities', communityId: '0xc' }));

    expect(_debugStack()).toHaveLength(3);

    goBack();
    expect(applied.at(-1)?.communityId).toBeNull();
    goBack();
    expect(applied.at(-1)?.dappView).toBeNull();
  });

  it('обрезает историю по верхней границе', () => {
    for (let i = 0; i < 80; i++) record(snap({ chatId: `chat-${i}` }));
    expect(_debugStack().length).toBeLessThanOrEqual(50);
  });

  it('resetNavigation очищает стек и флаги', () => {
    record(snap({ section: 'home' }));
    record(snap({ section: 'chat' }));
    resetNavigation();

    expect(_debugStack()).toHaveLength(0);
    expect(navState.canBack).toBe(false);
    expect(navState.canForward).toBe(false);
  });

  it('запись того же экрана после шага назад не съедает «вперёд»', () => {
    // В реальном приложении `goBack()` меняет состояние, а эффект записи
    // видит это изменение и вызывает `record` повторно. Если бы такой
    // вызов дописывал шаг, история теряла бы «будущее» после каждого
    // возврата — и вперёд было бы некуда идти.
    record(snap({ section: 'home' }));
    record(snap({ section: 'chat' }));

    goBack();
    record(snap({ section: 'home' })); // эффект после восстановления

    expect(_debugStack()).toHaveLength(2);
    expect(navState.canForward).toBe(true);
    expect(goForward()).toBe(true);
  });
});
