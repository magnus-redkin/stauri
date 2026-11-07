import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  normalizeFeedUrl,
  rewriteRsshub,
  RSSHUB_MIRROR,
  feedsState,
  loadFeeds,
} from './feedsStore.svelte';

// Стор трогает `localStorage` только в `loadFeeds`/`persist`; чистые
// функции ниже от него не зависят, но модуль импортирует `invoke` — его
// отсутствие в happy-dom не мешает, пока команды не вызываются.
const invokeMock = vi.fn();
vi.mock('@tauri-apps/api/core', () => ({ invoke: (...args: unknown[]) => invokeMock(...args) }));

describe('rewriteRsshub', () => {
  it('меняет хост rsshub.app на зеркало и сохраняет путь', () => {
    expect(rewriteRsshub('https://rsshub.app/telegram/channel/eveningprophet')).toBe(
      `https://${RSSHUB_MIRROR}/telegram/channel/eveningprophet`
    );
  });

  it('сохраняет query и хвост пути', () => {
    expect(rewriteRsshub('https://rsshub.app/twitter/user/elonmusk?limit=20')).toBe(
      `https://${RSSHUB_MIRROR}/twitter/user/elonmusk?limit=20`
    );
  });

  it('переписывает и www-вариант', () => {
    expect(rewriteRsshub('https://www.rsshub.app/discord/channel/950')).toBe(
      `https://${RSSHUB_MIRROR}/discord/channel/950`
    );
  });

  it('не трогает чужие хосты', () => {
    const other = 'https://news.ycombinator.com/rss';
    expect(rewriteRsshub(other)).toBe(other);
  });

  it('не трогает хост, который лишь заканчивается на rsshub.app', () => {
    // `evil-rsshub.app` не должен считаться RSSHub: сравнение идёт по
    // точному имени хоста, а не по суффиксу.
    const lookalike = 'https://evil-rsshub.app/telegram/channel/x';
    expect(rewriteRsshub(lookalike)).toBe(lookalike);
  });

  it('возвращает исходную строку, если это не URL', () => {
    expect(rewriteRsshub('rsshub.app/telegram')).toBe('rsshub.app/telegram');
  });
});

describe('normalizeFeedUrl', () => {
  it('переписывает rsshub.app на зеркало', () => {
    expect(normalizeFeedUrl('https://rsshub.app/telegram/channel/eveningprophet')).toBe(
      `https://${RSSHUB_MIRROR}/telegram/channel/eveningprophet`
    );
  });

  it('оставляет обычный RSS-адрес как есть', () => {
    const url = 'https://news.ycombinator.com/rss';
    expect(normalizeFeedUrl(url)).toBe(url);
  });

  it('превращает @name в маршрут RSSHub на зеркале', () => {
    // Не `t.me/s/name`: готовую HTML-страницу разбирать хрупко, а маршрут
    // RSSHub отдаёт настоящий RSS для любого канала.
    expect(normalizeFeedUrl('@status')).toBe(
      `https://${RSSHUB_MIRROR}/telegram/channel/status`
    );
  });

  it('превращает t.me/s/name в маршрут RSSHub', () => {
    expect(normalizeFeedUrl('t.me/s/status')).toBe(
      `https://${RSSHUB_MIRROR}/telegram/channel/status`
    );
  });

  it('превращает полную ссылку t.me/name в маршрут RSSHub', () => {
    // Пользователь копирует адрес канала из браузера целиком — это самый
    // частый способ, и раньше такой ввод уходил на `t.me/s/`, то есть
    // разбирался как HTML.
    expect(normalizeFeedUrl('https://t.me/eveningprophet')).toBe(
      `https://${RSSHUB_MIRROR}/telegram/channel/eveningprophet`
    );
    expect(normalizeFeedUrl('https://t.me/s/eveningprophet')).toBe(
      `https://${RSSHUB_MIRROR}/telegram/channel/eveningprophet`
    );
  });

  it('не путает t.me с чужим хостом', () => {
    // `t.me.evil.com` не должен считаться Telegram.
    const other = 'https://t.me.evil.com/feed';
    expect(normalizeFeedUrl(other)).toBe(other);
  });

  it('отклоняет пустой ввод и мусор', () => {
    expect(normalizeFeedUrl('')).toBeNull();
    expect(normalizeFeedUrl('   ')).toBeNull();
    expect(normalizeFeedUrl('stauri')).toBeNull();
  });
});

/**
 * Чтение хранилища.
 *
 * Главное, что здесь проверяется, — миграция: записи версии 1 содержат
 * отрывок с «…» внутри строки, поэтому их нужно перечитать с сервера. Без
 * этого пользователь после обновления видел бы старый обрезанный текст и
 * решил, что раскрытие по клику не работает.
 */
describe('loadFeeds', () => {
  beforeEach(() => {
    invokeMock.mockReset();
    localStorage.clear();
    feedsState.subscriptions.clear();
    // Флаг стоит после первого вызова в жизни модуля, поэтому сбрасываем
    // его вручную: иначе каждый следующий тест получал бы пустой стор.
    feedsState.loaded = false;
  });

  it('читает старый формат (голый массив) и перечитывает подписки', async () => {
    localStorage.setItem(
      'stauri:feeds',
      JSON.stringify([
        {
          url: 'https://example.com/feed',
          title: 'Old',
          source: 'example.com',
          items: [{ url: 'u', title: 't', summary: 'обрезано…', published_at: null }],
          fetchedAt: 1,
          error: '',
        },
      ])
    );
    invokeMock.mockResolvedValue({
      title: 'Fresh',
      source: 'example.com',
      items: [{ url: 'u2', title: 't2', summary: 'полный текст', published_at: null }],
    });

    loadFeeds();

    // Сразу после чтения — сохранённое; это состояние видно до обновления.
    expect(feedsState.subscriptions.get('https://example.com/feed')?.title).toBe('Old');

    // Обновление идёт фоном: ждём, пока цепочка отработает целиком, иначе
    // её вызов `invoke` попадёт в следующий тест и тот «увидит» лишний вызов.
    await new Promise((r) => setTimeout(r, 0));

    expect(invokeMock).toHaveBeenCalledWith('fetch_feed', {
      url: 'https://example.com/feed',
    });
    expect(feedsState.subscriptions.get('https://example.com/feed')?.title).toBe('Fresh');
  });

  it('читает новый формат (с версией) и не перечитывает подписки', async () => {
    localStorage.setItem(
      'stauri:feeds',
      JSON.stringify({
        version: 2,
        feeds: [
          {
            url: 'https://example.com/feed',
            title: 'Fresh',
            source: 'example.com',
            items: [{ url: 'u', title: 't', summary: 'полный текст', published_at: null }],
            fetchedAt: 2,
            error: '',
          },
        ],
      })
    );

    loadFeeds();
    await new Promise((r) => setTimeout(r, 0));

    expect(feedsState.subscriptions.get('https://example.com/feed')?.title).toBe('Fresh');
    // `invoke` используется ещё и логированием (`log_frontend`), поэтому
    // проверяем именно вызовы загрузки ленты, а не факт вызова вообще.
    expect(invokeMock.mock.calls.filter((c) => c[0] === 'fetch_feed')).toHaveLength(0);
  });

  it('пропускает записи неправильной формы, а не падает', () => {
    localStorage.setItem(
      'stauri:feeds',
      JSON.stringify({
        version: 2,
        feeds: [{ url: 42 }, { title: 'без url' }, null],
      })
    );

    expect(() => loadFeeds()).not.toThrow();
    expect(feedsState.subscriptions.size).toBe(0);
  });
});
