// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';
import PasswordInput from './PasswordInput.svelte';

describe('PasswordInput Component', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('должен корректно отображать placeholder', () => {
    render(PasswordInput, { props: { value: '', placeholder: 'Test Placeholder' } });
    const input = screen.getByPlaceholderText('Test Placeholder');
    expect(input).toBeInTheDocument();
    expect(input).toHaveAttribute('type', 'password');
  });

  it('должен обновлять значение при вводе (bind:value)', async () => {
    let value = '';
    render(PasswordInput, {
      props: {
        value,
        onchange: (e: Event) => { value = (e.target as HTMLInputElement).value; }
      }
    });

    const input = screen.getByPlaceholderText('Password');
    await fireEvent.input(input, { target: { value: 'secret123' } });

    expect(input).toHaveValue('secret123');
  });

  it('должен вызывать onEnter при нажатии Enter', async () => {
    const onEnter = vi.fn();
    render(PasswordInput, { props: { value: 'test', onEnter } });

    const input = screen.getByPlaceholderText('Password');
    await fireEvent.keyDown(input, { key: 'Enter', code: 'Enter' });

    expect(onEnter).toHaveBeenCalledTimes(1);
  });

  it('не должен вызывать onEnter при нажатии других клавиш', async () => {
    const onEnter = vi.fn();
    render(PasswordInput, { props: { value: 'test', onEnter } });

    const input = screen.getByPlaceholderText('Password');
    await fireEvent.keyDown(input, { key: 'a', code: 'KeyA' });

    expect(onEnter).not.toHaveBeenCalled();
  });

  it('должен ставить фокус при autofocus=true', async () => {
    render(PasswordInput, { props: { value: '', autofocus: true } });
    await new Promise(r => setTimeout(r, 100));
    const input = screen.getByPlaceholderText('Password');
    expect(document.activeElement).toBe(input);
  });

  it('не должен ставить фокус при autofocus=false', async () => {
    render(PasswordInput, { props: { value: '', autofocus: false } });
    await new Promise(r => setTimeout(r, 100));
    const input = screen.getByPlaceholderText('Password');
    expect(document.activeElement).not.toBe(input);
  });

  it('должен быть disabled, если передан disabled=true', () => {
    render(PasswordInput, { props: { value: '', disabled: true } });
    const input = screen.getByPlaceholderText('Password');
    expect(input).toBeDisabled();
  });
});
