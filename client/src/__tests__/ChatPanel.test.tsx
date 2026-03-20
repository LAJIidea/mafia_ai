import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import ChatPanel from '../components/ChatPanel';

describe('ChatPanel 发言门控', () => {
  it('canSpeak=false时输入框禁用', () => {
    const onSend = vi.fn();
    render(<ChatPanel messages={[]} onSend={onSend} canSpeak={false} />);
    const input = screen.getByPlaceholderText('当前不可发言');
    expect(input).toBeDisabled();
  });

  it('canSpeak=true时输入框可用', () => {
    const onSend = vi.fn();
    render(<ChatPanel messages={[]} onSend={onSend} canSpeak={true} />);
    const input = screen.getByPlaceholderText('输入发言...');
    expect(input).not.toBeDisabled();
  });

  it('canSpeak=false时发送按钮禁用', () => {
    const onSend = vi.fn();
    render(<ChatPanel messages={[]} onSend={onSend} canSpeak={false} />);
    const sendBtn = screen.getByText('发送');
    expect(sendBtn).toBeDisabled();
  });

  it('canSpeak=true时可以发送消息', () => {
    const onSend = vi.fn();
    render(<ChatPanel messages={[]} onSend={onSend} canSpeak={true} />);
    const input = screen.getByPlaceholderText('输入发言...');
    fireEvent.change(input, { target: { value: '测试消息' } });
    fireEvent.click(screen.getByText('发送'));
    expect(onSend).toHaveBeenCalledWith('测试消息');
  });

  it('canSpeak=false时即使有输入也不能发送', () => {
    const onSend = vi.fn();
    const { rerender } = render(<ChatPanel messages={[]} onSend={onSend} canSpeak={true} />);
    const input = screen.getByPlaceholderText('输入发言...');
    fireEvent.change(input, { target: { value: '测试' } });
    // Switch to canSpeak=false
    rerender(<ChatPanel messages={[]} onSend={onSend} canSpeak={false} />);
    fireEvent.click(screen.getByText('发送'));
    expect(onSend).not.toHaveBeenCalled();
  });
});
